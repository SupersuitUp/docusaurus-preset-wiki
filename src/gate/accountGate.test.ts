import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMiddleware } from '../middleware';
import { createFreedomAccountGate, hourKey, namedHourKey, mintPass, grantCookieValue } from './accountGate';

const SECRET = 'test-secret';
const SIGN_IN = 'https://freedom.example/wiki/sign-in';
const req = (url: string, init: { ua?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = { 'user-agent': init.ua ?? 'Mozilla/5.0' };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(url, { headers });
};
const gated = (opts: Parameters<typeof createFreedomAccountGate>[0] = {}) =>
  createMiddleware({ gate: createFreedomAccountGate({ signInUrl: SIGN_IN, secret: SECRET, ...opts }), secret: SECRET });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

test('the pass and the hourly key match node:crypto, which is what the portal signs with', async () => {
  // The portal (continental-works-web) mints both with createHmac; the wiki verifies with Web
  // Crypto. An independent oracle here is what keeps the two implementations from drifting.
  const oracle = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex').slice(0, 32);
  assert.equal(await hourKey('s', 3_600_000 * 5 + 17), oracle('s', 'wiki-gate:5'));
  assert.equal(await mintPass('s', 'uid1', 1000), `v1.uid1.1000.${oracle('s', 'wiki-pass:v1.uid1.1000')}`);
  assert.equal(await grantCookieValue('s', 'uid1', 1000), `v1.uid1.1000.${oracle('s', 'wiki-grant:v1.uid1.1000')}`);
});

test('a stranger meets the door: 401, noindex, a sign-in link that carries the page they asked for', async () => {
  const res = await gated()(req('https://t.wiki/concepts/the-supersuit?x=1'));
  assert.equal(res?.status, 401);
  assert.match(res!.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(res!.headers.get('x-robots-tag'), 'noindex');
  const html = await res!.text();
  assert.match(html, /early access program/);
  assert.match(html, new RegExp(`${SIGN_IN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\?to=https%3A%2F%2Ft\\.wiki%2Fconcepts%2Fthe-supersuit%3Fx%3D1`));
});

test('a fresh pass sets the week-long grant and 303s to the clean url', async () => {
  const pass = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 300);
  const res = await gated()(req(`https://t.wiki/concepts/x?pass=${pass}&y=2#h`));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/concepts/x?y=2#h');
  assert.match(res!.headers.get('set-cookie') ?? '', /^fw_gate=v1\.abc\.\d+\.[a-f0-9]{32}; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax$/);
});

test('the grant admits the reader for a week; a forged, expired or foreign-secret grant does not', async () => {
  const mw = gated();
  const pass = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 300);
  const cookie = cookieOf((await mw(req(`https://t.wiki/x?pass=${pass}`)))!);
  assert.equal(await mw(req('https://t.wiki/concepts/x', { cookie })), undefined, 'grant admits');
  assert.equal((await mw(req('https://t.wiki/x', { cookie: cookie.replace(/[a-f0-9]{32}$/, '0'.repeat(32)) })))?.status, 401, 'forged');
  const expired = `fw_gate=${await grantCookieValue(SECRET, 'abc', Math.floor(Date.now() / 1000) - 1)}`;
  assert.equal((await mw(req('https://t.wiki/x', { cookie: expired })))?.status, 401, 'expired');
  const foreign = `fw_gate=${await grantCookieValue('other', 'abc', Math.floor(Date.now() / 1000) + 100)}`;
  assert.equal((await mw(req('https://t.wiki/x', { cookie: foreign })))?.status, 401, 'foreign secret');
});

test('an expired, forged or wrong-secret pass is the door with the expired line, never a grant', async () => {
  const mw = gated();
  const expired = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) - 1);
  const res = await mw(req(`https://t.wiki/x?pass=${expired}`));
  assert.equal(res?.status, 401);
  assert.equal(res!.headers.get('set-cookie'), null);
  assert.match(await res!.text(), /expired/);
  const forged = (await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 100)).replace(/[a-f0-9]{32}$/, '1'.repeat(32));
  assert.equal((await mw(req(`https://t.wiki/x?pass=${forged}`)))?.status, 401);
  const foreign = await mintPass('other', 'abc', Math.floor(Date.now() / 1000) + 100);
  assert.equal((await mw(req(`https://t.wiki/x?pass=${foreign}`)))?.status, 401);
});

