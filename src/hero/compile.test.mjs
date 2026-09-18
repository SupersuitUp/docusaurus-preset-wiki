import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileHero, wikiGate } from './compile.mjs';

/** A loaded pack the way loadPack hands it back: manifest plus `dir`, refs on disk. */
function pack(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'));
  mkdirSync(join(dir, 'refs'));
  const p = {
    id: 'test-pack', name: 'Test pack', anchor: 'refs/anchor.png',
    refs: ['refs/anchor.png', 'refs/b.png', 'refs/c.png', 'refs/d.png', 'refs/e.png'],
    palette: { ground: ['#EFE6D2', '#F5F1E9'], fill: ['#8FB0CE'], line: ['#3B382F'] },
    styleLine: 'warm editorial illustration, soft painterly line',
    rejectedPoles: ['comic-book', 'neon', '3D/CGI/Pixar'],
    gate: ['muted natural palette on a warm cream ground', 'every person\'s eyes are open and clearly visible unless plainly asleep'],
    maxElements: 6, textPolicy: 'furniture', dir, ...overrides,
  };
  for (const r of new Set([p.anchor, ...p.refs])) if (r) writeFileSync(join(dir, r), '');
  return p;
}

const config = (extra = {}) => ({ layout: 'grid', beats: 4, size: '2560x1440', model: 'gpt-image-2.5-sunburst', quality: 'xhigh', props: {}, gate: [], outputDir: 'static/img/illustrations', ...extra });

const FOUR = ['A father opens a notebook.', 'The notebook fills with dated pages.', 'A machine reads the pages.', 'A printed album lands on the table.'];
const FOUR_LABELS = ['capture', 'annotate', 'own', 'project'];
const page = (extra = {}) => ({ pack: pack(), config: config(), title: 'HYPERDOCUMENTATION', labels: FOUR_LABELS, beats: FOUR, props: {}, ...extra });

test('the prompt carries its sections in order: style and palette, layout law, beats, text law, negatives', () => {
  const { prompt } = compileHero(page());
  const at = (s) => { const i = prompt.indexOf(s); assert.notEqual(i, -1, `missing: ${s}`); return i; };
  const style = at('warm editorial illustration, soft painterly line');
  const palette = at('#EFE6D2');
  const layout = at('ONE single image divided into 4 CLEAR PANELS');
  const beat1 = at(FOUR[0]);
  const beat4 = at(FOUR[3]);
  const text = at('TITLE BAR across the very top');
  const neg = at('no comic-book');
  assert.ok(style < palette && palette < layout && layout < beat1 && beat1 < beat4 && beat4 < text && text < neg);
});

test('grid law: a two-by-two grid read left to right then top to bottom, cream gutters, no borders', () => {
  const { prompt } = compileHero(page());
  assert.match(prompt, /GRID of two columns and two rows \(top-left, top-right, bottom-left, bottom-right\)/);
  assert.match(prompt, /read left to right and then top to bottom/);
  assert.match(prompt, /generous clean cream gutters both between the columns and between the rows/);
  assert.match(prompt, /NO drawn borders and NO frame lines/);
  assert.match(prompt, /rather than 4 unrelated pictures/);
  assert.doesNotMatch(prompt, /horizontal row/);
});

test('row law: N panels left to right in a horizontal row, cream gutters, no borders', () => {
  const { prompt } = compileHero(page({ config: config({ layout: 'row', beats: 3 }), beats: FOUR.slice(0, 3), labels: FOUR_LABELS.slice(0, 3) }));
  assert.match(prompt, /ONE single image divided into 3 CLEAR PANELS of equal size, arranged left to right in a horizontal row/);
  assert.match(prompt, /generous clean cream gutters with NO drawn borders and NO frame lines/);
  assert.match(prompt, /rather than 3 unrelated pictures/);
  assert.doesNotMatch(prompt, /two columns and two rows/);
});

