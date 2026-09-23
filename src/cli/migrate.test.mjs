import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { tokensOnly, configCustomisations, rewriteDocsImports, middlewareKind, accountGateSettings, markdownTrees, migrateScripts, OWNED_PATHS } from './migrate.mjs';
import { OWNED } from './owned.mjs';
import { matcherSource } from './matcher.mjs';
import { changelogBetween } from './upgrade.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, 'wiki.mjs');
const TEMPLATE = join(HERE, '..', '..', '..', 'wiki-template');
const haveTemplate = existsSync(join(TEMPLATE, '.git'));

function templateAt(tag) {
  const d = mkdtempSync(join(tmpdir(), 'wt-v1-'));
  execSync(`git -C "${TEMPLATE}" archive ${tag} | tar -x -C "${d}"`);
  return d;
}

test('tokensOnly keeps the :root block and the dark section and drops the layout between', () => {
  const css = `@import url(x);\n\n:root {\n  --ifm-color-primary: #111;\n}\n\n/* ============================\n   Article container\n   ============================ */\n.markdown { max-width: 40rem; }\n\n/* ============================\n   Dark mode\n   ============================ */\n\n[data-theme='dark'] {\n  --ifm-color-primary: #eee;\n}\n`;
  const out = tokensOnly(css);
  assert.match(out, /--ifm-color-primary: #111/);
  assert.match(out, /Dark mode/);
  assert.doesNotMatch(out, /Article container/);
  assert.equal(tokensOnly('body { color: red }'), null, 'an unfamiliar shape is refused, not mangled');
});

test('configCustomisations sees what a script must not guess at', () => {
  assert.deepEqual(configCustomisations("navbar: { items: [] }, footer: { items: [] }, plugins: ['./plugins/search-plugin']"), []);
  const notes = configCustomisations("navbar: { logo: { src: 'x' }, items: [{ to: '/listen', label: 'Listen' }] }, plugins: ['./plugins/chat-plugin']");
  assert.ok(notes.some((n) => /items/.test(n)) && notes.some((n) => /chat-plugin/.test(n)) && notes.some((n) => /logo/.test(n)), notes.join('; '));
});

test('rewriteDocsImports moves the four components to @theme and nothing else', () => {
  const out = rewriteDocsImports("import ChangelogWidget from '@site/src/components/ChangelogWidget';\nimport Changelog from '@site/src/components/Changelog';\nimport Foo from '@site/src/components/Foo';");
  assert.match(out, /'@theme\/ChangelogWidget'/); assert.match(out, /'@theme\/Changelog'/); assert.match(out, /@site\/src\/components\/Foo/);
});

test('changelogBetween returns the entries above from up to and including to', () => {
  const cl = '# Changelog\n\n## 1.2.0\n- c\n\n## 1.1.0\n- b\n\n## 1.0.0\n- a\n\n## Before the package\n';
  assert.deepEqual(changelogBetween(cl, '1.0.0', '1.2.0').map((s) => s.split('\n')[0]), ['## 1.2.0', '## 1.1.0']);
  assert.deepEqual(changelogBetween(cl, '1.2.0', '1.2.0'), []);
});

test('migrate turns a wiki-template v1.1.3 tree into a package consumer', { skip: !haveTemplate && 'wiki-template checkout not beside this repo' }, () => {
  const d = templateAt('v1.1.3');
  const r = spawnSync(process.execPath, [BIN, 'migrate', '--no-install', '--no-build'], { cwd: d, encoding: 'utf8' });
  assert.ok([0, 3].includes(r.status), r.stdout + r.stderr);
  for (const gone of ['plugins/search-plugin', 'src/theme/DocItem', 'src/share', 'scripts/check-links.mjs', 'TEMPLATE-VERSION', 'wiki.config.schema.json']) assert.equal(existsSync(join(d, gone)), false, `${gone} should be gone`);
  const cfg = readFileSync(join(d, 'docusaurus.config.ts'), 'utf8');
  assert.match(cfg, /defineWikiConfig\(wiki\)/);
  assert.equal(existsSync(join(d, 'docusaurus.config.pre-package.ts')), false, 'the template config had no per-wiki choices, so nothing is kept aside');
  const mw = readFileSync(join(d, 'middleware.ts'), 'utf8');
  assert.match(mw, /export default createMiddlewareFromConfig\(wiki\)/);
  assert.match(mw, /export const config = \{/);
  assert.equal(spawnSync(process.execPath, [BIN, 'check', 'middleware'], { cwd: d, encoding: 'utf8' }).status, 0, 'the written literal passes the check');
  assert.equal(spawnSync(process.execPath, [BIN, 'check', 'owned-files'], { cwd: d, encoding: 'utf8' }).status, 0, 'nothing owned is left');
  const css = readFileSync(join(d, 'src/css/custom.css'), 'utf8');
  assert.match(css, /--ifm-color-primary/); assert.doesNotMatch(css, /Article container/);
  const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@supersuit/docusaurus-preset-wiki'], '^1.0.0');
  assert.equal(pkg.dependencies.minisearch, undefined);
  assert.equal(pkg.scripts.prebuild, 'wiki check');
  assert.match(readFileSync(join(d, 'docs/start-here/index.mdx'), 'utf8'), /@theme\/ChangelogWidget/);
  assert.match(JSON.parse(readFileSync(join(d, 'wiki.config.json'), 'utf8')).$schema, /node_modules\/@supersuit/);
});

test('a password-gated middleware is the wiki\'s OWN: kept aside, the package gate written CLOSED, and a person named', { skip: !haveTemplate && 'wiki-template checkout not beside this repo' }, () => {
  // The template never shipped a password gate ("a gated wiki adds its gate BELOW the share
  // layer"), so every middleware that reads WIKI_PASSWORD was written by a person, and the one
  // thing it reliably differs on from the package default is what it does with machine paths.
  // Overwriting it with an OPEN gate published a private wiki's /llms-full.txt for twenty
  // minutes after a migration reported success (ContinentalWorks/freedom#159, 2026-09-17).
  const d = templateAt('v1.1.3');
  const own = "const MACHINE_PATH = /\\.(?:md|txt)$/i;\nconst password = process.env.WIKI_PASSWORD ?? '';\nexport default async function middleware() {}\n";
  writeFileSync(join(d, 'middleware.ts'), own);
  const r = spawnSync(process.execPath, [BIN, 'migrate', '--no-install', '--no-build'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 3, 'a replaced gate is a decision for a person, never a clean exit: ' + r.stdout + r.stderr);
  assert.match(r.stdout, /NEEDS A PERSON: middleware\.ts was this wiki's own password gate/);
  assert.equal(readFileSync(join(d, 'middleware.pre-package.ts'), 'utf8'), own, 'the operator\'s gate is kept byte for byte');
  const mw = readFileSync(join(d, 'middleware.ts'), 'utf8');
  assert.match(mw, /createMiddlewareFromConfig\(wiki\)/, 'the gate is read from the config');
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'wiki.config.json'), 'utf8')).gate, { type: 'password', machinePaths: 'gated' }, 'the false positive costs a re-run; the false negative costs a published corpus');
  assert.equal(spawnSync(process.execPath, [BIN, 'check', 'middleware'], { cwd: d, encoding: 'utf8' }).status, 0, 'the written literal still passes the check');
  const again = spawnSync(process.execPath, [BIN, 'migrate', '--no-install', '--no-build'], { cwd: d, encoding: 'utf8' });
  assert.equal(again.status, 2); assert.match(again.stderr, /wiki upgrade/);
});

