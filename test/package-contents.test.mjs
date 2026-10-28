// The published tarball carries no test files (issue #8). Packs the package the way
// `npm publish` would (prepack runs the build), then refuses any path matching
// `.test.` and any exports target that points at one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = /\.test\./;

function exportTargets(node) {
  if (typeof node === 'string') return [node];
  return Object.values(node ?? {}).flatMap(exportTargets);
}

test('the packed tarball contains no *.test.* file', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  // prepack's build logs to stdout ahead of the JSON, so parse from the array's opening line.
  const json = JSON.parse(out.slice(out.search(/^\[$/m)));
  const paths = json[0].files.map((f) => f.path);
  assert.ok(paths.includes('lib/index.js'), 'sanity: the build output is in the tarball');
  const leaked = paths.filter((p) => TEST_FILE.test(p));
  assert.deepEqual(leaked, [], `test files in the tarball:\n${leaked.join('\n')}`);
});

test('no exports or bin target is a test file', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const targets = [...exportTargets(pkg.exports), pkg.main, pkg.types, ...exportTargets(pkg.bin)];
  assert.deepEqual(targets.filter((t) => TEST_FILE.test(t)), []);
});
