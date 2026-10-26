#!/usr/bin/env node
// Write the pre-commit hook that keeps src/data/changelog-events.json fresh.
//
//   wiki install-hooks        idempotent; an instance's `prepare` script runs it on every install
//   wiki install-hooks --print show the hook body and exit
//
// Two hooks, one job: `wiki refresh-dates` before every commit, so the snapshot production
// reads for Created / Updated lags HEAD by one commit at most, and a post-commit settle that
// leaves the tree clean afterwards (see settleBlock). Worktrees share the hooks
// directory, so a branch made in one refreshes it too. An existing hook is kept: the block
// between the markers is added or replaced, nothing outside it is touched. Never fails an
// install: a machine with no git (a tarball, a Vercel build of an exported tree) just says so.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDirectRun } from "./is-direct-run.mjs";

export const BEGIN = '# >>> @supersuit/docusaurus-preset-wiki refresh-dates >>>';
export const END = '# <<< @supersuit/docusaurus-preset-wiki refresh-dates <<<';

/** The lines this package owns inside the hook. `prefix` is the wiki's path under the repo root ('' when it is the root). */
export function hookBlock(prefix = '') {
  const cd = prefix ? `cd "${prefix.replace(/\/$/, '')}" || exit 0` : ':';
  return [
    BEGIN,
    '# Refresh the page-dates snapshot from full git history and stage it, so every',
    '# deploy (Vercel clones shallow) can date every page. Installed by `wiki install-hooks`.',
    `${cd}`,
    'if [ -x node_modules/.bin/wiki ]; then node_modules/.bin/wiki refresh-dates || exit 1; fi',
    END,
  ].join('\n');
}

// THE SETTLE HALF. The house rule is `git commit -- <files>`. For such a commit git runs the
// pre-commit hook against a TEMPORARY index (GIT_INDEX_FILE=.git/next-index-*.lock), so the
// snapshot refresh-dates stages lands in that index and rides in the commit, as intended, while
// the REAL index keeps the old snapshot. After every commit the tree then read staged AND
// modified on the snapshot and `git pull --rebase` refused (supersuit-wiki#14). The pre-commit
// hook cannot fix it: git holds the real index's lock for the whole commit. So a post-commit
// block points the snapshot's index entry back at HEAD, and only when the working copy matches
// HEAD, so a snapshot that differs from what was committed is never touched.
export const SETTLE_BEGIN = '# >>> @supersuit/docusaurus-preset-wiki settle-snapshot >>>';
export const SETTLE_END = '# <<< @supersuit/docusaurus-preset-wiki settle-snapshot <<<';

/** The post-commit lines this package owns. `prefix` is the wiki's path under the repo root. */
export function settleBlock(prefix = '') {
  return [
    SETTLE_BEGIN,
    '# A `git commit -- <files>` commits the refreshed snapshot from a temporary index and leaves',
    '# the real index holding the old one. Once the commit exists, match the index to HEAD when the',
    '# working copy already does. Installed by `wiki install-hooks`.',
    `f="${prefix}src/data/changelog-events.json"`,
    'if git cat-file -e "HEAD:$f" 2>/dev/null && git diff --quiet HEAD -- "$f" 2>/dev/null; then git reset -q -- "$f" >/dev/null 2>&1 || true; fi',
    SETTLE_END,
  ].join('\n');
}

/** The hook file with our block added or replaced; a fresh file when `existing` is empty. */
export function mergeHook(existing, block, begin = BEGIN, end = END) {
  const re = new RegExp(`${escape(begin)}[\\s\\S]*?${escape(end)}`);
  if (existing && re.test(existing)) return existing.replace(re, block);
  if (existing && existing.trim()) return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
  return `#!/bin/sh\n${block}\n`;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const PREPARE = 'wiki install-hooks';

/** Give the instance's package.json a `prepare` that installs the hook on every install. Returns true when changed. */
export function ensurePrepare(pkg) {
  const scripts = (pkg.scripts ??= {});
  const cur = scripts.prepare;
  if (!cur) { scripts.prepare = PREPARE; return true; }
  if (cur.includes(PREPARE)) return false;
  scripts.prepare = `${cur} && ${PREPARE}`;
  return true;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// THE MERGE HALF. Every branch regenerates the snapshot from its own history, so any two branches
// that each committed a page conflict on it, and that conflict blocks landing real work behind a
// generated file (five times in one afternoon in getfreedom-wiki, 2026-09-23). Either side is a
// correct snapshot one commit behind, which the file already promises, and the next commit's hook
// refreshes it. So the clone gets a merge driver that keeps our side, and the attribute naming it
// goes in the clone's own info/attributes, never in a tracked file: installing must not dirty the
// wiki's tree. A clone that never ran this merges the file as text, exactly as before.
export const MERGE_DRIVER = 'changelog-snapshot';
export const SNAPSHOT = 'src/data/changelog-events.json';

/** Register the driver and the attribute for `<prefix>src/data/changelog-events.json`. True when both are set. */
export function installMergeDriver(root, prefix = '', run = git) {
  try {
    run(['config', `merge.${MERGE_DRIVER}.name`, 'keep ours: the snapshot is regenerated from history by the next commit'], root);
    run(['config', `merge.${MERGE_DRIVER}.driver`, 'true'], root);
    const raw = run(['rev-parse', '--git-path', 'info/attributes'], root);
    const file = isAbsolute(raw) ? raw : resolve(root, raw);
    const line = `/${prefix}${SNAPSHOT} merge=${MERGE_DRIVER}`;
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!existing.split('\n').includes(line)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${existing.replace(/\s*$/, '')}${existing.trim() ? '\n' : ''}${line}\n`);
    }
    return true;
  } catch { return false; }
}

export function installHooks({ root = process.cwd(), log = console.log } = {}) {
  let hooksDir;
  let prefix;
  try {
    // `--git-path hooks` honours core.hooksPath and resolves to the COMMON dir from a worktree.
    const raw = git(['rev-parse', '--git-path', 'hooks'], root);
    hooksDir = isAbsolute(raw) ? raw : resolve(root, raw);
    prefix = git(['rev-parse', '--show-prefix'], root);
  } catch {
    log('[install-hooks] not a git checkout; nothing to install');
    return 0;
  }
  installMergeDriver(root, prefix);
  const hooks = [
    ['pre-commit', hookBlock(prefix), BEGIN, END],
    ['post-commit', settleBlock(prefix), SETTLE_BEGIN, SETTLE_END],
  ];
  for (const [name, block, begin, end] of hooks) {
    const file = join(hooksDir, name);
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const next = mergeHook(existing, block, begin, end);
    if (next === existing) {
      log(`[install-hooks] ${name} hook already current (${file})`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, next);
    chmodSync(file, 0o755);
    log(`[install-hooks] ${name} hook ${existing ? 'updated' : 'written'}: ${file}`);
  }
  return 0;
}

const isMain = isDirectRun(import.meta.url);
if (isMain) {
  if (process.argv.includes('--print')) {
    console.log(`${hookBlock()}\n\n${settleBlock()}`);
    process.exit(0);
  }
  process.exit(installHooks());
}
