# Wiki Preset Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every framework file `wiki-template` v1.1.3 ships as a copy into one npm package, `@supersuit/docusaurus-preset-wiki`, so a wiki instance is config + docs + brand tokens and a framework update is a version bump.

**Architecture:** One package exporting (a) a Docusaurus preset (five plugins + one theme plugin carrying every component and the framework CSS), (b) `defineWikiConfig(wiki, overrides?)` which builds the whole Docusaurus `Config` from `wiki.config.json` so an instance's `docusaurus.config.ts` is three lines, (c) an edge-safe `./middleware` entry with `createMiddleware({ gate })`, and (d) a `wiki` CLI bin carrying the build checks and the share CLI. Compiled by `tsc` to CommonJS in `lib/`, the way `@docusaurus/theme-classic` ships; `src/theme` also ships for `swizzle --typescript`.

**Tech Stack:** TypeScript 5/6, Docusaurus 3.10.1 (peer), React 19 (peer), MiniSearch, satori + resvg, gray-matter, glob, remark. Tests with `node --test` via `tsx`. Source of the moved code: `~/Documents/github-repos/supersuit-repos/wiki-template` at tag v1.1.3 (`git -C <template> rev-parse v1.1.3` before starting; do not copy from a dirty tree).

**Spec:** `~/Documents/github-repos/garys-freedom/projects/2026-09-13-wiki-framework-as-a-package/documents/2026-09-13-094502-wiki-preset-package-design.md`

## Global Constraints

- Package name `@supersuit/docusaurus-preset-wiki`; if the `@supersuit` npm scope is taken at publish time, `@supersuitup/docusaurus-preset-wiki`, and the rename is a find-and-replace across this repo plus the instances already migrated.
- Peer deps `@docusaurus/core` and `@docusaurus/preset-classic` at `^3.10.1`; `react` and `react-dom` at `^19.0.0`.
- `lib/middleware.js` imports no Node built-in (no `fs`, `path`, `crypto` module import; Web Crypto via `globalThis.crypto` only). Vercel's edge bundler refuses otherwise.
- No file under `src/` imports `@site/...`. Package-internal imports are relative.
- Every moved test moves in the same task as its code and passes before the commit.
- Behaviour parity is the bar: the retargeted template's `build/` must match its pre-migration `build/` except for hashed asset filenames. Task 8 measures this.
- Commit messages carry no Co-Authored-By or "Generated with" trailer (workspace rule).
- Never `git add -A`; stage named paths.

---

## File structure of the package

```
docusaurus-preset-wiki/
  package.json
  tsconfig.json                 tsc -> lib/, CommonJS, jsx react
  wiki.config.schema.json       moved verbatim from the template
  src/
    index.ts                    default export = preset; named exports defineWikiConfig, WikiConfig
    config.ts                   readWikiConfig(siteDir, options) + WikiConfig type
    define-config.ts            defineWikiConfig(wiki, overrides?) -> Config
    plugins/
      search/index.ts, build-index.ts, engine.ts
      creation-date/index.ts, collect.ts
      og-image/index.ts, fonts/Inter-Bold.ttf, fonts/Inter-Regular.ttf
      manifest/index.ts         (today plugins/manifest-plugin/index.js, converted to TS)
      share-view/index.ts, focus.ts, focus.test.ts
    theme/
      index.ts                  the theme plugin: getThemePath, getTypeScriptThemePath, getClientModules
      wiki.css                  template custom.css lines 41-400 (structure), NOT the brand tokens
      SearchBar/index.tsx, styles.module.css
      SearchModal/index.tsx, styles.module.css
      DocItem/Content/index.tsx
      MDXComponents/A/index.tsx
      ShareButton/index.tsx
      PageDates/index.tsx
      Changelog/index.tsx
      ChangelogWidget/index.tsx
    share/
      signedRoute.ts (+test), handleShare.ts (+test), mintAndCopy.ts (+test)
    middleware.ts               createMiddleware, UNFURL_BOT_PATTERN, BLOCKED_BOT_PATTERN, MATCHER
    cli/
      wiki.mjs                  dispatcher
      check-admonitions.mjs, check-links.mjs, check-image-weight.mjs, check-image-provenance.mjs
      llms-txt.mjs (+ generate-llms-txt.sh), unlock-link.mjs (+test), test-image-provenance.mjs
      image-exempt-cases.default.json
      python/build-icons.py, python/optimize-images.py
  scripts/
    copy-assets.mjs             copies .css, .ttf, .sh, .py, .json from src/ into lib/ after tsc
  test/
    fixture-site/               a minimal instance depending on the package by file:
    build-fixture.test.mjs      builds it, asserts the outputs
  CHANGELOG.md                  the template's UPGRADE-LEDGER entries carried in as history, then package versions
  README.md
```

---

### Task 1: Package skeleton that builds an empty preset

**Files:**
- Create: `package.json`, `tsconfig.json`, `scripts/copy-assets.mjs`, `src/index.ts`, `src/config.ts`, `.gitignore`, `.npmignore`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces: `WikiConfig` type; `readWikiConfig(siteDir: string, options?: Partial<WikiConfig>): WikiConfig` (options win, `<siteDir>/wiki.config.json` fills the rest, throws naming the missing required field); preset default export `(context, options) => { plugins: [], themes: [] }` for now.

- [ ] **Step 1: package.json**

```json
{
  "name": "@supersuit/docusaurus-preset-wiki",
  "version": "0.1.0",
  "description": "The bones of every wiki in the Supersuit family, as one Docusaurus preset.",
  "license": "MIT",
  "repository": "github:SupersuitUp/docusaurus-preset-wiki",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./middleware": { "types": "./lib/middleware.d.ts", "default": "./lib/middleware.js" },
    "./wiki.config.schema.json": "./wiki.config.schema.json",
    "./package.json": "./package.json"
  },
  "bin": { "wiki": "lib/cli/wiki.mjs" },
  "files": ["lib", "src", "wiki.config.schema.json", "README.md", "CHANGELOG.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-assets.mjs",
    "test": "node --import tsx --test 'src/**/*.test.ts' 'src/**/*.test.mjs'",
    "test:fixture": "node --test test/build-fixture.test.mjs",
    "prepack": "npm run build"
  },
  "peerDependencies": {
    "@docusaurus/core": "^3.10.1",
    "@docusaurus/preset-classic": "^3.10.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "@resvg/resvg-js": "^2.6.2",
    "glob": "^13.0.6",
    "gray-matter": "^4.0.3",
    "minisearch": "^7.2.0",
    "remark": "^15.0.1",
    "satori": "^0.26.0",
    "strip-markdown": "^6.0.0"
  },
  "devDependencies": {
    "@docusaurus/core": "3.10.1",
    "@docusaurus/module-type-aliases": "3.10.1",
    "@docusaurus/preset-classic": "3.10.1",
    "@docusaurus/tsconfig": "3.10.1",
    "@docusaurus/types": "3.10.1",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "prism-react-renderer": "^2.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tsx": "^4.19.0",
    "typescript": "~5.9.0"
  }
}
```

