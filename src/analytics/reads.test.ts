import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as path from 'path';
import { createMiddleware, createMiddlewareFromConfig, MATCHER } from '../middleware';
import { createFreedomAccountGate, grantCookieValue, readSinkFor } from '../gate/accountGate';
import { createPasswordGate } from '../gate/passwordGate';
import {
  READ_PATH, READ_SIG_HEADER, signReadBody, resolveSink, sameSiteRoute, cleanRef, deviceOf, buildEvent, dispatch,
  type ReadEvent,
} from './reads';
import wikiTheme from '../theme';

const SECRET = 'test-secret';
const SIGN_IN = 'https://portal.example/wiki/sign-in';
const SINK = 'https://portal.example/api/wiki-reads';
const oracle = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex').slice(0, 32);

type Sent = { url: string; body: string; sig: string | null };
function recorder() {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(url), body: String(init?.body), sig: headers.get(READ_SIG_HEADER) });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { sent, fetchImpl, events: () => sent.map((s) => JSON.parse(s.body) as ReadEvent) };
}

const beacon = (body: string, headers: Record<string, string> = {}) =>
  new Request(`https://t.wiki${READ_PATH}`, { method: 'POST', body, headers: { 'user-agent': 'Mozilla/5.0 (iPhone)', ...headers } });

const accountMw = (fetchImpl: typeof fetch, extra: Parameters<typeof createMiddleware>[0] = {}) =>
  createMiddleware({ gate: createFreedomAccountGate({ signInUrl: SIGN_IN, secret: SECRET }), secret: SECRET, fetch: fetchImpl, analytics: { secret: SECRET }, ...extra });

const grant = async (uid: string) => `fw_gate=${await grantCookieValue(SECRET, uid, Math.floor(Date.now() / 1000) + 600)}`;

test('the signature matches node:crypto over "wiki-read:v1:" + body, which is what the portal verifies', async () => {
  const body = JSON.stringify({ v: 1, kind: 'read', host: 't.wiki', path: '/x', reader: 'abc', at: '2026-09-21T00:00:00.000Z', device: 'desktop' });
  assert.equal(await signReadBody('s', body), oracle('s', `wiki-read:v1:${body}`));
  assert.match(await signReadBody('s', ''), /^[a-f0-9]{32}$/);
});

test('a beacon from a signed-in reader is reported with the grant uid, signed, and answered 204', async () => {
  const r = recorder();
  const res = await accountMw(r.fetchImpl)(beacon(JSON.stringify({ path: '/concepts/x/', title: 'X | Wiki', ref: 'https://portal.example/wiki/sign-in?to=abc&pass=secret' }), {
    cookie: await grant('uid123'), 'x-vercel-ip-country': 'US',
  }));
  assert.equal(res?.status, 204);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, SINK);
  assert.equal(r.sent[0].sig, oracle(SECRET, `wiki-read:v1:${r.sent[0].body}`));
  const ev = r.events()[0];
  assert.equal(ev.v, 1);
  assert.equal(ev.kind, 'read');
  assert.equal(ev.host, 't.wiki');
  assert.equal(ev.path, '/concepts/x');
  assert.equal(ev.title, 'X | Wiki');
  assert.equal(ev.ref, 'https://portal.example/wiki/sign-in', 'the query string never leaves the edge');
  assert.equal(ev.reader, 'uid123');
  assert.equal(ev.country, 'US');
  assert.equal(ev.device, 'mobile');
  assert.ok(!Number.isNaN(Date.parse(ev.at)));
  assert.equal('ip' in ev, false);
  assert.equal(JSON.stringify(ev).includes('iPhone'), false, 'no raw user agent');
});

test('a key grant reads as "key", no grant as "anonymous", the password ticket as "password"', async () => {
  const r = recorder();
  const mw = accountMw(r.fetchImpl);
  await mw(beacon('{"path":"/a"}', { cookie: await grant('key') }));
  await mw(beacon('{"path":"/b"}'));
  assert.deepEqual(r.events().map((e) => e.reader), ['key', 'anonymous']);

  const pw = createPasswordGate({ password: 'word', secret: 'pw-secret' })!;
  const login = await createMiddleware({ gate: pw })(new Request('https://t.wiki/x?key=word'));
  const ticket = (login!.headers.get('set-cookie') ?? '').split(';')[0];
  const r2 = recorder();
  const res = await createMiddleware({ gate: pw, fetch: r2.fetchImpl, analytics: { endpoint: SINK, secret: 's' } })(beacon('{"path":"/a"}', { cookie: ticket }));
  assert.equal(res?.status, 204);
  assert.equal(r2.events()[0].reader, 'password', 'the password gate never saw the beacon body as a form');
});

test('a reader named in the beacon body is ignored: only the cookie names anyone', async () => {
  const r = recorder();
  await accountMw(r.fetchImpl)(beacon(JSON.stringify({ path: '/a', reader: 'someone-else' })));
  assert.equal(r.events()[0].reader, 'anonymous');
});

