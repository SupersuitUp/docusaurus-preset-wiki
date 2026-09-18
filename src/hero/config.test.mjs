import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readHeroConfig, resolvePackDir, loadPack, HERO_DEFAULTS } from './config.mjs';

const BASE = { title: 'T', tagline: 't', url: 'https://t.wiki', organizationName: 'o', projectName: 'p', copyright: 'c', noindex: true, description: 'd' };

/** A wiki root in a temp dir with the given extra config keys. */
function wiki(extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'wiki-hero-'));
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ ...BASE, ...extra }));
  return d;
}

/** A Style Pack folder: pack.json plus every ref it names, as empty files. */
function pack(parent, id, overrides = {}) {
  const dir = join(parent, id);
  mkdirSync(join(dir, 'refs'), { recursive: true });
  const manifest = {
    id, name: id, anchor: 'refs/anchor.png', refs: ['refs/anchor.png', 'refs/b.png', 'refs/c.png'],
    palette: { ground: ['#EFE6D2'], fill: ['#8FB0CE'], line: ['#3B382F'] },
    styleLine: 'warm editorial illustration', rejectedPoles: ['neon'], gate: ['muted palette'],
    maxElements: 6, textPolicy: 'furniture', ...overrides,
  };
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(manifest));
  for (const r of new Set([manifest.anchor, ...(manifest.refs || [])])) if (r) writeFileSync(join(dir, r), '');
  return dir;
}

test('defaults: a hero block naming only a pack gets grid, four beats, 2560x1440, sunburst, xhigh, the illustrations dir', () => {
  const root = wiki({ hero: { stylePack: 'plain' } });
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'plain');
  const c = readHeroConfig(root, { env: { WIKI_STYLE_PACKS: packs } });
  assert.equal(c.layout, 'grid');
  assert.equal(c.beats, 4);
  assert.equal(c.size, '2560x1440');
  assert.equal(c.model, 'gpt-image-2.5-sunburst');
  assert.equal(c.quality, 'xhigh');
  assert.equal(c.outputDir, 'static/img/illustrations');
  assert.deepEqual(c.props, {});
  assert.deepEqual(c.gate, []);
  assert.equal(c.stylePack, 'plain');
  assert.equal(c.packDir, join(packs, 'plain'));
  assert.equal(c.pack.id, 'plain');
});

test('a bare id resolves against $WIKI_STYLE_PACKS first, then ../wiki-style-packs/packs beside the wiki', () => {
  const parent = mkdtempSync(join(tmpdir(), 'family-'));
  const root = join(parent, 'some-wiki');
  mkdirSync(root);
  writeFileSync(join(root, 'wiki.config.json'), JSON.stringify({ ...BASE, hero: { stylePack: 'shared' } }));
  const sibling = join(parent, 'wiki-style-packs', 'packs');
  mkdirSync(sibling, { recursive: true });
  pack(sibling, 'shared');
  assert.equal(resolvePackDir('shared', root, {}), join(sibling, 'shared'));
  const env = mkdtempSync(join(tmpdir(), 'envpacks-'));
  pack(env, 'shared');
  assert.equal(resolvePackDir('shared', root, { WIKI_STYLE_PACKS: env }), join(env, 'shared'));
});

test('a filesystem path, relative to the wiki root or absolute, resolves as itself', () => {
  const root = wiki();
  const local = pack(join(root, 'illustrations'), 'mine');
  assert.equal(resolvePackDir('illustrations/mine', root, {}), local);
  assert.equal(resolvePackDir(local, root, {}), local);
});

test('an unresolvable pack names every place it looked', () => {
  const root = wiki({ hero: { stylePack: 'nowhere' } });
  assert.throws(() => readHeroConfig(root, { env: {} }), /nowhere[\s\S]*WIKI_STYLE_PACKS[\s\S]*wiki-style-packs\/packs/);
});

test('loadPack refuses a manifest with no styleLine or no anchor, and carries its dir', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  const ok = loadPack(pack(packs, 'ok'));
  assert.equal(ok.dir, join(packs, 'ok'));
  assert.equal(ok.styleLine, 'warm editorial illustration');
  assert.throws(() => loadPack(pack(packs, 'noline', { styleLine: undefined })), /styleLine/);
  assert.throws(() => loadPack(pack(packs, 'noanchor', { anchor: undefined })), /anchor/);
});