test('middlewareKind tells the three shapes apart, and a password gate is never mistaken for the template', () => {
  assert.equal(middlewareKind("export default async function middleware() {}"), 'open');
  assert.equal(middlewareKind("const password = process.env.WIKI_PASSWORD ?? '';"), 'password');
  assert.equal(middlewareKind("const password = process.env.WIKI_PASSWORD; const members = [];"), 'identity');
  assert.equal(middlewareKind("GOOGLE_OAUTH_CLIENT_ID"), 'identity');
});

// --- 1.13.0: the getfreedom-wiki migration (2026-09-23) ----------------------------------------

const ACCOUNT_MW = `import { createFreedomAccountGate } from './src/gate/accountGate';
const OPEN_PATHS = /^\\/(llms\\.txt|llms-full\\.txt)$|\\.(?:md|txt|json)$/i;
const gate = createFreedomAccountGate({
  signInUrl: 'https://portal.example/wiki/sign-in',
  openPaths: OPEN_PATHS,
});
export default async function middleware(request) { return undefined; }
export const config = {
  matcher: [
    '/((?!assets/|img/|favicon\\\\.ico|.*\\\\.(?:js|css|md)$).*)',
  ],
  runtime: 'edge',
};
`;

test('a mirrored Freedom-account gate is its own kind, never mistaken for the open template', () => {
  assert.equal(middlewareKind(ACCOUNT_MW), 'account');
  assert.equal(middlewareKind("export default async function middleware() {}"), 'open');
});

