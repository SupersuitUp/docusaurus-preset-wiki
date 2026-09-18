// The `hero` block of wiki.config.json: how this wiki's article heroes get made. Read, defaulted,
// validated, and the Style Pack it names resolved and loaded, so `wiki hero` and its compiler
// never touch the config file themselves.
//
// A wiki that still carries the older `hero_register` block is migrated in memory: its register
// sentence becomes an inline pack, `defaultPanels` becomes `beats`, `multipanel` becomes `row`,
// and its refs become the inline pack's refs. The file is never rewritten here.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const HERO_DEFAULTS = Object.freeze({
  layout: 'grid',
  beats: 4,
  size: '2560x1440',
  model: 'gpt-image-2.5-sunburst',
  quality: 'xhigh',
  outputDir: 'static/img/illustrations',
});

const LAYOUTS = ['row', 'grid'];

/** WIDTHxHEIGHT, both sides a whole number of sixteens. Throws naming the offending value. */
export function validateSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size ?? ''));
  if (!m) throw new Error(`hero.size must be WIDTHxHEIGHT (for example 2560x1440), got ${JSON.stringify(size)}`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w % 16 !== 0 || h % 16 !== 0) throw new Error(`hero.size ${size}: both sides must be divisible by 16 (the image model rounds anything else and the panels drift)`);
  return size;
}

/** Fill defaults and check shape. Pure; takes the raw `hero` block (or a migrated one). */
export function normalizeHeroConfig(raw = {}) {
  const c = { ...HERO_DEFAULTS, props: {}, gate: [], stylePack: null, ...stripUndefined(raw) };
  if (!LAYOUTS.includes(c.layout)) throw new Error(`hero.layout must be one of ${LAYOUTS.join(', ')}, got ${JSON.stringify(c.layout)}`);
  if (!Number.isInteger(c.beats) || c.beats < 2) throw new Error(`hero.beats must be a whole number of at least 2 (a hero is a strip of beats), got ${JSON.stringify(c.beats)}`);
  validateSize(c.size);
  if (typeof c.model !== 'string' || !c.model) throw new Error('hero.model must be a model id');
  if (typeof c.quality !== 'string' || !c.quality) throw new Error('hero.quality must be a string');
  if (typeof c.outputDir !== 'string' || !c.outputDir) throw new Error('hero.outputDir must be a path');
  if (c.props === null || typeof c.props !== 'object' || Array.isArray(c.props)) throw new Error('hero.props must be an object mapping a prop name to a list of image paths');
  for (const [name, paths] of Object.entries(c.props)) {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || !p)) throw new Error(`hero.props.${name} must be a list of image paths`);
  }
  if (!Array.isArray(c.gate) || c.gate.some((g) => typeof g !== 'string')) throw new Error('hero.gate must be a list of strings, one assertion each');
  if (c.stylePack !== null && (typeof c.stylePack !== 'string' || !c.stylePack)) throw new Error('hero.stylePack must be a pack id or a path to a pack folder');
  return c;
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** The in-memory shape of an older `hero_register` block, plus the inline pack it implies. */
export function migrateHeroRegister(legacy, root) {
  const layoutMap = { multipanel: 'row', grid: 'grid' };
  if (legacy.layout === 'single') {
    throw new Error('hero_register.layout "single" is not supported by `wiki hero`: a hero is a strip of beats. Add a `hero` block with layout "row" or "grid".');
  }
  // A mode-abu block names its pack relative to its universe; keep that working.
  let stylePack = legacy.stylePack;
  if (stylePack && legacy.universe && !isAbsolute(stylePack) && existsSync(join(resolve(root, legacy.universe, stylePack), 'pack.json'))) {
    stylePack = resolve(root, legacy.universe, stylePack);
  }
  // No layout key means the shell door's own default, which was one row, never the new grid
  // default: a wiki that never chose a layout has been rendering rows all along.
  const hero = {
    stylePack,
    layout: legacy.layout === undefined ? 'row' : layoutMap[legacy.layout],
    beats: legacy.defaultPanels,
    size: legacy.size,
    model: legacy.model,
    quality: legacy.quality,
    outputDir: legacy.outputDir,
    props: legacy.props,
    gate: legacy.gate,
  };
  if (legacy.layout !== undefined && hero.layout === undefined) throw new Error(`hero_register.layout ${JSON.stringify(legacy.layout)} has no wiki-hero equivalent; use "row" or "grid"`);
  let inlinePack = null;
  if (!legacy.stylePack) {
    const refs = Array.isArray(legacy.refs) ? legacy.refs : [];
    inlinePack = {
      id: 'inline:hero_register',
      name: 'Inline pack migrated from hero_register',
      anchor: refs[0] ?? null,
      refs,
      palette: null,
      styleLine: legacy.register || 'An editorial illustration on a warm cream ground: soft painterly line, gentle shading, a muted natural palette, grounded and human.',
      rejectedPoles: [],
      gate: [],
      dir: root,
    };
  }
  return { hero, inlinePack };
}

