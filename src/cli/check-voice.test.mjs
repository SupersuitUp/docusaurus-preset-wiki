import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findVoiceHits, DEFAULT_RULES} from './check-voice.mjs';

// THE GAP THIS CLOSES. Freedom ships a style gate, and on 2026-09-22 it passed a wiki page
// carrying nine em dashes, because it classifies a Docusaurus `docs/` tree as AGENT audience
// and the em-dash rule is a human-audience rule. That reasoning is sound for a wiki with a
// `plain/` human twin and wrong for every wiki without one, where `docs/` IS the human surface.
// It also means a wiki whose author does not run Freedom has no voice gate at all. So the wiki
// carries its own, with no dependency on anything outside this package.

const hits = (md, o) => findVoiceHits(md, o).map((h) => h.rule);

test('an em dash is refused wherever it appears in prose', () => {
  assert.deepEqual(hits('# T\n\nA sentence — an aside — and the rest.\n'), ['em-dash', 'em-dash']);
  assert.deepEqual(hits('- [A](/a) — the gloss\n'), ['em-dash']);
});

test('a code fence and inline code are left alone, because a dash there may be data', () => {
  assert.deepEqual(hits('# T\n\n```\nfoo — bar\n```\n'), []);
  assert.deepEqual(hits('Run `a — b` to see.\n'), []);
});

test('a BLOCKQUOTE is left alone, because a quotation keeps its own words', () => {
  assert.deepEqual(hits('> Orwell feared one thing — Huxley another.\n'), [],
    'rewriting punctuation inside a quote falsifies somebody else\'s sentence');
});

test('frontmatter is left alone', () => {
  assert.deepEqual(hits('---\ntitle: "A — B"\n---\n\n# T\n\nClean prose.\n'), []);
});

test('the filler inversion is caught, and a genuine contrast is not', () => {
  assert.deepEqual(hits('It is not a tool, but a partner.\n'), ['filler-inversion']);
  assert.deepEqual(hits('She did not leave, but she stopped arguing.\n'), [],
    'a clause with its own subject is a real contrast, not the tell');
});

test('an en dash between numbers is fine and an en dash between words is not', () => {
  assert.deepEqual(hits('Pages 12–14 cover it.\n'), []);
  assert.deepEqual(hits('The bargain – the real one – is older.\n'), ['en-dash-prose', 'en-dash-prose']);
});

test('every finding carries the line and what to write instead', () => {
  const [h] = findVoiceHits('# T\n\nA — B.\n');
  assert.equal(h.line, 3);
  assert.match(h.fix, /colon|comma|parenthes|sentence/i);
});

test('a wiki can add its own banned phrases and cannot switch the hard rules off', () => {
  const found = hits('We leverage synergy.\n', {extra: [{name: 'jargon', pattern: 'leverage|synergy'}]});
  assert.deepEqual(found, ['jargon', 'jargon']);
  assert.ok(DEFAULT_RULES.every((r) => r.hard), 'the shipped rules are hard; config only ADDS');
});
