import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiddleware, MATCHER } from './middleware';

const req = (url: string, ua = 'Mozilla/5.0', extra: Record<string, string> = {}) =>
  new Request(url, { headers: { 'user-agent': ua, ...extra } });

test('a training crawler gets 403', async () => {
  const res = await createMiddleware()(req('https://t.wiki/concepts/x', 'GPTBot/1.0'));
  assert.equal(res?.status, 403);
});

test('an unfurl bot passes an open wiki', async () => {
  assert.equal(await createMiddleware()(req('https://t.wiki/concepts/x', 'Twitterbot/1.0')), undefined);
});

test('an ordinary reader passes an open wiki', async () => {
  assert.equal(await createMiddleware()(req('https://t.wiki/concepts/x')), undefined);
});

test('open wiki: /s/mint answers the page url with focused:false', async () => {
  const res = await createMiddleware()(req('https://t.wiki/s/mint?path=/concepts/x'));
  assert.equal(res?.status, 200);
  const body = await res!.json();
  assert.equal(body.url, 'https://t.wiki/concepts/x');
  assert.equal(body.focused, false);
});

const cookieGate = (r: Request) => ({
  authorized: r.headers.get('cookie') === 'k=1',
  response: new Response('login', { status: 401 }),
});

test('gated wiki: the gate refuses an anonymous reader, unfurl bots and cookie holders pass', async () => {
  const mw = createMiddleware({ gate: cookieGate });
  assert.equal((await mw(req('https://t.wiki/concepts/x')))?.status, 401);
  assert.equal(await mw(req('https://t.wiki/concepts/x', 'Slackbot 1.0')), undefined);
  assert.equal(await mw(req('https://t.wiki/concepts/x', 'Mozilla', { cookie: 'k=1' })), undefined);
});

test('gated wiki: a training crawler is 403 before the gate ever runs', async () => {
  let ran = false;
  const mw = createMiddleware({ gate: () => { ran = true; return { authorized: false }; } });
  assert.equal((await mw(req('https://t.wiki/x', 'ClaudeBot')))?.status, 403);
  assert.equal(ran, false);
});

test('gated wiki: anonymous mint is 401, authorized mint is a signed share path', async () => {
  const mw = createMiddleware({ gate: cookieGate, secret: 'test-secret' });
  assert.equal((await mw(req('https://t.wiki/s/mint?path=/concepts/x')))?.status, 401);
  const res = await mw(req('https://t.wiki/s/mint?path=/concepts/x', 'Mozilla', { cookie: 'k=1' }));
  const body = await res!.json();
  assert.match(body.url, /^https:\/\/t\.wiki\/s\/[A-Za-z0-9_-]+\/concepts\/x$/);
  assert.equal(body.focused, true);
});

test('gated wiki: a genuine share address is rewritten to the mirror for an anonymous reader', async () => {
  const mw = createMiddleware({ gate: cookieGate, secret: 'test-secret' });
  const minted = await (await mw(req('https://t.wiki/s/mint?path=/concepts/x', 'Mozilla', { cookie: 'k=1' })))!.json();
  const res = await mw(req(minted.url));
  assert.equal(res?.status, 200);
  assert.match(res!.headers.get('x-middleware-rewrite') ?? '', /\/share-view\/concepts\/x/);
  // and an unfurl bot gets the same mirror, never a 404
  const bot = await mw(req(minted.url, 'Twitterbot/1.0'));
  assert.match(bot!.headers.get('x-middleware-rewrite') ?? '', /\/share-view\/concepts\/x/);
});

test('gated wiki: a forged share address falls through to the gate', async () => {
  const mw = createMiddleware({ gate: cookieGate, secret: 'test-secret' });
  assert.equal((await mw(req('https://t.wiki/s/forgedsig/concepts/x')))?.status, 401);
});

test('matcher exempts skills, generators and webmanifest', () => {
  const re = new RegExp('^' + MATCHER[0] + '$');
  assert.equal(re.test('/skills/x/SKILL.md'), false);
  assert.equal(re.test('/generators/x/GENERATE.md'), false);
  assert.equal(re.test('/manifest.webmanifest'), false);
  assert.equal(re.test('/img/og/x.png'), false);
  assert.equal(re.test('/concepts/x'), true);
  assert.equal(re.test('/s/mint'), true);
});
