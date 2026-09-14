import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiddleware } from '../middleware';
import { createPasswordGate } from './passwordGate';

const req = (url: string, init: RequestInit & { ua?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = { 'user-agent': init.ua ?? 'Mozilla/5.0' };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(url, { method: init.method ?? 'GET', headers, body: init.body });
};
const gated = () => createMiddleware({ gate: createPasswordGate({ password: 'Glory Hour', secret: 'test-secret' }), secret: 'test-secret' });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

test('no password means no gate: createPasswordGate returns undefined and the wiki is open', async () => {
  assert.equal(createPasswordGate({ password: '' }), undefined);
  const mw = createMiddleware({ gate: createPasswordGate({ password: '' }) });
  assert.equal(await mw(req('https://t.wiki/x')), undefined);
});

test('an anonymous reader meets the door (401 html, noindex)', async () => {
  const res = await gated()(req('https://t.wiki/the-argument/glory-hour'));
  assert.equal(res?.status, 401);
  assert.match(res!.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(res!.headers.get('x-robots-tag'), 'noindex');
  assert.match(await res!.text(), /opens with a password/);
});

test('a preloaded ?key= link sets the ticket and 303s to the clean url, any capitalization', async () => {
  const res = await gated()(req('https://t.wiki/the-argument/glory-hour?key=gLoRy%20hour'));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/the-argument/glory-hour');
  assert.match(res!.headers.get('set-cookie') ?? '', /^wiki_gate=v1\.\d+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly$/);
});

test('the ticket admits the reader afterwards; a forged one does not', async () => {
  const mw = gated();
  const first = await mw(req('https://t.wiki/x?key=glory%20hour'));
  const cookie = cookieOf(first!);
  assert.equal(await mw(req('https://t.wiki/the-argument/glory-hour', { cookie })), undefined, 'ticket admits');
  const forged = cookie.replace(/\.[^.]+$/, '.AAAA');
  assert.equal((await mw(req('https://t.wiki/x', { cookie: forged })))?.status, 401, 'forged ticket refused');
});

test('a wrong key is the door with the error line; a wrong POST too', async () => {
  const mw = gated();
  const wrongKey = await mw(req('https://t.wiki/x?key=nope'));
  assert.equal(wrongKey?.status, 401);
  const wrongPost = await mw(req('https://t.wiki/x', { method: 'POST', body: 'password=nope' }));
  assert.equal(wrongPost?.status, 401);
  assert.match(await wrongPost!.text(), /Not it/);
});

test('a correct POST issues the ticket and 303s back to the page', async () => {
  const res = await gated()(req('https://t.wiki/the-argument/shame', { method: 'POST', body: 'password=GLORY+HOUR' }));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/the-argument/shame');
  assert.match(res!.headers.get('set-cookie') ?? '', /^wiki_gate=/);
});

test('machine paths and unfurl bots pass the gate; training crawlers never reach it', async () => {
  const mw = gated();
  assert.equal(await mw(req('https://t.wiki/llms.txt')), undefined);
  assert.equal(await mw(req('https://t.wiki/skills/x/SKILL.md')), undefined);
  assert.equal(await mw(req('https://t.wiki/the-argument/shame', { ua: 'Twitterbot/1.0' })), undefined);
  assert.equal((await mw(req('https://t.wiki/the-argument/shame', { ua: 'GPTBot' })))?.status, 403);
});

// --- machinePaths: 'gated' ---------------------------------------------------------------
//
// Open machine paths are right for a public-knowledge wiki whose agents and players cannot
// answer a door. On a PRIVATE one they publish the entire wiki: `/llms-full.txt` is every page
// in one file and it matched the open pattern, so a wiki the operator had gated served its full
// text to anyone who guessed the filename. Reported by @brayantenesaca10-boop (freedom#122),
// found on a wiki registered `audience: private` with the gate on.

const gatedMachine = () => createMiddleware({
  gate: createPasswordGate({ password: 'Glory Hour', secret: 'test-secret', machinePaths: 'gated' }),
  secret: 'test-secret',
});

test("machinePaths: 'gated' puts the whole text behind the door, llms-full.txt included", async () => {
  const mw = gatedMachine();
  for (const path of ['/llms-full.txt', '/llms.txt', '/the-argument/shame.md', '/talks/one.mp3']) {
    const res = await mw(req(`https://t.wiki${path}`));
    assert.equal(res?.status, 401, `${path} must meet the door on a private wiki`);
  }
});

test("machinePaths: 'gated' still serves hosted skills and generators, which are instructions", async () => {
  // An agent following a wiki's intake skill has to be able to FETCH it before it has a key,
  // and the skill file is a procedure rather than the wiki's content.
  const mw = gatedMachine();
  assert.equal(await mw(req('https://t.wiki/skills/x-intake/SKILL.md')), undefined);
  assert.equal(await mw(req('https://t.wiki/generators/y/gen.mjs')), undefined);
});

test("machinePaths: 'gated' opens the text to a key, so an agent with the password still reads it", async () => {
  const mw = gatedMachine();
  const res = await mw(req('https://t.wiki/llms-full.txt?key=glory%20hour'));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/llms-full.txt');
  const cookie = cookieOf(res!);
  assert.equal(await mw(req('https://t.wiki/llms-full.txt', { cookie })), undefined);
});

test("machinePaths defaults to 'open', so no wiki already deployed changes behaviour", async () => {
  assert.equal(await gated()(req('https://t.wiki/llms-full.txt')), undefined);
});

test('a ticketed reader can mint a share link; an anonymous one cannot; the share serves the mirror', async () => {
  const mw = gated();
  const cookie = cookieOf((await mw(req('https://t.wiki/x?key=glory%20hour')))!);
  assert.equal((await mw(req('https://t.wiki/s/mint?path=/the-argument/shame')))?.status, 401);
  const minted = await (await mw(req('https://t.wiki/s/mint?path=/the-argument/shame', { cookie })))!.json();
  assert.equal(minted.focused, true);
  const share = await mw(req(minted.url));
  assert.match(share!.headers.get('x-middleware-rewrite') ?? '', /share-view\/the-argument\/shame/);
});

test('password set but no secret fails OPEN and says so in a header', async () => {
  const mw = createMiddleware({ gate: createPasswordGate({ password: 'x', secret: '' }) });
  const res = await mw(req('https://t.wiki/x'));
  assert.equal(res?.headers.get('x-middleware-next'), '1');
  assert.equal(res?.headers.get('x-wiki-gate'), 'gate-misconfigured-no-secret');
});
