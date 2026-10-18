// `wiki refresh-dates` as the pre-commit hook runs it: the rename or deletion is staged, the
// commit does not exist yet. The snapshot it stages INTO that commit must agree with what a
// refresh from the full history produces right after it, on every event the two share. The
// only legitimate difference is the commit's own events, which Vercel's shallow window carries.
// Needs the built package (`npm run build`), like the CLI itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The CLI loads the COMPILED plugin from beside itself, so run the copy in lib/ (from src/ too).
const HERE = fileURLToPath(new URL('.', import.meta.url));
const cli = existsSync(join(HERE, '..', 'plugins', 'creation-date', 'snapshot.js'))
  ? './refresh-dates.mjs'
  : '../../lib/cli/refresh-dates.mjs';
const { refreshDates } = await import(cli);

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim();
const commit = (root, msg, day) => {
  const date = `2026-10-${String(day).padStart(2, '0')}T12:00:00-04:00`;
  execFileSync('git', ['commit', '-q', '--no-verify', '-m', msg], {
    cwd: root,
    env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
};
const page = (title, body = 'Body.') => `---\ntitle: ${title}\n---\n\n${body}\n`;
const snapshot = (root) => JSON.parse(readFileSync(join(root, 'src/data/changelog-events.json'), 'utf8'));
const quiet = () => {};

test('the snapshot staged into a rename-and-delete commit is the one the next refresh would write', () => {
  const root = mkdtempSync(join(tmpdir(), 'refresh-dates-'));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'docs', 'skills'), { recursive: true });
  writeFileSync(join(root, 'docs', 'skills', 'set-up-my-hub.md'), page('Set up my hub'));
  writeFileSync(join(root, 'docs', 'skills', 'retired.md'), page('Retired'));
  writeFileSync(join(root, 'docs', 'skills', 'stays.md'), page('Stays'));
  git(root, 'add', '-A');
  commit(root, 'born', 1);
  writeFileSync(join(root, 'docs', 'skills', 'set-up-my-hub.md'), page('Set up my hub', 'Edited.'));
  git(root, 'add', '-A');
  commit(root, 'edited', 2);

  // The commit being made: rename + retitle one page, delete another.
  git(root, 'mv', 'docs/skills/set-up-my-hub.md', 'docs/skills/create-or-update-my-hub.md');
  writeFileSync(join(root, 'docs', 'skills', 'create-or-update-my-hub.md'), page('Create or update my hub', 'Edited.'));
  git(root, 'rm', '-q', 'docs/skills/retired.md');
  assert.equal(refreshDates({ root, log: quiet }), 0, 'the hook run succeeds and stages');
  const staged = snapshot(root);
  assert.ok(git(root, 'diff', '--cached', '--name-only').includes('src/data/changelog-events.json'), 'it staged the snapshot');
  commit(root, 'rename and delete', 3);

  // Nothing renamed, nothing deleted: the next refresh over the full history.
  assert.equal(refreshDates({ root, stage: false, log: quiet }), 0);
  const after = snapshot(root);

  const afterById = new Map(after.changeEvents.map((e) => [e.id, e]));
  for (const e of staged.changeEvents) {
    assert.deepEqual(e, afterById.get(e.id), `event ${e.id} changed between the staged snapshot and the next refresh`);
  }
  const hub = staged.changeEvents.filter((e) => e.docKey === 'skills/create-or-update-my-hub');
  assert.equal(hub.length, 2, 'the renamed page keeps both historical events');
  assert.ok(hub.every((e) => e.routePath === '/skills/create-or-update-my-hub' && e.title === 'Create or update my hub'));
  assert.ok(!staged.changeEvents.some((e) => e.docKey === 'skills/set-up-my-hub'), 'nothing is left under the old key');
  assert.equal(staged.pageDates['skills/create-or-update-my-hub']?.created?.slice(0, 10), '2026-10-01');
  for (const e of staged.changeEvents.filter((x) => x.docKey === 'skills/retired')) {
    assert.equal(e.routePath, '', 'a deleted page is never linked');
  }
  for (const [key, dates] of Object.entries(staged.pageDates)) {
    assert.equal(dates.created, after.pageDates[key]?.created, `${key} keeps its birthday across the commit`);
  }
});
