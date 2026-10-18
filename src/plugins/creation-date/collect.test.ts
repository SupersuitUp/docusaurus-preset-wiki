// Per-page dates from git history. The changelog stream is exercised only where the two
// have to agree; its own behaviour (drafts, hidden pages, renames) is unchanged and lives
// in the same function, so a regression there shows up here as a wrong date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectHistory, mergePageDates } from './collect';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

/** A wiki repo with `n` commits, each stamped a day apart so dates are distinguishable. */
function repo(): { root: string; commit: (msg: string, day: number) => string } {
  const root = mkdtempSync(join(tmpdir(), 'collect-'));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'docs', 'concepts'), { recursive: true });
  const commit = (msg: string, day: number) => {
    const date = `2026-09-${String(day).padStart(2, '0')}T12:00:00-04:00`;
    git(root, 'add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
    return git(root, 'rev-parse', 'HEAD');
  };
  return { root, commit };
}

const page = (title: string, body = 'Body.') => `---\ntitle: ${title}\n---\n\n${body}\n`;

test('every built page gets created and updated, including the section index the changelog skips', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'index.md'), page('Concepts'));
  writeFileSync(join(root, 'docs', 'concepts', 'alpha.md'), page('Alpha'));
  writeFileSync(join(root, 'docs', 'intro.md'), page('Intro'));
  commit('born', 1);
  writeFileSync(join(root, 'docs', 'concepts', 'alpha.md'), page('Alpha', 'Edited.'));
  writeFileSync(join(root, 'docs', 'concepts', 'index.md'), page('Concepts', 'Edited.'));
  commit('edited', 3);

  const { changeEvents, pageDates, liveDocKeys } = collectHistory(root);

  assert.deepEqual(new Set(liveDocKeys), new Set(['concepts/index', 'concepts/alpha', 'intro']));
  assert.equal(pageDates['concepts/alpha'].created?.slice(0, 10), '2026-09-01');
  assert.equal(pageDates['concepts/alpha'].updated?.slice(0, 10), '2026-09-03');
  assert.equal(pageDates['concepts/index'].created?.slice(0, 10), '2026-09-01', 'the index is dated');
  assert.equal(pageDates['concepts/index'].updated?.slice(0, 10), '2026-09-03');
  assert.equal(pageDates['intro'].created?.slice(0, 10), '2026-09-01');
  assert.equal(pageDates['intro'].updated?.slice(0, 10), '2026-09-01', 'a page written once');
  // The changelog still leaves the meta pages out.
  assert.ok(!changeEvents.some((e) => e.docKey === 'concepts/index' || e.docKey === 'intro'));
  assert.equal(changeEvents.filter((e) => e.docKey === 'concepts/alpha').length, 2);
});

test('a renamed page keeps its birthday under its new key', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'old-name.md'), page('Old'));
  commit('born', 1);
  renameSync(join(root, 'docs', 'concepts', 'old-name.md'), join(root, 'docs', 'concepts', 'new-name.md'));
  commit('renamed', 5);

  const { pageDates } = collectHistory(root);
  assert.equal(pageDates['concepts/new-name'].created?.slice(0, 10), '2026-09-01');
  assert.equal(pageDates['concepts/new-name'].updated?.slice(0, 10), '2026-09-05');
  assert.equal(pageDates['concepts/old-name'], undefined);
});

test('drafts and _hidden pages are not dated and not live', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'draft.md'), `---\ntitle: D\ndraft: true\n---\n\nx\n`);
  writeFileSync(join(root, 'docs', 'concepts', '_hidden.md'), page('H'));
  writeFileSync(join(root, 'docs', 'concepts', 'shown.md'), page('S'));
  commit('born', 1);

  const { pageDates, liveDocKeys } = collectHistory(root);
  assert.deepEqual(Object.keys(pageDates), ['concepts/shown']);
  assert.deepEqual(liveDocKeys, ['concepts/shown']);
});

test('a page hidden with an underscore and later restored gets its history back; one still hidden stays hidden', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', '_secret.md'), page('Secret'));
  writeFileSync(join(root, 'docs', 'concepts', '_still.md'), page('Still hidden'));
  commit('hidden drafts', 1);
  renameSync(join(root, 'docs', 'concepts', '_secret.md'), join(root, 'docs', 'concepts', 'secret.md'));
  commit('unhide secret', 4);

  const { changeEvents, pageDates, liveDocKeys } = collectHistory(root);
  assert.deepEqual(liveDocKeys, ['concepts/secret']);
  assert.equal(pageDates['concepts/secret'].created?.slice(0, 10), '2026-09-01', 'its birthday is the hidden commit');
  assert.equal(pageDates['concepts/secret'].updated?.slice(0, 10), '2026-09-04');
  assert.ok(changeEvents.some((e) => e.docKey === 'concepts/secret'), 'the restored page is in the changelog');
  assert.ok(!changeEvents.some((e) => e.title === 'Still hidden'), 'the one still hidden leaks nothing');
  assert.equal(pageDates['concepts/_still'], undefined);
});