`prism-react-renderer` is a devDependency here and a peer in practice: `defineWikiConfig` imports its themes. Add it to `peerDependencies` too (`"prism-react-renderer": "^2.3.0"`); the template already depends on it.

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "@docusaurus/tsconfig",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "es2022",
    "jsx": "react",
    "declaration": true,
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "@docusaurus/module-type-aliases", "@docusaurus/theme-classic"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/cli/**/*.mjs", "src/cli/python", "lib", "test"]
}
```

`.mjs` files under `src/cli` are not compiled; `copy-assets.mjs` copies them as-is.

- [ ] **Step 3: scripts/copy-assets.mjs**

```js
// tsc emits only .js/.d.ts. Everything else a component or CLI needs beside it
// (CSS modules, fonts, the llms shell script, the python tools, JSON defaults,
// the untranspiled .mjs CLI files) is copied here so lib/ is complete on its own.
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const KEEP = /\.(css|ttf|sh|py|json|mjs)$/;
const SRC = 'src';
const OUT = 'lib';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let n = 0;
for (const file of walk(SRC)) {
  if (!KEEP.test(file) || /\.test\.mjs$/.test(file)) continue;
  const dest = join(OUT, relative(SRC, file));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
  n += 1;
}
console.log(`[copy-assets] ${n} files copied into ${OUT}/`);
```

- [ ] **Step 4: Write the failing config test** `src/config.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWikiConfig } from './config';

const BASE = {
  title: 'T', tagline: 'tag', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
  copyright: 'c', noindex: true, description: 'd',
};

test('reads wiki.config.json from siteDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  writeFileSync(join(dir, 'wiki.config.json'), JSON.stringify(BASE));
  assert.equal(readWikiConfig(dir).title, 'T');
});

test('options win over the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  writeFileSync(join(dir, 'wiki.config.json'), JSON.stringify(BASE));
  assert.equal(readWikiConfig(dir, { title: 'Override' }).title, 'Override');
});

test('a missing required field is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  const { url, ...rest } = BASE;
  writeFileSync(join(dir, 'wiki.config.json'), JSON.stringify(rest));
  assert.throws(() => readWikiConfig(dir), /wiki\.config\.json.*"url"/);
});

test('no file and no options is an error, not an empty config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  assert.throws(() => readWikiConfig(dir), /wiki\.config\.json/);
});
```

- [ ] **Step 5: Run it, expect failure** — `npm install && npm test` → fails: cannot find `./config`.

- [ ] **Step 6: src/config.ts**

```ts
import * as fs from 'fs';
import * as path from 'path';

export interface WikiConfig {
  title: string;
  tagline: string;
  url: string;
  organizationName: string;
  projectName: string;
  copyright: string;
  noindex: boolean;
  description: string;
  gate?: { unlockParam?: string | null };
  og?: { bg?: string; accent?: string; text?: string; muted?: string };
  intake_mode?: 'source-grounded' | 'authored-canon';
  skill_prefix?: string;
  hero_register?: Record<string, unknown>;
  $schema?: string;
}

const REQUIRED: (keyof WikiConfig)[] = [
  'title', 'tagline', 'url', 'organizationName', 'projectName', 'copyright', 'noindex', 'description',
];

