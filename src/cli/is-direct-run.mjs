// "Was this file run, or imported?" for every CLI in this package.
//
// THE OBVIOUS SPELLINGS ARE ALL WRONG IN THE SAME WAY, and they fail SILENTLY.
//
//   import.meta.url === `file://${process.argv[1]}`              breaks on any path with a
//                                                                space, and on Windows
//   import.meta.url === pathToFileURL(process.argv[1]).href      breaks through a symlink
//   fileURLToPath(import.meta.url) === process.argv[1]           breaks through a symlink
//
// The symlink case is not exotic: **pnpm installs every package as a symlink** into `.pnpm/`,
// so for every consumer of this package `process.argv[1]` is the link and `import.meta.url` is
// the target. A gate guarded that way imports cleanly, runs nothing, and exits 0, which reads
// as a pass. That is worse than having no gate, and it is invisible.
//
// Found 2026-09-23 with eleven copies of the three spellings above in src/cli, five of them
// gates. `is-direct-run.test.mjs` refuses a twelfth: it greps this directory and fails on any
// hand-rolled comparison, because a comment saying "use the helper" is not a mechanism.
import { realpathSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";

const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** True when `importMetaUrl`'s file is the one node was asked to run. */
export function isDirectRun(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return real(fileURLToPath(importMetaUrl)) === real(entry);
  } catch {
    return importMetaUrl === pathToFileURL(entry).href;
  }
}
