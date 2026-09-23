import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSearchIndex } from './build-index';

// Search results are LINKS. This index is built by walking docs/, which knows nothing about
// where the docs are mounted, so on a wiki with a non-root routeBasePath every hit sent the
// reader to a 404. Found 2026-09-23 sweeping for other copies of that defect after it was
// fixed in the link gate and the changelog plugin; this was the third of four.

function docs(files) {
  const dir = mkdtempSync(join(tmpdir(), 'search-index-'));
  for (const [rel, body] of Object.entries(files)) {
    const f = join(dir, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, body);
  }
  return dir;
}

const pathsOf = (entries) => entries.map((e) => e.path).sort();

test('with no base, paths are docs-relative', async () => {
  const dir = docs({
    'concepts/x.md': '---\ntitle: X\n---\nbody',
    'the-thirteen/index.md': '---\ntitle: T\n---\nbody',
  });
  assert.deepEqual(pathsOf(await buildSearchIndex(dir)), ['/concepts/x', '/the-thirteen']);
});

test('under a moved base, every path is prefixed', async () => {
  const dir = docs({
    'concepts/x.md': '---\ntitle: X\n---\nbody',
    'the-thirteen/index.md': '---\ntitle: T\n---\nbody',
  });
  assert.deepEqual(pathsOf(await buildSearchIndex(dir, '/wiki')),
    ['/wiki/concepts/x', '/wiki/the-thirteen']);
});

test('a frontmatter slug is prefixed too, and only once', async () => {
  // A slug is itself resolved by Docusaurus relative to the base, so it needs the same
  // treatment as a path-derived route and must not be double-prefixed if already absolute.
  const dir = docs({
    'a.md': '---\ntitle: A\nslug: /sources/zuboff\n---\nbody',
    'b.md': '---\ntitle: B\nslug: /wiki/already\n---\nbody',
  });
  assert.deepEqual(pathsOf(await buildSearchIndex(dir, '/wiki')),
    ['/wiki/already', '/wiki/sources/zuboff']);
});

test('the index still carries what search needs', async () => {
  const dir = docs({ 'concepts/x.md': '---\ntitle: The Uncontract\n---\n## A heading\n\nSome prose.' });
  const [entry] = await buildSearchIndex(dir, '/wiki');
  assert.equal(entry.title, 'The Uncontract');
  assert.equal(entry.section, 'concepts');
  assert.equal(entry.path, '/wiki/concepts/x');
  assert.match(entry.content, /Some prose/);
});
