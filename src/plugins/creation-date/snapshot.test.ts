// The snapshot is what production reads; these are the ways it used to go wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHistory, mergeHistory, readSnapshot, undatedPages, SNAPSHOT_RELATIVE_PATH } from './snapshot';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
const commit = (cwd: string, msg: string, day: number) => {
  const date = `2026-09-${String(day).padStart(2, '0')}T12:00:00-04:00`;
  git(cwd, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};
const page = (title: string, body = 'Body.') => `---\ntitle: ${title}\n---\n\n${body}\n`;

test('a snapshot written before pageDates existed still reads, with an empty map', () => {
  const root = mkdtempSync(join(tmpdir(), 'snap-'));
  mkdirSync(join(root, 'src', 'data'), { recursive: true });
  writeFileSync(join(root, SNAPSHOT_RELATIVE_PATH), JSON.stringify({ changeEvents: [{ id: 'a@1', type: 'new', date: '2026-09-01T00:00:00Z', docKey: 'a', routePath: '/a', section: '', title: 'A' }] }));
  const snap = readSnapshot(root);
  assert.equal(snap.changeEvents.length, 1);
  assert.deepEqual(snap.pageDates, {});
});

test('mergeHistory: live events win by id, page dates merge by earliest birth and latest touch', () => {
  const merged = mergeHistory(
    {
      changeEvents: [{ id: 'a@1', type: 'new', date: '2026-09-01T00:00:00Z', docKey: 'a', routePath: '/a', section: '', title: 'Old title' }],
      pageDates: { a: { created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z' } },
    },
    {
      changeEvents: [{ id: 'a@1', type: 'new', date: '2026-09-01T00:00:00Z', docKey: 'a', routePath: '/a', section: '', title: 'New title' }],
      pageDates: { a: { updated: '2026-09-04T00:00:00Z' } },
    },
  );
  assert.equal(merged.changeEvents[0].title, 'New title');
  assert.deepEqual(merged.pageDates.a, { created: '2026-09-01T00:00:00Z', updated: '2026-09-04T00:00:00Z' });
});

test('undatedPages names the live pages nothing can date', () => {
  const history = { changeEvents: [], pageDates: { a: { created: 'x' }, b: {} } };
  assert.deepEqual(undatedPages(history, ['c', 'a', 'b']), ['b', 'c']);
});

test('the full-clone build writes the snapshot; the shallow build merges it and dates a page the window cannot see', () => {
  const root = mkdtempSync(join(tmpdir(), 'full-'));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'docs', 'concepts'), { recursive: true });
  writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old'));
  commit(root, 'born', 1);

  // A laptop build: git is complete, the snapshot is written from it.
  const full = loadHistory(root);
  assert.equal(full.shallow, false);
  assert.equal(full.wroteSnapshot, true);
  assert.ok(existsSync(join(root, SNAPSHOT_RELATIVE_PATH)));
  const written = JSON.parse(readFileSync(join(root, SNAPSHOT_RELATIVE_PATH), 'utf8'));
  assert.equal(written.pageDates['concepts/old'].created.slice(0, 10), '2026-09-01');
  assert.ok(!('liveDocKeys' in written), 'the working-tree list never enters the snapshot');
  commit(root, 'snapshot', 1);

  // Many commits later, one of which adds a page, with no snapshot refresh in between.
  for (let day = 2; day <= 4; day += 1) {
    writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old', `edit ${day}`));
    commit(root, `edit ${day}`, day);
  }
  writeFileSync(join(root, 'docs', 'concepts', 'fresh.md'), page('Fresh'));
  commit(root, 'fresh page', 5);
  for (let day = 6; day <= 9; day += 1) {
    writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old', `edit ${day}`));
    commit(root, `edit ${day}`, day);
  }

  // The deploy: a shallow clone whose window ends after `fresh` was added.
  const shallow = mkdtempSync(join(tmpdir(), 'shallow-'));
  git(shallow, 'clone', '-q', '--depth', '3', `file://${root}`, '.');
  const deployed = loadHistory(shallow);
  assert.equal(deployed.shallow, true);
  assert.equal(deployed.wroteSnapshot, false, 'a shallow clone never rewrites the snapshot');
  assert.equal(deployed.pageDates['concepts/old'].created?.slice(0, 10), '2026-09-01', 'birth from the snapshot');
  assert.equal(deployed.pageDates['concepts/old'].updated?.slice(0, 10), '2026-09-09', 'touch from the window');
  // This is the getfreedom-wiki failure of 2026-09-20: a page committed after the last
  // snapshot and before the window has NO dates, and the build now says which.
  assert.deepEqual(undatedPages(deployed, deployed.liveDocKeys ?? []), ['concepts/fresh']);
});
