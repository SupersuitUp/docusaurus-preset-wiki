#!/usr/bin/env node
// Bridge: read the wiki root's wiki.config.json (cwd), set env vars, exec generate-llms-txt.sh.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { docsRouteBasePathFromConfigFile } from './docs-base.mjs';

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
  },
});

process.exit(result.status ?? 0);
