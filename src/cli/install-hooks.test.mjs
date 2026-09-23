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

// The merge half: two branches that each regenerated the snapshot merge without a conflict.
import { spawnSync } from 'node:child_process';
import { installMergeDriver } from './install-hooks.mjs';

function snapRepo() {
  const r = mkdtempSync(join(tmpdir(), 'snapmerge-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: r, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  mkdirSync(join(r, 'src/data'), { recursive: true });
  writeFileSync(join(r, 'src/data/changelog-events.json'), '{"e":[1]}\n'); writeFileSync(join(r, 'page.md'), 'a\n');
  g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'side'); writeFileSync(join(r, 'src/data/changelog-events.json'), '{"e":[1,2]}\n'); g('commit', '-qam', 's');
  g('checkout', '-q', 'main'); writeFileSync(join(r, 'src/data/changelog-events.json'), '{"e":[1,3]}\n'); g('commit', '-qam', 'm');
  return { r, g };
}
const merge = (r) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-edit', 'side'], { cwd: r, encoding: 'utf8' });

test('without the driver two regenerated snapshots conflict', () => {
  assert.notEqual(merge(snapRepo().r).status, 0);
});

test('with the driver they merge, ours kept, and no tracked file changes', () => {
  const { r, g } = snapRepo();
  assert.ok(installMergeDriver(r));
  assert.equal(g('status', '--porcelain'), '', 'installing must not dirty the wiki');
  assert.equal(merge(r).status, 0);
  assert.equal(readFileSync(join(r, 'src/data/changelog-events.json'), 'utf8'), '{"e":[1,3]}\n');
  installMergeDriver(r);
  assert.equal(readFileSync(join(r, '.git/info/attributes'), 'utf8').split('changelog-snapshot').length, 2, 'idempotent');
});

test('a real page conflict still stops the merge', () => {
  const { r, g } = snapRepo();
  installMergeDriver(r);
  g('checkout', '-q', 'side'); writeFileSync(join(r, 'page.md'), 's\n'); g('commit', '-qam', 'p');
  g('checkout', '-q', 'main'); writeFileSync(join(r, 'page.md'), 'm\n'); g('commit', '-qam', 'p');
  assert.notEqual(merge(r).status, 0);
});