test('a shallow clone dates only what it can see, and never invents a birthday', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old'));
  commit('born', 1);
  writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old', 'edit 1'));
  commit('edit 1', 2);
  writeFileSync(join(root, 'docs', 'concepts', 'old.md'), page('Old', 'edit 2'));
  writeFileSync(join(root, 'docs', 'concepts', 'fresh.md'), page('Fresh'));
  commit('edit 2 and a new page', 3);

  const shallow = mkdtempSync(join(tmpdir(), 'shallow-'));
  git(shallow, 'clone', '-q', '--depth', '2', `file://${root}`, '.');

  const { pageDates } = collectHistory(shallow);
  // `old` was born outside the window: its updated date is known, its birth is not.
  assert.equal(pageDates['concepts/old'].updated?.slice(0, 10), '2026-09-03');
  assert.equal(pageDates['concepts/old'].created, undefined);
  // `fresh` was added by HEAD, which is inside the window and not the boundary commit.
  assert.equal(pageDates['concepts/fresh'].created?.slice(0, 10), '2026-09-03');
});

test('mergePageDates keeps the earliest birth and the latest touch, comparing instants', () => {
  const merged = mergePageDates(
    { a: { created: '2026-09-01T12:00:00-04:00', updated: '2026-09-02T12:00:00-04:00' }, b: { updated: '2026-09-01T12:00:00-04:00' } },
    { a: { updated: '2026-09-02T17:30:00+02:00' }, b: { created: '2026-09-01T12:00:00-04:00' }, c: { created: '2026-09-05T00:00:00Z' } },
  );
  assert.equal(merged.a.created, '2026-09-01T12:00:00-04:00');
  // 17:30+02:00 is 15:30Z; 12:00-04:00 is 16:00Z, so the snapshot's value is the later one.
  assert.equal(merged.a.updated, '2026-09-02T12:00:00-04:00');
  assert.deepEqual(merged.b, { updated: '2026-09-01T12:00:00-04:00', created: '2026-09-01T12:00:00-04:00' });
  assert.deepEqual(merged.c, { created: '2026-09-05T00:00:00Z' });
});

// The pre-commit hook (`wiki refresh-dates`) runs BEFORE the commit exists: the working tree and
// the index already hold the rename or deletion, git log does not. Read naively, a staged rename
// orphans the page's whole history under its old key (blank routePath, the old title recovered
// from history, no dates for the new key), and that wrong snapshot is staged INTO the commit.
// getfreedom-wiki, 2026-10-16 to 10-18: every commit after a rename had to restore the file.
test('a STAGED rename (the pre-commit view) keeps the history on the new key, route and title', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'old-name.md'), page('Old Title'));
  writeFileSync(join(root, 'docs', 'concepts', 'keep.md'), page('Keep'));
  commit('born', 1);
  writeFileSync(join(root, 'docs', 'concepts', 'old-name.md'), page('Old Title', 'Edited.'));
  commit('edited', 2);
  // Rename and retitle, staged but not committed, exactly what the hook sees.
  git(root, 'mv', 'docs/concepts/old-name.md', 'docs/concepts/new-name.md');
  writeFileSync(join(root, 'docs', 'concepts', 'new-name.md'), page('New Title', 'Edited.'));
  git(root, 'add', '-A');

  const { changeEvents, pageDates } = collectHistory(root);
  const moved = changeEvents.filter((e) => e.id.startsWith('concepts/old-name@') || e.id.startsWith('concepts/new-name@'));
  assert.equal(moved.length, 2, 'both historical events survive');
  for (const e of moved) {
    assert.equal(e.docKey, 'concepts/new-name', 'filed under the name the page will have');
    assert.equal(e.routePath, '/concepts/new-name', 'linked, not blanked');
    assert.equal(e.title, 'New Title', 'the live title, not the one recovered from history');
  }
  assert.equal(pageDates['concepts/new-name']?.created?.slice(0, 10), '2026-09-01');
  assert.equal(pageDates['concepts/new-name']?.updated?.slice(0, 10), '2026-09-02');
});

test('a STAGED deletion leaves the page events unlinked, never pointing at a route that is gone', () => {
  const { root, commit } = repo();
  writeFileSync(join(root, 'docs', 'concepts', 'gone.md'), page('Gone'));
  writeFileSync(join(root, 'docs', 'concepts', 'stays.md'), page('Stays'));
  commit('born', 1);
  git(root, 'rm', '-q', 'docs/concepts/gone.md');

  const { changeEvents, pageDates } = collectHistory(root);
  const gone = changeEvents.filter((e) => e.docKey === 'concepts/gone');
  assert.equal(gone.length, 1, 'its history stays: the page was created on the 1st');
  assert.equal(gone[0].routePath, '', 'the ChangelogWidget renders an event with no routePath as plain text');
  assert.equal(gone[0].title, 'Gone');
  assert.equal(pageDates['concepts/gone'], undefined, 'a page that will not be built is not dated');
});
