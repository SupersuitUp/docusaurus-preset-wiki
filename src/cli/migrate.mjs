#!/usr/bin/env node
// Move a wiki that carries the framework as COPIED FILES (wiki-template v1.x) onto the package.
// This is wiki-template's v2.0.0 upgrade-ledger remedy as code, so 25 wikis do not each get it
// by hand, and so the parts that are mechanical stop being a place to make a mistake.
//
//   wiki migrate [--dry-run] [--no-install] [--no-build]
//
// What it does, in the wiki root:
//   1. deletes every path the package owns (the same list `wiki check owned-files` refuses)
//   2. writes docusaurus.config.ts as the three-line defineWikiConfig form. If the wiki's config
//      had grown past the template (navbar items, extra plugins), the OLD file is kept beside it as
//      docusaurus.config.pre-package.ts and the differences are printed, because those are per-wiki
//      choices a script must not guess at; carry them into defineWikiConfig's second argument.
//   3. middleware.ts: a template-identical open middleware becomes the re-export plus the matcher
//      literal; one that reads WIKI_PASSWORD becomes createMiddleware({ gate: createPasswordGate() });
//      anything else (Google identity, a member list) is LEFT ALONE and named, because its verdict
//      function is the wiki's own and has to be moved by a person into createMiddleware({ gate }).
//   4. src/css/custom.css keeps only the brand tokens: the :root block at the top and everything
//      from the "Dark mode" section to the end. The layout sections between them are the package's.
//   5. docs: @site/src/components/<X> imports become @theme/<X>.
//   6. package.json: the package dependency is added, the seven libraries it absorbed are removed,
//      the scripts become `wiki check` / `wiki share` / `wiki icons` / `wiki optimize-images`;
//      wiki.config.json's $schema points at the package's schema.
//   7. installs (pnpm or npm, by lockfile) and builds unless told not to; `wiki check` runs in
//      the prebuild and refuses if anything the package owns is still here.
//
// It never commits and never pushes. Read the diff, run the live checks, then commit by explicit
// paths. A wiki with the package already in package.json is refused: use `wiki upgrade`.
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PKG = "@supersuit/docusaurus-preset-wiki";

export const OWNED_PATHS = [
  "plugins/search-plugin", "plugins/creation-date-plugin", "plugins/og-image-plugin",
  "plugins/manifest-plugin", "plugins/share-view-plugin",
  "src/components/ShareButton.tsx", "src/components/PageDates.tsx",
  "src/components/Changelog.tsx", "src/components/ChangelogWidget.tsx",
  "src/theme/DocItem", "src/theme/MDXComponents", "src/share",
  "scripts/check-links.mjs", "scripts/check-image-weight.mjs", "scripts/check-image-provenance.mjs",
  "scripts/check-admonitions.mjs", "scripts/unlock-link.mjs", "scripts/unlock-link.test.mjs",
  "scripts/generate-llms-txt.sh", "scripts/llms-txt-env.mjs", "scripts/test-image-provenance.mjs",
  "scripts/ts-resolve-hooks.mjs", "scripts/ts-resolve-loader.mjs",
  "scripts/build-icons.py", "scripts/optimize-images.py",
  "scripts/check-template-version.mjs", "scripts/check-template-version.test.mjs", "scripts/bump.sh",
  "TEMPLATE-VERSION", "wiki.config.schema.json",
];
export const ABSORBED_DEPS = ["minisearch", "satori", "@resvg/resvg-js", "gray-matter", "glob", "remark", "strip-markdown", "@easyops-cn/docusaurus-search-local"];

const log = (m) => console.log(`[migrate] ${m}`);
const rel = (p) => join(ROOT, p);
const read = (p) => readFileSync(rel(p), "utf8");
function write(p, text) {
  if (DRY) { log(`would write ${p} (${text.length} chars)`); return; }
  writeFileSync(rel(p), text);
  log(`wrote ${p}`);
}

export function matcherLiteral() {
  const { matcher } = JSON.parse(readFileSync(join(HERE, "matcher.json"), "utf8"));
  return matcher[0].replace(/\\/g, "\\\\");
}

const CONFIG_BLOCK = () => `// Vercel reads \`config\` STATICALLY from this file, so it cannot come from the package: a
// re-export is invisible to it and the middleware runs on every path, which on a gated wiki
// 401s its own og cards and manifest. The literal is the package's; \`wiki check middleware\`
// refuses a build where it drifts.
export const config = {
  matcher: [
    '${matcherLiteral()}',
  ],
  runtime: 'edge',
};
`;

export const OPEN_MIDDLEWARE = () => `// Vercel Routing Middleware for an OPEN wiki: the family bot-block and the one-page share
// layer, from the preset. A gated wiki: createMiddleware({ gate: createPasswordGate() }).
export { default } from '${PKG}/middleware';

${CONFIG_BLOCK()}`;

