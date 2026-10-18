import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tldrProblems, checkSource, spliceLlms, hasLede } from './tldr.mjs';

test('valid tldr has no problems', () => {
  assert.deepEqual(tldrProblems('One thing. Two things.'), []);
});
test('over 60 words is refused', () => {
  const long = Array(61).fill('word').join(' ') + '.';
  assert.match(tldrProblems(long).join(), /61 words/);
});
test('four sentences are refused', () => {
  assert.match(tldrProblems('A. B. C. D.').join(), /4 sentences/);
});
test('em dash is refused', () => {
  assert.match(tldrProblems('This — that.').join(), /dash/);
});
test('tldr plus italic lede is refused', () => {
  const src = '---\ntldr: "Short."\n---\n\n# T\n\n*A lede.*\n';
  assert.match(checkSource('x.md', src).join(), /both a TL;DR and an italic lede/);
  assert.equal(hasLede(src), true);
});
test('misspelled key is refused', () => {
  assert.match(checkSource('x.md', '---\nTLDR: "x."\n---\n').join(), /not read by anything/);
});
test('splice adds TL;DR under llms entries once', () => {
  const by = new Map([['concepts/a', 'Short.']]);
  const once = spliceLlms('- [A](https://w/concepts/a)\n', 'URL: https://w/concepts/a\nbody\n', by);
  const twice = spliceLlms(once.llmsTxt, once.llmsFull, by);
  assert.equal(twice.llmsTxt, once.llmsTxt);
  assert.match(once.llmsFull, /URL: https:\/\/w\/concepts\/a\nTL;DR: Short\./);
});

// Wikis load the TL;DR helpers from their own generators (getfreedom-wiki scripts/lib/tldr.mjs).
// A deep `lib/tldr/tldr.mjs` path is refused by the exports map, so the subpath is public.
test('the package exports ./tldr by name, resolving to the built helpers', async () => {
  const resolved = import.meta.resolve('@supersuit/docusaurus-preset-wiki/tldr');
  assert.match(resolved, /\/lib\/tldr\/tldr\.mjs$/);
  const mod = await import('@supersuit/docusaurus-preset-wiki/tldr');
  assert.equal(typeof mod.tldrProblems, 'function');
  assert.equal(typeof mod.spliceLlms, 'function');
  assert.equal(mod.MAX_WORDS, 60);
});
