import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parseHeroArgs, selectProps } from './hero.mjs';

const WIKI = join(dirname(fileURLToPath(import.meta.url)), 'wiki.mjs');
const run = (cwd, env, ...args) => spawnSync(process.execPath, [WIKI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

/** A wiki root with a hero block, and a packs dir holding the pack it names. */
function site() {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  const dir = join(packs, 'plain');
  mkdirSync(join(dir, 'refs'), { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({
    id: 'plain', name: 'plain', anchor: 'refs/a.png', refs: ['refs/a.png', 'refs/b.png'],
    palette: { ground: ['#EFE6D2'], fill: ['#8FB0CE'], line: ['#3B382F'] },
    styleLine: 'warm editorial illustration', rejectedPoles: ['neon'], gate: ['muted palette'],
  }));
  writeFileSync(join(dir, 'refs', 'a.png'), '');
  writeFileSync(join(dir, 'refs', 'b.png'), '');
  const root = mkdtempSync(join(tmpdir(), 'wiki-hero-cli-'));
  mkdirSync(join(root, 'illustrations', 'props'), { recursive: true });
  writeFileSync(join(root, 'illustrations', 'props', 'glasses.png'), '');
  writeFileSync(join(root, 'wiki.config.json'), JSON.stringify({
    title: 'T', tagline: 't', url: 'https://t.wiki', organizationName: 'o', projectName: 'p', copyright: 'c', noindex: true, description: 'd',
    hero: { stylePack: 'plain', layout: 'row', beats: 2, props: { glasses: ['illustrations/props/glasses.png'] }, gate: ['the glasses match the prop photo'] },
  }));
  return { root, env: { WIKI_STYLE_PACKS: packs } };
}

const PAGE = ['--title', 'TWO BEATS', '--beat', 'A person opens a notebook.', '--beat', 'The notebook fills.', '--label', 'open', '--label', 'fill'];

test('parseHeroArgs collects repeatable beats, labels and props, and the pipe form of labels', () => {
  const a = parseHeroArgs(['my-page', ...PAGE, '--prop', 'glasses', '--dry-run']);
  assert.equal(a.slug, 'my-page');
  assert.equal(a.title, 'TWO BEATS');
  assert.deepEqual(a.beats, ['A person opens a notebook.', 'The notebook fills.']);
  assert.deepEqual(a.labels, ['open', 'fill']);
  assert.deepEqual(a.props, ['glasses']);
  assert.equal(a.dryRun, true);
  assert.deepEqual(parseHeroArgs(['p', '--labels', 'a|b|c']).labels, ['a', 'b', 'c']);
  assert.throws(() => parseHeroArgs(['p', '--frob']), /unknown flag/);
  assert.throws(() => parseHeroArgs(['p', '--title']), /needs a value/);
  assert.throws(() => parseHeroArgs(['p', 'stray']), /--beat/);
});

test('selectProps takes only declared props and names the declared ones on a miss', () => {
  assert.deepEqual(selectProps(['g'], { g: ['x.png'], h: ['y.png'] }), { g: ['x.png'] });
  assert.throws(() => selectProps(['nope'], { g: ['x.png'] }), /nope[\s\S]*declared: g/);
});

test('wiki hero --help exits 0 and names the flags', () => {
  const r = run(process.cwd(), {}, 'hero', '--help');
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['--title', '--beat', '--label', '--prop', '--dry-run']) assert.match(r.stdout, new RegExp(f));
});

test('wiki hero --dry-run prints the compiled prompt, refs, strings and gate as JSON and exits 0', () => {
  const { root, env } = site();
  const r = run(root, env, 'hero', 'my-page', ...PAGE, '--prop', 'glasses', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'my-page');
  assert.equal(out.pack, 'plain');
  assert.equal(out.out, 'static/img/illustrations/my-page.webp');
  assert.match(out.prompt, /^warm editorial illustration/);
  assert.match(out.prompt, /2 CLEAR PANELS[\s\S]*horizontal row/);
  assert.match(out.prompt, /reading "TWO BEATS"/);
  assert.match(out.prompt, /PROP references/);
  assert.deepEqual(out.refs.map((x) => x.role), ['anchor', 'style', 'prop']);
  assert.equal(out.refs[2].path, join(realpathSync(root), 'illustrations', 'props', 'glasses.png'));
  assert.deepEqual(out.strings.map((s) => s.text), ['TWO BEATS', 'open', 'fill']);
  assert.equal(out.gate.at(-1), 'the glasses match the prop photo');
  assert.ok(out.gate.includes('muted palette'));
});

test('without --dry-run the command says the render is not here yet and exits 2', () => {
  const { root, env } = site();
  const r = run(root, env, 'hero', 'my-page', ...PAGE);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Task 3/);
});

test('a compile refusal reaches the terminal by message and exits 1', () => {
  const { root, env } = site();
  const r = run(root, env, 'hero', 'my-page', '--title', 'X', '--beat', 'A notebook on a surface.', '--beat', 'b', '--label', 'a', '--label', 'b', '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /surface/);
  const missing = run(root, env, 'hero', 'my-page', ...PAGE, '--prop', 'hat', '--dry-run');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /hat[\s\S]*declared: glasses/);
});
