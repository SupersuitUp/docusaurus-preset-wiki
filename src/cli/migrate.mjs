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
//      literal. One that reads WIKI_PASSWORD is the wiki's OWN (the template never shipped a
//      password gate), so it is kept aside as middleware.pre-package.ts, the package gate is
//      written CLOSED (createPasswordGate({ machinePaths: 'gated' })) and a person is named to
//      reconcile the two. Anything else (Google identity, a member list) is LEFT ALONE and named,
//      because its verdict function has to be moved by a person into createMiddleware({ gate }).
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
import { ensurePrepare } from "./install-hooks.mjs";
import { isDirectRun } from "./is-direct-run.mjs";
import { MIGRATE_DELETES } from "./owned.mjs";
import { matcherSource } from "./matcher.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PKG = "@supersuit/docusaurus-preset-wiki";

export const OWNED_PATHS = MIGRATE_DELETES;
export const ABSORBED_DEPS = ["minisearch", "satori", "@resvg/resvg-js", "gray-matter", "glob", "remark", "strip-markdown", "@easyops-cn/docusaurus-search-local"];

const log = (m) => console.log(`[migrate] ${m}`);
const rel = (p) => join(ROOT, p);
const read = (p) => readFileSync(rel(p), "utf8");
function write(p, text) {
  if (DRY) { log(`would write ${p} (${text.length} chars)`); return; }
  writeFileSync(rel(p), text);
  log(`wrote ${p}`);
}

/** Which of the three shapes a pre-package middleware.ts is. `open` is the template's own file
 *  (bot-block and shares, no door) and may be replaced freely. `password` reads WIKI_PASSWORD, and
 *  the template never shipped that, so it was written by a person. `identity` carries a door the
 *  package has no equivalent for. Identity wins over password because such a file reads both. */
export function middlewareKind(text) {
  // The package's own account gate, carried as a mirror before the wiki was on the package.
  // Checked FIRST: until 1.13.0 such a file matched none of the patterns below, was called
  // `open`, and was replaced by the config middleware reading a gate block with no type, which
  // is the PASSWORD gate: a Freedom-account wiki came out of a clean-looking migration asking
  // readers for a password nobody had set (getfreedom-wiki, 2026-09-23, caught before deploy).
  if (/createFreedomAccountGate/.test(text)) return "account";
  if (/GOOGLE_OAUTH|GATE_IDENTITY|member/i.test(text)) return "identity";
  if (/WIKI_PASSWORD/.test(text)) return "password";
  return "open";
}

export function matcherLiteral(name) {
  return matcherSource(name);
}

const CONFIG_BLOCK = (name) => `// Vercel reads \`config\` STATICALLY from this file, so it cannot come from the package: a
// re-export is invisible to it and the middleware runs on every path, which on a gated wiki
// 401s its own og cards and manifest. The literal is the package's; \`wiki check middleware\`
// refuses a build where it drifts.
export const config = {
  matcher: [
    '${matcherLiteral(name)}',
  ],
  runtime: 'edge',
};
`;

export const OPEN_MIDDLEWARE = (name) => `// Vercel Routing Middleware: the family bot-block, the one-page share layer, and whatever gate
// wiki.config.json declares, all from the preset. With no \`gate\` block this is the family
// password gate, dark until WIKI_PASSWORD and WIKI_GATE_SECRET are set on the deployment
// (\`wiki gate set --password "<word>"\`); \`"gate": { "type": "freedom-account" }\` is the door
// for people running Freedom (\`wiki gate set --type freedom-account --pass-secret ...\`);
// \`"type": "none"\` is never gated. Changing the gate is a config edit, never an edit here.
import wiki from './wiki.config.json';
import { createMiddlewareFromConfig } from '${PKG}/middleware';

export default createMiddlewareFromConfig(wiki);

${CONFIG_BLOCK(name)}`;

