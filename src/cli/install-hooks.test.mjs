// The pre-commit hook: written once, kept current, never clobbering a hook the wiki already has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BEGIN, END, PREPARE, ensurePrepare, hookBlock, installHooks, mergeHook } from './install-hooks.mjs';

test('a fresh hook is a shell script holding exactly our block', () => {
  const out = mergeHook('', hookBlock());
  assert.ok(out.startsWith('#!/bin/sh\n'));
  assert.ok(out.includes(BEGIN) && out.includes(END));
  assert.ok(out.includes('node_modules/.bin/wiki refresh-dates'));
});

test('an existing hook keeps its own lines and gains our block once', () => {
  const theirs = '#!/bin/sh\nnpm test\n';
  const once = mergeHook(theirs, hookBlock());
  assert.ok(once.startsWith(theirs.trimEnd()));
  assert.equal(once.split(BEGIN).length, 2);
  const twice = mergeHook(once, hookBlock());
  assert.equal(twice, once, 'idempotent');
});

test('a changed block replaces the old one in place', () => {
  const old = mergeHook('#!/bin/sh\necho first\n', `${BEGIN}\nold body\n${END}`);
  const next = mergeHook(old, hookBlock());
  assert.ok(!next.includes('old body'));
  assert.ok(next.includes('echo first'));
  assert.equal(next.split(BEGIN).length, 2);
});

test('a wiki that lives in a subdirectory of its repo cds there first', () => {
  assert.ok(hookBlock('wiki/').includes('cd "wiki" || exit 0'));
  assert.ok(hookBlock('').includes('\n:\n'), 'the repo-root case is a no-op line');
});

test('installHooks writes an executable pre-commit into the repo hooks dir, and from a worktree into the shared one', () => {
  const root = mkdtempSync(join(tmpdir(), 'hooks-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  const logs = [];
  assert.equal(installHooks({ root, log: (m) => logs.push(m) }), 0);
  const file = join(root, '.git', 'hooks', 'pre-commit');
  assert.ok(readFileSync(file, 'utf8').includes(BEGIN));
  assert.ok(statSync(file).mode & 0o111, 'executable');
  assert.equal(installHooks({ root, log: (m) => logs.push(m) }), 0);
  assert.match(logs.at(-1), /already current/);

  // A worktree resolves to the same hooks directory.
  writeFileSync(join(root, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'a'], { cwd: root });
  const wt = join(root, '.claude', 'worktrees', 'x');
  mkdirSync(join(root, '.claude', 'worktrees'), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'x', wt], { cwd: root });
  const wtLogs = [];
  assert.equal(installHooks({ root: wt, log: (m) => wtLogs.push(m) }), 0);
  assert.match(wtLogs.at(-1), /already current/, 'the worktree found the hook the main checkout installed');
});

test('ensurePrepare adds the hook install to prepare once, chaining an existing script', () => {
  const fresh = {};
  assert.equal(ensurePrepare(fresh), true);
  assert.equal(fresh.scripts.prepare, PREPARE);
  assert.equal(ensurePrepare(fresh), false, 'idempotent');
  const theirs = { scripts: { prepare: 'husky' } };
  assert.equal(ensurePrepare(theirs), true);
  assert.equal(theirs.scripts.prepare, `husky && ${PREPARE}`);
  assert.equal(ensurePrepare(theirs), false);
});

test('outside git it says so and exits 0, so an install never fails on it', () => {
  const root = mkdtempSync(join(tmpdir(), 'nogit-'));
  const logs = [];
  assert.equal(installHooks({ root, log: (m) => logs.push(m) }), 0);
  assert.match(logs[0], /not a git checkout/);
});
