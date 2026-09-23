#!/usr/bin/env node
// The ASCII-diagram gate. Runs in prebuild, beside check-links and check-image-provenance.
//
// THE RULE: a diagram on a wiki page is RENDERED, never typed out of dashes, pipes, arrows and
// plus signs inside a code fence. Deterministic graphics render in CODE (a component, an SVG a
// script emits), because that is the form that survives: it themes with the page, it scales on a
// phone, a screen reader gets a real label, and adding a fifth box is a one-line change rather
// than a redraw with a monospace ruler.
//
// WHY THIS IS A GATE AND NOT A CONVENTION. An ASCII diagram is the cheapest thing in the world to
// type and it looks fine in the editor where it was written. Nothing downstream complains: the
// build passes, the page renders, and the fence is legible to the author because the author is
// looking at the same font it was aligned in. It is the reader on a narrow screen, in dark mode,
// or with a screen reader who gets the mess, and none of them can file a bug. Same invisible
// failure shape as the provenance gate next door, and the same answer: check it mechanically.
//
// Earned 2026-09-14. A new concept page shipped a four-node loop as a fenced ASCII ring. It was
// the only ASCII fence in the entire wiki, so it was out of house style as well as ugly, and the
// only reason it got caught is that the owner happened to read the page.
//
// WHAT IT LOOKS FOR. Only inside fenced code blocks, because prose is allowed to contain an arrow
// and a table is allowed to contain pipes. A fence is flagged when it has no language tag (or a
// language known to be decorative, like `text`) AND enough box-drawing evidence across enough
// lines to be a picture rather than a snippet. Real code fences are untouched: they carry a
// language tag, which is the first thing this checks.
//
//   node scripts/check-ascii-diagrams.mjs          # check, exit 1 on a violation
//   node scripts/check-ascii-diagrams.mjs --json   # machine-readable
import {readFileSync, readdirSync, statSync} from 'fs';
import {join, relative, resolve} from 'path';
import { isDirectRun } from "./is-direct-run.mjs";

// Languages that carry no syntax and so cannot vouch for a fence being real code.
const DECORATIVE_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'none', 'ascii']);

// The marks a typed picture is built from. Unicode box-drawing is included because the
// "nicer" version of this mistake reaches for it.
const ART = /(->|<-|-->|<--|\|\s|\s\||\+--|--\+|__\||\^|\bv\b|[┌┐└┘│─├┤┬┴┼╭╮╯╰═║╔╗╚╝▲▼◀▶←→↑↓])/;

// A line that is mostly rule characters, which is what the body of a typed box is made of.
const RULE_LINE = /^[\s|+\-_=^v<>*.:/\\()[\]{}│─┌┐└┘├┤┬┴┼╭╮╯╰═║╔╗╚╝▲▼←→↑↓]+$/;

// A DIRECTORY TREE is not a diagram and is the right way to show a repo layout. It is built from
// the same box-drawing characters as a picture, so it has to be recognised rather than described:
// its branches all sit at the START of the line and what follows them is a path. Left out of the
// first version and caught by sweeping the fleet, where it flagged appliedai.wiki's knowledge-repo
// playbook. This is the kind of false positive that gets a gate switched off within a week.
const TREE_LINE = /^[\s│├└─|`+\\-]*[A-Za-z0-9_.@-]+(\/|\.[A-Za-z0-9]{1,5})/;

function looksLikeDirectoryTree(body) {
  const lines = body.filter((l) => l.trim());
  if (lines.length < 3) return false;
  return lines.filter((l) => TREE_LINE.test(l)).length / lines.length >= 0.6;
}

export function findAsciiDiagrams(source) {
  const lines = source.split('\n');
  const findings = [];
  let fence = null;

  lines.forEach((line, i) => {
    // The language is the FIRST token after the fence and everything after it is meta, which
    // Docusaurus uses constantly: ```bash title="Terminal", ```js {1,3}, ```py showLineNumbers.
    // An opener regex anchored to end-of-line does not match those, so the OPENER is missed, the
    // CLOSER is read as an untagged opener, and the prose after a perfectly ordinary shell block
    // gets scanned as if it were inside a fence. Found by sweeping the fleet: getfreedom.wiki's
    // install page reported a diagram it does not have.
    const open = line.match(/^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)(?:[ \t][^\n]*)?$/);
    if (open && !fence) {
      fence = {marker: open[2][0], len: open[2].length, lang: open[3].toLowerCase(), start: i + 1, body: []};
      return;
    }
    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.len) {
        if (DECORATIVE_LANGS.has(fence.lang)) {
          const artLines = fence.body.filter((l) => ART.test(l));
          const ruleLines = fence.body.filter((l) => l.trim() && RULE_LINE.test(l));
          // Two independent signals, so a two-line snippet of shell output does not trip it:
          // several lines carrying box marks, and at least one line that is nothing BUT marks.
          if (artLines.length >= 3 && ruleLines.length >= 1 && !looksLikeDirectoryTree(fence.body)) {
            findings.push({line: fence.start, lang: fence.lang || '(none)', sample: artLines[0].trim().slice(0, 60)});
          }
        }
        fence = null;
        return;
      }
      fence.body.push(line);
    }
  });

  return findings;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.mdx?$/.test(name)) acc.push(full);
  }
  return acc;
}

function main() {
  const json = process.argv.includes('--json');
  const root = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '.');
  const roots = ['docs', 'plain'].map((d) => join(root, d)).filter((d) => {
    try { return statSync(d).isDirectory(); } catch { return false; }
  });

  const violations = [];
  let scanned = 0;
  for (const r of roots) {
    for (const file of walk(r)) {
      scanned += 1;
      for (const f of findAsciiDiagrams(readFileSync(file, 'utf8'))) {
        violations.push({file: relative(root, file), ...f});
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({scanned, violations}, null, 2));
    process.exit(violations.length ? 1 : 0);
  }

  if (!violations.length) {
    console.log(`ascii diagrams: ${scanned} page(s), none typed out of dashes and arrows`);
    process.exit(0);
  }

  console.error(`\nascii diagrams: ${violations.length} fenced block(s) look like a typed picture.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  lang ${v.lang}`);
    console.error(`     ${v.sample}`);
  }
  console.error(`
A diagram on a page is RENDERED, never typed. It has to theme with the page, scale on a
phone, and hand a screen reader something better than a wall of pipes.

  Draw it in code.   A component under src/components/<Name>/, an SVG whose geometry is
                     computed rather than hand-placed. Use currentColor so one asset is
                     correct in both themes. Give the <svg> a role="img" and an aria-label
                     that says what the picture says.
                     Worked example: supersuit-wiki src/components/ImaginationLoop/,
                     which also carries the two things that render wrong by default.
                     Import it from a .mdx page, not a .md one.

  Or cut it.         Most typed diagrams are four nouns and an arrow, and the sentence
                     underneath them was already doing the work.

If the fence really is code or literal output, give it a language tag. That is what the tag
is for, and it is what this gate reads first.
`);
  process.exit(1);
}

if (isDirectRun(import.meta.url)) main();