test('garbage is answered 204 and reported nowhere', async () => {
  const r = recorder();
  const mw = accountMw(r.fetchImpl);
  for (const body of ['', 'not json', '[]', 'null', '{"path":"https://evil.example/x"}', '{"path":"//evil.example"}', '{"path":"/../etc"}', '{"path":"relative"}', JSON.stringify({ path: '/a', title: 'x'.repeat(3000) })]) {
    const res = await mw(beacon(body));
    assert.equal(res?.status, 204, body.slice(0, 30));
  }
  assert.equal(r.sent.length, 0);
  const get = await mw(new Request(`https://t.wiki${READ_PATH}`));
  assert.equal(get?.status, 204, 'a GET is answered too, never the door');
  assert.equal(r.sent.length, 0);
});

test('a sink that throws or hangs never changes the answer', async () => {
  const boom = (async () => { throw new Error('down'); }) as typeof fetch;
  assert.equal((await accountMw(boom)(beacon('{"path":"/a"}')))?.status, 204);
  const hang = (() => new Promise<Response>(() => undefined)) as typeof fetch;
  const t0 = Date.now();
  assert.equal((await accountMw(hang)(beacon('{"path":"/a"}')))?.status, 204);
  assert.ok(Date.now() - t0 < 2000, 'the no-waitUntil path is capped');
});

test('with context.waitUntil the send is handed to the runtime and the response does not wait', async () => {
  const r = recorder();
  const handed: Promise<unknown>[] = [];
  const res = await accountMw(r.fetchImpl)(beacon('{"path":"/a"}'), { waitUntil: (p) => { handed.push(p); } });
  assert.equal(res?.status, 204);
  assert.equal(handed.length, 1);
  await Promise.all(handed);
  assert.equal(r.sent.length, 1);
});

test('dispatch awaits at most 800 ms when no waitUntil exists', async () => {
  const t0 = Date.now();
  await dispatch(new Promise(() => undefined));
  const took = Date.now() - t0;
  assert.ok(took >= 750 && took < 1500, `took ${took}`);
});