export const PASSWORD_MIDDLEWARE = () => `// Vercel Routing Middleware: bot-block, one-page shares and the family password gate, all from
// the preset. The gate is dark until WIKI_PASSWORD and WIKI_GATE_SECRET are set on the deployment;
// set them with \`wiki gate set --password "<word>"\`. A preloaded link is <page>?key=<password>.
import { createMiddleware, createPasswordGate } from '${PKG}/middleware';

export default createMiddleware({ gate: createPasswordGate() });

${CONFIG_BLOCK()}`;

export const DOCUSAURUS_CONFIG = `import wiki from './wiki.config.json';
import { defineWikiConfig } from '${PKG}';

// Everything a family wiki shares lives in the preset. Per-wiki additions go in the
// second argument: themeConfig deep-merges onto the defaults, any other key replaces its default.
export default defineWikiConfig(wiki);
`;

/** Keep the brand tokens, drop the layout: the :root block at the top, then from the Dark mode
 *  section header to the end. Returns null when the file does not have that shape. */
export function tokensOnly(css) {
  const rootStart = css.indexOf(":root");
  const firstSection = css.indexOf("/* ====", rootStart);
  const dark = css.search(/\/\* =+\n\s*Dark mode/);
  if (rootStart === -1 || firstSection === -1 || dark === -1 || dark < firstSection) return null;
  const head = css.slice(0, firstSection).trimEnd();
  const tail = css.slice(dark);
  return `${head}

/* Layout, typography and component styling come from ${PKG} (its theme/wiki.css) and read the
   variables above. Below: the dark-mode tokens and overrides, which are brand and stay per wiki. */

${tail}`;
}

/** Was this config the template's, give or take whitespace? Compared by the lines that carry
 *  per-wiki intent: navbar items, footer links, plugins beyond the template's five. */
export function configCustomisations(ts) {
  const notes = [];
  const items = ts.match(/items:\s*\[([^\]]*)\]/g) || [];
  if (items.some((m) => m.replace(/\s/g, "") !== "items:[]")) notes.push("navbar or footer items are not empty");
  const plugins = (ts.match(/'\.\/plugins\/[^']+'/g) || []).map((s) => s.replace(/'\.\/plugins\//, "").replace(/'$/, ""));
  const extra = plugins.filter((p) => !["search-plugin", "creation-date-plugin", "og-image-plugin", "manifest-plugin", "share-view-plugin"].includes(p));
  if (extra.length) notes.push(`plugins of its own: ${extra.join(", ")}`);
  if (/@docusaurus\/plugin-client-redirects|redirects/.test(ts)) notes.push("redirects configured");
  if (/logo:\s*\{/.test(ts)) notes.push("a navbar logo");
  if (/routeBasePath:\s*'(?!\/')/.test(ts)) notes.push("a non-root docs routeBasePath");
  return notes;
}

