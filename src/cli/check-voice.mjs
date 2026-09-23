#!/usr/bin/env node
// THE VOICE GATE. Runs in prebuild, beside check-links and check-page-graphics.
//
// THE RULE: the tells that make prose read as machine-written do not ship. An em dash used as a
// separator is the first of them and the most frequent, and it has a colon, a comma, a pair of
// parentheses or a full stop waiting to do its job better.
//
// WHY A WIKI CARRIES ITS OWN, when Freedom already ships a style gate. Two reasons, and the
// first is a measured defect rather than a design preference.
//
// 1. Freedom's gate classifies a Docusaurus `docs/` tree as AGENT audience, and its em-dash rule
//    is a human-audience rule, so the rule does not run there. That is sound for a wiki with a
//    `plain/` human twin and wrong for every wiki without one, where `docs/` IS the human
//    surface. Measured 2026-09-22: `style.mjs check --surface public` reported a page clean
//    while it carried nine em dashes, one of them mid-sentence in prose, on a live public site.
//    The identical file at the repo root was flagged twice.
// 2. A wiki is minted for people who may not run Freedom at all. A gate that only fires on one
//    person's machine is not a gate.
//
// WHAT IT REFUSES TO TOUCH, which is most of the design. Code fences and inline code, because a
// dash there may be data. BLOCKQUOTES, because a quotation keeps its own words and a gate that
// rewrites punctuation inside one falsifies somebody else's sentence while reporting success.
// Frontmatter. And an en dash between numbers, which is a range and is correct.
//
//   node scripts/check-voice.mjs          # check, exit 1 on a violation
//   node scripts/check-voice.mjs --json   # machine-readable
import {readFileSync, readdirSync, statSync, existsSync} from 'fs';
import {join, relative, resolve} from 'path';

export const DEFAULT_RULES = [
  {
    name: 'em-dash', hard: true, pattern: '—',
    fix: 'use a colon, a comma, parentheses, or two sentences. An em dash is the single most '
      + 'recognisable tell in generated prose.',
  },
  {
    // An en dash between WORDS is an em dash wearing a disguise. Between numbers it is a range.
    name: 'en-dash-prose', hard: true, pattern: '(?<=[A-Za-z,)])\\s+–\\s+(?=[A-Za-z(])',
    fix: 'same as an em dash: a colon, a comma, parentheses, or two sentences. Between numbers '
      + 'an en dash is a range and is correct.',
  },
  {
    // "not X, but Y" where no reader was ever going to think X. A real contrast has its own
    // subject after "but", which is why the pattern requires the second half to be a bare
    // noun phrase rather than a clause.
    name: 'filler-inversion', hard: true,
    pattern: '\\bnot (?:a|an|the|just|merely|only) [\\w\\s]{1,30}?, but (?:a|an|the) \\w+',
    fix: 'ask whether a smart reader would plausibly have held the first half. If not, cut it '
      + 'and state the second half on its own.',
  },
];

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * The body with everything a voice rule must not read blanked, NEWLINES PRESERVED so the line
 * numbers a finding reports still point at the real line.
 */
function readable(body) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let out = body.replace(FRONTMATTER, blank);
  out = out.replace(/^```[\s\S]*?^```/gm, blank);       // fenced code
  out = out.replace(/^\s*>.*$/gm, blank);               // blockquotes: somebody else's words
  out = out.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));   // inline code
  return out;
}

/** Every voice hit in one document. `extra` adds wiki-specific rules; it cannot remove any. */
export function findVoiceHits(body, {extra = []} = {}) {
  const text = readable(body);
  const lines = text.split(/\r?\n/);
  const rules = [...DEFAULT_RULES, ...extra.map((r) => ({...r, hard: false}))];
  const out = [];
  for (const rule of rules) {
    const rx = new RegExp(rule.pattern, 'g');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rx)) {
        out.push({rule: rule.name, line: i + 1, col: m.index + 1, hard: rule.hard !== false,
          text: line.trim().slice(0, 120), fix: rule.fix || 'remove it'});
      }
    });
  }
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

// ── the CLI half ─────────────────────────────────────────────────────────────────────────────

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { collect(full, out); continue; }
    if (/\.mdx?$/.test(name)) out.push(full);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes('--json');
  const docs = resolve(process.cwd(), 'docs');
  if (!existsSync(docs)) { console.log('[voice] no docs/ here; nothing to check'); process.exit(0); }

  let extra = [];
  try { extra = JSON.parse(readFileSync(resolve(process.cwd(), 'wiki.config.json'), 'utf8')).voice?.banned || []; }
  catch { /* none configured */ }

  const findings = [];
  const files = collect(docs);
  for (const file of files) {
    for (const h of findVoiceHits(readFileSync(file, 'utf8'), {extra})) {
      findings.push({...h, file: relative(process.cwd(), file)});
    }
  }

  if (json) { console.log(JSON.stringify({files: files.length, findings}, null, 2)); }
  else if (!findings.length) {
    console.log(`[voice] ok: ${files.length} page(s), none of the tells`);
  } else {
    console.error(`[voice] ${findings.length} finding(s) across ${new Set(findings.map((f) => f.file)).size} page(s):\n`);
    const byRule = {};
    for (const f of findings) (byRule[f.rule] ||= []).push(f);
    for (const [rule, hits] of Object.entries(byRule)) {
      console.error(`  ${rule}  (${hits.length})`);
      for (const h of hits.slice(0, 8)) console.error(`    ${h.file}:${h.line}  ${h.text}`);
      if (hits.length > 8) console.error(`    ... and ${hits.length - 8} more`);
      console.error(`    -> ${hits[0].fix}\n`);
    }
  }
  process.exit(findings.length ? 1 : 0);
}
