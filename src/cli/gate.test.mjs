import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEnv, verifyLengths, preloadedLink } from './gate.mjs';

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
