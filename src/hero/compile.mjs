// The pure half of `wiki hero`: a Style Pack, the wiki's hero config and one page's inputs in;
// the prompt, the ordered reference list, the declared strings and the read-back gate out.
// No network, no image model, nothing written. Task 3 hands this output to the renderer.
//
// The laws here are ported from the hyperdocumentation wiki's render-hero.sh (the row law, the
// two-by-two grid law, the text law, the prop law), wording kept, shell dropped. They are the
// house rules every wiki hero obeys whatever pack paints it:
//
//   layout   one image, N equal panels, cream gutters, no drawn borders, one world and one cast
//   text     a title bar across the top and one label band per panel, spelled exactly, nothing else
//   props    a prop photo is passed AFTER the style refs and named as a prop, so the model copies
//            the object and not the photograph; a prop's own gate lines join the read-back only
//            when that prop is in the scene
//   pairings the pack's standing rules (how a recurring subject is always shown), one line each,
//            between the layout law and the beats, so every scene the pack paints inherits them
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { normalizeProp, validateSize } from './config.mjs';

/** The most style refs passed after the anchor. More than this and the anchor stops anchoring. */
// A panel caption's length, in words. Under four reads as a tag; over twelve does not fit a band.
const MIN_CAPTION_WORDS = 4;
const MAX_CAPTION_WORDS = 12;

const MAX_STYLE_REFS = 3;

/** The word is banned in scene text family-wide: it reads as a tabletop and the model draws one. */
const BANNED_SCENE_WORD = /\bsurface/i;

/** The five assertions every wiki hero is read back against, before the pack's and the wiki's. */
export function wikiGate({ layout, beats }) {
  return [
    "every person's eyes are open and clearly visible unless plainly asleep",
    'no lettering beyond the declared strings; invented words on folders, screens or tags are a DEFECT',
    'a screen faces the person using it, never the viewer',
    `exactly ${beats} panels, one per beat, no more and no fewer`,
    layout === 'grid'
      ? 'the panels sit in a two-by-two grid, read left to right then top to bottom, with cream gutters and no drawn borders'
      : 'the panels sit in one horizontal row, read left to right, with cream gutters and no drawn borders',
  ];
}

function layoutLaw(layout, n) {
  if (layout === 'grid') {
    return `ONE single image divided into ${n} CLEAR PANELS of equal size, arranged as a GRID of two columns and two rows (top-left, top-right, bottom-left, bottom-right), read left to right and then top to bottom, separated by generous clean cream gutters both between the columns and between the rows, with NO drawn borders and NO frame lines. Each panel is one BEAT of the same argument and they read in order as a sequence. Each beat shows the CONSEQUENCE of the one before rather than restating it. Keep ONE consistent world and ONE consistent cast across every panel, so the grid reads as a progression rather than ${n} unrelated pictures.`;
  }
  return `ONE single image divided into ${n} CLEAR PANELS of equal size, arranged left to right in a horizontal row, separated by generous clean cream gutters with NO drawn borders and NO frame lines. Each panel is one BEAT of the same argument and they read in order as a sequence. Beat two shows the CONSEQUENCE of beat one rather than restating it. Keep ONE consistent world and ONE consistent cast across every panel, so the strip reads as a progression rather than ${n} unrelated pictures.`;
}

function textLaw(title, labels) {
  const pretty = labels.map((l) => `"${l}"`).join(', ');
  const labelLaw = ` Label the panels, in order, with these exact words: ${pretty}. Each label sits in a small clean band at the top of its own panel.`;
  return `TEXT, and it must be SPELLED EXACTLY AS WRITTEN HERE, with no invented words and no extra sentences anywhere in the image: a TITLE BAR across the very top of the whole image reading "${title}" in bold, chunky, hand-inked capitals.${labelLaw} That title and those labels are the ONLY text permitted. No body copy, no paragraphs, no sentences, no speech bubbles, no captions under the panels, no UI chrome, no menus, no watermarks, no signature. Any lettering must be large, high contrast and effortlessly legible at a glance; a reader who sees only this image should understand the point without reading anything else.`;
}