/** Where a pack folder is, given a path or a bare id. Throws naming every place it looked. */
export function resolvePackDir(stylePack, root, env = process.env) {
  const tried = [];
  const isPack = (d) => existsSync(join(d, 'pack.json')) && statSync(d).isDirectory();
  const looksLikePath = isAbsolute(stylePack) || stylePack.includes('/') || stylePack.startsWith('.');
  if (looksLikePath) {
    const d = resolve(root, stylePack);
    tried.push(d);
    if (isPack(d)) return d;
  } else {
    if (env.WIKI_STYLE_PACKS) {
      const d = join(env.WIKI_STYLE_PACKS, stylePack);
      tried.push(`${d} ($WIKI_STYLE_PACKS)`);
      if (isPack(d)) return d;
    } else {
      tried.push('$WIKI_STYLE_PACKS is not set');
    }
    const sibling = resolve(root, '..', 'wiki-style-packs', 'packs', stylePack);
    tried.push(`${sibling} (../wiki-style-packs/packs beside the wiki)`);
    if (isPack(sibling)) return sibling;
    const local = resolve(root, stylePack);
    tried.push(local);
    if (isPack(local)) return local;
  }
  throw new Error(`style pack ${JSON.stringify(stylePack)} not found (a pack is a folder holding pack.json). Looked in:\n  ${tried.join('\n  ')}`);
}

/** Read and check a pack.json; the returned pack carries `dir`, which its refs resolve against. */
export function loadPack(dir) {
  const file = join(dir, 'pack.json');
  if (!existsSync(file)) throw new Error(`no pack.json in ${dir}`);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['id', 'anchor', 'styleLine']) {
    if (typeof pack[key] !== 'string' || !pack[key]) throw new Error(`${file}: pack.${key} must be a non-empty string`);
  }
  pack.refs = Array.isArray(pack.refs) ? pack.refs : [];
  pack.rejectedPoles = Array.isArray(pack.rejectedPoles) ? pack.rejectedPoles : [];
  pack.gate = Array.isArray(pack.gate) ? pack.gate : [];
  pack.palette = pack.palette && typeof pack.palette === 'object' ? pack.palette : null;
  pack.dir = dir;
  return pack;
}

/**
 * The hero configuration of the wiki at `root`, with the pack resolved and loaded.
 * `{ root, stylePack, packDir, pack, layout, beats, size, model, quality, props, gate, outputDir }`.
 * `stylePack` is null and `packDir` is the wiki root for a migrated legacy block with no pack.
 * `root` is carried so a caller resolving relative prop paths never splices it in itself.
 */
export function readHeroConfig(root, { env = process.env } = {}) {
  const file = join(root, 'wiki.config.json');
  if (!existsSync(file)) throw new Error(`no wiki.config.json at ${file}; run from the wiki root`);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  let raw;
  let inlinePack = null;
  if (config.hero && typeof config.hero === 'object') {
    raw = config.hero;
  } else if (config.hero_register && typeof config.hero_register === 'object') {
    ({ hero: raw, inlinePack } = migrateHeroRegister(config.hero_register, root));
  } else {
    throw new Error('wiki.config.json has no `hero` block (and no legacy `hero_register` to migrate). Add `"hero": { "stylePack": "<pack id or path>" }`.');
  }
  const hero = normalizeHeroConfig(raw);
  if (hero.stylePack === null && !inlinePack) throw new Error('hero.stylePack is required: the id of a shared Style Pack, or a path to one');
  let packDir;
  let pack;
  if (hero.stylePack === null) {
    packDir = root;
    pack = inlinePack;
  } else {
    packDir = resolvePackDir(hero.stylePack, root, env);
    pack = loadPack(packDir);
  }
  return { ...hero, root, packDir, pack };
}
