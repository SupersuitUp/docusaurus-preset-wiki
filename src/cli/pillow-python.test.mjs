import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillowPython } from './pillow-python.mjs';

const has = (works) => (cmd, args) => works.includes(cmd === 'python3' ? 'pil' : cmd);

test('python3 with Pillow is used as it is', () => {
  assert.deepEqual(pillowPython(has(['pil', 'uv'])), ['python3']);
});

test('python3 without Pillow falls back to uv supplying it, instead of stopping', () => {
  assert.deepEqual(pillowPython(has(['uv'])), ['uv', 'run', '--quiet', '--with', 'pillow', 'python3']);
});

test('neither available is null, so callers can name the fix', () => {
  assert.equal(pillowPython(has([])), null);
});