function propLaw(props) {
  const names = Object.entries(props).map(([name, { refs }]) => `the ${name.replace(/[-_]+/g, ' ')} (${refs.length} ${refs.length === 1 ? 'photograph' : 'photographs'})`);
  const count = Object.values(props).reduce((n, { refs }) => n + refs.length, 0);
  const which = names.length === 1 ? 'an object that must appear' : 'objects that must each appear';
  return `The FIRST reference image(s) carry the visual style and nothing else. The LAST ${count} reference image(s) are PROP references: photographs of ${joinNames(names)}, ${which} in the scene drawn accurately in shape and detail, in this illustration's painted register, never copying the photograph's realism, background or people.`;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The pack's standing rules as one line each. A pairing is a string, or the object the review
 * frapp writes (`{ rule, subject, shownAs, ... }`): the rule when it has one, else composed from
 * the subject and how it is shown. Blanks drop out; duplicates are said once.
 */
export function pairingLines(pairings) {
  if (!Array.isArray(pairings)) return [];
  return dedupe(pairings.map((p) => {
    if (typeof p === 'string') return p;
    if (!p || typeof p !== 'object') return '';
    if (typeof p.rule === 'string' && p.rule.trim()) return p.rule;
    if (typeof p.subject === 'string' && p.subject.trim() && typeof p.shownAs === 'string' && p.shownAs.trim()) return `${p.subject.trim()} is shown as ${p.shownAs.trim()}`;
    return '';
  }));
}

function standingRules(pairings) {
  const lines = pairingLines(pairings);
  return lines.length ? `Standing rules for every scene:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
}

function paletteLine(palette) {
  if (!palette) return '';
  const parts = [];
  if (palette.ground?.length) parts.push(`the ground is ${palette.ground.join(' or ')}`);
  if (palette.fill?.length) parts.push(`fills are ${palette.fill.join(', ')}`);
  if (palette.line?.length) parts.push(`the line is ${palette.line.join(', ')}`);
  return parts.length ? ` Palette, strictly: ${parts.join('; ')}. No colour outside this palette.` : '';
}

function negatives(poles) {
  if (!poles.length) return '';
  return `Negatives: ${poles.map((p) => `no ${p}`).join(', ')}.`;
}

/** Deduplicate by trimmed string equality, keeping first occurrences and their trimmed text. */
function dedupe(lines) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Compile one hero.
 *   pack    a loaded Style Pack (see config.mjs loadPack): manifest plus `dir`
 *   config  the wiki's hero config (readHeroConfig, or hand-built with the same fields)
 *   title   the words across the top, verbatim
 *   labels  one label per panel, verbatim
 *   beats   the scene, one string per panel, verbatim
 *   props   the props this page uses: { name: [paths] } or { name: { refs: [paths], gate: [...] } };
 *           paths absolute or relative to config.root (else cwd). A prop's gate joins the returned
 *           gate only because the prop is passed here.
 * Returns { prompt, refs: [{ path, role }], strings: [{ text, placement }], gate: string[] }.
 */
export function compileHero({ pack, config, title, labels, beats, props: rawProps = {} }) {
  if (!pack || typeof pack !== 'object') throw new Error('compileHero needs a loaded style pack');
  if (!config || typeof config !== 'object') throw new Error('compileHero needs the hero config');
  const layout = config.layout ?? 'grid';
  if (!['row', 'grid'].includes(layout)) throw new Error(`layout must be row or grid, got ${JSON.stringify(layout)}`);
  validateSize(config.size ?? '2560x1440');

  if (!Array.isArray(beats) || beats.length < 2) throw new Error('a hero is a strip of at least 2 beats; pass one scene string per panel');
  if (beats.some((b) => typeof b !== 'string' || !b.trim())) throw new Error('every beat must be a non-empty scene string');
  if (layout === 'grid' && beats.length !== 4) throw new Error(`a grid hero holds exactly four beats (two columns by two rows), got ${beats.length}; use layout "row" for another count`);
  for (const [i, b] of beats.entries()) {
    const hit = BANNED_SCENE_WORD.exec(b);
    if (hit) throw new Error(`beat ${i + 1} contains the banned word "${hit[0]}": say what the thing actually is (a table, a desk, a page)`);
  }
  if (typeof title !== 'string' || !title.trim()) throw new Error('a title is required: the words across the top of the hero, so it reads on its own');
  if (!Array.isArray(labels)) throw new Error('labels are required: one per panel, in order');
  if (labels.length !== beats.length) throw new Error(`${labels.length} labels for ${beats.length} beats; give exactly one label per panel`);
  if (labels.some((l) => typeof l !== 'string' || !l.trim())) throw new Error('every label must be a non-empty string');
  // A caption is a short plain sentence, never a one- or two-word tag. A hero shipped with
  // bands reading "the phone" and "the glasses" on 2026-09-18 and Gary named the rule from
  // his phone: short sentences in very plain language. The band can carry about twelve words.
  labels.forEach((l, i) => {
    const n = l.trim().split(/\s+/).length;
    if (n < MIN_CAPTION_WORDS || n > MAX_CAPTION_WORDS) throw new Error(`caption ${i + 1} "${l}" has ${n} word${n === 1 ? '' : 's'}; a caption is a short plain sentence of four to twelve words`);
  });

  // References: the anchor, then up to three more style refs, then the props in declared order.
  const packDir = pack.dir;
  const packPath = (rel) => (isAbsolute(rel) ? rel : resolve(packDir ?? '.', rel));
  const refs = [];
  if (pack.anchor) {
    const anchor = packPath(pack.anchor);
    if (!existsSync(anchor)) throw new Error(`pack anchor not found: ${pack.anchor} (looked at ${anchor})`);
    refs.push({ path: anchor, role: 'anchor' });
  }
  const others = (pack.refs ?? []).filter((r) => r && r !== pack.anchor);
  for (const rel of others) {
    const p = packPath(rel);
    if (!existsSync(p)) throw new Error(`pack ref not found: ${rel} (looked at ${p})`);
  }
  for (const rel of others.slice(0, MAX_STYLE_REFS)) refs.push({ path: packPath(rel), role: 'style' });
  if (rawProps === null || typeof rawProps !== 'object' || Array.isArray(rawProps)) throw new Error('props must be an object keyed by prop name');
  const props = Object.fromEntries(Object.entries(rawProps).map(([name, value]) => [name, normalizeProp(name, value)]));
  const propNames = Object.keys(props);
  for (const name of propNames) {
    for (const rel of props[name].refs) {
      const p = isAbsolute(rel) ? rel : join(config.root ?? process.cwd(), rel);
      if (!existsSync(p)) throw new Error(`prop "${name}" not found: ${rel} (looked at ${p})`);
      refs.push({ path: p, role: 'prop' });
    }
  }

  const sections = [
    `${pack.styleLine}${paletteLine(pack.palette)}`,
    layoutLaw(layout, beats.length),
  ];
  const rules = standingRules(pack.pairings);
  if (rules) sections.push(rules);
  sections.push(`The scene, beat by beat:\n${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}`);
  if (propNames.length) sections.push(propLaw(props));
  sections.push(textLaw(title, labels));
  const neg = negatives(pack.rejectedPoles ?? []);
  if (neg) sections.push(neg);
  const prompt = sections.join('\n\n');

  const strings = [
    { text: title, placement: 'title-bar' },
    ...labels.map((text, i) => ({ text, placement: `panel-${i + 1}-label` })),
  ];

  const gate = dedupe([
    ...wikiGate({ layout, beats: beats.length }),
    ...(pack.gate ?? []),
    ...(config.gate ?? []),
    ...propNames.flatMap((name) => props[name].gate),
  ]);

  return { prompt, refs, strings, gate };
}