test('the hourly account key (?k=) still opens the door, this hour and the last, and is redeemed on any path', async () => {
  const mw = gated({ keySecret: 'key-secret' });
  const now = Date.now();
  const res = await mw(req(`https://t.wiki/?k=${await hourKey('key-secret', now)}`));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/');
  assert.match(res!.headers.get('set-cookie') ?? '', /^fw_gate=v1\.key\./);
  const last = await mw(req(`https://t.wiki/x?k=${await hourKey('key-secret', now - 3_600_000)}`));
  assert.equal(last?.status, 303, 'previous hour');
  const stale = await mw(req(`https://t.wiki/x?k=${await hourKey('key-secret', now - 2 * 3_600_000)}`));
  assert.equal(stale?.status, 401, 'two hours ago is refused');
  const wrongSecret = await mw(req(`https://t.wiki/x?k=${await hourKey(SECRET, now)}`));
  assert.equal(wrongSecret?.status, 401, 'the pass secret does not mint keys');
});

test('the named key matches node:crypto and a fixed vector the portal test shares', async () => {
  const oracle = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex').slice(0, 32);
  const at = 3_600_000 * 494000 + 17;
  // SHARED VECTOR: continental-works-web/src/app/api/wiki-key/wiki-key.test.mjs asserts the same strings.
  assert.equal(await namedHourKey('vector-secret', at, 'Uq1Zx9_-acct'), 'Uq1Zx9_-acct.eb98741b11794f996d518302388b558c');
  assert.equal(await hourKey('vector-secret', at), 'ca70f3b196d3924c25b94b4511d09379');
  assert.equal(await namedHourKey('s', at, 'u1'), `u1.${oracle('s', 'wiki-gate:494000:u1')}`);
  await assert.rejects(namedHourKey('s', at, 'bad.uid'), /uid/);
});

test('a named key opens the door this hour and the last, and its grant names the account', async () => {
  const mw = gated({ keySecret: 'key-secret' });
  const now = Date.now();
  const res = await mw(req(`https://t.wiki/concepts/x?k=${await namedHourKey('key-secret', now, 'acct_42')}&y=1`));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/concepts/x?y=1');
  assert.match(res!.headers.get('set-cookie') ?? '', /^fw_gate=v1\.acct_42\.\d+\.[a-f0-9]{32};/);
  const last = await mw(req(`https://t.wiki/x?k=${await namedHourKey('key-secret', now - 3_600_000, 'acct_42')}`));
  assert.match(last!.headers.get('set-cookie') ?? '', /^fw_gate=v1\.acct_42\./, 'previous hour');
  const stale = await mw(req(`https://t.wiki/x?k=${await namedHourKey('key-secret', now - 2 * 3_600_000, 'acct_42')}`));
  assert.equal(stale?.status, 401, 'two hours ago is refused');

  // The verdict on the grant carries the uid, which is what reader analytics read.
  const gate = createFreedomAccountGate({ signInUrl: SIGN_IN, secret: SECRET, keySecret: 'key-secret' });
  const verdict = await gate(req('https://t.wiki/x', { cookie: cookieOf(res!) }));
  assert.equal(verdict.authorized, true);
  assert.equal(verdict.reader, 'acct_42');
  const bare = await mw(req(`https://t.wiki/x?k=${await hourKey('key-secret', now)}`));
  assert.equal((await gate(req('https://t.wiki/x', { cookie: cookieOf(bare!) }))).reader, 'key', 'the bare key still reads as key');
});

test('a named key with the wrong uid, a wrong sig, a foreign secret or a bad shape is the door', async () => {
  const mw = gated({ keySecret: 'key-secret' });
  const now = Date.now();
  const good = await namedHourKey('key-secret', now, 'acct_42');
  const sig = good.split('.')[1];
  const tries = {
    'uid swapped': `someone_else.${sig}`,
    'sig forged': `acct_42.${'0'.repeat(32)}`,
    'foreign secret': await namedHourKey(SECRET, now, 'acct_42'),
    'bare sig of the named key': sig,
    'three parts': `${good}.x`,
    'bad uid chars': `a%20b.${sig}`,
    'empty uid': `.${sig}`,
    'short sig': `acct_42.${sig.slice(1)}`,
  };
  for (const [why, k] of Object.entries(tries)) {
    const res = await mw(req(`https://t.wiki/x?k=${encodeURIComponent(k)}`));
    assert.equal(res?.status, 401, why);
    assert.equal(res!.headers.get('set-cookie'), null, why);
  }
});

