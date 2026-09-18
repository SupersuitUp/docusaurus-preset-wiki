import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { publishHero, patchPage, findPage, heroUrl } from './publish.mjs';

/** A fake optimizer: what optimize-images.py does to one file, without Pillow. */
function fakeOptimize(root, files) {
  for (const png of files) {
    const webp = png.replace(/\.png$/, '.webp');
    writeFileSync(webp, 'webp');
    unlinkSync(png);
    const recipe = JSON.parse(readFileSync(`${png}.recipe.json`, 'utf8'));
    recipe.asset = webp.slice(root.length + 1);
    recipe.transforms = [{ tool: 'scripts/optimize-images.py', op: 'webp' }];
    writeFileSync(`${webp}.recipe.json`, JSON.stringify(recipe));
    unlinkSync(`${png}.recipe.json`);
  }
  return { status: 0 };
}

function render() {
  const d = mkdtempSync(join(tmpdir(), 'render-'));
  const png = join(d, 'round-2.png');
  writeFileSync(png, 'png');
  writeFileSync(`${png}.recipe.json`, JSON.stringify({ model: 'gpt-image-2.5-sunburst', prompt: 'p', refs: [{ path: '/a.png' }], timestamp: '2026-09-18T00:00:00Z', asset: png }));
  return { png, recipe: `${png}.recipe.json` };
}

const READBACK = { rounds: 2, verdicts: [{ assertion: 'x', verdict: 'PASS', note: '' }] };

test('heroUrl maps an outputDir under static/ to the site path, and refuses one outside it', () => {
  assert.equal(heroUrl('static/img/illustrations', 'capture'), '/img/illustrations/capture.webp');
  assert.equal(heroUrl('static/img/illustrations/', 'concepts/capture'), '/img/illustrations/concepts/capture.webp');
  assert.throws(() => heroUrl('img/heroes', 'x'), /static/);
});

test('publishHero copies the png and its recipe beside the webp, adds readback to the recipe, runs the optimizer on that one file, and prints the two lines', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  const { png, recipe } = render();
  const calls = [];
  const r = await publishHero({ png, recipe, slug: 'capture', outputDir: 'static/img/illustrations', root, alt: 'Two-panel strip', readback: READBACK, optimize: (rt, files) => { calls.push([rt, files]); return fakeOptimize(rt, files); } });
  assert.equal(r.webp, join(root, 'static', 'img', 'illustrations', 'capture.webp'));
  assert.equal(r.recipeOut, `${r.webp}.recipe.json`);
  assert.ok(existsSync(r.webp));
  assert.ok(!existsSync(join(root, 'static', 'img', 'illustrations', 'capture.png')), 'the png does not linger beside the webp');
  assert.deepEqual(calls, [[root, [join(root, 'static', 'img', 'illustrations', 'capture.png')]]]);
  const out = JSON.parse(readFileSync(r.recipeOut, 'utf8'));
  assert.deepEqual(out.readback, READBACK);
  assert.equal(out.model, 'gpt-image-2.5-sunburst');
  assert.equal(out.asset, 'static/img/illustrations/capture.webp');
  assert.equal(r.frontmatterLine, 'image: "/img/illustrations/capture.webp"');
  assert.equal(r.bodyLine, '![Two-panel strip](/img/illustrations/capture.webp)');
  assert.ok(existsSync(png), 'the source render is left where it was');
});

test('the published recipe passes the preset\'s own provenance gate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  const { png, recipe } = render();
  await publishHero({ png, recipe, slug: 'capture', outputDir: 'static/img/illustrations', root, alt: 'a', readback: READBACK, optimize: fakeOptimize });
  const check = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'check-image-provenance.mjs');
  const r = spawnSync(process.execPath, [check, root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.covered, 1);
  assert.equal(summary.invalid, 0);
});