test('accountGateSettings carries the literal signInUrl, the openPaths regex behind a const, and fails the matcher CLOSED', () => {
  const { gate, matcher } = accountGateSettings(ACCOUNT_MW);
  assert.deepEqual(gate, { type: 'freedom-account', signInUrl: 'https://portal.example/wiki/sign-in', openPaths: '^/(llms\\.txt|llms-full\\.txt)$|\\.(?:md|txt|json)$' });
  assert.ok(new RegExp(gate.openPaths, 'i').test('/skills/x/SKILL.md') && !new RegExp(gate.openPaths, 'i').test('/skills/x'));
  assert.equal(matcher, 'skills-are-pages', 'an old matcher that let /skills/ through means those routes were gated pages');
  const familyish = ACCOUNT_MW.replace('assets/|', 'assets/|skills/|');
  assert.equal(accountGateSettings(familyish).matcher, undefined, 'a matcher that already skipped skills/ keeps the family one');
});

test('markdownTrees finds every docs tree, and none of the folders that only look like one', () => {
  const d = mkdtempSync(join(tmpdir(), 'wiki-trees-'));
  for (const [dir, file] of [['docs', 'a.md'], ['plain', 'b.mdx'], ['node_modules/x', 'c.md'], ['static/skills/y', 'SKILL.md'], ['src/pages', 'd.md'], ['empty', 'x.txt']]) {
    mkdirSync(join(d, dir), { recursive: true }); writeFileSync(join(d, dir, file), '# x');
  }
  assert.deepEqual(markdownTrees(d), ['docs', 'plain']);
});

test('migrateScripts drops only what runs a deleted file, and keeps the wiki\'s own checks in the prebuild', () => {
  const { scripts, keptPrebuild } = migrateScripts({
    prebuild: 'node scripts/check-gate-mirror.mjs && node scripts/check-links.mjs && node scripts/make-redirects.mjs && node --import ./scripts/ts-resolve-hooks.mjs scripts/test-changelog-routes.mjs',
    'check:links': 'node scripts/check-links.mjs',
    'check:docs': 'node scripts/check-docs.mjs',
    'test:plain': 'node scripts/test-plain-twins.mjs',
    'test:unlock-link': 'node --test scripts/unlock-link.test.mjs',
    start: 'docusaurus start',
  });
  assert.equal(scripts.prebuild, 'wiki check && node scripts/check-gate-mirror.mjs && node scripts/make-redirects.mjs');
  assert.deepEqual(keptPrebuild, ['node scripts/check-gate-mirror.mjs', 'node scripts/make-redirects.mjs']);
  assert.equal(scripts['check:links'], undefined, 'the template check the package now runs is gone');
  assert.equal(scripts['test:unlock-link'], undefined);
  assert.equal(scripts['check:docs'], 'node scripts/check-docs.mjs', 'the wiki\'s own check survives');
  assert.equal(scripts['test:plain'], 'node scripts/test-plain-twins.mjs');
  assert.equal(scripts.start, 'docusaurus start');
  assert.equal(migrateScripts({}).scripts.prebuild, 'wiki check', 'a template wiki gets exactly what it got before');
});

