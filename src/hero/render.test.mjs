import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAdapter, adapterArgv, renderHero, ABU_CACHE_REL } from './render.mjs';

/** A fake home dir with the ABU plugin cache holding the given versions (each with the adapter). */
function home(versions) {
  const h = mkdtempSync(join(tmpdir(), 'home-'));
  for (const v of versions) {
    const d = join(h, ABU_CACHE_REL, v, 'skills', 'on-brand-image', 'scripts');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'generate.py'), '# adapter');
  }
  return h;
}

function wikiRoot({ fallback = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  if (fallback) {
    mkdirSync(join(root, 'illustrations', 'scripts'), { recursive: true });
    writeFileSync(join(root, 'illustrations', 'scripts', 'generate.py'), '# wiki adapter');
  }
  return root;
}

test('$ABU_ADAPTER wins over everything, and must exist', () => {
  const h = home(['1.29.1']);
  const root = wikiRoot({ fallback: true });
  const own = join(mkdtempSync(join(tmpdir(), 'own-')), 'generate.py');
  writeFileSync(own, '#');
  const a = resolveAdapter({ env: { ABU_ADAPTER: own }, root, home: h });
  assert.equal(a.kind, 'abu');
  assert.equal(a.script, own);
  assert.throws(() => resolveAdapter({ env: { ABU_ADAPTER: join(root, 'nope.py') }, root, home: h }), /ABU_ADAPTER[\s\S]*nope\.py/);
});

test('the newest ABU cache version is chosen by version, not by string order', () => {
  const h = home(['1.9.0', '1.28.0', '1.29.1', '1.10.0']);
  const a = resolveAdapter({ env: {}, root: wikiRoot(), home: h });
  assert.equal(a.kind, 'abu');
  assert.equal(a.script, join(h, ABU_CACHE_REL, '1.29.1', 'skills', 'on-brand-image', 'scripts', 'generate.py'));
  assert.equal(a.note, undefined);
});

test('a cache version folder without the adapter file is skipped', () => {
  const h = home(['1.28.0']);
  mkdirSync(join(h, ABU_CACHE_REL, '1.30.0'), { recursive: true });
  const a = resolveAdapter({ env: {}, root: wikiRoot(), home: h });
  assert.match(a.script, /1\.28\.0/);
});

test('with no ABU the wiki\'s own illustrations/scripts/generate.py is used, with a note that entities and --ref-first are unavailable', () => {
  const root = wikiRoot({ fallback: true });
  const a = resolveAdapter({ env: {}, root, home: home([]) });
  assert.equal(a.kind, 'wiki');
  assert.equal(a.script, join(root, 'illustrations', 'scripts', 'generate.py'));
  assert.match(a.note, /entities/);
  assert.match(a.note, /--ref-first/);
});

test('with no adapter at all the refusal names the install', () => {
  assert.throws(() => resolveAdapter({ env: {}, root: wikiRoot(), home: home([]) }), /agentic-brand-universe|ABU_ADAPTER/);
});

const COMPILED = {
  prompt: 'warm editorial illustration\n\nONE single image',
  refs: [{ path: '/p/anchor.png', role: 'anchor' }, { path: '/p/b.png', role: 'style' }, { path: '/w/glasses.png', role: 'prop' }],
  strings: [], gate: [],
};

test('the ABU argv: uv run, --out, --prompt-file, one --ref per compiled ref in compiled order, model, size, quality, --no-open', () => {
  const argv = adapterArgv({ kind: 'abu', script: '/abu/generate.py' }, { ...COMPILED, out: '/o/r.png', promptFile: '/t/prompt.txt', model: 'gpt-image-2.5-sunburst', size: '2560x1440', quality: 'xhigh' });
  assert.deepEqual(argv, [
    'uv', 'run', '/abu/generate.py',
    '--out', '/o/r.png', '--prompt-file', '/t/prompt.txt',
    '--ref', '/p/anchor.png', '--ref', '/p/b.png', '--ref', '/w/glasses.png',
    '--model', 'gpt-image-2.5-sunburst', '--size', '2560x1440', '--quality', 'xhigh', '--no-open',
  ]);
});

test('the fallback argv: uv run, --prompt inline, --filename, one --input-image per ref, model, size, quality, --no-open', () => {
  const argv = adapterArgv({ kind: 'wiki', script: '/w/illustrations/scripts/generate.py' }, { ...COMPILED, out: '/o/r.png', promptFile: '/t/prompt.txt', model: 'gpt-image-2.5-flare', size: '1536x1024', quality: 'high' });
  assert.deepEqual(argv, [
    'uv', 'run', '/w/illustrations/scripts/generate.py',
    '--prompt', COMPILED.prompt, '--filename', '/o/r.png',
    '--input-image', '/p/anchor.png', '--input-image', '/p/b.png', '--input-image', '/w/glasses.png',
    '--model', 'gpt-image-2.5-flare', '--size', '1536x1024', '--quality', 'high', '--no-open',
  ]);
});

test('renderHero writes the prompt file, runs the adapter, and returns the png and its recipe', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'round-1.png');
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    const promptFile = argv[argv.indexOf('--prompt-file') + 1];
    assert.equal(readFileSync(promptFile, 'utf8'), COMPILED.prompt);
    writeFileSync(out, 'png');
    writeFileSync(`${out}.recipe.json`, JSON.stringify({ model: 'm', prompt: COMPILED.prompt, refs: [], timestamp: 't' }));
    return { status: 0 };
  };
  const r = await renderHero(COMPILED, { adapter: { kind: 'abu', script: '/abu/generate.py' }, out, model: 'm', size: '32x32', quality: 'q', run });
  assert.equal(r.png, out);
  assert.equal(r.recipe, `${out}.recipe.json`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'uv');
  assert.deepEqual(r.argv, calls[0]);
});

test('renderHero refuses when the adapter exits non-zero, produces no file, or produces no recipe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'out-'));
  const adapter = { kind: 'abu', script: '/abu/generate.py' };
  const opts = { adapter, model: 'm', size: '32x32', quality: 'q' };
  await assert.rejects(renderHero(COMPILED, { ...opts, out: join(dir, 'a.png'), run: () => ({ status: 1 }) }), /exit(ed)? 1|status 1/);
  await assert.rejects(renderHero(COMPILED, { ...opts, out: join(dir, 'b.png'), run: () => ({ status: 0 }) }), /no image|produced no file/i);
  const c = join(dir, 'c.png');
  await assert.rejects(renderHero(COMPILED, { ...opts, out: c, run: () => { writeFileSync(c, 'png'); return { status: 0 }; } }), /recipe/);
  assert.ok(existsSync(c));
});
