#!/usr/bin/env node
// Bridge: read the wiki root's wiki.config.json (cwd), set env vars, exec generate-llms-txt.sh.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { docsRouteBasePathFromConfigFile } from './docs-base.mjs';
import { frontmatterBlock, readKey, llmsUrlPath, spliceLlms } from '../tldr/tldr.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wiki = JSON.parse(
  readFileSync(resolve(process.cwd(), 'wiki.config.json'), 'utf8'),
);

const result = spawnSync('bash', [resolve(__dirname, 'generate-llms-txt.sh')], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    WIKI_TITLE: wiki.title,
    WIKI_DESCRIPTION: wiki.description,
    // Every URL in llms.txt and llms-full.txt is built from the docs/ tree, so on a wiki
    // whose docs are mounted elsewhere the whole agent-facing index pointed at 404s. The base
    // is folded into BASE_URL rather than threaded through the shell script.
    BASE_URL: wiki.url.replace(/\/+$/, '') + docsRouteBasePathFromConfigFile(process.cwd()),
    // A paragraph aimed at the agent that opens llms.txt, before the index starts: what tree
    // this is and in what order to read it, which a list of titles cannot say about itself.
    LLMS_PREAMBLE: wiki.llms_preamble ?? '',
    // Top-level docs folders in the order a reader should meet them; the rest follow A to Z.
    SECTION_ORDER: Array.isArray(wiki.llms_sections) ? wiki.llms_sections.join(' ') : '',
  },
});

// Put each page's frontmatter TL;DR into the generated files, so an agent reading the corpus gets
// the takeaway without the body. A wiki with no TL;DR pages never writes: byte-for-byte no-op.
function docsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? docsFiles(p) : /\.mdx?$/.test(name) ? [p] : [];
  });
}

function spliceTldrs(root) {
  const docs = join(root, 'docs');
  if (!existsSync(docs)) return;
  const byPath = new Map();
  for (const abs of docsFiles(docs)) {
    const block = frontmatterBlock(readFileSync(abs, 'utf8'));
    const tldr = block ? readKey(block, 'tldr') : undefined;
    if (typeof tldr === 'string' && tldr.trim()) byPath.set(llmsUrlPath(relative(docs, abs).split(sep).join('/')), tldr);
  }
  if (!byPath.size) return;
  const txtPath = join(root, 'static', 'llms.txt');
  const fullPath = join(root, 'static', 'llms-full.txt');
  if (!existsSync(txtPath) || !existsSync(fullPath)) return;
  const { llmsTxt, llmsFull } = spliceLlms(readFileSync(txtPath, 'utf8'), readFileSync(fullPath, 'utf8'), byPath);
  writeFileSync(txtPath, llmsTxt);
  writeFileSync(fullPath, llmsFull);
}

if ((result.status ?? 0) === 0) spliceTldrs(process.cwd());

process.exit(result.status ?? 0);
