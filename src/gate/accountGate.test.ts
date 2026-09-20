import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMiddleware } from '../middleware';
import { createFreedomAccountGate, hourKey, mintPass, grantCookieValue } from './accountGate';

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

test('the key secret defaults to the pass secret when none is given', async () => {
  const res = await gated()(req(`https://t.wiki/x?k=${await hourKey(SECRET, Date.now())}`));
  assert.equal(res?.status, 303);
});

test('machine paths and unfurl bots pass; training crawlers never reach the door', async () => {
  const mw = gated();
  for (const p of ['/skills/x/SKILL.md', '/llms.txt', '/llms-full.txt', '/audio/a.mp3', '/generators/g/GENERATE.md'])
    assert.equal(await mw(req(`https://t.wiki${p}`)), undefined, p);
  assert.equal(await mw(req('https://t.wiki/concepts/x', { ua: 'Slackbot-LinkExpanding 1.0' })), undefined, 'unfurl bot');
  assert.equal((await mw(req('https://t.wiki/concepts/x', { ua: 'GPTBot/1.0' })))?.status, 403);
});

test('a key on a machine path serves the file in one request, no 303, no cookie (freedom#137)', async () => {
  const res = await gated()(req(`https://t.wiki/skills/x/SKILL.md?k=${await hourKey(SECRET, Date.now())}`));
  assert.equal(res, undefined);
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
