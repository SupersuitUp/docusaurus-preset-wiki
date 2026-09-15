#!/usr/bin/env node
// Tests for the ASCII-diagram gate. The interesting half is the NEGATIVES: a gate that fires on
// real code fences, tables or prose arrows gets switched off within a week, and then it is worse
// than nothing because everyone believes it is running.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findAsciiDiagrams} from './check-ascii-diagrams.mjs';

const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';

test('catches the exact block that earned this gate', () => {
  const src = fence('', [
    'imagine  ->  bring it into being  ->  the reach is now longer',
    '   ^                                            |',
    '   |                                            v',
    ' the old ceiling stops being the ceiling  <-  imagine bigger',
  ].join('\n'));
  assert.equal(findAsciiDiagrams(src).length, 1);
});

test('catches the unicode box-drawing version, which is the same mistake in nicer clothes', () => {
  const src = fence('text', [
    '┌──────────┐      ┌──────────┐',
    '│  map it  │ ───▶ │ promote  │',
    '└──────────┘      └──────────┘',
    '      ▲                 │',
  ].join('\n'));
  assert.equal(findAsciiDiagrams(src).length, 1);
});

test('catches it under a ~~~ fence, not just backticks', () => {
  const src = [
    '~~~',
    'a  ->  b  ->  c',
    '^              |',
    '|              v',
    'e  <----------  d',
    '~~~',
  ].join('\n');
  assert.equal(findAsciiDiagrams(src).length, 1);
});

test('does NOT fire on a real code fence carrying a language tag', () => {
  const src = fence('bash', [
    'git log --oneline | head -3',
    'test "$a" -> /dev/null',
    'for f in *; do echo "$f" | tee -a out; done',
    'echo "| a | b |"',
  ].join('\n'));
  assert.deepEqual(findAsciiDiagrams(src), []);
});

test('does NOT fire on typescript that is dense with arrows and pipes', () => {
  const src = fence('ts', [
    'const f = (x: number) => x + 1;',
    'type T = "a" | "b" | "c";',
    'const g = (a: A) => (b: B) => a | b;',
    'items.map((i) => i.id).filter(Boolean);',
  ].join('\n'));
  assert.deepEqual(findAsciiDiagrams(src), []);
});

test('does NOT fire on a markdown table, which is all pipes and dashes', () => {
  const src = [
    '| When | What |',
    '|---|---|',
    '| 8/25 | the wedge, stated as settled |',
    '| 8/26 | -> moved to counsel |',
  ].join('\n');
  assert.deepEqual(findAsciiDiagrams(src), []);
});

test('does NOT fire on prose containing arrows outside any fence', () => {
  const src = 'The router goes registry -> intake skill -> page. That is the whole path.\n^ and this is a caret.\n';
  assert.deepEqual(findAsciiDiagrams(src), []);
});

test('does NOT fire on a short untagged snippet of command output', () => {
  const src = fence('', 'ok  |  48 files  |  49 routes');
  assert.deepEqual(findAsciiDiagrams(src), []);
});

test('reports the line the fence opened on, so the message points somewhere', () => {
  const src = ['# Title', '', 'prose', '', fence('', ['a -> b', '^     |', '|     v', 'd <-- c'].join('\n'))].join('\n');
  const [found] = findAsciiDiagrams(src);
  assert.equal(found.line, 5);
});
