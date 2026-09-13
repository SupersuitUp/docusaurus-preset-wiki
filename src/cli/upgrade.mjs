#!/usr/bin/env node
// Bring a wiki that is already on the package up to the newest release, and say what changed.
//
//   wiki upgrade [--to <version>] [--no-build] [--dry-run]
//
// Reads the installed version, moves the dependency to the newest (or --to), installs, prints
// the CHANGELOG entries between the two so a major is read before it is merged, runs the build
// (which runs `wiki check`). Never commits, never pushes: read the diff, commit by explicit
// paths, push, then check the deployed site.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const PKG = "@supersuit/docusaurus-preset-wiki";
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const log = (m) => console.log(`[upgrade] ${m}`);

export function installedVersion(root = ROOT) {
  const p = join(root, "node_modules", PKG, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).version : null;
}

/** The CHANGELOG sections for every version above `from` up to and including `to`. */
export function changelogBetween(changelog, from, to) {
  const sections = changelog.split(/^## /m).slice(1).map((s) => "## " + s);
  const ver = (s) => (s.match(/^## (\d+\.\d+\.\d+)/) || [])[1];
  const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  return sections.filter((s) => { const v = ver(s); return v && (!from || cmp(v, from) > 0) && (!to || cmp(v, to) <= 0); });
}

export function upgrade() {
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) { console.error("[upgrade] run this in a wiki root"); return 2; }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.dependencies?.[PKG]) { console.error(`[upgrade] ${PKG} is not a dependency here; a wiki still on copied files takes \`wiki migrate\``); return 2; }
  const from = installedVersion();
  const target = flag("--to") ?? "latest";
  const pm = existsSync(join(ROOT, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  log(`installed ${from ?? "(not installed)"}; moving to ${target}`);
  if (args.includes("--dry-run")) { log("dry run, nothing changed"); return 0; }
  const addArgs = pm === "pnpm" ? ["add", `${PKG}@${target}`, "--config.minimum-release-age=0"] : ["install", `${PKG}@${target}`];
  const r = spawnSync(pm, addArgs, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) { console.error("[upgrade] install failed"); return 1; }
  const to = installedVersion();
  log(`now ${to}`);
  if (to === from) { log("already current"); return 0; }
  const cl = join(ROOT, "node_modules", PKG, "CHANGELOG.md");
  if (existsSync(cl)) {
    const between = changelogBetween(readFileSync(cl, "utf8"), from, to);
    if (between.length) { console.log("\n" + between.join("\n").trim() + "\n"); }
    if (from && to.split(".")[0] !== from.split(".")[0]) log("MAJOR: something an instance must do changed. Read the entries above before committing.");
  }
  if (!args.includes("--no-build")) {
    const b = spawnSync(pm, ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    if (b.status !== 0) { console.error("[upgrade] build failed; the CHANGELOG above names what an instance must change"); return 1; }
  }
  log("done. Next: read the diff, commit package.json and the lockfile by name, push, then check the deployed site (`wiki gate status` if gated).");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(upgrade());
