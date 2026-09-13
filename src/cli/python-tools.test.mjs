import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PY = join(dirname(fileURLToPath(import.meta.url)), 'python');
const havePillow = spawnSync('python3', ['-c', 'import PIL']).status === 0;

test('optimize-images --repair-sidecars runs (it once crashed with NameError before the function was defined)', { skip: !havePillow && 'python3 with Pillow not on this machine' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'wiki-py-'));
  mkdirSync(join(d, 'static'), { recursive: true });
  writeFileSync(join(d, 'wiki.config.json'), '{}');
  const r = spawnSync('python3', [join(PY, 'optimize-images.py'), '--repair-sidecars'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /repaired 0 sidecar/);
  assert.doesNotMatch(r.stderr, /NameError/);
});
