import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { docsRouteBasePath } from "./check-links.mjs";

const CLI = fileURLToPath(new URL("./check-links.mjs", import.meta.url));

function wiki(config, docs) {
  const dir = mkdtempSync(join(tmpdir(), "check-links-"));
  if (config !== null) writeFileSync(join(dir, "docusaurus.config.ts"), config);
  for (const [rel, body] of Object.entries(docs)) {
    const f = join(dir, "docs", rel);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, body);
  }
  return dir;
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, dir], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("no config means the docs are at the root", () => {
  assert.equal(docsRouteBasePath(wiki(null, { "a.md": "x" })), "");
});

test("reads the imperative assignment some configs use", () => {
  const d = wiki(`classic[1].docs.routeBasePath = '/wiki';\n`, { "a.md": "x" });
  assert.equal(docsRouteBasePath(d), "/wiki");
});

test("reads the declared preset option", () => {
  const d = wiki(`presets: [['classic', { docs: { sidebarPath: './s.ts', routeBasePath: '/handbook' } }]]`, { "a.md": "x" });
  assert.equal(docsRouteBasePath(d), "/handbook");
});

test("an imperative override beats the declared value", () => {
  const d = wiki(
    `presets: [['classic', { docs: { routeBasePath: '/' } }]]\nclassic[1].docs.routeBasePath = '/wiki';\n`,
    { "a.md": "x" });
  assert.equal(docsRouteBasePath(d), "/wiki");
});

test("a root base normalizes to empty, so ordinary wikis are unaffected", () => {
  assert.equal(docsRouteBasePath(wiki(`docs: { routeBasePath: '/' }`, { "a.md": "x" })), "");
});

test("--route-base overrides whatever the config says", () => {
  const d = wiki(`classic[1].docs.routeBasePath = '/wiki';\n`, { "a.md": "x" });
  assert.equal(docsRouteBasePath(d, "docs"), "/docs");
});

// THE REGRESSION. Before this, a prefixed link was reported broken and an
// unprefixed one passed, which is backwards and shipped 20 dead links.
test("under a moved base, the PREFIXED link passes", () => {
  const d = wiki(`classic[1].docs.routeBasePath = '/wiki';\n`, {
    "concepts/x.md": "---\nslug: /concepts/x\n---\nbody",
    "a.md": "see [x](/wiki/concepts/x)",
  });
  const r = run(d);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /under \/wiki/);
  rmSync(d, { recursive: true, force: true });
});

test("under a moved base, the UNPREFIXED link is reported broken", () => {
  const d = wiki(`classic[1].docs.routeBasePath = '/wiki';\n`, {
    "concepts/x.md": "---\nslug: /concepts/x\n---\nbody",
    "a.md": "see [x](/concepts/x)",
  });
  const r = run(d);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\/concepts\/x/);
  assert.match(r.out, /serves its docs under \/wiki/);
  rmSync(d, { recursive: true, force: true });
});

test("with no base, an unprefixed link still passes", () => {
  const d = wiki(null, {
    "concepts/x.md": "---\nslug: /concepts/x\n---\nbody",
    "a.md": "see [x](/concepts/x)",
  });
  assert.equal(run(d).code, 0);
  rmSync(d, { recursive: true, force: true });
});

// THE SILENT NO-OP. pnpm installs packages as symlinks, so process.argv[1] is the link and
// import.meta.url is the target. A naive direct-run guard is false for every pnpm consumer:
// the gate runs nothing and exits 0, which reads as a pass.
test("invoked through a SYMLINK, the gate still runs", () => {
  const d = wiki(null, {
    "concepts/x.md": "---\nslug: /concepts/x\n---\nbody",
    "a.md": "see [x](/concepts/x)",
  });
  const linkDir = mkdtempSync(join(tmpdir(), "check-links-link-"));
  const link = join(linkDir, "check-links.mjs");
  symlinkSync(CLI, link);
  const r = (() => {
    try { return { code: 0, out: execFileSync(process.execPath, [link, d], { encoding: "utf8" }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  })();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /check-links: \d+ files/,
    "a symlinked invocation must produce the report, not silence");
  rmSync(d, { recursive: true, force: true });
  rmSync(linkDir, { recursive: true, force: true });
});

test("invoked through a SYMLINK, a broken link still fails", () => {
  const d = wiki(null, { "a.md": "see [x](/concepts/nope)" });
  const linkDir = mkdtempSync(join(tmpdir(), "check-links-link-"));
  const link = join(linkDir, "check-links.mjs");
  symlinkSync(CLI, link);
  let code = 0, out = "";
  try { out = execFileSync(process.execPath, [link, d], { encoding: "utf8" }); }
  catch (e) { code = e.status; out = (e.stdout || "") + (e.stderr || ""); }
  assert.equal(code, 1, "silence and exit 0 through a symlink is the defect");
  assert.match(out, /\/concepts\/nope/);
  rmSync(d, { recursive: true, force: true });
  rmSync(linkDir, { recursive: true, force: true });
});

// Custom pages are scanned for asset references, added 2026-09-23 after a green build
// shipped a front door whose <img src> pointed at a deleted file.
function wikiWithPage(page, assets = []) {
  const dir = mkdtempSync(join(tmpdir(), "check-links-page-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "a.md"), "x");
  mkdirSync(join(dir, "src", "pages"), { recursive: true });
  writeFileSync(join(dir, "src", "pages", "door.tsx"), page);
  for (const a of assets) {
    const f = join(dir, "static", a);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "binary");
  }
  return dir;
}

test("a page img src pointing at a missing asset is caught", () => {
  const d = wikiWithPage(`export default () => <img src="/img/gone.webp" />;`);
  const r = run(d);
  assert.notEqual(r.code, 0, "a missing page asset must fail the build");
  assert.match(r.out, /\/img\/gone\.webp/);
  assert.match(r.out, /door\.tsx/);
  rmSync(d, { recursive: true, force: true });
});

test("a page img src pointing at a real asset passes", () => {
  const d = wikiWithPage(`export default () => <img src="/img/there.webp" />;`, ["img/there.webp"]);
  const r = run(d);
  assert.equal(r.code, 0, r.out);
  rmSync(d, { recursive: true, force: true });
});

test("an external or expression src is left alone", () => {
  const d = wikiWithPage(
    `const a = <img src="https://example.com/x.png" />;\n` +
    `const b = <img src={someVar} />;\n` +
    `const c = <img src="relative.png" />;\n`);
  const r = run(d);
  assert.equal(r.code, 0, "only a rooted literal src is this gate's business:\n" + r.out);
  rmSync(d, { recursive: true, force: true });
});