test('legacy hero_register migrates in memory: the register sentence becomes an inline pack, multipanel becomes row, defaultPanels becomes beats, refs become the pack refs', () => {
  const root = wiki({
    hero_register: {
      mode: 'local', layout: 'multipanel', defaultPanels: 3,
      register: 'Loose watercolor washes on cream paper.',
      refs: ['illustrations/refs/a.png', 'illustrations/refs/b.png'],
      outputDir: 'static/img/heroes', size: '1536x1024', model: 'gpt-image-2.5-sunburst', quality: 'high',
      props: { 'smart-glasses': ['illustrations/props/g.png'] },
      gate: ['every person has open eyes'],
    },
  });
  const c = readHeroConfig(root, { env: {} });
  assert.equal(c.stylePack, null);
  assert.equal(c.packDir, root);
  assert.equal(c.layout, 'row');
  assert.equal(c.beats, 3);
  assert.equal(c.size, '1536x1024');
  assert.equal(c.quality, 'high');
  assert.equal(c.outputDir, 'static/img/heroes');
  assert.deepEqual(c.props, { 'smart-glasses': ['illustrations/props/g.png'] });
  assert.deepEqual(c.gate, ['every person has open eyes']);
  assert.equal(c.pack.styleLine, 'Loose watercolor washes on cream paper.');
  assert.equal(c.pack.anchor, 'illustrations/refs/a.png');
  assert.deepEqual(c.pack.refs, ['illustrations/refs/a.png', 'illustrations/refs/b.png']);
  assert.deepEqual(c.pack.rejectedPoles, []);
  assert.deepEqual(c.pack.gate, []);
  assert.equal(c.pack.dir, root);
});

test('legacy grid stays grid, and legacy defaults fill in the same as new ones', () => {
  const root = wiki({ hero_register: { layout: 'grid', register: 'r' } });
  const c = readHeroConfig(root, { env: {} });
  assert.equal(c.layout, 'grid');
  assert.equal(c.beats, 4);
  assert.equal(c.size, HERO_DEFAULTS.size);
});

test('a legacy block that names a stylePack uses it rather than an inline pack', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'named');
  const root = wiki({ hero_register: { mode: 'abu', stylePack: 'named', register: 'ignored' } });
  const c = readHeroConfig(root, { env: { WIKI_STYLE_PACKS: packs } });
  assert.equal(c.stylePack, 'named');
  assert.equal(c.pack.id, 'named');
});

test('a new hero block wins over a legacy one when both are present', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'new');
  const root = wiki({ hero: { stylePack: 'new', layout: 'row', beats: 3 }, hero_register: { layout: 'grid', register: 'old' } });
  const c = readHeroConfig(root, { env: { WIKI_STYLE_PACKS: packs } });
  assert.equal(c.pack.id, 'new');
  assert.equal(c.layout, 'row');
  assert.equal(c.beats, 3);
});

test('no hero and no hero_register is refused with the field to add', () => {
  assert.throws(() => readHeroConfig(wiki(), { env: {} }), /hero/);
});

test('size must be WIDTHxHEIGHT with both sides divisible by 16', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'p');
  const env = { WIKI_STYLE_PACKS: packs };
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', size: '2560x1441' } }), { env }), /16/);
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', size: '1000x1000' } }), { env }), /16/);
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', size: 'big' } }), { env }), /size/);
  assert.equal(readHeroConfig(wiki({ hero: { stylePack: 'p', size: '1536x1024' } }), { env }).size, '1536x1024');
});

test('layout must be row or grid, beats must be a whole number of at least 2, and a legacy single plate is refused', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'p');
  const env = { WIKI_STYLE_PACKS: packs };
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', layout: 'multipanel' } }), { env }), /row|grid/);
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', beats: 1 } }), { env }), /beats/);
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', beats: 2.5 } }), { env }), /beats/);
  assert.throws(() => readHeroConfig(wiki({ hero_register: { layout: 'single', register: 'r' } }), { env }), /single/);
});

test('props must map a name to a list of paths, and gate must be a list of strings', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'p');
  const env = { WIKI_STYLE_PACKS: packs };
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', props: { glasses: 'one.png' } } }), { env }), /props/);
  assert.throws(() => readHeroConfig(wiki({ hero: { stylePack: 'p', gate: 'open eyes' } }), { env }), /gate/);
});

test('readHeroConfig returns the wiki root, so callers never splice it in themselves', () => {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  pack(packs, 'plain');
  const root = wiki({ hero: { stylePack: 'plain' } });
  const c = readHeroConfig(root, { env: { WIKI_STYLE_PACKS: packs } });
  assert.equal(c.root, root);
  const legacy = wiki({ hero_register: { layout: 'grid', register: 'r' } });
  assert.equal(readHeroConfig(legacy, { env: {} }).root, legacy);
});

test('a legacy hero_register with no layout key migrates to row, the shell door\'s old default, never to grid', () => {
  const root = wiki({ hero_register: { register: 'r', defaultPanels: 3 } });
  const c = readHeroConfig(root, { env: {} });
  assert.equal(c.layout, 'row');
  assert.equal(c.beats, 3);
});