test('migrate deletes everything the owned-files check refuses, so a migrated wiki passes its own prebuild', () => {
  for (const p of OWNED) assert.ok(OWNED_PATHS.includes(p), `migrate never deletes ${p}, which the check then refuses`);
});

test('an account-gated wiki with a plain mirror migrates onto the config gate, the closed matcher, and every tree', { skip: !haveTemplate && 'wiki-template checkout not beside this repo' }, () => {
  const d = templateAt('v1.1.3');
  writeFileSync(join(d, 'middleware.ts'), ACCOUNT_MW);
  mkdirSync(join(d, 'plain'), { recursive: true });
  writeFileSync(join(d, 'plain', 'changelog.mdx'), "import Changelog from '@site/src/components/Changelog';\n\n<Changelog />\n");
  mkdirSync(join(d, 'src/theme/MDXComponents/A'), { recursive: true });
  writeFileSync(join(d, 'src/theme/MDXComponents/A/index.tsx'), '// this wiki\'s own\n');
  const r = spawnSync(process.execPath, [BIN, 'migrate', '--no-install', '--no-build'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /NEEDS A PERSON: middleware\.ts mirrored the package's Freedom-account gate/);
  assert.match(r.stdout, /restore it with `git checkout -- <path>`/, 'a deleted theme override is named');
  assert.equal(readFileSync(join(d, 'middleware.pre-package.ts'), 'utf8'), ACCOUNT_MW, 'kept byte for byte');
  const cfg = JSON.parse(readFileSync(join(d, 'wiki.config.json'), 'utf8'));
  assert.equal(cfg.gate.type, 'freedom-account', 'never the password gate an untyped block means');
  assert.equal(cfg.gate.signInUrl, 'https://portal.example/wiki/sign-in');
  assert.equal(cfg.matcher, 'skills-are-pages');
  const mw = readFileSync(join(d, 'middleware.ts'), 'utf8');
  assert.ok(mw.includes(`'${matcherSource('skills-are-pages')}'`), 'the variant literal is written');
  assert.equal(spawnSync(process.execPath, [BIN, 'check', 'middleware'], { cwd: d, encoding: 'utf8' }).status, 0, 'and the check accepts it');
  assert.match(readFileSync(join(d, 'plain/changelog.mdx'), 'utf8'), /@theme\/Changelog/, 'the mirror is rewritten too');
});

test('check middleware holds a wiki to the variant it NAMES, and refuses a name the package does not ship', () => {
  const d = mkdtempSync(join(tmpdir(), 'wiki-mw-'));
  const file = (name) => `export default 1;\nexport const config = {\n  matcher: [\n    '${matcherSource(name)}',\n  ],\n  runtime: 'edge',\n};\n`;
  const run = () => spawnSync(process.execPath, [BIN, 'check', 'middleware'], { cwd: d, encoding: 'utf8' });
  writeFileSync(join(d, 'middleware.ts'), file('default'));
  writeFileSync(join(d, 'wiki.config.json'), '{}');
  assert.equal(run().status, 0, 'no name, the family matcher');
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ matcher: 'skills-are-pages' }));
  const wrong = run();
  assert.equal(wrong.status, 1, 'naming the variant and carrying the family literal publishes /skills/');
  assert.match(wrong.stderr, /skills-are-pages/);
  writeFileSync(join(d, 'middleware.ts'), file('skills-are-pages'));
  assert.equal(run().status, 0);
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ matcher: 'made-up' }));
  assert.match(run().stderr, /unknown matcher "made-up"/);
});
