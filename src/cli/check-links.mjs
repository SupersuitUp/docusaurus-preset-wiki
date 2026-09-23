#!/usr/bin/env node
// Internal link gate. Runs in prebuild, beside check-admonitions.
//
// WHY THIS EXISTS RATHER THAN TRUSTING onBrokenLinks.
// The config says `onBrokenLinks: 'throw'`. It does not fire. Measured on
// Docusaurus 3.10.1: a plainly dead `[x](/concepts/not-a-real-page)` in ordinary
// prose built clean, exit 0, with no mention of links anywhere in the build log,
// and the dead href present in the emitted HTML. Toggling `future.faster` off did
// not restore it either.
//
// A declared gate that never runs is worse than no gate. It is read as protection,
// so nobody checks by hand, and a dead link ships wearing a green build. That is
// exactly how a renamed concept page left a dead link in the decision log tonight
// and passed.
//
// So this does not depend on framework behaviour. It reads the files and resolves
// the links itself.
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, relative } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { isDirectRun } from "./is-direct-run.mjs";


// THE DOCS ARE NOT ALWAYS AT THE ROOT, AND ASSUMING THEY ARE INVERTS THIS GATE.
// A wiki that moves its docs (`routeBasePath: '/wiki'`, so a homepage can own `/`)
// serves docs/sources/x.md at /wiki/sources/x. This checker derives routes from the
// docs/ tree, so with no knowledge of the base it builds every route one prefix
// short, then reports the CORRECT links as broken and the broken ones as fine.
//
// That is worse than not running. On 2026-09-23 it told an agent to strip the
// `/wiki` prefix off 20 correct links across a corpus; the local build passed
// (onBrokenLinks does not fire locally, per the note above), and Vercel's build,
// where it DOES fire, failed five times in a row. Production sat on an hour-old
// deploy while every gate on the machine read green.
//
// So the base is read from the config rather than assumed. Both spellings are
// supported: the `docs: { routeBasePath }` preset option, and the imperative
// `classic[1].docs.routeBasePath = '/wiki'` some configs use because the preset
// hardcodes the option. `--route-base <path>` overrides for anything exotic.
import { docsRouteBasePathFromConfigFile } from "./docs-base.mjs";
// Re-exported under the name this gate's tests and callers already use.
export const docsRouteBasePath = docsRouteBasePathFromConfigFile;

