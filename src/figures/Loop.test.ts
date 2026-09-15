// The Loop figure's accessible label. This is the half of the figure a screen reader gets, and
// the whole argument for drawing a cycle instead of typing one is that the drawn version can
// carry it at all: a fenced ASCII ring reads aloud as punctuation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopLabel } from './loop-label';
import { wrapLabel, NODE_MAX_W, NODE_PAD, CHAR_W } from './wrap-label';

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

/* ------- wrapping, which exists because the first real labels ran off the frame and clipped ---- */

test('a short beat is one line and is left alone', () => {
  assert.deepEqual(wrapLabel('Hours come back'), ['Hours come back']);
});

test('a long beat wraps instead of running off the frame', () => {
  const lines = wrapLabel('Promote it to something that runs');
  assert.ok(lines.length > 1, 'expected the label to wrap');
  assert.equal(lines.join(' '), 'Promote it to something that runs', 'wrapping must not lose words');
});

test('every wrapped line fits the box it is drawn in, which is the whole point', () => {
  const beats = [
    'Promote it to something that runs',
    'Capacity to remove the next one',
    'Their inviter earns invite capacity',
    'An invite goes out over iMessage',
  ];
  for (const b of beats) {
    for (const line of wrapLabel(b)) {
      const width = line.length * CHAR_W + NODE_PAD * 2;
      assert.ok(width <= NODE_MAX_W, `"${line}" renders ${width.toFixed(0)}px wide, past the ${NODE_MAX_W}px frame`);
    }
  }
});

test('an unbreakable word is kept rather than truncated, because losing text is worse than overflow', () => {
  const lines = wrapLabel('Supercalifragilisticexpialidociousandthensome');
  assert.equal(lines.join(''), 'Supercalifragilisticexpialidociousandthensome');
});

test('never exceeds maxLines, so a node cannot grow without bound', () => {
  const lines = wrapLabel('one two three four five six seven eight nine ten eleven twelve thirteen', 200, 2);
  assert.ok(lines.length <= 2, `got ${lines.length} lines`);
});
