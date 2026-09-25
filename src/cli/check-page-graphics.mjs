#!/usr/bin/env node
// THE PAGE-GRAPHICS GATE. Runs in prebuild, beside check-links and check-ascii-diagrams.
//
// THE RULE, which the diagram kit's README has always stated: "A page without a graphic is not
// finished." Two ways to give one: a rendered illustration (paid, an image model, a scene with
// people in it) or a code-drawn diagram (free, a node script, pure SVG). Reach for the diagram
// first, because most pages argue a STRUCTURE and a structure drawn in code is exact, diffable,
// re-renderable after a wording change, and readable through its alt text.
//
// WHY THIS IS A GATE AND NOT A CONVENTION. The rule was prose, in one README, inside the
// diagrams folder, which is the one place an author writing a concept page never opens. So a
// wiki could ship with every other check green and no graphics at all, and nothing anywhere
// said so: links resolve, the build passes, llms.txt generates, the share cards are auto-made
// by the og-image plugin so even the unfurl looks finished. The only detector was somebody
// scrolling the live site and noticing it looked bare.
//
// Earned 2026-09-22, the day antisocialcontract.com went live with eleven pages, zero diagrams
// and zero illustrations. The scaffold had printed "Every page ships with a graphic" in its own
// next-steps output an hour earlier. Gary, reading the site: "Where are all the diagrams bro.
// As well as the generated graphics. Feel like we need gates for ensuring that wikis ship with
// at least one or the other."
//
// THE EXEMPTION IS DECLARATIVE AND COSTS A SENTENCE. A page may opt out with `graphic: none`
// plus a `graphic_reason`, because an exemption nobody has to justify is how a gate gets
// switched off wiki-wide in one commit. The three the README names (a glossary, a voice-rules
// page, a changelog) are exempt by default, by ROUTE rather than by filename, so renaming a
// file cannot silently acquire or lose an exemption.
//
//   node scripts/check-page-graphics.mjs          # check, exit 1 on a violation
//   node scripts/check-page-graphics.mjs --json   # machine-readable
import {readFileSync, writeFileSync, readdirSync, statSync, existsSync} from 'fs';
import {join, relative, resolve} from 'path';
import { isDirectRun } from "./is-direct-run.mjs";

// The three the diagram kit's README names. A lookup page has no argument to draw.
export const DEFAULT_EXEMPT = ['/reference/glossary', '/reference/voice-rules', '/changelog',
  '/reference/graphic-style'];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
// A fence opener: three or more backticks or tildes, then an info string. A fence closes only on
// a run of the SAME character at least as long, with nothing after it, which is what lets a
// four-backtick fence show a three-backtick mermaid block as an example without either one
// being mistaken for the other.
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^\s`]*)/;

/** Frontmatter as a flat map of the scalar keys this gate reads. Not a YAML parser. */
function frontmatter(body) {
  const m = FRONTMATTER.exec(body);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * The body split into prose and top-level fences. Fences are removed from the prose so that
 * documentation ABOUT embedding is not an embed, but their info strings are kept, because one
 * kind of fence is not documentation at all: a ```mermaid block IS the diagram, rendered by the
 * theme. Stripping it unread is how ninety mermaid charts on one wiki read as "no graphic".
 */