test('a door knock is logged as kind door, reader anonymous; a prefetch and a bot are not', async () => {
  const r = recorder();
  const mw = accountMw(r.fetchImpl);
  const res = await mw(new Request('https://t.wiki/concepts/x?y=1', { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://news.example/a?b=c' } }));
  assert.equal(res?.status, 401);
  await mw(new Request('https://t.wiki/concepts/y', { headers: { 'user-agent': 'Mozilla/5.0', 'sec-purpose': 'prefetch' } }));
  await mw(new Request('https://t.wiki/concepts/y', { headers: { 'user-agent': 'Slackbot 1.0' } }));
  await mw(new Request('https://t.wiki/concepts/y', { headers: { 'user-agent': 'GPTBot' } }));
  const evs = r.events();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'door');
  assert.equal(evs[0].reader, 'anonymous');
  assert.equal(evs[0].path, '/concepts/x');
  assert.equal(evs[0].ref, 'https://news.example/a');
  // an admitted reader's page load is NOT logged here: the beacon reports it
  await mw(new Request('https://t.wiki/concepts/x', { headers: { 'user-agent': 'Mozilla/5.0', cookie: await grant('u1') } }));
  assert.equal(r.sent.length, 1);
});

test('a served share mirror is logged as kind share, reader share', async () => {
  const r = recorder();
  const mw = accountMw(r.fetchImpl);
  const minted = await (await mw(new Request('https://t.wiki/s/mint?path=/concepts/x', { headers: { 'user-agent': 'Mozilla/5.0', cookie: await grant('u1') } })))!.json();
  const res = await mw(new Request(minted.url, { headers: { 'user-agent': 'Mozilla/5.0' } }));
  assert.match(res!.headers.get('x-middleware-rewrite') ?? '', /share-view/);
  await mw(new Request(minted.url, { headers: { 'user-agent': 'Twitterbot/1.0' } }));
  const evs = r.events();
  assert.equal(evs.length, 1, 'the unfurl bot is not a reader');
  assert.equal(evs[0].kind, 'share');
  assert.equal(evs[0].reader, 'share');
  assert.equal(evs[0].path, '/concepts/x');
});

test('analytics: false sends nothing and the beacon is still 204', async () => {
  const r = recorder();
  const mw = accountMw(r.fetchImpl, { analytics: false });
  assert.equal((await mw(beacon('{"path":"/a"}')))?.status, 204);
  assert.equal((await mw(new Request('https://t.wiki/x')))?.status, 401);
  assert.equal(r.sent.length, 0);
});

test('an open wiki with no endpoint sends nothing, ever', async () => {
  const r = recorder();
  const before = process.env.WIKI_ANALYTICS_URL;
  delete process.env.WIKI_ANALYTICS_URL;
  try {
    const mw = createMiddleware({ fetch: r.fetchImpl, analytics: { secret: 's' } });
    assert.equal((await mw(beacon('{"path":"/a"}')))?.status, 204);
    assert.equal(await mw(new Request('https://t.wiki/x')), undefined);
    assert.equal(r.sent.length, 0);
  } finally { if (before !== undefined) process.env.WIKI_ANALYTICS_URL = before; }
});

test('sink resolution: false wins, then WIKI_ANALYTICS_URL, then analytics.endpoint, then the gate default; no secret, no sink', () => {
  const env = { WIKI_PASS_SECRET: 'p', WIKI_GATE_SECRET: 'g' };
  assert.equal(resolveSink(false, SINK, { ...env, WIKI_ANALYTICS_URL: 'https://env.example/r' }), null);
  assert.deepEqual(resolveSink(undefined, SINK, { ...env, WIKI_ANALYTICS_URL: 'https://env.example/r' }), { endpoint: 'https://env.example/r', secret: 'p' });
  assert.deepEqual(resolveSink({ endpoint: 'https://cfg.example/r' }, SINK, env), { endpoint: 'https://cfg.example/r', secret: 'p' });
  assert.deepEqual(resolveSink(true, SINK, env), { endpoint: SINK, secret: 'p' });
  assert.deepEqual(resolveSink(undefined, SINK, { WIKI_GATE_SECRET: 'g' }), { endpoint: SINK, secret: 'g' });
  assert.equal(resolveSink(undefined, undefined, env), null, 'open wiki, no endpoint');
  assert.equal(resolveSink(undefined, SINK, {}), null, 'no secret');
  assert.equal(resolveSink({ endpoint: 'not a url' }, undefined, env), null);
});

test('the account gate implies the portal sink; createMiddlewareFromConfig carries analytics through', async () => {
  assert.equal(readSinkFor('https://freedom.continentalworks.ai/wiki/sign-in'), 'https://freedom.continentalworks.ai/api/wiki-reads');
  assert.equal(readSinkFor(), 'https://freedom.continentalworks.ai/api/wiki-reads');
  assert.equal(createFreedomAccountGate({ signInUrl: SIGN_IN }).readSink, SINK);
  const r = recorder();
  const before = { ...process.env };
  process.env.WIKI_PASS_SECRET = SECRET;
  delete process.env.WIKI_ANALYTICS_URL;
  try {
    // createMiddlewareFromConfig has no fetch seam, so intercept the global for this one test.
    const realFetch = globalThis.fetch;
    globalThis.fetch = r.fetchImpl;
    try {
      await createMiddlewareFromConfig({ gate: { type: 'freedom-account', signInUrl: SIGN_IN } })(beacon('{"path":"/a"}'));
      await createMiddlewareFromConfig({ gate: { type: 'freedom-account', signInUrl: SIGN_IN }, analytics: false })(beacon('{"path":"/b"}'));
    } finally { globalThis.fetch = realFetch; }
  } finally { process.env = before; }
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, SINK);
});

test('helpers: sameSiteRoute, cleanRef, deviceOf, buildEvent', () => {
  assert.equal(sameSiteRoute('/a/b/', 't.wiki'), '/a/b');
  assert.equal(sameSiteRoute('https://t.wiki/a?x#y', 't.wiki'), '/a');
  assert.equal(sameSiteRoute('https://o.wiki/a', 't.wiki'), null);
  assert.equal(sameSiteRoute('/', 't.wiki'), '/');
  assert.equal(sameSiteRoute('/a b', 't.wiki'), null);
  assert.equal(sameSiteRoute(42, 't.wiki'), null);
  assert.equal(cleanRef('javascript:alert(1)'), undefined);
  assert.equal(cleanRef('https://x.example/p?k=1#h'), 'https://x.example/p');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14) Mobile'), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh)'), 'desktop');
  assert.equal(deviceOf(null), 'desktop');
  const ev = buildEvent(new Request('https://t.wiki/x', { headers: { 'x-vercel-ip-country': 'not-a-country' } }), { kind: 'door', path: '/x', reader: 'anonymous', now: new Date(0) });
  assert.deepEqual(ev, { v: 1, kind: 'door', host: 't.wiki', path: '/x', reader: 'anonymous', at: '1970-01-01T00:00:00.000Z', device: 'desktop' });
});

test('the matcher lets /_wiki/read reach the middleware', () => {
  const re = new RegExp('^' + MATCHER[0] + '$');
  assert.equal(re.test(READ_PATH), true);
});

test('the theme registers the beacon as a client module, outside the theme path', () => {
  const mods = (wikiTheme({} as never).getClientModules?.() ?? []) as string[];
  assert.ok(mods.some((m) => m.endsWith(path.join('analytics', 'client.js'))), mods.join(', '));
});