export function rewriteDocsImports(text) {
  return text
    .replace(/@site\/src\/components\/ChangelogWidget/g, "@theme/ChangelogWidget")
    .replace(/@site\/src\/components\/Changelog(?=['"])/g, "@theme/Changelog")
    .replace(/@site\/src\/components\/ShareButton/g, "@theme/ShareButton")
    .replace(/@site\/src\/components\/PageDates/g, "@theme/PageDates");
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function run(cmd, cmdArgs) {
  log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  if (DRY) return 0;
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit" });
  return r.status ?? 1;
}

export function migrate() {
  const pkgPath = rel("package.json");
  if (!existsSync(pkgPath) || !existsSync(rel("wiki.config.json"))) { console.error("[migrate] run this in a wiki root (package.json and wiki.config.json)"); return 2; }
  const pkg = JSON.parse(read("package.json"));
  if (pkg.dependencies?.[PKG]) { console.error(`[migrate] ${PKG} is already a dependency; use \`wiki upgrade\``); return 2; }
  const warnings = [];

  // 1. owned paths
  for (const p of OWNED_PATHS) {
    if (!existsSync(rel(p))) continue;
    if (DRY) { log(`would delete ${p}`); continue; }
    rmSync(rel(p), { recursive: true, force: true });
    log(`deleted ${p}`);
  }
  for (const dir of ["plugins", "src/components", "src/theme", "src/share"]) {
    if (existsSync(rel(dir)) && readdirSync(rel(dir)).length === 0 && !DRY) rmSync(rel(dir), { recursive: true });
  }
  if (existsSync(rel("plugins"))) warnings.push(`plugins/ still holds ${readdirSync(rel("plugins")).join(", ")}: this wiki's own; register them in defineWikiConfig's second argument (plugins: [...])`);

  // 2. docusaurus.config.ts
  if (existsSync(rel("docusaurus.config.ts"))) {
    const old = read("docusaurus.config.ts");
    const notes = configCustomisations(old);
    if (notes.length) {
      if (!DRY) renameSync(rel("docusaurus.config.ts"), rel("docusaurus.config.pre-package.ts"));
      warnings.push(`docusaurus.config.ts had per-wiki choices (${notes.join("; ")}); kept as docusaurus.config.pre-package.ts. Carry them into defineWikiConfig(wiki, { ... }) and delete that file.`);
    }
  }
  write("docusaurus.config.ts", DOCUSAURUS_CONFIG);

  // 3. middleware.ts
  if (existsSync(rel("middleware.ts"))) {
    const mw = read("middleware.ts");
    const hasGate = /WIKI_PASSWORD/.test(mw);
    const hasIdentity = /GOOGLE_OAUTH|GATE_IDENTITY|member/i.test(mw);
    if (hasIdentity) warnings.push("middleware.ts has a gate of its own (identity or a member list). Left untouched: move its verdict into `async function gate(request): Promise<GateVerdict>` and export createMiddleware({ gate }) plus the matcher literal (see the package README).");
    else write("middleware.ts", hasGate ? PASSWORD_MIDDLEWARE() : OPEN_MIDDLEWARE());
  } else {
    write("middleware.ts", OPEN_MIDDLEWARE());
  }

  // 4. custom.css
  if (existsSync(rel("src/css/custom.css"))) {
    const css = read("src/css/custom.css");
    const kept = tokensOnly(css);
    if (kept) write("src/css/custom.css", kept);
    else warnings.push("src/css/custom.css is not in the template's shape (no :root block followed by sections and a Dark mode section); left as is. Remove the layout sections the package now ships, keep the tokens.");
  }

  // 5. docs imports
  let rewritten = 0;
  if (existsSync(rel("docs"))) {
    for (const f of walk(rel("docs"))) {
      if (!/\.mdx?$/.test(f)) continue;
      const t = readFileSync(f, "utf8"); const n = rewriteDocsImports(t);
      if (n !== t) { rewritten += 1; if (!DRY) writeFileSync(f, n); }
    }
  }
  if (rewritten) log(`rewrote @site/src/components imports in ${rewritten} doc(s)`);

  // 6. package.json and $schema
  const deps = pkg.dependencies ?? {};
  for (const d of ABSORBED_DEPS) delete deps[d];
  deps[PKG] = args.find((a, i) => args[i - 1] === "--version") ? `^${args[args.indexOf("--version") + 1]}` : "^1.0.0";
  pkg.dependencies = Object.fromEntries(Object.entries(deps).sort());
  const s = pkg.scripts ?? {};
  for (const k of Object.keys(s)) if (/^(check|test|template|share|optimize|accept|icons)/.test(k)) delete s[k];
  Object.assign(s, { prebuild: "wiki check", check: "wiki check", share: "wiki share", icons: "wiki icons", "optimize:images": "wiki optimize-images" });
  pkg.scripts = s;
  write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const wc = JSON.parse(read("wiki.config.json"));
  wc.$schema = `./node_modules/${PKG}/wiki.config.schema.json`;
  write("wiki.config.json", JSON.stringify(wc, null, 2) + "\n");
  if (existsSync(rel("renovate.json")) === false) {
    write("renovate.json", JSON.stringify({ $schema: "https://docs.renovatebot.com/renovate-schema.json", extends: ["config:recommended"], packageRules: [{ description: "The framework. A bump PR here is the upgrade; read the package CHANGELOG before merging a major.", matchPackageNames: [PKG], automerge: false, labels: ["framework"] }] }, null, 2) + "\n");
  }

  // 7. install and build
  const pm = existsSync(rel("pnpm-lock.yaml")) ? "pnpm" : "npm";
  if (!args.includes("--no-install")) {
    const extra = pm === "pnpm" ? ["--config.minimum-release-age=0"] : [];
    if (run(pm, ["install", ...extra]) !== 0) { console.error("[migrate] install failed"); return 1; }
  }
  if (!args.includes("--no-build") && !DRY) {
    if (run(pm, ["run", "build"]) !== 0) { console.error("[migrate] build failed; read the errors above"); return 1; }
  }

  console.log("");
  for (const w of warnings) console.log(`[migrate] NEEDS A PERSON: ${w}`);
  log(`done${DRY ? " (dry run, nothing written)" : ""}. Next: read the diff, commit by explicit paths, push, then \`wiki gate status\` (gated) or the live checks on the deployed site.`);
  return warnings.length ? 3 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(migrate());