function splitFences(body) {
  const kept = [];
  const fences = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (open) {
      const close = /^(`{3,}|~{3,})$/.exec(t);
      if (close && close[1][0] === open[0] && close[1].length >= open.length) open = null;
      else fences[fences.length - 1].lines.push(line);
      continue;
    }
    const m = FENCE_OPEN.exec(t);
    if (m) { open = m[1]; fences.push({lang: m[2].toLowerCase(), lines: []}); continue; }
    kept.push(line);
  }
  // Inline code spans go too: `<svg>` written in a sentence is an example, not a drawing.
  const prose = kept.join('\n').replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, '');
  return {prose, fences};
}

// Where a component may come from and still count as a drawing. Local components (@site, a
// relative path) count loosely, as before; the package's own figures entry counts because its
// exports ARE figures. Anything else (a theme component, a UI kit) does not, since Tabs and
// Admonition are layout, not graphics.
const FIGURE_SOURCES = [/^@site\//, /^\./, /^@supersuit\/docusaurus-preset-wiki\/figures$/];

/** Local names bound by each qualifying import: default, named, and `X as Y` aliases. */
function importedFigureNames(prose) {
  const names = [];
  for (const m of prose.matchAll(/^import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    if (!FIGURE_SOURCES.some((rx) => rx.test(m[2]))) continue;
    const clause = m[1];
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (/^\w+$/.test(def)) names.push(def);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop().trim();
        if (/^\w+$/.test(local)) names.push(local);
      }
    }
  }
  return names;
}

/**
 * Does this page carry a graphic, and if not, why not.
 *
 * `{has, kind, exempt, reason}`. `kind` is which of the two ways it satisfied the rule, so the
 * summary can report how a wiki is actually illustrated rather than only that it passed.
 */
export function pageGraphic(body) {
  const fm = frontmatter(body);

  if (String(fm.graphic || '').toLowerCase() === 'none') {
    const why = (fm.graphic_reason || '').trim();
    return why
      ? {has: false, exempt: true, kind: 'declared-exempt', reason: why}
      : {has: false, exempt: false, reason: 'exempt-without-reason'};
  }

  if (fm.image) return {has: true, exempt: false, kind: 'frontmatter-image'};

  const {prose, fences} = splitFences(body.replace(FRONTMATTER, ''));

  // A markdown embed. The ALT IS THE POINT: the README asks for one sentence saying what the
  // reader now knows, and an embed with an empty alt gives a screen reader nothing at all, so
  // it is not a graphic for every reader and does not satisfy the rule.
  const embeds = [...prose.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)];
  if (embeds.length) {
    return embeds.some((e) => e[1].trim())
      ? {has: true, exempt: false, kind: 'embed'}
      : {has: false, exempt: false, reason: 'empty-alt'};
  }

  // An MDX page can draw with a component instead. Any local import, or anything from the
  // package's figures entry, that is then used as an element counts; this is deliberately loose
  // about local names, because the alternative is a list of component names that goes stale the
  // first time somebody writes a new one.
  const imported = importedFigureNames(prose);
  if (imported.some((name) => new RegExp(`<${name}[\\s/>]`).test(prose))) {
    return {has: true, exempt: false, kind: 'component'};
  }

  // An SVG written straight into the MDX, bare or wrapped in a <figure>.
  if (/<svg[\s>]/i.test(prose)) return {has: true, exempt: false, kind: 'inline-svg'};

  // A mermaid fence, which the theme renders as a diagram. SAME RULE AS THE ALT: a chart with no
  // accTitle or accDescr renders an SVG with no accessible name, so it is a graphic for the
  // sighted reader only and does not satisfy the rule. The directive must open a line; the same
  // words inside a node label are not it.
  const charts = fences.filter((f) => f.lang === 'mermaid');
  if (charts.length) {
    return charts.some((f) => f.lines.some((l) => /^\s*acc(Title|Descr)\s*[:{]/.test(l)))
      ? {has: true, exempt: false, kind: 'mermaid'}
      : {has: false, exempt: false, reason: 'mermaid-without-title'};
  }

  return {has: false, exempt: false, reason: 'no-graphic'};
}

const FIX = 'draw it in code (copy sampleFlow() in diagrams/build.mjs, render, embed the SVG with a '
  + 'one-sentence alt) or render a hero (illustrations/scripts/render-hero.sh). If the page genuinely '
  + 'has no argument to draw, add `graphic: none` and a `graphic_reason` saying why.';

const FIX_MERMAID = 'give the mermaid chart an `accTitle:` line (and ideally an `accDescr:`) saying what '
  + 'the reader now knows, the same sentence an image alt would carry.';

/**
 * Pages owed a graphic. `pages` is `[{route, body}]`; `exempt` is extra route globs; `baseline`
 * is the routes that predate this gate.
 *
 * THE BASELINE IS THE ONLY REASON THIS COULD SHIP. Measured across the fleet the day it was
 * written: 43 of 53 pages on one wiki, 24 of 80 on another, 18 of 47 on a third. A gate that
 * breaks four live wikis on the release that introduces it is one whose first PR turns it off,
 * and then the rule is prose again with a config key attached. So it grandfathers what exists,
 * refuses anything NEW, and the list may only SHRINK. Same shape as the provenance gate next
 * door, for the same reason.
 */
export function findPagesWithoutGraphics({pages, exempt = [], baseline = []}) {
  const grandfathered = new Set(baseline);
  const patterns = [...DEFAULT_EXEMPT, ...exempt];
  // A pattern that matches every route turns the gate off for the whole wiki in one line, which
  // is the one edit nobody reviews as a policy change. Refuse it loudly instead.
  for (const p of exempt) {
    if (p === '**' || p === '*' || p === '/**' || p === '/*') {
      throw new Error(`graphics.exempt pattern ${JSON.stringify(p)} would exempt everything; `
        + 'list the routes that genuinely have no argument to draw');
    }
  }
  const matches = (route, pattern) => {
    if (pattern === route) return true;
    const rx = new RegExp('^' + pattern.split('**').map((s) =>
      s.split('*').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
    return rx.test(route);
  };
  const out = [];
  for (const page of pages) {
    if (patterns.some((p) => matches(page.route, p))) continue;
    const g = pageGraphic(page.body);
    if (g.has || g.exempt) continue;
    if (grandfathered.has(page.route)) continue;
    out.push({route: page.route, file: page.file, reason: g.reason,
      fix: g.reason === 'mermaid-without-title' ? FIX_MERMAID : FIX});
  }
  return out;
}

// ── the CLI half ─────────────────────────────────────────────────────────────────────────────

function collect(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { collect(full, root, out); continue; }
    if (!/\.mdx?$/.test(name)) continue;
    const body = readFileSync(full, 'utf8');
    const fm = frontmatter(body);
    const route = fm.slug
      || '/' + relative(root, full).replace(/\.mdx?$/, '').replace(/\/index$/, '');
    out.push({route, file: relative(process.cwd(), full), body});
  }
  return out;
}

if (isDirectRun(import.meta.url)) {
  const json = process.argv.includes('--json');
  const docs = resolve(process.cwd(), 'docs');
  if (!existsSync(docs)) { console.log('[page-graphics] no docs/ here; nothing to check'); process.exit(0); }

  let exempt = [];
  try { exempt = JSON.parse(readFileSync(resolve(process.cwd(), 'wiki.config.json'), 'utf8')).graphics?.exempt || []; }
  catch { /* no config, or no graphics block: the defaults stand */ }

  const BASELINE = resolve(process.cwd(), 'docs/.page-graphics-baseline.json');
  const adopted = existsSync(BASELINE);
  let baseline = [];
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).routes || []; } catch { /* none yet */ }

  const pages = collect(docs, docs);

  // --accept writes the baseline. It may only SHRINK: a route that has since been given a
  // graphic drops out, and a NEW bare page is refused rather than quietly absorbed, which is
  // the difference between grandfathering and a gate that launders every future omission.
  if (process.argv.includes('--accept')) {
    const bare = findPagesWithoutGraphics({pages, exempt}).map((f) => f.route).sort();
    const added = bare.filter((r) => !baseline.includes(r));
    if (baseline.length && added.length) {
      console.error(`[page-graphics] refusing to ADD ${added.length} route(s) to the baseline:\n`);
      for (const r of added) console.error(`  ${r}`);
      console.error('\n  The baseline may only shrink. Give these pages a graphic.');
      process.exit(1);
    }
    const dropped = baseline.filter((r) => !bare.includes(r));
    writeFileSync(BASELINE, JSON.stringify({
      _comment: 'Pages that predate the page-graphics gate. This list may only SHRINK: give a page '
        + 'a diagram or a hero and delete its line. Anything NOT in here must carry one or the build '
        + 'fails. Regenerate with `node scripts/check-page-graphics.mjs --accept`.',
      routes: bare,
    }, null, 2) + '\n');
    console.log(`[page-graphics] baseline: ${bare.length} route(s)`
      + (dropped.length ? `, ${dropped.length} illustrated since and dropped` : ''));
    process.exit(0);
  }

  let findings;
  try { findings = findPagesWithoutGraphics({pages, exempt, baseline}); }
  catch (e) { console.error(`[page-graphics] ${e.message}`); process.exit(1); }

  const kinds = {};
  for (const p of pages) { const k = pageGraphic(p.body).kind; if (k) kinds[k] = (kinds[k] || 0) + 1; }

  if (json) { console.log(JSON.stringify({pages: pages.length, adopted, findings, kinds}, null, 2)); }
  else if (!findings.length) {
    const how = Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ') || 'all exempt';
    const owed = baseline.length ? `, ${baseline.length} grandfathered and still owed one` : '';
    console.log(`[page-graphics] ok: ${pages.length} page(s) (${how})${owed}`);
  } else if (!adopted) {
    // FIRST RUN. A wiki that has never been baselined cannot be failed for pages that predate
    // the gate, and a brand-new scaffold would fail on its own starter pages from minute one,
    // which is the surest way to teach somebody to delete the check on day one. So the first
    // run REPORTS and passes, and says exactly how to turn it into a gate.
    console.log(`[page-graphics] ${findings.length} of ${pages.length} page(s) have no graphic, and this wiki`
      + ' has no baseline yet, so nothing is failing.');
    console.log('  Give them a diagram or a hero, then run `wiki check page-graphics --accept`');
    console.log('  to freeze what is left. From then on a NEW page with no graphic fails the build.');
  } else {
    console.error(`[page-graphics] ${findings.length} page(s) with no graphic:\n`);
    for (const f of findings) console.error(`  ${f.file}  (${f.route})  ${f.reason}`);
    console.error(`\n  ${FIX}`);
  }
  process.exit(adopted && findings.length ? 1 : 0);
}
