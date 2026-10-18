#!/usr/bin/env node
// `wiki check tldr`: refuse the build when any page's `tldr:` breaks the rules, naming every
// failing page. See src/tldr/tldr.mjs for the convention.
//
//   --require   additionally fail any docs page with no `tldr:`, unless its frontmatter has
//               `tldr_exempt: <reason>` (index and redirect stubs)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkSource, frontmatterBlock, readKey } from '../tldr/tldr.mjs';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const require = process.argv.slice(2).includes('--require');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.mdx?$/.test(name)) out.push(p);
  }
  return out.sort();
}

const pages = existsSync(DOCS)
  ? walk(DOCS).map((abs) => {
      const source = readFileSync(abs, 'utf8');
      const block = frontmatterBlock(source);
      return {
        rel: relative(ROOT, abs),
        source,
        tldr: block ? readKey(block, 'tldr') : undefined,
        exempt: block ? readKey(block, 'tldr_exempt') : undefined,
      };
    })
  : [];

const problems = pages.flatMap((p) => checkSource(p.rel, p.source));
if (require) {
  for (const p of pages) {
    if (p.tldr === undefined && p.exempt === undefined) {
      problems.push(`${p.rel}: has no tldr; write the takeaway, or add "tldr_exempt: <reason>" for an index or redirect stub`);
    }
  }
}
if (problems.length) {
  console.error(`[tldr] ${problems.length} problem(s). A TL;DR is at most 3 sentences and 60 words:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const n = pages.filter((p) => typeof p.tldr === 'string').length;
console.log(`[tldr] ${n} page(s) carry a TL;DR, all within 3 sentences and 60 words.`);