test('publishHero refuses when the optimizer fails or leaves no webp behind', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  const { png, recipe } = render();
  await assert.rejects(publishHero({ png, recipe, slug: 's', outputDir: 'static/img/x', root, alt: 'a', readback: READBACK, optimize: () => ({ status: 1 }) }), /optimize/);
  const again = render();
  await assert.rejects(publishHero({ ...again, slug: 's2', outputDir: 'static/img/x', root, alt: 'a', readback: READBACK, optimize: () => ({ status: 0 }) }), /webp/);
});

const PAGE = `---
title: "Capture that keeps you in the moment"
description: "d"
---

# Capture

*Capture is the discipline of recording without leaving the moment.*

Body paragraph one.
`;

test('patchPage adds the image frontmatter line and inserts the image under the italic definition, idempotently', () => {
  const url = '/img/illustrations/capture.webp';
  const body = `![Two beats](${url})`;
  const once = patchPage(PAGE, { url, bodyLine: body });
  assert.match(once, /^---\ntitle: "Capture that keeps you in the moment"\ndescription: "d"\nimage: "\/img\/illustrations\/capture\.webp"\n---\n/);
  assert.match(once, /\*Capture is the discipline of recording without leaving the moment\.\*\n\n!\[Two beats\]\(\/img\/illustrations\/capture\.webp\)\n\nBody paragraph one\./);
  const twice = patchPage(once, { url, bodyLine: body });
  assert.equal(twice, once);
  const replaced = patchPage(once, { url, bodyLine: `![New alt](${url})` });
  assert.doesNotMatch(replaced, /Two beats/);
  assert.match(replaced, /!\[New alt\]/);
  assert.equal(replaced.match(/img\/illustrations\/capture\.webp/g).length, 2);
});

test('patchPage replaces an existing image: line rather than adding a second, and falls back to after the H1 when there is no italic line', () => {
  const url = '/img/illustrations/x.webp';
  const withImage = PAGE.replace('description: "d"', 'description: "d"\nimage: "/img/old.webp"');
  const out = patchPage(withImage, { url, bodyLine: `![a](${url})` });
  assert.equal(out.match(/^image:/gm).length, 1);
  assert.match(out, /image: "\/img\/illustrations\/x\.webp"/);
  const noItalic = '---\ntitle: t\n---\n\n# H\n\nPlain paragraph.\n';
  const out2 = patchPage(noItalic, { url, bodyLine: `![a](${url})` });
  assert.match(out2, /# H\n\n!\[a\]\(\/img\/illustrations\/x\.webp\)\n\nPlain paragraph\./);
});

test('findPage locates docs/**/<slug>.md or .mdx by slug, and refuses on none or several', () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  mkdirSync(join(root, 'docs', 'concepts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'playbooks'), { recursive: true });
  writeFileSync(join(root, 'docs', 'concepts', 'capture.md'), PAGE);
  assert.equal(findPage(root, 'capture'), join(root, 'docs', 'concepts', 'capture.md'));
  assert.equal(findPage(root, 'concepts/capture'), join(root, 'docs', 'concepts', 'capture.md'));
  assert.throws(() => findPage(root, 'missing'), /missing[\s\S]*--page/);
  writeFileSync(join(root, 'docs', 'playbooks', 'capture.mdx'), PAGE);
  assert.throws(() => findPage(root, 'capture'), /concepts\/capture\.md[\s\S]*playbooks\/capture\.mdx/);
});

test('publishHero with write patches the page on disk and reports it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  const page = join(root, 'docs', 'capture.md');
  writeFileSync(page, PAGE);
  const { png, recipe } = render();
  const r = await publishHero({ png, recipe, slug: 'capture', outputDir: 'static/img/illustrations', root, alt: 'Two beats', readback: READBACK, optimize: fakeOptimize, page, write: true });
  assert.equal(r.pageWritten, page);
  const text = readFileSync(page, 'utf8');
  assert.match(text, /image: "\/img\/illustrations\/capture\.webp"/);
  assert.match(text, /!\[Two beats\]\(\/img\/illustrations\/capture\.webp\)/);
});
