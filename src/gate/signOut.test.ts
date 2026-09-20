import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiddleware } from '../middleware';
import { createFreedomAccountGate, mintPass } from './accountGate';
import { createPasswordGate } from './passwordGate';
import { handleSignOut, GATE_COOKIES } from './signOut';

const req = (url: string, init: { ua?: string; cookie?: string; method?: string } = {}) => {
  const headers: Record<string, string> = { 'user-agent': init.ua ?? 'Mozilla/5.0' };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(url, { headers, method: init.method ?? 'GET' });
};
const SECRET = 'test-secret';
const account = () => createMiddleware({ gate: createFreedomAccountGate({ signInUrl: 'https://p.example/wiki/sign-in', secret: SECRET }), secret: SECRET });
const password = () => createMiddleware({ gate: createPasswordGate({ password: 'word', secret: SECRET }), secret: SECRET });

test('/sign-out expires every family cookie and lands on the front page saying so', async () => {
  const res = handleSignOut(req('https://t.wiki/sign-out'));
  assert.equal(res?.status, 303);
  assert.equal(res!.headers.get('location'), '/?signed-out');
  const set = res!.headers.getSetCookie();
  assert.deepEqual(GATE_COOKIES, ['fw_gate', 'wiki_gate']);
  for (const name of GATE_COOKIES) assert.ok(set.some((c) => c.startsWith(`${name}=; Path=/; Max-Age=0;`)), name);
  assert.equal(handleSignOut(req('https://t.wiki/sign-out/'))?.status, 303, 'trailing slash');
  assert.equal(handleSignOut(req('https://t.wiki/sign-out', { method: 'POST' }))?.status, 303, 'a form may POST it');
  assert.equal(handleSignOut(req('https://t.wiki/sign-outs')), undefined);
  assert.equal(handleSignOut(req('https://t.wiki/concepts/x')), undefined);
});

test('on an account wiki a signed-in reader who signs out meets the door, which says they are signed out', async () => {
  const mw = account();
  const pass = await mintPass(SECRET, 'abc', Math.floor(Date.now() / 1000) + 300);
  const cookie = (await mw(req(`https://t.wiki/x?pass=${pass}`)))!.headers.get('set-cookie')!.split(';')[0];
  assert.equal(await mw(req('https://t.wiki/concepts/x', { cookie })), undefined, 'signed in');
  const out = await mw(req('https://t.wiki/sign-out', { cookie }));
  assert.equal(out?.status, 303);
  assert.equal(out!.headers.get('location'), '/?signed-out');
  const door = await mw(req('https://t.wiki/?signed-out'));
  assert.equal(door?.status, 401);
  const html = await door!.text();
  assert.match(html, /You are signed out of this site/);
  // The sign-in link it offers carries the clean page, never the signed-out marker.
  assert.match(html, /wiki\/sign-in\?to=https%3A%2F%2Ft\.wiki%2F"/);
});

test('the door is ambiguous: no product name, an early-access line, a plain Sign in button', async () => {
  const html = await (await account()(req('https://t.wiki/concepts/x')))!.text();
  assert.match(html, /This website is gated to those who are part of an early access program\./);
  assert.match(html, /Sign in with the Google account you were invited with/);
  assert.match(html, />Sign in<\/a>/);
  assert.doesNotMatch(html, /Freedom/);
  assert.doesNotMatch(html, /freedom:profile/);
  assert.doesNotMatch(html, /signed out/i, 'no signed-out line on an ordinary visit');
});

test('on a password wiki sign-out drops the ticket and the door says so', async () => {
  const mw = password();
  const cookie = (await mw(req('https://t.wiki/x?key=word')))!.headers.get('set-cookie')!.split(';')[0];
  assert.equal(await mw(req('https://t.wiki/concepts/x', { cookie })), undefined, 'ticket admits');
  assert.equal((await mw(req('https://t.wiki/sign-out', { cookie })))?.status, 303);
  const door = await mw(req('https://t.wiki/?signed-out'));
  assert.equal(door?.status, 401);
  assert.match(await door!.text(), /You are signed out of this site/);
});

test('an open wiki leaves /sign-out to the static site', async () => {
  assert.equal(await createMiddleware()(req('https://t.wiki/sign-out')), undefined);
});
