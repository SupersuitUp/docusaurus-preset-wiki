#!/usr/bin/env node
// Rewrite src/data/changelog-events.json from this clone's git history and stage it.
//
//   wiki refresh-dates            refresh, `git add` the snapshot if it changed
//   wiki refresh-dates --check    exit 1 if the committed snapshot is behind git (CI, prebuild)
//   wiki refresh-dates --no-stage refresh only
//
// The snapshot is what production reads for every page's Created / Updated line and for
// /changelog, because Vercel's clone is shallow (plugins/creation-date/snapshot.ts). It is
// only as fresh as its last commit, so this runs from the pre-commit hook `wiki install-hooks`
// writes: every commit refreshes it from the history before that commit, the commit itself is
// inside the shallow window, and the two halves meet. On a shallow clone it refuses, because
// writing the window over the full history is the one way to make things worse.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The compiled plugin module, wherever this CLI is running from (lib/ after build, src/ under tests via tsx). */
function snapshotModule() {
  const compiled = join(HERE, '..', 'plugins', 'creation-date', 'snapshot.js');
  if (existsSync(compiled)) return require(compiled);
  throw new Error(`refresh-dates needs the built package (missing ${compiled}); run \`npm run build\` in the package`);
}

export function refreshDates({ root = process.cwd(), stage = true, check = false, log = console.log } = {}) {
  const { loadHistory, readSnapshot, serializeSnapshot, SNAPSHOT_RELATIVE_PATH } = snapshotModule();
  const { isShallowClone, collectHistory } = require(join(HERE, '..', 'plugins', 'creation-date', 'collect.js'));
  if (!existsSync(join(root, 'docs'))) {
    console.error('[refresh-dates] no docs/ here; run from the wiki root');
    return 2;
  }
  if (isShallowClone(root)) {
    console.error('[refresh-dates] this is a shallow clone; the snapshot can only be refreshed from full history');
    return 2;
  }
  if (check) {
    const live = collectHistory(root);
    const before = serializeSnapshot(readSnapshot(root));
    const after = serializeSnapshot({ changeEvents: live.changeEvents, pageDates: live.pageDates });
    if (before === after) { log('[refresh-dates] snapshot is current'); return 0; }
    console.error(`[refresh-dates] ${SNAPSHOT_RELATIVE_PATH} is behind git history; run \`wiki refresh-dates\` and commit it`);
    return 1;
  }
  const history = loadHistory(root);
  const pages = Object.keys(history.pageDates).length;
  if (!history.wroteSnapshot) {
    log(`[refresh-dates] snapshot already current (${history.changeEvents.length} events, ${pages} dated pages)`);
    return 0;
  }
  log(`[refresh-dates] ${SNAPSHOT_RELATIVE_PATH} refreshed: ${history.changeEvents.length} events, ${pages} dated pages`);
  if (stage) {
    execFileSync('git', ['add', '--', SNAPSHOT_RELATIVE_PATH], { cwd: root, stdio: 'inherit' });
    log('[refresh-dates] staged');
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  process.exit(refreshDates({ stage: !args.includes('--no-stage'), check: args.includes('--check') }));
}
