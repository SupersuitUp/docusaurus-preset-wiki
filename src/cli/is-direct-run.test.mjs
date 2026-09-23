import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isDirectRun } from "./is-direct-run.mjs";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

test("a module that was IMPORTED reports false", () => {
  // Asserted through a spawned fixture rather than on this file: under `node --test` the
  // test file IS the entry point, so isDirectRun is correctly true here.
  const dir = mkdtempSync(join(tmpdir(), "direct-run-"));
  const lib = join(dir, "lib.mjs");
  writeFileSync(lib,
    `import { isDirectRun } from ${JSON.stringify(join(CLI_DIR, "is-direct-run.mjs"))};\n` +
    `export const verdict = isDirectRun(import.meta.url);\n`);
  const entry = join(dir, "entry.mjs");
  writeFileSync(entry,
    `import { verdict } from "./lib.mjs";\nconsole.log(verdict ? "DIRECT" : "IMPORTED");\n`);
  assert.equal(execFileSync(process.execPath, [entry], { encoding: "utf8" }).trim(), "IMPORTED",
    "a library imported by an entry point must not run its CLI body");
  rmSync(dir, { recursive: true, force: true });
});

test("a file run directly says so, through a symlink or not", () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-run-"));
  const real = join(dir, "prog.mjs");
  writeFileSync(real,
    `import { isDirectRun } from ${JSON.stringify(join(CLI_DIR, "is-direct-run.mjs"))};\n` +
    `console.log(isDirectRun(import.meta.url) ? "DIRECT" : "IMPORTED");\n`);
  const link = join(dir, "link.mjs");
  symlinkSync(real, link);

  const run = (p) => execFileSync(process.execPath, [p], { encoding: "utf8" }).trim();
  assert.equal(run(real), "DIRECT", "run by its real path");
  assert.equal(run(link), "DIRECT", "run through a symlink, which is how pnpm installs");
  rmSync(dir, { recursive: true, force: true });
});

test("a path with a space still resolves", () => {
  const dir = mkdtempSync(join(tmpdir(), "direct run "));
  const p = join(dir, "prog.mjs");
  writeFileSync(p,
    `import { isDirectRun } from ${JSON.stringify(join(CLI_DIR, "is-direct-run.mjs"))};\n` +
    `console.log(isDirectRun(import.meta.url) ? "DIRECT" : "IMPORTED");\n`);
  assert.equal(execFileSync(process.execPath, [p], { encoding: "utf8" }).trim(), "DIRECT",
    "the file:// template spelling this helper replaced fails exactly here");
  rmSync(dir, { recursive: true, force: true });
});

// THE ASSERTION THIS FILE EXISTS FOR.
//
// Eleven CLIs in this directory hand-rolled this comparison, in three different spellings, and
// every one silently no-opped through a symlink. pnpm installs packages as symlinks, so that
// was every consumer. A note in a header telling the next author to use the helper changes
// nothing about what the next author types; this does.
test("no CLI hand-rolls the direct-run comparison", () => {
  const naive = [
    /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/,
    /import\.meta\.url\s*===\s*pathToFileURL\(process\.argv\[1\]\)/,
    /fileURLToPath\(import\.meta\.url\)\s*===\s*process\.argv\[1\]/,
  ];
  const offenders = [];
  for (const f of readdirSync(CLI_DIR)) {
    if (!f.endsWith(".mjs") || f.startsWith("is-direct-run")) continue;
    const src = readFileSync(join(CLI_DIR, f), "utf8");
    if (naive.some((rx) => rx.test(src))) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    "these compare import.meta.url to process.argv[1] by hand, which is false through a " +
    "pnpm symlink and makes the CLI exit 0 having done nothing. Use isDirectRun().");
});