test('the key secret defaults to the pass secret when none is given', async () => {
  const res = await gated()(req(`https://t.wiki/x?k=${await hourKey(SECRET, Date.now())}`));
  assert.equal(res?.status, 303);
});

test('machine paths and unfurl bots pass; training crawlers never reach the door', async () => {
  const mw = gated();
  for (const p of ['/skills/x/SKILL.md', '/audio/a.mp3', '/generators/g/GENERATE.md'])
    assert.equal(await mw(req(`https://t.wiki${p}`)), undefined, p);
  assert.equal(await mw(req('https://t.wiki/concepts/x', { ua: 'Slackbot-LinkExpanding 1.0' })), undefined, 'unfurl bot');
  assert.equal((await mw(req('https://t.wiki/concepts/x', { ua: 'GPTBot/1.0' })))?.status, 403);
});

test('a key on a machine path serves the file in one request, no 303, no cookie (freedom#137)', async () => {
  const res = await gated()(req(`https://t.wiki/skills/x/SKILL.md?k=${await hourKey(SECRET, Date.now())}`));
  assert.equal(res, undefined);
});

// THE BULK EXPORTS (supersuit-wiki#15). llms.txt, llms-full.txt and search-index.json carry the
// text of every gated page in one file, so serving them open published the whole wiki to anyone
// with curl. They are behind the same credentials the pages take, answered in one request.
const EXPORTS = ['/llms.txt', '/llms-full.txt', '/search-index.json'];
const keyReq = (url: string, headers: Record<string, string>) => new Request(url, { headers: { 'user-agent': 'node', ...headers } });

test('the bulk exports refuse a stranger with a plain 401, even where openPaths names them', async () => {
  // The second gate is the Supersuit Wiki's own openPaths, which names llms and every .json.
  for (const mw of [gated(), gated({ openPaths: /^\/(llms\.txt|llms-full\.txt)$|\.(?:md|txt|json)$/i })]) {
    for (const p of EXPORTS) {
      const res = await mw(req(`https://t.wiki${p}`));
      assert.equal(res?.status, 401, p);
      assert.match(res!.headers.get('content-type') ?? '', /text\/plain/, `${p}: a program gets text, not the door`);
      assert.match(res!.headers.get('www-authenticate') ?? '', /^Bearer/, p);
      assert.equal(res!.headers.get('location'), null, `${p}: never a redirect`);
    }
  }
});

test('the hourly key opens an export in one request, as ?k= or a Bearer header, with no 303', async () => {
  const mw = gated();
  const bare = await hourKey(SECRET, Date.now());
  const named = await namedHourKey(SECRET, Date.now(), 'uid1');
  assert.equal(await mw(req(`https://t.wiki/llms-full.txt?k=${bare}`)), undefined, 'bare key in the query');
  assert.equal(await mw(keyReq('https://t.wiki/llms-full.txt', { authorization: `Bearer ${named}` })), undefined, 'named key as a header');
  assert.equal(await mw(keyReq('https://t.wiki/llms.txt', { authorization: `Bearer ${bare}` })), undefined, 'bare key as a header');
  assert.equal((await mw(keyReq('https://t.wiki/llms-full.txt', { authorization: `Bearer ${'0'.repeat(32)}` })))?.status, 401, 'a wrong key');
  assert.equal((await mw(req(`https://t.wiki/llms-full.txt?k=${await hourKey('other', Date.now())}`)))?.status, 401, 'a foreign key');
});

test('a signed-in reader reads the exports with the grant they already hold (the search box)', async () => {
  const mw = gated();
  const cookie = `fw_gate=${await grantCookieValue(SECRET, 'abc', Math.floor(Date.now() / 1000) + 3600)}`;
  assert.equal(await mw(req('https://t.wiki/search-index.json', { cookie })), undefined);
  const pass = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 300);
  assert.equal(await mw(req(`https://t.wiki/llms-full.txt?pass=${pass}`)), undefined, 'a pass opens it without a 303');
});

test('an allowlist binds the exports too, and act mode leaves them open with its pages', async () => {
  const bare = await hourKey(SECRET, Date.now());
  assert.equal((await gated({ allow: ['gary'] })(req(`https://t.wiki/llms-full.txt?k=${bare}`)))?.status, 403, 'a bare key names nobody on the list');
  const named = await namedHourKey(SECRET, Date.now(), 'gary');
  assert.equal(await gated({ allow: ['gary'] })(req(`https://t.wiki/llms-full.txt?k=${named}`)), undefined, 'a listed account');
  for (const p of EXPORTS) assert.equal(await gated({ mode: 'act' })(req(`https://t.wiki${p}`)), undefined, `act: ${p}`);
});

