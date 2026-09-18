import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

test('optimize-images converts only the files named on the command line, and refuses a path that is not an image under static/', { skip: !havePillow && 'python3 with Pillow not on this machine' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'wiki-py-'));
  mkdirSync(join(d, 'static', 'img'), { recursive: true });
  writeFileSync(join(d, 'wiki.config.json'), '{}');
  // Two 2000px-wide PNGs drawn by Pillow, so both need work; only one is named.
  const draw = spawnSync('python3', ['-c', `
from PIL import Image
for n in ("a", "b"):
    Image.new("RGB", (2000, 100), (200, 100, 50)).save("${join(d, 'static', 'img')}/" + n + ".png")
`], { encoding: 'utf8' });
  assert.equal(draw.status, 0, draw.stderr);
  writeFileSync(join(d, 'static', 'img', 'a.png.recipe.json'), JSON.stringify({ model: 'm', prompt: 'p', refs: [], timestamp: 't', asset: 'static/img/a.png' }));
  const r = spawnSync('python3', [join(PY, 'optimize-images.py'), join(d, 'static', 'img', 'a.png')], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(d, 'static', 'img', 'a.webp')), 'the named file was converted');
  assert.ok(!existsSync(join(d, 'static', 'img', 'a.png')));
  assert.ok(existsSync(join(d, 'static', 'img', 'b.png')), 'the unnamed file was left alone');
  assert.ok(!existsSync(join(d, 'static', 'img', 'b.webp')));
  const recipe = JSON.parse(readFileSync(join(d, 'static', 'img', 'a.webp.recipe.json'), 'utf8'));
  assert.equal(recipe.asset, 'static/img/a.webp');
  assert.equal(recipe.transforms[0].op, 'webp');
  const bad = spawnSync('python3', [join(PY, 'optimize-images.py'), join(d, 'wiki.config.json')], { cwd: d, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not an image under static/);
});