test('a grid holds exactly four beats', () => {
  assert.throws(() => compileHero(page({ beats: FOUR.slice(0, 3), labels: FOUR_LABELS.slice(0, 3) })), /grid[\s\S]*four/i);
});

test('every beat appears verbatim, numbered, after "beat by beat"', () => {
  const { prompt } = compileHero(page());
  const i = prompt.indexOf('beat by beat');
  assert.notEqual(i, -1);
  for (const [n, b] of FOUR.entries()) assert.ok(prompt.indexOf(`${n + 1}. ${b}`) > i, `beat ${n + 1}`);
});

test('labels must match beats one for one', () => {
  assert.throws(() => compileHero(page({ labels: FOUR_LABELS.slice(0, 3) })), /3 labels[\s\S]*4 beats|labels/);
  assert.throws(() => compileHero(page({ labels: undefined })), /labels/);
});

test('a hero is a strip of at least two beats', () => {
  assert.throws(() => compileHero(page({ config: config({ layout: 'row' }), beats: [FOUR[0]], labels: ['one'] })), /at least 2|two beats/i);
});

test('the text law names the title and every label verbatim and nothing else', () => {
  const { prompt, strings } = compileHero(page());
  assert.match(prompt, /TITLE BAR across the very top of the whole image reading "HYPERDOCUMENTATION" in bold, chunky, hand-inked capitals/);
  assert.match(prompt, /Label the panels, in order, with these exact words: "capture", "annotate", "own", "project"/);
  assert.match(prompt, /Each label sits in a small clean band at the top of its own panel/);
  assert.match(prompt, /That title and those labels are the ONLY text permitted/);
  assert.deepEqual(strings, [
    { text: 'HYPERDOCUMENTATION', placement: 'title-bar' },
    { text: 'capture', placement: 'panel-1-label' },
    { text: 'annotate', placement: 'panel-2-label' },
    { text: 'own', placement: 'panel-3-label' },
    { text: 'project', placement: 'panel-4-label' },
  ]);
});

test('a title is required; a hero has to be readable on its own', () => {
  assert.throws(() => compileHero(page({ title: '' })), /title/);
  assert.throws(() => compileHero(page({ title: undefined })), /title/);
});