test('openPaths replaces the machine-path default, so a wiki whose /skills/ is docs can keep it gated', async () => {
  const mw = gated({ openPaths: /\.(md|txt)$|^\/llms\.txt$/i });
  assert.equal(await mw(req('https://t.wiki/skills/foo/SKILL.md')), undefined, 'the file is open');
  assert.equal((await mw(req('https://t.wiki/skills/foo')))?.status, 401, 'the docs page is gated');
  assert.equal((await mw(req('https://t.wiki/audio/a.mp3')))?.status, 401, 'audio no longer in the default');
});

test('no secret fails OPEN and says so in a header, matching the family posture', async () => {
  const mw = createMiddleware({ gate: createFreedomAccountGate({ signInUrl: SIGN_IN, secret: '' }) });
  const res = await mw(req('https://t.wiki/x'));
  assert.equal(res?.headers.get('x-middleware-next'), '1');
  assert.equal(res?.headers.get('x-wiki-gate'), 'gate-misconfigured-no-secret');
});

test('allow admits only the listed accounts; anyone else signed in meets a 403 naming them, with Sign out', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const grant = async (uid: string) => `fw_gate=${await grantCookieValue(SECRET, uid, exp)}`;
  const mw = gated({ allow: ['gary', 'wilson'] });
  assert.equal(await mw(req('https://t.wiki/x', { cookie: await grant('gary') })), undefined, 'listed account admitted');
  assert.equal(await mw(req('https://t.wiki/x', { cookie: await grant('wilson') })), undefined, 'second listed account admitted');
  const res = await mw(req('https://t.wiki/x', { cookie: await grant('stranger') }));
  assert.equal(res?.status, 403);
  assert.equal(res!.headers.get('x-robots-tag'), 'noindex');
  const html = await res!.text();
  assert.match(html, /<code>stranger<\/code>/, 'names who they are signed in as');
  assert.match(html, /href="\/sign-out"/, 'offers sign out');
  // A grant the bare hourly key bought names nobody, so it is never on a list.
  assert.equal((await mw(req('https://t.wiki/x', { cookie: await grant('key') })))?.status, 403);
  // Anonymous is still the door, not the refusal.
  assert.equal((await mw(req('https://t.wiki/x')))?.status, 401);
});

test('allow is read per request when it is a function, and an empty list admits nobody (fails closed)', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cookie = `fw_gate=${await grantCookieValue(SECRET, 'gary', exp)}`;
  let list: string[] | undefined = ['gary'];
  const mw = gated({ allow: () => list });
  assert.equal(await mw(req('https://t.wiki/x', { cookie })), undefined);
  list = [];
  assert.equal((await mw(req('https://t.wiki/x', { cookie })))?.status, 403, 'empty list');
  list = undefined;
  assert.equal((await mw(req('https://t.wiki/x', { cookie })))?.status, 403, 'unset list');
});

test('a refused account is still served a share link and still reaches /sign-out', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cookie = `fw_gate=${await grantCookieValue(SECRET, 'stranger', exp)}`;
  const mw = gated({ allow: ['gary'] });
  const out = await mw(req('https://t.wiki/sign-out', { cookie }));
  assert.equal(out?.status, 303);
  assert.match(out!.headers.get('set-cookie') ?? '', /fw_gate=; Path=\/; Max-Age=0/);
});

test('parseAllowList splits on commas and whitespace and drops blanks', async () => {
  const { parseAllowList } = await import('./accountGate');
  assert.deepEqual(parseAllowList(' a, b ,,c\nd '), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseAllowList(undefined), []);
  assert.deepEqual(parseAllowList(''), []);
});

test('a wiki can say who its door is for; the default still reads as early access', async () => {
  const own = await (await gated({ door: { heading: 'The <team> wiki', body: 'Only the two of us.' } })(req('https://t.wiki/x')))!.text();
  assert.match(own, /The &lt;team&gt; wiki/, 'the heading is escaped');
  assert.match(own, /Only the two of us\./);
  assert.doesNotMatch(own, /early access program/);
  const dflt = await (await gated()(req('https://t.wiki/x')))!.text();
  assert.match(dflt, /early access program/);
});