export const PASSWORD_MIDDLEWARE = ({ machinePaths } = {}) => `// Vercel Routing Middleware: bot-block, one-page shares and the family password gate, all from
// the preset. The gate is dark until WIKI_PASSWORD and WIKI_GATE_SECRET are set on the deployment;
// set them with \`wiki gate set --password "<word>"\`. A preloaded link is <page>?key=<password>.
${machinePaths === "gated" ? `// machinePaths 'gated' puts .md, .txt, audio, video, .pdf and /llms.txt behind the same door as
// every page. 'open' serves them to anyone, which on a private wiki publishes the whole corpus
// as /llms-full.txt. Written closed by the migration because the gate it replaced was this
// wiki's own; open it only if that is what this wiki's content wants.
` : ""}// The gate is read from wiki.config.json (\`"gate": { "type": "password"${machinePaths ? `, "machinePaths": "${machinePaths}"` : ""} }\`);
// changing it is a config edit, never an edit here.
import wiki from './wiki.config.json';
import { createMiddlewareFromConfig } from '${PKG}/middleware';

export default createMiddlewareFromConfig(wiki);

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

/** What a mirrored account-gate middleware configured, as wiki.config.json `gate` fields plus the
 *  matcher variant it needs. Only literals are read: a value computed at runtime is left for the
 *  person the migration names. */
export function accountGateSettings(text) {
  const gate = { type: "freedom-account" };
  const sign = text.match(/signInUrl:\s*(['"`])([^'"`]+)\1/);
  if (sign) gate.signInUrl = sign[2];
  let open = text.match(/openPaths:\s*\/((?:\\\/|[^\/\n])+)\/[a-z]*/);
  if (!open) {
    const ref = text.match(/openPaths:\s*([A-Za-z_$][\w$]*)/);
    if (ref) open = text.match(new RegExp(`const\\s+${ref[1]}\\s*=\\s*\\/((?:\\\\\\/|[^\\/\\n])+)\\/[a-z]*`));
  }
  if (open) gate.openPaths = open[1].replace(/\\\//g, "/");
  // A matcher that does not skip `skills/` means /skills/* reached this gate on purpose: those
  // routes are gated pages here. The family matcher skips the prefix, which would publish them,
  // so the migration picks the variant that keeps them behind the door. Fails closed.
  const m = text.match(/matcher:\s*\[\s*(['"])(.*?)\1/s);
  const matcher = m && !m[2].includes("skills/") ? "skills-are-pages" : undefined;
  return { gate, matcher };
}

/** Every markdown tree a docs instance may read: `docs/` and any other top-level folder holding
 *  .md/.mdx (a plain-language mirror, a second docs instance). Until 1.13.0 only `docs/` was
 *  rewritten, so a wiki's `plain/` mirror kept importing components the migration had deleted. */
const NOT_DOCS = new Set(["node_modules", "build", ".docusaurus", ".git", ".claude", "static", "src", "scripts", "plugins", "illustrations", "templates", "review", ".vercel"]);
export function markdownTrees(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NOT_DOCS.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((d) => walk(join(root, d)).some((f) => /\.mdx?$/.test(f)))
    .sort();
}

/** The wiki's scripts after migration: a script is dropped only when its command runs something
 *  the migration deleted, so the wiki's OWN checks and tests survive (until 1.13.0 every key
 *  starting check/test/share/... went, which took getfreedom's 30 own checks with the template's).
 *  The prebuild keeps the commands that still have a file to run, after `wiki check`. */
export function migrateScripts(scripts, deleted = OWNED_PATHS) {
  const s = { ...scripts };
  const runsDeleted = (cmd) => deleted.some((p) => cmd.includes(p)) || /ts-resolve-(hooks|loader)/.test(cmd);
  const kept = [];
  for (const [k, v] of Object.entries(s)) {
    if (k === "prebuild") continue;
    if (runsDeleted(String(v))) delete s[k];
  }
  const ownPre = String(s.prebuild ?? "").split(/\s*&&\s*/).map((c) => c.trim()).filter(Boolean)
    .filter((c) => !runsDeleted(c) && c !== "wiki check");
  kept.push(...ownPre);
  delete s.prebuild;
  Object.assign(s, {
    prebuild: ["wiki check", ...ownPre].join(" && "),
    check: "wiki check", share: "wiki share", icons: "wiki icons", "optimize:images": "wiki optimize-images",
  });
  return { scripts: s, keptPrebuild: kept };
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
  const themeCopies = ["src/theme/DocItem", "src/theme/MDXComponents"].filter((p) => existsSync(rel(p)));
  if (themeCopies.length) warnings.push(`deleted ${themeCopies.join(" and ")}, the template's copies of what the package now ships. If this wiki had customised one, restore it with \`git checkout -- <path>\`: a file there shadows the package's, which is the supported override.`);
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
    const kind = middlewareKind(read("middleware.ts"));
    if (kind === "account") {
      const old = read("middleware.ts");
      const { gate, matcher } = accountGateSettings(old);
      if (!DRY) renameSync(rel("middleware.ts"), rel("middleware.pre-package.ts"));
      const cfg = JSON.parse(read("wiki.config.json"));
      cfg.gate = { ...(cfg.gate && typeof cfg.gate === "object" ? cfg.gate : {}), ...gate };
      if (matcher) cfg.matcher = matcher;
      write("wiki.config.json", JSON.stringify(cfg, null, 2) + "\n");
      write("middleware.ts", OPEN_MIDDLEWARE(matcher));
      warnings.push(`middleware.ts mirrored the package's Freedom-account gate; kept as middleware.pre-package.ts. wiki.config.json now declares gate ${JSON.stringify(cfg.gate)}${matcher ? ` and the "${matcher}" matcher, because the old matcher let /skills/ reach the gate` : ""}. Check those against the kept file (anything computed rather than literal was not carried), then delete it and any src/gate or src/analytics mirror.`);
    } else if (kind === "identity") warnings.push("middleware.ts has a gate of its own (identity or a member list). Left untouched: move its verdict into `async function gate(request): Promise<GateVerdict>` and export createMiddleware({ gate }) plus the matcher literal (see the package README).");
    else if (kind === "password") {
      // A person wrote this gate: the template never shipped one. Until 1.5.0 it was overwritten
      // with the package default, whose machine paths are OPEN, and a private wiki whose own gate
      // covered .md and .txt came out of a SUCCESSFUL migration serving /llms-full.txt to anyone
      // holding the URL, with every live check green because they ask about the home page
      // (ContinentalWorks/freedom#159, 2026-09-17). So: keep theirs, write ours closed, exit 3.
      if (!DRY) renameSync(rel("middleware.ts"), rel("middleware.pre-package.ts"));
      write("middleware.ts", PASSWORD_MIDDLEWARE({ machinePaths: "gated" }));
      // The middleware reads its gate from wiki.config.json, so the closed setting has to be
      // written THERE; the comment in middleware.ts only says where to look.
      const cfgPath = rel("wiki.config.json");
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(read("wiki.config.json"));
        cfg.gate = { ...(cfg.gate && typeof cfg.gate === "object" ? cfg.gate : {}), type: "password", machinePaths: "gated" };
        write("wiki.config.json", JSON.stringify(cfg, null, 2) + "\n");
      }
      warnings.push("middleware.ts was this wiki's own password gate; kept as middleware.pre-package.ts. The package gate is written CLOSED (wiki.config.json gate: { type: 'password', machinePaths: 'gated' }): .md, .txt, audio and /llms-full.txt answer 401 without the key. If this wiki's machine paths were open on purpose, change machinePaths to 'open' in wiki.config.json; if your gate carried anything else (an allowlist, a second door), carry it into createMiddleware({ gate }). Then delete the kept file and commit both by name.");
    } else write("middleware.ts", OPEN_MIDDLEWARE());
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
  for (const tree of markdownTrees(ROOT)) {
    for (const f of walk(rel(tree))) {
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
  const { scripts: s, keptPrebuild } = migrateScripts(pkg.scripts ?? {});
  pkg.scripts = s;
  if (keptPrebuild.length) warnings.push(`the prebuild kept this wiki's own steps after \`wiki check\`: ${keptPrebuild.join(" ; ")}. Each still has its file; confirm none duplicates a \`wiki check\` step.`);
  ensurePrepare(pkg);
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

if (isDirectRun(import.meta.url)) process.exit(migrate());
