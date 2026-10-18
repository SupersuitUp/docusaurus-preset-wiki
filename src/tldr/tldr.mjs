// The TL;DR convention, in one place: what a valid `tldr:` is, how to read it out of a page's
// frontmatter without a YAML dependency, and how to put it into the agent corpus.
//
// This file lives in @supersuit/docusaurus-preset-wiki so every family wiki shares one
// definition. Consumers that read it must agree:
//   - src/cli/check-tldr.mjs   `wiki check tldr`, the prebuild gate, names every failing page at once
//   - the renderer             renders the block, and re-validates what Docusaurus itself parsed,
//                              so a YAML shape the light reader below gets wrong still cannot ship
//   - the llms splice          puts each TL;DR into static/llms.txt and llms-full.txt (spliceLlms)

export const MAX_SENTENCES = 3;
export const MAX_WORDS = 60;

// Keys an author might plausibly type for the same thing. Docusaurus accepts any key silently,
// so a TL;DR under the wrong name would simply never render. The gate refuses them instead.
export const MISSPELLED_KEYS = ['tl_dr', 'tl-dr', 'TLDR', 'TL_DR', 'tl;dr', 'TL;DR', 'summary_tldr', 'tldr_text'];

export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// A sentence ends at . ! or ? (optionally followed by a closing quote or bracket) followed by
// whitespace or the end. Abbreviations like "e.g." count as an end, which errs toward refusing,
// and the fix (write it out) is better prose anyway.
export function countSentences(text) {
  const t = text.trim();
  if (!t) return 0;
  const ends = t.match(/[.!?]+["'”’)\]]*(?=\s|$)/g) ?? [];
  const lastIsTerminal = /[.!?]+["'”’)\]]*$/.test(t);
  return ends.length + (lastIsTerminal ? 0 : 1);
}

/** Every reason this value is not a valid TL;DR. Empty array means valid. */
export function tldrProblems(value) {
  if (value === undefined) return [];
  if (typeof value !== 'string') return [`tldr must be a string, got ${Array.isArray(value) ? 'a list' : typeof value}`];
  const text = value.trim();
  const problems = [];
  if (!text) return ['tldr is empty; delete the key or write the takeaway'];
  const s = countSentences(text);
  const w = countWords(text);
  if (s > MAX_SENTENCES) problems.push(`tldr has ${s} sentences; the limit is ${MAX_SENTENCES}`);
  if (w > MAX_WORDS) problems.push(`tldr has ${w} words; the limit is ${MAX_WORDS}`);
  if (/[—–]/.test(text)) problems.push('tldr contains an em or en dash; use a period, comma or colon');
  if (!/[.!?]["'”’)\]]*$/.test(text)) problems.push('tldr must end with a full stop, question mark or exclamation mark');
  return problems;
}

/** The raw frontmatter block of a markdown file, or null when it has none. */
export function frontmatterBlock(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return m ? m[1] : null;
}

/**
 * Read one top-level scalar key out of a frontmatter block. Handles the shapes an author writes
 * for a sentence: plain, "double quoted" (with \" escapes), 'single quoted' ('' escape), and the
 * block scalars > >- | |-. Returns undefined when the key is absent. Anything stranger is
 * returned as a non-string so the gate refuses it rather than guessing.
 */
export function readKey(block, key) {
  const lines = block.split(/\r?\n/);
  const esc = key.replace(/[.*+?^${}()|[\]\\;]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^${esc}:(\\s|$)`).test(l));
  if (start === -1) return undefined;
  const rest = lines[start].slice(key.length + 1).trim();

  if (/^[>|][+-]?$/.test(rest)) {
    const body = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') { body.push(''); continue; }
      if (!/^\s/.test(lines[i])) break;
      body.push(lines[i].trim());
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    return rest.startsWith('>') ? body.join(' ').replace(/\s+/g, ' ') : body.join('\n');
  }
  if (rest.startsWith('"')) {
    const m = rest.match(/^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/);
    return m ? m[1].replace(/\\(["\\/])/g, '$1') : { unparsed: rest };
  }
  if (rest.startsWith("'")) {
    const m = rest.match(/^'((?:[^']|'')*)'\s*(#.*)?$/);
    return m ? m[1].replace(/''/g, "'") : { unparsed: rest };
  }
  if (rest.startsWith('[') || rest.startsWith('{')) return { unparsed: rest };
  if (rest === '') {
    // `tldr:` followed by an indented list or map.
    const next = lines[start + 1];
    return next && /^\s+-/.test(next) ? [] : '';
  }
  return rest.replace(/\s+#.*$/, '');
}

/** The problems with one file's TL;DR, as full sentences naming the page. */
export function checkSource(relPath, source) {
  const block = frontmatterBlock(source);
  if (block === null) return [];
  const out = [];
  for (const k of MISSPELLED_KEYS) {
    if (readKey(block, k) !== undefined) out.push(`${relPath}: frontmatter key "${k}" is not read by anything; the key is "tldr"`);
  }
  const tldr = readKey(block, 'tldr');
  for (const p of tldrProblems(tldr)) out.push(`${relPath}: ${p}`);
  if (typeof tldr === 'string' && tldr.trim() && hasLede(source)) {
    out.push(`${relPath}: has both a TL;DR and an italic lede under the title; the TL;DR replaces the lede, so delete the lede`);
  }
  return out;
}

/**
 * True when the first paragraph after the page's H1 is a single italic line (the lede). A page
 * with a TL;DR does not carry one: the two said the same thing twice at the top (Gary,
 * 2026-09-27: "why do you even need an intro if you have a tldr").
 */
export function hasLede(source) {
  const lines = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 === -1) return false;
  const first = lines.slice(h1 + 1).find((l) => l.trim() !== '');
  if (!first) return false;
  const t = first.trim();
  return /^\*[^*]/.test(t) && /[^*]\*$/.test(t);
}

/** docs/concepts/foo.md -> concepts/foo, docs/x/index.mdx -> x. Mirrors generate-llms-txt.sh. */
export function llmsUrlPath(relFromDocs) {
  return relFromDocs.replace(/\.mdx?$/, '').replace(/\/index$/, '').replace(/^index$/, '');
}

/**
 * Put each TL;DR into the generated agent corpus. `byPath` maps an llms url path (see above) to
 * its TL;DR. llms.txt gets an indented `TL;DR:` line under the page's index entry; llms-full.txt
 * gets a `TL;DR:` line right under the page's `URL:` line, before the body. Idempotent.
 */
export function spliceLlms(llmsTxt, llmsFull, byPath) {
  const entries = [...byPath.entries()].filter(([p]) => p);
  const matchUrl = (url) => entries.find(([p]) => url.endsWith(`/${p}`));

  const idx = llmsTxt.split('\n');
  const outIdx = [];
  for (let i = 0; i < idx.length; i++) {
    outIdx.push(idx[i]);
    const m = idx[i].match(/^- \[[^\]]*\]\(([^)]+)\)/);
    const hit = m && matchUrl(m[1]);
    if (hit && !/^\s+TL;DR: /.test(idx[i + 1] ?? '')) outIdx.push(`  TL;DR: ${oneLine(hit[1])}`);
  }

  const full = llmsFull.split('\n');
  const outFull = [];
  for (let i = 0; i < full.length; i++) {
    outFull.push(full[i]);
    const m = full[i].match(/^URL: (\S+)$/);
    const hit = m && matchUrl(m[1]);
    if (hit && !/^TL;DR: /.test(full[i + 1] ?? '')) outFull.push(`TL;DR: ${oneLine(hit[1])}`);
  }
  return { llmsTxt: outIdx.join('\n'), llmsFull: outFull.join('\n') };
}

function oneLine(s) {
  return s.trim().replace(/\s+/g, ' ');
}
