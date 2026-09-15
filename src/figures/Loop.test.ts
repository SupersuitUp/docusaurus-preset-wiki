// The Loop figure's accessible label. This is the half of the figure a screen reader gets, and
// the whole argument for drawing a cycle instead of typing one is that the drawn version can
// carry it at all: a fenced ASCII ring reads aloud as punctuation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopLabel } from './loop-label';

test('reads the beats in order and says it comes back round', () => {
  const l = loopLabel(['A', 'B', 'C']);
  assert.match(l, /A, then B, then C, and back to A\./);
  assert.match(l, /3 beats/);
});

test('every beat reaches a screen reader, so the figure is not sighted-only information', () => {
  const beats = ['Map a workflow', 'Promote it', 'Hours come back', 'Capacity for the next'];
  const l = loopLabel(beats);
  for (const b of beats) assert.ok(l.includes(b), `label is missing "${b}"`);
});