/** Options passed to the preset win; `<siteDir>/wiki.config.json` fills the rest. */
export function readWikiConfig(siteDir: string, options: Partial<WikiConfig> = {}): WikiConfig {
  const file = path.join(siteDir, 'wiki.config.json');
  let fromFile: Partial<WikiConfig> = {};
  if (fs.existsSync(file)) {
    fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (Object.keys(options).length === 0) {
    throw new Error(`No wiki.config.json at ${file} and no preset options given.`);
  }
  const merged = { ...fromFile, ...options } as Partial<WikiConfig>;
  for (const key of REQUIRED) {
    if (merged[key] === undefined) {
      throw new Error(`wiki.config.json is missing required field "${key}" (looked in ${file} and preset options).`);
    }
  }
  return merged as WikiConfig;
}
```

- [ ] **Step 7: src/index.ts (empty preset for now)**

```ts
import type { LoadContext } from '@docusaurus/types';
import { readWikiConfig, type WikiConfig } from './config';

export type { WikiConfig };
export { readWikiConfig };

export default function wikiPreset(context: LoadContext, options: Partial<WikiConfig> = {}) {
  const wiki = readWikiConfig(context.siteDir, options);
  void wiki;
  return { plugins: [], themes: [] };
}
```

- [ ] **Step 8: Run tests and build** — `npm test` → 4 pass. `npm run build` → `lib/index.js`, `lib/config.js` exist.

- [ ] **Step 9: .gitignore / .npmignore / commit**

`.gitignore`: `node_modules/`, `lib/`, `test/fixture-site/node_modules/`, `test/fixture-site/build/`, `test/fixture-site/.docusaurus/`, `test/fixture-site/static/search-index.json`, `test/fixture-site/static/llms*.txt`.

```bash
git add package.json package-lock.json tsconfig.json scripts/copy-assets.mjs src/index.ts src/config.ts src/config.test.ts .gitignore docs/superpowers/plans/2026-09-13-wiki-preset-extraction.md
git commit -m "Scaffold the preset package: config reader, tsc build, empty preset"
```

---

### Task 2: Move the five plugins

**Files:**
- Create: `src/plugins/search/{index,build-index,engine}.ts`, `src/plugins/creation-date/{index,collect}.ts`, `src/plugins/og-image/index.ts` + `fonts/`, `src/plugins/manifest/index.ts`, `src/plugins/share-view/{index,focus,focus.test}.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `readWikiConfig`, `WikiConfig` from Task 1.
- Produces: each plugin is `default function (context: LoadContext, options) => Plugin`. `searchPlugin` no longer has `getThemePath` (the theme plugin in Task 3 serves SearchBar/SearchModal). `ogImagePlugin(context, options: OgImageOptions)`. `manifestPlugin(context, { bg?: string })`.

- [ ] **Step 1: Copy verbatim from the template tag**

```bash
T=~/Documents/github-repos/supersuit-repos/wiki-template
git -C "$T" rev-parse v1.1.3   # must print a sha; abort if not
mkdir -p src/plugins/{search,creation-date,og-image/fonts,manifest,share-view}
for f in index build-index engine; do git -C "$T" show v1.1.3:plugins/search-plugin/src/$f.ts > src/plugins/search/$f.ts; done
for f in index collect; do git -C "$T" show v1.1.3:plugins/creation-date-plugin/src/$f.ts > src/plugins/creation-date/$f.ts; done
git -C "$T" show v1.1.3:plugins/og-image-plugin/src/index.ts > src/plugins/og-image/index.ts
for f in Inter-Bold Inter-Regular; do git -C "$T" show v1.1.3:plugins/og-image-plugin/fonts/$f.ttf > src/plugins/og-image/fonts/$f.ttf; done
git -C "$T" show v1.1.3:plugins/manifest-plugin/index.js > src/plugins/manifest/index.ts
for f in index focus focus.test; do git -C "$T" show v1.1.3:plugins/share-view-plugin/src/$f.ts > src/plugins/share-view/$f.ts; done
```

- [ ] **Step 2: Edit the search plugin** — delete the `getThemePath()` method (lines `getThemePath() { return path.resolve(__dirname, './theme'); },`). Nothing else changes.

- [ ] **Step 3: Convert the manifest plugin to TypeScript.** Replace `module.exports = function manifestPlugin(context) {` with:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { LoadContext, Plugin } from '@docusaurus/types';

export interface ManifestOptions { bg?: string }

export default function manifestPlugin(context: LoadContext, options: ManifestOptions = {}): Plugin<void> {
  const title = context.siteConfig.title;
  const bg = options.bg || '#ffffff';
```

Delete the three lines that read `wiki.config.json` (`const wikiPath = ...`, `const wiki = ...`, `const og = wiki.og ?? {}`). Keep the body. Type the `postBuild` destructure as `({ outDir }: { outDir: string })`.

- [ ] **Step 4: share-view reads title from options, file as fallback.** Change `shareViewPlugin(context: LoadContext)` to `shareViewPlugin(context: LoadContext, options: { title?: string } = {})` and the postBuild line to `const title = options.title ?? await siteTitle(context.siteDir, context.siteConfig.title);`.

- [ ] **Step 5: og-image: fonts path.** The plugin reads fonts with `path.join(__dirname, '../fonts', ...)` today (check with `grep -n fonts src/plugins/og-image/index.ts`). The fonts now sit at `src/plugins/og-image/fonts/` next to `index.ts`, so change that to `path.join(__dirname, 'fonts', ...)`. `copy-assets.mjs` copies `.ttf` into `lib/plugins/og-image/fonts/`.

- [ ] **Step 6: Wire the plugins into the preset** in `src/index.ts`:

```ts
import type { LoadContext, PluginModule } from '@docusaurus/types';
import { readWikiConfig, type WikiConfig } from './config';
import searchPlugin from './plugins/search';
import creationDatePlugin from './plugins/creation-date';
import ogImagePlugin from './plugins/og-image';
import manifestPlugin from './plugins/manifest';
import shareViewPlugin from './plugins/share-view';

export type { WikiConfig };
export { readWikiConfig };

export default function wikiPreset(context: LoadContext, options: Partial<WikiConfig> = {}) {
  const wiki = readWikiConfig(context.siteDir, options);
  return {
    plugins: [
      searchPlugin as PluginModule,
      creationDatePlugin as PluginModule,
      [manifestPlugin as PluginModule, { bg: wiki.og?.bg }],
      [ogImagePlugin as PluginModule, wiki.og ?? {}],
      [shareViewPlugin as PluginModule, { title: wiki.title }],
    ],
    themes: [],
  };
}
```

- [ ] **Step 7: Run** `npm test` (focus.test.ts now runs: expect its 4+ cases to pass) and `npm run build` (tsc clean; fix any `implicit any` the JS→TS conversion surfaces).

- [ ] **Step 8: Commit**

```bash
git add src/plugins src/index.ts
git commit -m "Move the five template plugins into the preset"
```

---

### Task 3: The theme plugin: components and framework CSS

**Files:**
- Create: `src/theme/index.ts`, `src/theme/wiki.css`, `src/theme/SearchBar/*`, `src/theme/SearchModal/*`, `src/theme/DocItem/Content/index.tsx`, `src/theme/MDXComponents/A/index.tsx`, `src/theme/ShareButton/index.tsx`, `src/theme/PageDates/index.tsx`, `src/theme/Changelog/index.tsx`, `src/theme/ChangelogWidget/index.tsx`, `src/share/{signedRoute,handleShare,mintAndCopy}.ts` + their three tests
- Modify: `src/index.ts`

**Interfaces:**
- Produces: theme plugin `wikiTheme(context) => Plugin` with `getThemePath() → lib/theme`, `getTypeScriptThemePath() → src/theme`, `getClientModules() → [lib/theme/wiki.css]`. Components importable in instances as `@theme/ShareButton`, `@theme/PageDates`, `@theme/Changelog`, `@theme/ChangelogWidget`.

- [ ] **Step 1: Copy**

```bash
T=~/Documents/github-repos/supersuit-repos/wiki-template
mkdir -p src/theme/{SearchBar,SearchModal,DocItem/Content,MDXComponents/A,ShareButton,PageDates,Changelog,ChangelogWidget} src/share
for c in SearchBar SearchModal; do
  git -C "$T" show v1.1.3:plugins/search-plugin/src/theme/$c/index.tsx > src/theme/$c/index.tsx
  git -C "$T" show v1.1.3:plugins/search-plugin/src/theme/$c/styles.module.css > src/theme/$c/styles.module.css
done
git -C "$T" show v1.1.3:src/theme/DocItem/Content/index.tsx > src/theme/DocItem/Content/index.tsx
git -C "$T" show v1.1.3:src/theme/MDXComponents/A/index.tsx > src/theme/MDXComponents/A/index.tsx
for c in ShareButton PageDates Changelog ChangelogWidget; do git -C "$T" show v1.1.3:src/components/$c.tsx > src/theme/$c/index.tsx; done
for f in signedRoute handleShare mintAndCopy; do
  git -C "$T" show v1.1.3:src/share/$f.ts > src/share/$f.ts
  git -C "$T" show v1.1.3:src/share/$f.test.ts > src/share/$f.test.ts
done
git -C "$T" show v1.1.3:src/css/custom.css | sed -n '41,400p' > src/theme/wiki.css
```

- [ ] **Step 2: Rewrite the three `@site` imports**

- `src/theme/DocItem/Content/index.tsx`: `'@site/src/components/ShareButton'` → `'@theme/ShareButton'`; `'@site/src/components/PageDates'` → `'@theme/PageDates'`.
- `src/theme/ShareButton/index.tsx`: `'@site/src/share/mintAndCopy'` → `'../../share/mintAndCopy'`.
- `src/theme/Changelog/index.tsx` imports `'./ChangelogWidget'` today; it becomes `'@theme/ChangelogWidget'`.
- `src/theme/SearchModal/index.tsx` imports the engine from `'../../engine'` today (check with `grep -n engine`); it becomes `'../../plugins/search/engine'`.

Verify: `grep -rn "@site" src/` prints nothing.

- [ ] **Step 3: Check the CSS split.** `src/theme/wiki.css` must contain no `:root` and no `[data-theme='dark']` variable block (those are the brand tokens and stay in the instance). `grep -n "^:root\|data-theme" src/theme/wiki.css` should print only selectors that *use* variables inside sections (e.g. `[data-theme='dark'] .foo`), never a block that *defines* `--ifm-color-primary`. If lines 41–400 cut a section mid-way, adjust the `sed` range to the section boundaries (`/* ====` comment lines) and record the final range here.

- [ ] **Step 4: src/theme/index.ts**

```ts
import * as path from 'path';
import type { LoadContext, Plugin } from '@docusaurus/types';

// Every component the family wiki ships, and the CSS that lays a wiki out.
// Resolution order is the site's own src/theme, then this, then theme-classic,
// so an instance overrides one component by putting a file in its src/theme.
export default function wikiTheme(_context: LoadContext): Plugin<void> {
  return {
    name: 'supersuit-wiki-theme',
    getThemePath() {
      return path.resolve(__dirname, './');
    },
    getTypeScriptThemePath() {
      return path.resolve(__dirname, '../../src/theme');
    },
    getClientModules() {
      return [path.resolve(__dirname, './wiki.css')];
    },
  };
}
```

`__dirname` at runtime is `lib/theme/`, so `getThemePath` is `lib/theme` (the compiled components sit beside `index.js`) and the TypeScript path is `src/theme`. `index.js` itself sitting inside the theme dir is harmless: Docusaurus only resolves `@theme/<Name>` requests against it.

- [ ] **Step 5: Register the theme** in `src/index.ts`: `import wikiTheme from './theme';` and `themes: [wikiTheme as PluginModule]`.

- [ ] **Step 6: Run** `npm test` (the three share tests now run) and `npm run build`. Expect tsc to complain about `styles.module.css` imports: add `src/css-modules.d.ts` with `declare module '*.module.css' { const c: Record<string, string>; export default c; }`. Verify `ls lib/theme` shows every component dir with `index.js`, plus `wiki.css` and the two `styles.module.css`.

- [ ] **Step 7: Commit**

```bash
git add src/theme src/share src/css-modules.d.ts src/index.ts
git commit -m "Move the theme: components, swizzles, share layer, framework CSS"
```

---

### Task 4: `defineWikiConfig` — the whole Docusaurus config from `wiki.config.json`

**Files:**
- Create: `src/define-config.ts`, `src/define-config.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `defineWikiConfig(wiki: WikiConfig, overrides?: DeepPartial<Config>): Config`. Named export from the package root. The preset is referenced by module name inside it, so an instance's `docusaurus.config.ts` is: `import wiki from './wiki.config.json'; import { defineWikiConfig } from '@supersuit/docusaurus-preset-wiki'; export default defineWikiConfig(wiki);`

- [ ] **Step 1: Failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineWikiConfig } from './define-config';

const wiki = {
  title: 'T', tagline: 'tag', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
  copyright: '© T', noindex: true, description: 'd', og: { bg: '#123456' },
};

test('builds title, url and the preset entry', () => {
  const c = defineWikiConfig(wiki);
  assert.equal(c.title, 'T');
  assert.equal(c.url, 'https://t.wiki');
  const preset = (c.presets as any[])[0];
  assert.equal(preset[0], '@supersuit/docusaurus-preset-wiki');
  assert.equal(preset[1].title, 'T');
});

test('noindex adds the robots meta and disables the sitemap', () => {
  const c = defineWikiConfig(wiki);
  const robots = (c.headTags as any[]).find((t) => t.attributes?.name === 'robots');
  assert.equal(robots.attributes.content, 'noindex, nofollow');
  const classic = (c.presets as any[])[1];
  assert.equal(classic[1].sitemap, false);
});

test('theme-color comes from og.bg', () => {
  const c = defineWikiConfig(wiki);
  const tc = (c.headTags as any[]).find((t) => t.attributes?.name === 'theme-color');
  assert.equal(tc.attributes.content, '#123456');
});

test('overrides merge into themeConfig without dropping defaults', () => {
  const c = defineWikiConfig(wiki, { themeConfig: { navbar: { items: [{ to: '/x', label: 'X' }] } } });
  const tc = c.themeConfig as any;
  assert.equal(tc.navbar.title, 'T');
  assert.equal(tc.navbar.items.length, 1);
  assert.equal(tc.footer.copyright, '© T');
});
```

- [ ] **Step 2: Run** → fails, module missing.

- [ ] **Step 3: src/define-config.ts.** Port `wiki-template/docusaurus.config.ts` v1.1.3 body, reading `wiki` instead of the JSON import. The classic preset stays a second `presets` entry (a preset cannot nest a preset), so the array is `[['@supersuit/docusaurus-preset-wiki', wiki], ['classic', {...}]]`.

```ts
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type { WikiConfig } from './config';

type Overrides = Partial<Omit<Config, 'themeConfig'>> & { themeConfig?: Record<string, unknown> };

function deepMerge<T extends Record<string, any>>(base: T, over: Record<string, any> | undefined): T {
  if (!over) return base;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])
      ? deepMerge(out[k], v)
      : v;
  }
  return out as T;
}

export function defineWikiConfig(wiki: WikiConfig, overrides: Overrides = {}): Config {
  const { themeConfig: themeOverrides, ...configOverrides } = overrides;

  const base: Config = {
    title: wiki.title,
    tagline: wiki.tagline,
    favicon: 'img/favicon.png',
    url: wiki.url,
    baseUrl: '/',
    organizationName: wiki.organizationName,
    projectName: wiki.projectName,
    onBrokenLinks: 'throw',
    future: { v4: true, faster: true },
    markdown: { hooks: { onBrokenMarkdownLinks: 'warn' } },
    i18n: { defaultLocale: 'en', locales: ['en'] },
    headTags: [
      { tagName: 'link', attributes: { rel: 'apple-touch-icon', sizes: '180x180', href: '/img/apple-touch-icon.png' } },
      { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/img/icon-192.png' } },
      { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/img/icon-512.png' } },
      { tagName: 'link', attributes: { rel: 'manifest', href: '/manifest.webmanifest' } },
      { tagName: 'meta', attributes: { name: 'theme-color', content: wiki.og?.bg ?? '#ffffff' } },
      ...(wiki.noindex ? [{ tagName: 'meta', attributes: { name: 'robots', content: 'noindex, nofollow' } }] : []),
    ],
    presets: [
      ['@supersuit/docusaurus-preset-wiki', wiki],
      [
        'classic',
        {
          docs: {
            routeBasePath: '/',
            sidebarPath: './sidebars.ts',
            editUrl: undefined,
            showLastUpdateTime: false,
            showLastUpdateAuthor: false,
            sidebarItemsGenerator: async ({ defaultSidebarItemsGenerator, ...args }: any) => {
              const items = await defaultSidebarItemsGenerator(args);
              const stripIndex = (list: any[]): any[] =>
                list
                  .filter((item) => !(item.type === 'doc' && typeof item.id === 'string' && item.id.endsWith('/index')))
                  .map((item) => (item.type === 'category' && Array.isArray(item.items) ? { ...item, items: stripIndex(item.items) } : item));
              return stripIndex(items);
            },
          },
          blog: false,
          theme: { customCss: './src/css/custom.css' },
          sitemap: wiki.noindex ? false : undefined,
        } satisfies Preset.Options,
      ],
    ],
    themeConfig: {
      image: undefined,
      metadata: [
        { property: 'og:type', content: 'article' },
        { property: 'og:site_name', content: wiki.title },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
      ],
      navbar: { title: wiki.title, logo: undefined, items: [] },
      footer: { style: 'light', links: [], copyright: wiki.copyright },
      prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
      colorMode: { defaultMode: 'light', disableSwitch: false, respectPrefersColorScheme: true },
    } satisfies Preset.ThemeConfig,
  };

  const merged = { ...base, ...configOverrides } as Config;
  merged.themeConfig = deepMerge(base.themeConfig as Record<string, any>, themeOverrides);
  return merged;
}
```

Copy the explanatory comments from the template's `docusaurus.config.ts` (the `future` block, the headTags block, the `sidebarItemsGenerator` block, the `metadata` block) into the same places; they are the reasons and they travel with the code.

- [ ] **Step 4: Export it** from `src/index.ts`: `export { defineWikiConfig } from './define-config';`

- [ ] **Step 5: Run** `npm test` → all pass; `npm run build` clean.

- [ ] **Step 6: Commit**

```bash
git add src/define-config.ts src/define-config.test.ts src/index.ts
git commit -m "defineWikiConfig: the whole Docusaurus config from wiki.config.json"
```

---

### Task 5: The `./middleware` entry

**Files:**
- Create: `src/middleware.ts`, `src/middleware.test.ts`

**Interfaces:**
- Produces: `createMiddleware(opts?: { gate?: GateFn }): (request: Request) => Promise<Response | undefined>`; `MATCHER: string[]`; `UNFURL_BOT_PATTERN`, `BLOCKED_BOT_PATTERN`; re-exports `handleShare`, `ShareRequest`. `type GateFn = (request: Request) => Promise<GateVerdict> | GateVerdict`; `interface GateVerdict { authorized: boolean; response?: Response }` — `response` is what the gate wants to send when not authorized (its 401 page, or a 303 that sets a cookie for a `?key=` prefill).

- [ ] **Step 1: Failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiddleware, MATCHER } from './middleware';

const req = (url: string, ua = 'Mozilla/5.0') => new Request(url, { headers: { 'user-agent': ua } });

test('a training crawler gets 403', async () => {
  const mw = createMiddleware();
  const res = await mw(req('https://t.wiki/concepts/x', 'GPTBot/1.0'));
  assert.equal(res?.status, 403);
});

test('an unfurl bot passes an open wiki', async () => {
  const mw = createMiddleware();
  assert.equal(await mw(req('https://t.wiki/concepts/x', 'Twitterbot/1.0')), undefined);
});

test('an ordinary reader passes an open wiki', async () => {
  const mw = createMiddleware();
  assert.equal(await mw(req('https://t.wiki/concepts/x')), undefined);
});

test('open wiki: /s/mint answers the page url with focused:false', async () => {
  const mw = createMiddleware();
  const res = await mw(req('https://t.wiki/s/mint?path=/concepts/x'));
  assert.equal(res?.status, 200);
  const body = await res!.json();
  assert.equal(body.url, 'https://t.wiki/concepts/x');
  assert.equal(body.focused, false);
});

test('gated wiki: the gate refuses an anonymous reader but an unfurl bot passes', async () => {
  const mw = createMiddleware({
    gate: (r) => ({ authorized: r.headers.get('cookie') === 'k=1', response: new Response('login', { status: 401 }) }),
  });
  assert.equal((await mw(req('https://t.wiki/concepts/x')))?.status, 401);
  assert.equal(await mw(req('https://t.wiki/concepts/x', 'Slackbot 1.0')), undefined);
  const ok = new Request('https://t.wiki/concepts/x', { headers: { 'user-agent': 'Mozilla', cookie: 'k=1' } });
  assert.equal(await mw(ok), undefined);
});

test('gated wiki: anonymous mint is 401, authorized mint is a signed share path', async () => {
  process.env.WIKI_SHARE_SECRET = 'test-secret';
  const mw = createMiddleware({ gate: (r) => ({ authorized: r.headers.get('cookie') === 'k=1', response: new Response(null, { status: 401 }) }) });
  assert.equal((await mw(req('https://t.wiki/s/mint?path=/concepts/x')))?.status, 401);
  const ok = new Request('https://t.wiki/s/mint?path=/concepts/x', { headers: { 'user-agent': 'Mozilla', cookie: 'k=1' } });
  const body = await (await mw(ok))!.json();
  assert.match(body.url, /^https:\/\/t\.wiki\/s\/[A-Za-z0-9_-]+\/concepts\/x$/);
  assert.equal(body.focused, true);
});

test('matcher exempts skills, generators and webmanifest', () => {
  const re = new RegExp(MATCHER[0].replace(/^\//, '^/'));
  assert.equal(re.test('/skills/x/SKILL.md'), false);
  assert.equal(re.test('/manifest.webmanifest'), false);
  assert.equal(re.test('/concepts/x'), true);
});
```

- [ ] **Step 2: Run** → fails.

- [ ] **Step 3: src/middleware.ts.** Port the template `middleware.ts` verbatim (both patterns, both comment blocks, the matcher) into this shape:

```ts
import { handleShare, type ShareRequest } from './share/handleShare';

export { handleShare };
export type { ShareRequest };

export const UNFURL_BOT_PATTERN = /* verbatim from template */;
export const BLOCKED_BOT_PATTERN = /* verbatim from template */;

export interface GateVerdict {
  authorized: boolean;
  /** What to send when not authorized: the login page, or a 303 that sets the cookie. */
  response?: Response;
}
export type GateFn = (request: Request) => Promise<GateVerdict> | GateVerdict;

export interface MiddlewareOptions {
  /** Absent means an open wiki: every reader is authorized and share addresses redirect. */
  gate?: GateFn;
  /** Defaults to WIKI_SHARE_SECRET, then WIKI_GATE_SECRET. */
  secret?: string;
}

declare const process: { env: Record<string, string | undefined> };

export function createMiddleware(opts: MiddlewareOptions = {}) {
  return async function middleware(request: Request): Promise<Response | undefined> {
    const ua = request.headers.get('user-agent') ?? '';
    const isUnfurlBot = UNFURL_BOT_PATTERN.test(ua);
    if (!isUnfurlBot && BLOCKED_BOT_PATTERN.test(ua)) {
      return new Response('Forbidden: automated training and AI-search crawlers are not permitted on this site.', {
        status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const gated = Boolean(opts.gate);
    const verdict: GateVerdict = opts.gate ? await opts.gate(request) : { authorized: true };
    const secret = opts.secret ?? process.env.WIKI_SHARE_SECRET ?? process.env.WIKI_GATE_SECRET ?? '';

    const share = await handleShare({ url: new URL(request.url), authorized: verdict.authorized, secret, gated });
    if (share) return share;

    if (isUnfurlBot) return undefined;
    if (gated && !verdict.authorized) return verdict.response;
    return undefined;
  };
}

export const MATCHER = [ /* verbatim matcher string from template */ ];
export const config = { matcher: MATCHER, runtime: 'edge' as const };
export default createMiddleware();
```

Order is the template's and it is load-bearing: bot block, then share, then gate. The gate runs *before* `handleShare` only to produce the verdict; its refusal is sent *after* the share layer declines the request.

- [ ] **Step 4: Run** `npm test` → pass. Then the edge-safety check: `npm run build && grep -nE "require\(['\"](fs|path|crypto|node:)" lib/middleware.js lib/share/*.js` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "middleware entry: createMiddleware composes bot-block, share layer and a wiki's gate"
```

---

### Task 6: The `wiki` CLI

**Files:**
- Create: `src/cli/wiki.mjs`, `src/cli/check-admonitions.mjs`, `src/cli/check-links.mjs`, `src/cli/check-image-weight.mjs`, `src/cli/check-image-provenance.mjs`, `src/cli/llms-txt.mjs`, `src/cli/generate-llms-txt.sh`, `src/cli/unlock-link.mjs`, `src/cli/unlock-link.test.mjs`, `src/cli/test-image-provenance.mjs`, `src/cli/image-exempt-cases.default.json`, `src/cli/python/build-icons.py`, `src/cli/python/optimize-images.py`
- Test: `src/cli/wiki.test.mjs`

**Interfaces:**
- Produces: `wiki check [admonitions|links|image-weight|provenance|llms|owned-files]` (no subcommand = all, in that order; exit 1 on the first failure); `wiki share [args passed through to unlock-link]`; `wiki icons`; `wiki optimize-images`. Every script resolves its root from `process.cwd()`, never from its own location.

- [ ] **Step 1: Copy**

```bash
T=~/Documents/github-repos/supersuit-repos/wiki-template
mkdir -p src/cli/python
for f in check-admonitions check-links check-image-weight check-image-provenance unlock-link unlock-link.test test-image-provenance; do git -C "$T" show v1.1.3:scripts/$f.mjs > src/cli/$f.mjs; done
git -C "$T" show v1.1.3:scripts/generate-llms-txt.sh > src/cli/generate-llms-txt.sh
git -C "$T" show v1.1.3:scripts/llms-txt-env.mjs > src/cli/llms-txt.mjs
git -C "$T" show v1.1.3:scripts/image-exempt-cases.json > src/cli/image-exempt-cases.default.json
git -C "$T" show v1.1.3:scripts/build-icons.py > src/cli/python/build-icons.py
git -C "$T" show v1.1.3:scripts/optimize-images.py > src/cli/python/optimize-images.py
```

- [ ] **Step 2: Root resolution edits, one per file**

- `check-links.mjs`, `check-image-weight.mjs`, `check-image-provenance.mjs`: already `resolve(process.argv[2] || ".")`. Leave them; the dispatcher passes no positional so they use cwd.
- `check-image-weight.mjs` line ~77: `const casesPath = join(ROOT, "scripts", "image-exempt-cases.json")` → try the instance file first, then fall back to the shipped default: `const casesPath = [join(ROOT, "scripts", "image-exempt-cases.json"), join(ROOT, "image-exempt-cases.json"), join(dirname(fileURLToPath(import.meta.url)), "image-exempt-cases.default.json")].find(existsSync)`.
- `llms-txt.mjs`: `resolve(__dirname, '..', 'wiki.config.json')` → `resolve(process.cwd(), 'wiki.config.json')`; the `spawnSync('bash', [resolve(__dirname, 'generate-llms-txt.sh')], …)` keeps `__dirname` (the script ships beside it) and must set `cwd: process.cwd()`.
- `unlock-link.mjs` lines 25–26: `const ROOT = join(HERE, "..")` → `const ROOT = process.cwd()`. Its test constructs temp roots and passes them explicitly (check `grep -n "siteUrl(\|unlockParam(" src/cli/unlock-link.test.mjs`); it should not need edits.
- `check-admonitions.mjs`: `grep -n "docs" src/cli/check-admonitions.mjs` and make its docs path `resolve(process.cwd(), 'docs')`.
- `test-image-provenance.mjs`: it spawns `check-image-provenance.mjs` by `HERE`; that still works since both ship together.
- `python/*.py`: `grep -n "wiki.config.json\|__file__" src/cli/python/*.py` — every path they compute from `__file__` must become `os.getcwd()`-relative. Record the exact line numbers changed in the commit message.

- [ ] **Step 3: Failing dispatcher test** `src/cli/wiki.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'wiki.mjs');
const run = (cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });

function site() {
  const d = mkdtempSync(join(tmpdir(), 'wiki-cli-'));
  mkdirSync(join(d, 'docs'), { recursive: true });
  mkdirSync(join(d, 'static'), { recursive: true });
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ title: 'T', tagline: 't', url: 'https://t.wiki', organizationName: 'o', projectName: 'p', copyright: 'c', noindex: true, description: 'd' }));
  writeFileSync(join(d, 'docs', 'a.md'), '---\ntitle: A\n---\n# A\n\n*One line.*\n\n---\n\n## Body\n\ntext\n');
  return d;
}

test('--help lists the subcommands and exits 0', () => {
  const r = run(process.cwd(), '--help');
  assert.equal(r.status, 0);
  for (const s of ['check', 'share', 'icons', 'optimize-images']) assert.match(r.stdout, new RegExp(s));
});

test('an unknown subcommand exits 2', () => {
  assert.equal(run(process.cwd(), 'frobnicate').status, 2);
});

test('check passes on a clean minimal site', () => {
  const r = run(site(), 'check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('check owned-files refuses a forked plugin directory', () => {
  const d = site();
  mkdirSync(join(d, 'plugins', 'search-plugin'), { recursive: true });
  const r = run(d, 'check', 'owned-files');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /plugins\/search-plugin/);
});
```

- [ ] **Step 4: Run** → fails, `wiki.mjs` missing.

- [ ] **Step 5: src/cli/wiki.mjs**

```js
#!/usr/bin/env node
// The build-time checks and operator commands every family wiki runs, as one bin,
// so an instance's package.json says `wiki check` and never carries the scripts.
// Every command resolves the wiki root from the cwd it is run in.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const [cmd, ...rest] = process.argv.slice(2);

// Paths the package owns. Their presence in an instance means the framework was
// forked again, which is the one failure the package exists to prevent.
const OWNED = ['plugins', 'src/theme', 'src/components', 'src/share', 'scripts/check-links.mjs',
  'scripts/check-image-weight.mjs', 'scripts/check-image-provenance.mjs', 'scripts/check-admonitions.mjs',
  'scripts/unlock-link.mjs', 'scripts/generate-llms-txt.sh', 'scripts/llms-txt-env.mjs'];

const CHECKS = {
  'owned-files': () => {
    const found = OWNED.filter((p) => existsSync(join(ROOT, p)));
    if (found.length === 0) return 0;
    console.error(`[wiki check] these paths are owned by @supersuit/docusaurus-preset-wiki and must not exist in an instance:\n  ${found.join('\n  ')}\nDelete them; the package provides them.`);
    return 1;
  },
  admonitions: () => node('check-admonitions.mjs'),
  llms: () => node('llms-txt.mjs'),
  links: () => node('check-links.mjs'),
  'image-weight': () => node('check-image-weight.mjs'),
  provenance: () => node('check-image-provenance.mjs', ...rest.filter((a) => a.startsWith('--'))),
};

function node(script, ...args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
}
function python(script, ...args) {
  const probe = spawnSync('python3', ['--version']);
  if (probe.status !== 0) { console.error(`[wiki] ${script} needs python3 on PATH (uv run --with pillow works too).`); return 1; }
  const r = spawnSync('python3', [join(HERE, 'python', script), ...args], { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
}

function help() {
  console.log(`wiki <command>

  check [owned-files|admonitions|llms|links|image-weight|provenance]
                       run one build-time check, or all of them in that order (prebuild)
  share [...]          the unlock-link CLI: OPEN / UNLOCKED / BLOCKED / MINTABLE / focused
  icons                draw the favicon and PWA icon set from wiki.config.json (python3 + Pillow)
  optimize-images      WebP-convert and resize static images (python3 + Pillow)

Run from the wiki root (where wiki.config.json is).`);
}

let status;
switch (cmd) {
  case undefined: case '-h': case '--help': case 'help': help(); status = 0; break;
  case 'check': {
    const which = rest.find((a) => !a.startsWith('--'));
    const order = which ? [which] : Object.keys(CHECKS);
    status = 0;
    for (const name of order) {
      if (!CHECKS[name]) { console.error(`[wiki check] unknown check "${name}"`); status = 2; break; }
      status = CHECKS[name]();
      if (status !== 0) break;
    }
    break;
  }
  case 'share': status = node('unlock-link.mjs', ...rest); break;
  case 'icons': status = python('build-icons.py', ...rest); break;
  case 'optimize-images': status = python('optimize-images.py', ...rest); break;
  default: console.error(`[wiki] unknown command "${cmd}". Try --help.`); status = 2;
}
process.exit(status);
```

- [ ] **Step 6: Run** `npm test` → dispatcher tests, unlock-link tests pass. Run `node src/cli/test-image-provenance.mjs` → passes (add it to the `test` script: `&& node src/cli/test-image-provenance.mjs`). `npm run build` and `ls lib/cli` shows every `.mjs`, `.sh`, `.json` and `python/`. `chmod +x` is not preserved by copy; add `"postbuild": "chmod +x lib/cli/wiki.mjs"` to package.json — no, `bin` entries are made executable by npm on install; leave it.

- [ ] **Step 7: Commit**

```bash
git add src/cli package.json
git commit -m "wiki CLI: the build checks, the share CLI, icons and image tools as one bin"
```

---

### Task 7: Fixture site integration test

**Files:**
- Create: `test/fixture-site/{package.json,wiki.config.json,docusaurus.config.ts,sidebars.ts,middleware.ts,src/css/custom.css,docs/index.md,docs/concepts/alpha.md,static/img/favicon.png}`, `test/build-fixture.test.mjs`

**Interfaces:**
- Consumes: everything above by `"@supersuit/docusaurus-preset-wiki": "file:../.."`.

- [ ] **Step 1: The fixture.** `test/fixture-site/package.json`:

```json
{
  "name": "fixture-site", "private": true,
  "scripts": { "prebuild": "wiki check", "build": "docusaurus build" },
  "dependencies": {
    "@docusaurus/core": "3.10.1", "@docusaurus/faster": "3.10.1", "@docusaurus/preset-classic": "3.10.1",
    "@mdx-js/react": "^3.0.0", "@supersuit/docusaurus-preset-wiki": "file:../..",
    "prism-react-renderer": "^2.3.0", "react": "^19.0.0", "react-dom": "^19.0.0"
  },
  "devDependencies": { "@docusaurus/tsconfig": "3.10.1", "@docusaurus/types": "3.10.1", "typescript": "~5.9.0" }
}
```

`docusaurus.config.ts`:

```ts
import wiki from './wiki.config.json';
import { defineWikiConfig } from '@supersuit/docusaurus-preset-wiki';
export default defineWikiConfig(wiki);
```

`middleware.ts`:

```ts
export { default, config } from '@supersuit/docusaurus-preset-wiki/middleware';
```

`wiki.config.json`: the template's with `"title": "Fixture Wiki"`, `"url": "https://fixture.example"`, `"og": { "bg": "#101826" }`. `sidebars.ts`: `export default { docs: [{ type: 'autogenerated', dirName: '.' }] };`. `src/css/custom.css`: the template's `:root` block (lines 1–40) and dark block (401–475) only. `docs/index.md` and `docs/concepts/alpha.md`: two pages in the template's anatomy (frontmatter `title`/`description`, H1, italic line, `---`, an H2). `static/img/favicon.png`: copy from the template. Commit the fixture with one initial git commit *inside* `test/fixture-site` is NOT possible (nested repo); instead the test runs `git init && git add -A && git commit -m fixture` in a temp copy so the changelog plugin has history.

- [ ] **Step 2: test/build-fixture.test.mjs**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test('a fixture instance builds from the package and emits every framework output', { timeout: 600_000 }, () => {
  sh('npm', ['run', 'build'], PKG);
  const site = mkdtempSync(join(tmpdir(), 'fixture-site-'));
  cpSync(join(HERE, 'fixture-site'), site, { recursive: true, filter: (p) => !/node_modules|\/build$|\.docusaurus/.test(p) });
  // file: must point at the package from the copy's location
  const pj = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'));
  pj.dependencies['@supersuit/docusaurus-preset-wiki'] = `file:${PKG}`;
  require('node:fs').writeFileSync(join(site, 'package.json'), JSON.stringify(pj, null, 2));
  sh('git', ['init', '-q'], site); sh('git', ['add', '-A'], site);
  sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'fixture'], site);
  sh('npm', ['install', '--no-audit', '--no-fund'], site);
  sh('npm', ['run', 'build'], site);

  const out = join(site, 'build');
  assert.ok(existsSync(join(out, 'search-index.json')), 'search index');
  assert.ok(existsSync(join(out, 'manifest.webmanifest')), 'manifest');
  assert.ok(existsSync(join(out, 'llms.txt')) && existsSync(join(out, 'llms-full.txt')), 'llms');
  assert.ok(existsSync(join(out, 'share-view', 'concepts', 'alpha', 'index.html')), 'share-view mirror');
  const mirror = readFileSync(join(out, 'share-view', 'concepts', 'alpha', 'index.html'), 'utf8');
  assert.equal((mirror.match(/<script/g) ?? []).length, 0, 'mirror has no scripts');
  const page = readFileSync(join(out, 'concepts', 'alpha', 'index.html'), 'utf8');
  assert.match(page, /property="og:image" content="https:\/\/fixture\.example\/img\/og\/concepts--alpha\.png"/, 'og card injected');
  assert.ok(existsSync(join(out, 'img', 'og', 'concepts--alpha.png')), 'og card rendered');
  assert.match(page, /name="robots" content="noindex, nofollow"/, 'noindex meta');
  assert.match(page, /rel="manifest" href="\/manifest\.webmanifest"/, 'manifest link');
  assert.ok(readdirSync(join(out, 'assets', 'css')).length > 0, 'css emitted');
  assert.match(page, /doc-meta-slot|DocItem/, 'DocItem wrapper rendered');
});
```

Replace the `require('node:fs').writeFileSync` line with an import of `writeFileSync` at the top; the plan shows it inline so the intent is unmistakable.

- [ ] **Step 3: Run** `npm run test:fixture`. First run will surface real integration defects (theme path resolution, CSS module handling in `lib/theme`, `@theme/*` alias against a CJS-compiled component, `defineWikiConfig` referencing the preset by name from inside `node_modules`). Fix each in the package, not the fixture. Record each fix as its own commit with the symptom in the message.

- [ ] **Step 4: Commit**

```bash
git add test/fixture-site test/build-fixture.test.mjs .gitignore
git commit -m "Fixture instance builds from the package; asserts every framework output"
```

---

### Task 8: Retarget `wiki-template` onto the package (v2.0.0)

**Repo:** `~/Documents/github-repos/supersuit-repos/wiki-template`. Work on a branch `package-consumer`; the tree had one dirty file (`scripts/optimize-images.py`) on 2026-09-13, so `git status --porcelain` first and leave that file alone.

**Files:**
- Delete: `plugins/`, `src/components/`, `src/theme/`, `src/share/`, `scripts/check-*.mjs`, `scripts/unlock-link*.mjs`, `scripts/generate-llms-txt.sh`, `scripts/llms-txt-env.mjs`, `scripts/test-image-provenance.mjs`, `scripts/ts-resolve-*.mjs`, `scripts/build-icons.py`, `scripts/optimize-images.py`, `scripts/check-template-version*.mjs`, `scripts/bump.sh`, `TEMPLATE-VERSION`
- Modify: `docusaurus.config.ts` (→ 3 lines), `middleware.ts` (→ re-export), `package.json`, `src/css/custom.css` (→ tokens only), `wiki.config.json` (`$schema` path), `README.md`, `UPGRADE-LEDGER.md` (final entry), `CLAUDE.md` if present

- [ ] **Step 1: Baseline build for the parity diff**

```bash
cd ~/Documents/github-repos/supersuit-repos/wiki-template && git checkout -b package-consumer
pnpm install && pnpm build && rm -rf /tmp/wt-before && cp -r build /tmp/wt-before
```

- [ ] **Step 2: Add the dependency (local link until publish)**

```bash
pnpm add ../docusaurus-preset-wiki    # writes "link:../docusaurus-preset-wiki"; publish replaces it with ^0.1.0
```

- [ ] **Step 3: Delete the owned files** (the list above, with `git rm -r`). Then `pnpm remove minisearch satori @resvg/resvg-js gray-matter glob remark strip-markdown` (now the package's).

- [ ] **Step 4: Rewrite the four files**

`docusaurus.config.ts`:
```ts
import wiki from './wiki.config.json';
import { defineWikiConfig } from '@supersuit/docusaurus-preset-wiki';

// Everything a family wiki shares lives in the preset. Per-wiki additions
// (navbar items, footer links) go in the second argument and merge on top.
export default defineWikiConfig(wiki);
```

`middleware.ts`:
```ts
// Open wiki: bot-block + share layer, no gate. A gated wiki replaces this with
// createMiddleware({ gate }) from the same entry; see the package README.
export { default, config } from '@supersuit/docusaurus-preset-wiki/middleware';
```

`package.json` scripts → `start`, `build`, `prebuild: "wiki check"`, `share: "wiki share"`, `icons: "wiki icons"`, `optimize:images: "wiki optimize-images"`, `typecheck`, `init*` and `register-skills` unchanged. Remove `test:share`, `test:unlock-link`, `test:provenance`, `template:version`, `test:template-version`, `check:*`.

`src/css/custom.css` → lines 1–40 and 401–475 of the v1.1.3 file only (the same split Task 3 made, so `grep -c "" src/css/custom.css` is about 115).

`wiki.config.json`: `"$schema": "./node_modules/@supersuit/docusaurus-preset-wiki/wiki.config.schema.json"`; `git rm wiki.config.schema.json`.

- [ ] **Step 5: Build and diff**

```bash
pnpm build && diff -rq /tmp/wt-before build | grep -v "assets/" 
```

Expected: no differences outside `assets/` (hashed bundles). Any other line is a parity break; fix it in the package. Then check the ledger detectors still pass on the new shape: v1.1.0's `grep -q handleShare middleware.ts` will now fail by design; the v2.0.0 entry below rewrites the detectors.

- [ ] **Step 6: Final ledger entry** appended to `UPGRADE-LEDGER.md`:

```markdown
### → v2.0.0 (the framework is a package)

Everything the ledger above told you to copy now arrives by dependency. The template is an
ordinary instance of `@supersuit/docusaurus-preset-wiki`; `TEMPLATE-VERSION` and the version
checker are retired, because the package version is the template version and `pnpm outdated`
is the checker. This is the last entry: from here the record is the package's CHANGELOG.md.

- **Detector:** `grep -q '"@supersuit/docusaurus-preset-wiki"' package.json && wiki check owned-files`.
- **Remedy:** `pnpm add @supersuit/docusaurus-preset-wiki`; delete `plugins/`, `src/components/`,
  `src/theme/`, `src/share/`, the check/share/icon scripts, `TEMPLATE-VERSION`, `scripts/bump.sh`,
  `scripts/check-template-version*.mjs`; replace `docusaurus.config.ts`, `middleware.ts` (an open
  wiki re-exports; a gated wiki wraps its gate in `createMiddleware({ gate })`), `package.json`
  scripts and `src/css/custom.css` (brand tokens only) with the template's; point `$schema` at the
  package's schema. Build, `diff -rq` against the pre-migration build outside `assets/`, run
  `wiki check`, deploy a preview, then production.
```

- [ ] **Step 7: README.** Replace the "What this is" bullets' file paths with the package; add a "Per-wiki overrides" section showing `defineWikiConfig(wiki, { themeConfig: { navbar: { items: [...] } } })`, the gated middleware shape, and `src/theme/<Component>/index.tsx` as the swizzle escape hatch.

- [ ] **Step 8: Deploy a preview** from the branch (`vercel` without `--prod` in the template repo) and load it: search opens on `/`, `/changelog` lists pages, a page's `og:image` URL returns 200, `/manifest.webmanifest` is 200, `curl -A GPTBot` is 403, `curl -A Twitterbot` is 200, `/s/mint?path=/` answers `{"url":...,"focused":false}`.

- [ ] **Step 9: Commit and merge**

```bash
git add -u && git add docusaurus.config.ts middleware.ts package.json pnpm-lock.yaml src/css/custom.css wiki.config.json README.md UPGRADE-LEDGER.md
git commit -m "The template consumes @supersuit/docusaurus-preset-wiki (v2.0.0)"
```

Do NOT tag v2.0.0 or merge to `main` until the package is published (Task 10): a `link:` dependency in the template would break every `Use this template` clone. Keep the branch; Task 10 flips the dependency to `^0.1.0` (or `^1.0.0`) and merges.

---

### Task 9: Migrate one open wiki and one gated wiki

**Repos:** `supersuit-repos/pcs-wiki` (open, v1.1.3), then `supersuit-repos/supersuit-wiki` (gated, v1.1.3). Both after Task 10 publishes, since they deploy from GitHub and cannot use `link:`.

- [ ] **Step 1: pcs-wiki.** Follow the v2.0.0 remedy verbatim. Its `middleware.ts` is the template's (confirm with `diff <(git -C ../wiki-template show v1.1.3:middleware.ts) middleware.ts`); if identical, the re-export replaces it. Build, `diff -rq` parity, `wiki check`, commit by explicit file list, push, watch the Vercel deploy, then the seven live checks from Task 8 Step 8 against `pcs.wiki`.

- [ ] **Step 2: supersuit-wiki.** Its middleware has a password gate. Rewrite it as:

```ts
import { createMiddleware, type GateVerdict } from '@supersuit/docusaurus-preset-wiki/middleware';
export { config } from '@supersuit/docusaurus-preset-wiki/middleware';

// <the existing gate: cookie check, ?key= prefill → set-cookie + 303, login page render>
async function gate(request: Request): Promise<GateVerdict> {
  // returns { authorized: true } when the cookie is valid,
  // { authorized: false, response: <303 with set-cookie> } on a ?key= prefill,
  // { authorized: false, response: <the login page 401> } otherwise.
}

export default createMiddleware({ gate });
```

Move the existing gate body into `gate()` unchanged. Then the nine live checks recorded in `garys-freedom/projects/2026-09-11-edge-knowledge-wikis/STATE.md` (anonymous mint 401, authorized mint 200 + focused:true, share address 200 with zero `<script>`, authorized share 302, forged sig 401, Twitterbot 200 on a share address, GPTBot 403, `?key=` prefill sets the cookie and 303s, wrong password 401).

- [ ] **Step 3: Record** both migrations as dated lines in the project STATE.md (via `create-or-update-project`), with any package fix they forced.

---

### Task 10: Publish, then flip the template

Blocked on Gary running `npm login` on this machine (interactive; suggest `! npm login`). Then:

- [ ] **Step 1:** `npm org ls supersuit` → if "Scope not found", create the org at npmjs.com (Gary), or fall back to `@supersuitup` and rename across this repo, the template branch and the fixture (`grep -rl "@supersuit/" --exclude-dir=node_modules .`).
- [ ] **Step 2:** In this repo: `npm version 1.0.0`, `npm publish --access public`, `git push --follow-tags`. Create the GitHub repo first: `gh repo create SupersuitUp/docusaurus-preset-wiki --public --source . --push` (confirm the org and visibility with Gary before running; the wikis it serves are public, so public is expected).
- [ ] **Step 3:** In the template branch: `pnpm remove @supersuit/docusaurus-preset-wiki && pnpm add @supersuit/docusaurus-preset-wiki@^1.0.0`, build, commit, merge to `main`, `git tag v2.0.0`, push tags.
- [ ] **Step 4:** Add Renovate config to the template (`renovate.json`: `{"extends": ["config:recommended"], "packageRules": [{"matchPackageNames": ["@supersuit/docusaurus-preset-wiki"], "automerge": false}]}`) so every clone inherits the bump-PR behaviour.
- [ ] **Step 5:** CHANGELOG.md in this repo: carry the template's v1.0.0–v1.1.3 ledger entries in as history under "Before the package", then `## 1.0.0`.

---

### Task 11: `set-up-a-wiki` scaffolds from the package

**Repo:** `supersuit-repos/freedom-dev`, skill `.agents/skills/set-up-a-wiki`. Its `scaffold-local.sh` clones `SupersuitUp/wiki-template`; after Task 10 that clone is a package consumer, so the scaffold needs only two checks:

- [ ] **Step 1:** Run the skill's scaffold against a temp dir and confirm the result has no `plugins/` and builds (`wiki check` passes, `pnpm build` succeeds). The 2026-09-11 lesson still applies: the scaffold commits before the first build.
- [ ] **Step 2:** Grep the skill and its tests for `TEMPLATE-VERSION`, `check-template-version`, `template:version` (the retired machinery) and replace with `pnpm outdated @supersuit/docusaurus-preset-wiki`. Update `getfreedom-wiki`'s skill page if it names the old checker. Ship as a Freedom patch release with the test that runs the scaffold.

---

## Self-review

**Spec coverage.** Package boundary (Tasks 2–6), options schema (Task 1 + schema file copied in Task 8 Step 4 — add: copy `wiki.config.schema.json` into this repo's root in Task 1 Step 9), what stays per-instance (Task 8), distribution (Task 10), migration order (Tasks 8–9–11; Victory's book is spun up after Task 11 through the verb and is the project's follow-on), the instance test `wiki check owned-files` (Task 6), fixture integration test (Task 7), edge-safety (Task 5 Step 4), parity diff (Task 8 Step 5). Renovate (Task 10 Step 4). Gap found and fixed: the schema file copy was missing from Task 1; added above.

**Placeholders.** Task 5 Step 3 says "verbatim from template" for two regexes and the matcher: those are literal copies of lines 30–33 and 81–83 of the template's `middleware.ts` at v1.1.3, not something to invent. Task 9 Step 2 leaves the gate body as "the existing gate" because it IS the existing code, moved into a function; nothing new is written there.

**Type consistency.** `WikiConfig` (Task 1) is what `defineWikiConfig` (Task 4) and the preset (Task 2) take. `GateVerdict`/`GateFn`/`createMiddleware`/`MATCHER` (Task 5) are what Task 9 imports. `readWikiConfig(siteDir, options)` signature is the same in Tasks 1, 2.
