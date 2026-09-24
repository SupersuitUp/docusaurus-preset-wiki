import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { gateFromConfig, unlockParamFor } from './fromConfig';
import { createMiddlewareFromConfig } from '../middleware';

const req = (url: string, init: { ua?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = { 'user-agent': init.ua ?? 'Mozilla/5.0' };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(url, { headers });
};
const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
  const before: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; process.env[k] = env[k]; }
  try { await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};
const hex = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex').slice(0, 32);

test('no gate block, or type password, is the family password gate: dark until WIKI_PASSWORD is set', async () => {
  await withEnv({ WIKI_PASSWORD: '', WIKI_GATE_SECRET: '' }, async () => {
    assert.equal(gateFromConfig(undefined), undefined);
    assert.equal(gateFromConfig({ type: 'password' }), undefined);
    assert.equal(await createMiddlewareFromConfig({})(req('https://t.wiki/x')), undefined, 'open');
  });
  await withEnv({ WIKI_PASSWORD: 'word', WIKI_GATE_SECRET: 's' }, async () => {
    const mw = createMiddlewareFromConfig({ gate: { type: 'password' } });
    assert.equal((await mw(req('https://t.wiki/x')))?.status, 401);
    assert.equal((await mw(req('https://t.wiki/x?key=WORD')))?.status, 303);
  });
});

test('machinePaths and unlockParam reach the password gate from the config', async () => {
  await withEnv({ WIKI_PASSWORD: 'word', WIKI_GATE_SECRET: 's' }, async () => {
    const mw = createMiddlewareFromConfig({ gate: { type: 'password', machinePaths: 'gated', unlockParam: 'password' } });
    assert.equal((await mw(req('https://t.wiki/llms-full.txt')))?.status, 401, 'machine path gated');
    assert.equal((await mw(req('https://t.wiki/x?password=word')))?.status, 303, 'custom unlock param');
    assert.equal((await mw(req('https://t.wiki/x?key=word')))?.status, 401, 'the family param no longer opens it');
  });
});

test('type freedom-account is the account gate: the door links to the portal and ?k= opens it', async () => {
  await withEnv({ WIKI_PASSWORD: 'word', WIKI_GATE_SECRET: 'gs', WIKI_PASS_SECRET: 'ps' }, async () => {
    const mw = createMiddlewareFromConfig({ gate: { type: 'freedom-account' } });
    const door = await mw(req('https://t.wiki/concepts/x'));
    assert.equal(door?.status, 401);
    assert.match(await door!.text(), /freedom\.continentalworks\.ai\/wiki\/sign-in\?to=/);
    assert.equal((await mw(req('https://t.wiki/x?key=word')))?.status, 401, 'a password set on the project opens nothing');
    assert.equal((await mw(req(`https://t.wiki/x?k=${hex('gs', `wiki-gate:${Math.floor(Date.now() / 3_600_000)}`)}`)))?.status, 303);
    const exp = Math.floor(Date.now() / 1000) + 60;
    assert.equal((await mw(req(`https://t.wiki/x?pass=v1.u.${exp}.${hex('ps', `wiki-pass:v1.u.${exp}`)}`)))?.status, 303);
  });
});

test('the account gate takes signInUrl, openPaths (a regex source) and grantDays from the config', async () => {
  await withEnv({ WIKI_GATE_SECRET: 'gs' }, async () => {
    const mw = createMiddlewareFromConfig({ gate: { type: 'freedom-account', signInUrl: 'https://p.example/in', openPaths: '\\.md$', grantDays: 1 } });
    const door = await mw(req('https://t.wiki/skills/x'));
    assert.match(await door!.text(), /https:\/\/p\.example\/in\?to=/);
    assert.equal(await mw(req('https://t.wiki/skills/x/SKILL.md')), undefined, 'open by the config regex');
    assert.equal((await mw(req('https://t.wiki/llms.txt')))?.status, 401, 'the default open set is replaced, not extended');
    const k = hex('gs', `wiki-gate:${Math.floor(Date.now() / 3_600_000)}`);
    assert.match((await mw(req(`https://t.wiki/x?k=${k}`)))!.headers.get('set-cookie') ?? '', /Max-Age=86400;/);
  });
});

test('type none is never gated, whatever the project holds', async () => {
  await withEnv({ WIKI_PASSWORD: 'word', WIKI_GATE_SECRET: 's' }, async () => {
    assert.equal(gateFromConfig({ type: 'none' }), undefined);
    assert.equal(await createMiddlewareFromConfig({ gate: { type: 'none' } })(req('https://t.wiki/x')), undefined);
  });
});

test('an unknown type is refused at construction, never silently open', () => {
  assert.throws(() => gateFromConfig({ type: 'oauth' as never }), /gate\.type/);
  assert.throws(() => gateFromConfig({ type: 'freedom-account', openPaths: '[' }), /openPaths/);
});

test('unlockParamFor follows the type: key for a password, k for an account, and the declared value wins', () => {
  assert.equal(unlockParamFor(undefined), 'key');
  assert.equal(unlockParamFor({ type: 'password' }), 'key');
  assert.equal(unlockParamFor({ type: 'freedom-account' }), 'k');
  assert.equal(unlockParamFor({ type: 'password', unlockParam: 'password' }), 'password');
  assert.equal(unlockParamFor({ unlockParam: null }), null);
  assert.equal(unlockParamFor({ type: 'none' }), null);
});

test('allowEnv names the env var holding the allowed account ids, read per request', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const grant = (uid: string) => `fw_gate=v1.${uid}.${exp}.${hex('ps', `wiki-grant:v1.${uid}.${exp}`)}`;
  await withEnv({ WIKI_PASS_SECRET: 'ps', WIKI_ALLOWED_ACCOUNTS: 'gary,wilson' }, async () => {
    const mw = createMiddlewareFromConfig({ gate: { type: 'freedom-account', allowEnv: 'WIKI_ALLOWED_ACCOUNTS' } });
    assert.equal(await mw(req('https://t.wiki/x', { cookie: grant('wilson') })), undefined);
    assert.equal((await mw(req('https://t.wiki/x', { cookie: grant('stranger') })))?.status, 403);
    process.env.WIKI_ALLOWED_ACCOUNTS = '';
    assert.equal((await mw(req('https://t.wiki/x', { cookie: grant('wilson') })))?.status, 403, 'emptied: nobody');
  });
  await withEnv({ WIKI_PASS_SECRET: 'ps' }, async () => {
    const open = createMiddlewareFromConfig({ gate: { type: 'freedom-account' } });
    assert.equal(await open(req('https://t.wiki/x', { cookie: grant('stranger') })), undefined, 'no allowEnv: every account');
  });
});
