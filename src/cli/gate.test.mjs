import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planEnv, verifyLengths, preloadedLink, hourKeyFor, accountLink, writeGateType } from './gate.mjs';

const rnd = () => 'S'.repeat(64);

test('first set creates the password and mints both secrets', () => {
  const plan = planEnv([], { password: 'freedom', random: rnd });
  assert.deepEqual(plan.map((s) => [s.key, s.action]), [['WIKI_PASSWORD', 'create'], ['WIKI_GATE_SECRET', 'create'], ['WIKI_SHARE_SECRET', 'create']]);
  assert.equal(plan[1].value.length, 64);
});

test('a later set only updates the password; secrets are left alone so tickets survive', () => {
  const existing = [{ key: 'WIKI_PASSWORD', value: 'old' }, { key: 'WIKI_GATE_SECRET', value: 'g' }, { key: 'WIKI_SHARE_SECRET', value: 's' }];
  const plan = planEnv(existing, { password: 'freedom', random: rnd });
  assert.deepEqual(plan, [{ key: 'WIKI_PASSWORD', value: 'freedom', action: 'update' }]);
});

test('--rotate-secrets replaces both secrets and can leave the password untouched', () => {
  const existing = [{ key: 'WIKI_PASSWORD', value: 'old' }, { key: 'WIKI_GATE_SECRET', value: 'g' }, { key: 'WIKI_SHARE_SECRET', value: 's' }];
  const plan = planEnv(existing, { rotateSecrets: true, random: rnd });
  assert.deepEqual(plan.map((s) => [s.key, s.action]), [['WIKI_GATE_SECRET', 'update'], ['WIKI_SHARE_SECRET', 'update']]);
});

test('read-back compares lengths and names the blank one', () => {
  const plan = [{ key: 'WIKI_PASSWORD', value: 'freedom', action: 'update' }];
  assert.deepEqual(verifyLengths([{ key: 'WIKI_PASSWORD', value: 'freedom' }], plan), []);
  assert.match(verifyLengths([{ key: 'WIKI_PASSWORD', value: '' }], plan)[0], /expected length 7, read back 0/);
});

test('the preloaded link carries the key on the page route', () => {
  assert.equal(preloadedLink('https://t.wiki', '/the-argument/shame', 'copper ledger willow'), 'https://t.wiki/the-argument/shame?key=copper+ledger+willow');
  assert.equal(preloadedLink('https://t.wiki', '/', 'freedom'), 'https://t.wiki/?key=freedom');
});

test('set --type freedom-account plans the shared pass secret, mints the others, and drops the password that would open nothing', () => {
  const existing = [{ key: 'WIKI_PASSWORD', value: 'old' }, { key: 'WIKI_GATE_SECRET', value: 'g' }];
  const plan = planEnv(existing, { type: 'freedom-account', passSecret: 'P'.repeat(40), random: rnd });
  assert.deepEqual(plan.map((s) => [s.key, s.action]), [['WIKI_PASSWORD', 'delete'], ['WIKI_PASS_SECRET', 'create'], ['WIKI_SHARE_SECRET', 'create']]);
  const again = planEnv([...existing, { key: 'WIKI_PASS_SECRET', value: 'x' }, { key: 'WIKI_SHARE_SECRET', value: 's' }], { type: 'freedom-account', random: rnd });
  assert.deepEqual(again.map((s) => [s.key, s.action]), [['WIKI_PASSWORD', 'delete']], 'no pass secret given: the one already there is kept');
});

test('the account door is checked the way a person would meet it: 401 with the sign-in link, ?k= 303, grant 200', () => {
  const k = hourKeyFor('g', 3_600_000 * 7);
  assert.equal(k, createHmac('sha256', 'g').update('wiki-gate:7').digest('hex').slice(0, 32));
  assert.equal(accountLink('https://t.wiki', '/x', 'g', 3_600_000 * 7), `https://t.wiki/x?k=${k}`);
});

test('writeGateType edits only the gate block of wiki.config.json and keeps every other key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  writeFileSync(join(dir, 'wiki.config.json'), JSON.stringify({ title: 'T', gate: { unlockParam: 'key' }, og: { bg: '#fff' } }, null, 2) + '\n');
  writeGateType(dir, 'freedom-account');
  const after = JSON.parse(readFileSync(join(dir, 'wiki.config.json'), 'utf8'));
  assert.deepEqual(after, { title: 'T', gate: { type: 'freedom-account' }, og: { bg: '#fff' } }, 'the family unlockParam is dropped so the type decides it');
  writeGateType(dir, 'password');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'wiki.config.json'), 'utf8')).gate, { type: 'password' });
});