// Everything below is the CLI. It is guarded so that importing this module for
// its pure helpers does not walk a directory, print, or call process.exit, which
// silently truncated the first test run of this file.
export function main(argv = process.argv.slice(2)) {
  const flagIdx = argv.indexOf("--route-base");
  const routeBaseFlag = flagIdx >= 0 ? argv[flagIdx + 1] : null;
  const ROOT = resolve(argv.find((a) => !a.startsWith("--") && a !== routeBaseFlag) || ".");
  const DOCS = join(ROOT, "docs");
  const STATIC = join(ROOT, "static");
  const BASE = docsRouteBasePath(ROOT, routeBaseFlag);

  function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.mdx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  const files = walk(DOCS);
  if (!files.length) { console.log("check-links: no docs/ to check"); process.exit(0); }

  /** Every route a doc can be reached at: its explicit slug, and its path-derived route. */
  const routes = new Set(["/"]);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const m = /^---\n([\s\S]*?)\n---/.exec(src);
    const slug = m && /^slug:\s*(.+)$/m.exec(m[1])?.[1]?.trim().replace(/^["']|["']$/g, "");
    // A doc's slug is relative to the docs route base, so `/sources/x` under a
    // `/wiki` base is served at `/wiki/sources/x`. Both spellings are registered
    // when the base is root, which keeps this a no-op for ordinary wikis.
    if (slug) routes.add((BASE + (slug.replace(/\/$/, "") || "/")).replace(/\/$/, "") || "/");
    // Path-derived route, which stays valid even when a slug is declared.
    let rel = "/" + relative(DOCS, f).replace(/\.mdx?$/, "").replace(/\\/g, "/");
    rel = rel.replace(/\/index$/, "") || "/";
    routes.add((BASE + rel).replace(/\/$/, "") || "/");
  }

  // Custom React pages are real routes too. src/pages/ask.tsx serves /ask, and a
  // checker that only knows about docs/ calls that a broken link. Caught immediately:
  // the first sweep reported /ask as broken in a wiki whose src/pages/ask.tsx has been
  // live for weeks. A gate that cries wolf gets switched off, which costs more than
  // the gate was ever worth.
  const PAGES = join(ROOT, "src", "pages");
  function addPageRoutes(dir, prefix = "") {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { addPageRoutes(join(dir, e.name), `${prefix}/${e.name}`); continue; }
      const m = /^(.+)\.(tsx?|jsx?|mdx?)$/.exec(e.name);
      if (!m) continue;                       // .module.css and friends are not routes
      if (m[1].startsWith("_")) continue;     // _listen.tsx is deliberately unrouted
      routes.add(m[1] === "index" ? (prefix || "/") : `${prefix}/${m[1]}`);
    }
  }

  /** Every custom page's SOURCE file, so its asset references can be checked. */
  function pageFiles(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) pageFiles(p, out);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  /** A static asset that really is on disk. */
  const isAsset = (p) => existsSync(join(STATIC, p.replace(/^\//, "")));

  addPageRoutes(PAGES);

  const problems = [];

  // CUSTOM PAGES ARE SCANNED FOR ASSET REFERENCES, not only harvested for routes.
  //
  // Until 2026-09-23 src/pages/*.tsx was read ONLY to learn which routes it serves, so an
  // <img src="/img/..."> in a custom page pointed at nothing and the build still reported
  // "no broken internal links". Caught on antisocialcontract.com: a hero image was deleted
  // and its page kept referencing it, and a full green build shipped a front door with a
  // hole in it. Docusaurus does not resolve these either, because the value is just a
  // string; nothing anywhere was checking them.
  //
  // Deliberately narrow: ONLY a `src` whose value is a plain double-quoted literal starting
  // with `/`. Not `to=` and not `href=`, which carry anchors, external URLs and expressions
  // and would need real route modelling to judge; guessing there would break builds over
  // links that work, which is how a gate teaches people to bypass it.
  for (const f of pageFiles(PAGES)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\bsrc="(\/[^"{}\s]*)"/g)) {
        const target = m[1];
        if (isAsset(target)) continue;
        problems.push({ file: relative(ROOT, f), line: i + 1, target });
      }
    });
  }

  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    let fenced = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) { fenced = !fenced; return; }
      if (fenced) return;   // a link inside a code fence is an example, not a link
      // Inline code spans are examples too. A voice-rules page documenting the house
      // link format as `[Link](/path) - description` is not linking to /path, and
      // flagging it teaches everyone that the gate is noisy. Strip spans before
      // scanning, rather than skipping the whole line, so a real link sitting beside
      // an example is still checked.
      const scan = line.replace(/`[^`]*`/g, "");
      for (const m of scan.matchAll(/\[[^\]]*\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g)) {
        const target = m[1].replace(/\/$/, "") || "/";
        if (routes.has(target) || isAsset(target)) continue;
        // Blog routes are derived from dated filenames and per-post slug frontmatter,
        // which this checker deliberately does not model. Claiming to check them and
        // getting it wrong would break a build over a link that works, so they are
        // out of scope and skipped rather than guessed at.
        if (target === "/blog" || target.startsWith("/blog/")) continue;
        // Ignore anything the site serves outside docs (blog, custom pages) by
        // convention: only flag paths that look like doc routes.
        problems.push({ file: relative(ROOT, f), line: i + 1, target });
      }
    });
  }

  if (!problems.length) {
    console.log(`check-links: ${files.length} files, ${routes.size} routes${BASE ? ` under ${BASE}` : ""}, no broken internal links`);
    process.exit(0);
  }
  console.error(`\ncheck-links: ${problems.length} broken internal link(s)\n`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}  ->  ${p.target}`);
  console.error(`\nEvery one of these renders as a link or an image and 404s. Fix the target or the reference.`);
  if (BASE) {
    console.error(`\nThis wiki serves its docs under ${BASE}, so an in-docs link reads`);
    console.error(`${BASE}/concepts/x, not /concepts/x. That is the usual cause here.`);
  }
  console.error(`\n(Docusaurus' own onBrokenLinks is unreliable locally on 3.10.1 but DOES`);
  console.error(` fire on a clean CI install, so a link this gate misses fails the deploy`);
  console.error(` rather than shipping. See the header of check-links.mjs.)\n`);
  process.exit(1);

}

if (isDirectRun(import.meta.url)) main();