test('door theme "ascent" dresses the door and the not-allowed page in the Continental Works look', async () => {
  const door = await (await gated({ door: { theme: 'ascent' } })(req('https://t.wiki/x')))!.text();
  assert.match(door, /family=Fraunces/, 'loads the display face');
  assert.match(door, /#105971/i, 'teal poster border');
  assert.match(door, /--mulberry: #A12A5E;/, 'mulberry primary action');
  assert.match(door, /a\.button \{[^}]*background: var\(--mulberry\)/, 'the action is drawn in mulberry');
  assert.match(door, /--deepmulberry: #8A2451;/, 'deep mulberry for hover and press');
  assert.match(door, /a\.button:hover, a\.button:active \{ background: var\(--deepmulberry\); \}/);
  assert.match(door, /\.error \{[^}]*border-left: 4px solid var\(--mulberry\)/, 'the error bar is mulberry');
  // The sixth stripe was tomato #DB371F (hover #D63219) until 2026-10-12, and raspberry #C22D55 for
  // an hour that evening. None of the three hexes, and neither old token name, may come back.
  for (const gone of [/#DB371F/i, /#D63219/i, /#C22D55/i, /tomato/i, /deepred/i]) assert.doesNotMatch(door, gone, `the old sixth stripe is gone: ${gone}`);
  assert.match(door, /#F6E7C5/i, 'cream text on the action');
  assert.doesNotMatch(door, /#2f6f5f/i, 'none of the neutral door accent survives');
  // The ribbon runs teal to mulberry, never another order.
  const order = ['#105971', '#69B1B5', '#EED79E', '#E9A23B', '#DD562F', '#A12A5E'].map((h) => door.toUpperCase().indexOf(`${h} `));
  assert.ok(order.every((i) => i > -1), 'all six stripes are drawn');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'stripes in ribbon order');
  assert.match(door, /early access program/, 'theme changes the look, not the words');

  const { notAllowedPage } = await import('./accountGate');
  const no = notAllowedPage('t.wiki', 'someone@x', 'ascent');
  assert.match(no, /family=Fraunces/);
  assert.match(no, /#105971/i);
  assert.doesNotMatch(no, /#2f6f5f/i);
  assert.match(no, /--mulberry: #A12A5E;/);
  for (const gone of [/#DB371F/i, /#D63219/i, /#C22D55/i, /tomato/i, /deepred/i]) assert.doesNotMatch(no, gone);
});

test('with no theme the door keeps the neutral look', async () => {
  const dflt = await (await gated()(req('https://t.wiki/x')))!.text();
  assert.match(dflt, /#2f6f5f/i);
  assert.doesNotMatch(dflt, /Fraunces/);
  const { notAllowedPage } = await import('./accountGate');
  assert.doesNotMatch(notAllowedPage('t.wiki', 'a@b'), /Fraunces/);
});

test('the ascent door has no teal frame, and its ribbon rises from a fan into the card', async () => {
  const door = await (await gated({ door: { theme: 'ascent' } })(req('https://t.wiki/x')))!.text();
  assert.doesNotMatch(door, /box-shadow: 0 0 0 120px/, 'the poster frame is gone');
  assert.doesNotMatch(door, /html \{ background: var\(--teal\)/);
  assert.doesNotMatch(door, /\n  main \{[^}]*background/, 'no card: the ribbon is the frame');
  assert.match(door, /main::before \{[^}]*right: calc\(\(100% - 100vw\) \/ 2\)/, 'the thread runs to the screen edge');
  const { riseHtml } = await import('./accountGate');
  assert.ok(door.includes(riseHtml()), 'the ribbon is on the door');
  const turn = [...riseHtml().matchAll(/<path d="M([\d.]+) 24 A([\d.]+) [\d.]+ 0 0 1 24 ([\d.]+)" stroke="var\(--(\w+)\)"/g)];
  assert.deepEqual(turn.map((m) => m[4]), ['teal', 'aqua', 'sand', 'mustard', 'burnt', 'mulberry']);
  // Each strand climbs at x = 1 + 2i and lands on thread row 1 + 2i: a quarter circle, no gap.
  turn.forEach((m, i) => {
    assert.equal(+m[1], 1 + 2 * i);
    assert.equal(+m[3], 1 + 2 * i);
    assert.equal(+m[2], 24 - +m[1]);
  });
  const fan = [...riseHtml().matchAll(/<path d="M([-\d.]+) ([\d.]+) C/g)];
  assert.ok(+fan[0][1] < 0 && +fan[1][1] < 0, 'teal and aqua enter from the side');
  assert.ok(fan.slice(2).every((m) => +m[2] > 140), 'the rest enter through the bottom edge');
  const xs = fan.slice(2).map((m) => +m[1]);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'bottom entries in ribbon order, so nothing crosses');
  const no = (await import('./accountGate')).notAllowedPage('t.wiki', 'a@b', 'ascent');
  assert.ok(no.includes(riseHtml()));
  assert.doesNotMatch(await (await gated()(req('https://t.wiki/x')))!.text(), /class="rise"/, 'neutral door untouched');
});

// THE MAISON DOOR (2026-10-17), for a product wiki that wears the Maison (the Supersuit Wiki).
// continental-works-universe canon/craft/maison-kit.json, piece product-ground-follows-phone:
// stone in light mode, night in dark mode, chosen by the reader's phone; DM Serif Display to
// inscribe and DM Sans at 400 and up to read (maison-type); no saturated colour on the house
// (no-go decorative-colour). Gary, 2026-10-17: "The supersuit wiki gating screens need to be
// updated to new branding."
const MAISON = { night: '#17171a', walnut: '#2e2119', travertine: '#e8e0d2', marble: '#f4f1ec', bronze: '#a8834f', ink: '#1c1a17', mist: '#d8d1c4' };
const hexesIn = (html: string) => [...(html.match(/<style>[\s\S]*<\/style>/)?.[0] ?? '').matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());

test('door theme "maison" draws the Maison: stone or night by the phone, pair A, nothing saturated', async () => {
  const { notAllowedPage, DOOR_THEMES } = await import('./accountGate');
  assert.ok(DOOR_THEMES.includes('maison'));
  const door = await (await gated({ door: { theme: 'maison' } })(req('https://t.wiki/x')))!.text();
  const no = notAllowedPage('t.wiki', 'someone@x', 'maison');
  for (const page of [door, no]) {
    for (const [name, hex] of Object.entries(MAISON)) assert.match(page, new RegExp(`--${name}: ${hex};`), `the ${name} token`);
    assert.match(page, /family=DM\+Serif\+Display/, 'the inscription face');
    assert.match(page, /family=DM\+Sans/, 'the reading face');
    assert.match(page, /@media \(prefers-color-scheme: dark\)/, 'the ground follows the phone');
    assert.match(page, /<meta name="theme-color" content="#f4f1ec" media="\(prefers-color-scheme: light\)"/);
    assert.match(page, /<meta name="theme-color" content="#17171a" media="\(prefers-color-scheme: dark\)"/);
    assert.match(page, /a\.button \{[^}]*background: var\(--press\)/, 'the action is the pressed colour');
    assert.match(page, /:root \{[^}]*--press: var\(--walnut\)/, 'walnut to press on stone');
    assert.match(page, /prefers-color-scheme: dark\) \{ :root \{[^}]*--press: var\(--bronze\)/, 'bronze to press at night');
    const stray = hexesIn(page).filter((h) => !Object.values(MAISON).includes(h));
    assert.deepEqual(stray, [], 'every colour on the door is a house token');
    assert.doesNotMatch(page, /Fraunces|class="rise"|mulberry|#2f6f5f/i, 'nothing of the Ascent or the neutral card');
    assert.doesNotMatch(page, /font-weight: [123]00\b/, 'reading type is never light');
  }
  assert.match(door, /early access program/, 'theme changes the look, not the words');
  assert.match(no, /someone@x/);
});

test('an empty door body draws no line at all, so a door can be one sentence and a button', async () => {
  // Gary, 2026-10-17, on the Supersuit Wiki's door: "This website is gated. That's it".
  const door = await (await gated({ door: { heading: 'This website is gated.', body: '', theme: 'maison' } })(req('https://t.wiki/x')))!.text();
  assert.match(door, /<h1>This website is gated\.<\/h1>/);
  assert.doesNotMatch(door, /<p>\s*<\/p>/, 'no empty paragraph where the line was');
  assert.doesNotMatch(door, /invited with/, 'the default line does not come back');
  assert.match(door, /class="button"[^>]*>Sign in</);
});

// ACT MODE (Gary, 2026-10-27): the wiki is public to READ; signing in is only to ACT, which today
// means minting a share or superlink. Standard: https://hypercontext.wiki/standards/superlink/v1
const actMw = (fetchImpl?: typeof fetch) => createMiddleware({
  gate: createFreedomAccountGate({ signInUrl: SIGN_IN, secret: SECRET, mode: 'act' }), secret: SECRET,
  ...(fetchImpl ? { fetch: fetchImpl, analytics: { secret: SECRET } } : { analytics: false }),
});
const grantFor = async (uid: string) => `fw_gate=${await grantCookieValue(SECRET, uid, Math.floor(Date.now() / 1000) + 600)}`;

test('act mode (a): a page is readable with no cookie, no door, no knock', async () => {
  assert.equal(await actMw()(req('https://t.wiki/concepts/x')), undefined);
  assert.equal(await actMw()(req('https://t.wiki/')), undefined);
});

test('act mode (b): minting with no grant goes to sign-in, returning to the page', async () => {
  const back = encodeURIComponent('https://t.wiki/concepts/x?act=share');
  // A navigation is redirected to the same sign-in the read-mode door uses.
  const nav = await actMw()(req('https://t.wiki/s/mint?path=/concepts/x'));
  assert.equal(nav?.status, 303);
  assert.equal(nav!.headers.get('location'), `${SIGN_IN}?to=${back}`);
  // The Share button's fetch cannot follow a cross-site redirect, so it is told where to go.
  const api = await actMw()(new Request('https://t.wiki/s/mint?path=/concepts/x&to=Tim', { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } }));
  assert.equal(api?.status, 401);
  assert.deepEqual(await api!.json(), { error: 'sign_in_to_act', signIn: `${SIGN_IN}?to=${back}` });
});

test('act mode (b): on return the pass is redeemed and keeps the return marker, so the mint can proceed', async () => {
  const pass = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 300);
  const res = await actMw()(req(`https://t.wiki/concepts/x?act=share&pass=${pass}`));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/concepts/x?act=share');
  assert.match(res!.headers.get('set-cookie') ?? '', /^fw_gate=v1\.abc\./);
});

test('act mode (c): a mint with a grant succeeds, and a forward link records its signed-in maker', async () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: unknown, init?: RequestInit) => { sent.push(String(init?.body)); return new Response(null, { status: 204 }); }) as typeof fetch;
  const cookie = await grantFor('u1');
  const plain = await actMw(fetchImpl)(req('https://t.wiki/s/mint?path=/concepts/x', { cookie }));
  assert.equal(plain?.status, 200);
  assert.equal((await plain!.json()).focused, true);
  const named = await actMw(fetchImpl)(req('https://t.wiki/s/mint?path=/concepts/x&to=Tim&forward=signed-in', { cookie }));
  assert.equal(named?.status, 200);
  const body = await named!.json();
  assert.equal(body.superlink, true);
  const mint = sent.map((s) => JSON.parse(s)).find((e) => e.kind === 'mint');
  assert.equal(mint.reader, 'u1', 'the maker is the signed-in reader');
  assert.equal(mint.link.rid, body.rid);
});

test('act mode: a signed-in reader off the allowlist still reads, but cannot mint', async () => {
  const mw = createMiddleware({ gate: createFreedomAccountGate({ signInUrl: SIGN_IN, secret: SECRET, mode: 'act', allow: ['u1'] }), secret: SECRET, analytics: false });
  const cookie = await grantFor('u2');
  assert.equal(await mw(req('https://t.wiki/concepts/x', { cookie })), undefined);
  assert.equal((await mw(req('https://t.wiki/s/mint?path=/concepts/x', { cookie })))?.status, 403);
});

test('act mode: a share address sent to someone with no grant still opens the one-article view', async () => {
  const cookie = await grantFor('u1');
  const { url } = await (await actMw()(req('https://t.wiki/s/mint?path=/concepts/x', { cookie })))!.json();
  const res = await actMw()(req(url));
  assert.match(res!.headers.get('x-middleware-rewrite') ?? '', /\/share-view\/concepts\/x/);
});

test('read mode (d) is unchanged: mode "read" and no mode both meet the door, and mint is 401', async () => {
  for (const mw of [gated(), gated({ mode: 'read' })]) {
    assert.equal((await mw(req('https://t.wiki/concepts/x')))?.status, 401);
    assert.equal((await mw(req('https://t.wiki/s/mint?path=/concepts/x')))?.status, 401);
  }
});