test('the prop clause appears only with props, counts them, and names them as props after the style refs', () => {
  const without = compileHero(page());
  assert.doesNotMatch(without.prompt, /PROP reference/);
  assert.equal(without.refs.filter((r) => r.role === 'prop').length, 0);

  const propsDir = mkdtempSync(join(tmpdir(), 'props-'));
  const a = join(propsDir, 'glasses-front.png');
  const b = join(propsDir, 'glasses-side.png');
  writeFileSync(a, ''); writeFileSync(b, '');
  const withProps = compileHero(page({ props: { 'smart-glasses': [a, b] } }));
  assert.match(withProps.prompt, /The FIRST reference image\(s\) carry the visual style and nothing else\. The LAST 2 reference image\(s\) are PROP references/);
  assert.match(withProps.prompt, /smart glasses/);
  assert.match(withProps.prompt, /never copying the photograph's realism, background or people/);
  const roles = withProps.refs.map((r) => r.role);
  assert.deepEqual(roles.slice(-2), ['prop', 'prop']);
  assert.deepEqual(withProps.refs.slice(-2).map((r) => r.path), [a, b]);
  // The prop clause sits between the beats and the text law.
  assert.ok(withProps.prompt.indexOf(FOUR[3]) < withProps.prompt.indexOf('PROP reference'));
  assert.ok(withProps.prompt.indexOf('PROP reference') < withProps.prompt.indexOf('TITLE BAR'));
});

test('a prop path that does not exist is refused by name', () => {
  assert.throws(() => compileHero(page({ props: { glasses: ['/nowhere/glasses.png'] } })), /\/nowhere\/glasses\.png/);
});

test('refs: the anchor first, then up to three more style refs, then the props', () => {
  const p = pack();
  const propsDir = mkdtempSync(join(tmpdir(), 'props-'));
  const a = join(propsDir, 'p.png');
  writeFileSync(a, '');
  const { refs } = compileHero(page({ pack: p, props: { thing: [a] } }));
  assert.deepEqual(refs, [
    { path: join(p.dir, 'refs/anchor.png'), role: 'anchor' },
    { path: join(p.dir, 'refs/b.png'), role: 'style' },
    { path: join(p.dir, 'refs/c.png'), role: 'style' },
    { path: join(p.dir, 'refs/d.png'), role: 'style' },
    { path: a, role: 'prop' },
  ]);
});

test('a pack ref that does not exist on disk is refused by name', () => {
  const p = pack({ refs: ['refs/anchor.png', 'refs/missing.png'] });
  unlinkSync(join(p.dir, 'refs/missing.png'));
  assert.throws(() => compileHero(page({ pack: p })), /refs\/missing\.png/);
  const q = pack({ anchor: 'refs/gone.png', refs: [] });
  unlinkSync(join(q.dir, 'refs/gone.png'));
  assert.throws(() => compileHero(page({ pack: q })), /refs\/gone\.png/);
});

test('negatives: one "no <pole>" per rejected pole, in pack order', () => {
  const { prompt } = compileHero(page());
  assert.match(prompt, /no comic-book, no neon, no 3D\/CGI\/Pixar/);
});

test('the gate is the five wiki defaults, then the pack gate, then the config gate, deduplicated by trimmed equality', () => {
  const p = pack({ gate: ['muted natural palette on a warm cream ground', '  every person\'s eyes are open and clearly visible unless plainly asleep  ', 'shared line'] });
  const c = config({ gate: ['shared line', 'the smart glasses match the prop photos'] });
  const { gate } = compileHero(page({ pack: p, config: c }));
  assert.equal(gate.length, 5 + 2 + 1);
  assert.deepEqual(gate.slice(0, 5), wikiGate({ layout: 'grid', beats: 4 }));
  assert.equal(gate[0], 'every person\'s eyes are open and clearly visible unless plainly asleep');
  assert.deepEqual(gate.slice(5), ['muted natural palette on a warm cream ground', 'shared line', 'the smart glasses match the prop photos']);
});

test('the wiki defaults name the declared strings, the panel count and the layout', () => {
  const grid = wikiGate({ layout: 'grid', beats: 4 });
  assert.equal(grid.length, 5);
  assert.match(grid[1], /no .*lettering beyond the declared strings/i);
  assert.match(grid[2], /screen faces/);
  assert.match(grid[3], /exactly 4 panels/);
  assert.match(grid[4], /two-by-two grid/);
  assert.match(wikiGate({ layout: 'row', beats: 3 })[4], /one horizontal row/);
});

test('a size not divisible by 16 is refused even when the config was hand-built', () => {
  assert.throws(() => compileHero(page({ config: config({ size: '2560x1000' }) })), /16/);
});

test('the word "surface" is banned in scene text', () => {
  assert.throws(() => compileHero(page({ beats: ['A notebook lies on a surface.', ...FOUR.slice(1)] })), /surface/);
  assert.throws(() => compileHero(page({ beats: ['Surfaces gleam.', ...FOUR.slice(1)] })), /surface/i);
});

test('an inline pack with no palette and no refs still compiles, with no palette line and no refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'inline-'));
  const p = { id: 'inline:hero_register', name: 'inline', anchor: null, refs: [], palette: null, styleLine: 'Loose watercolor washes.', rejectedPoles: [], gate: [], dir: root };
  const { prompt, refs } = compileHero(page({ pack: p }));
  assert.match(prompt, /^Loose watercolor washes\./);
  assert.doesNotMatch(prompt, /Palette/);
  assert.doesNotMatch(prompt, /Negatives/);
  assert.deepEqual(refs, []);
});

test('no em dash anywhere in the compiled prompt', () => {
  const { prompt } = compileHero(page());
  assert.doesNotMatch(prompt, /\u2014/);
});
