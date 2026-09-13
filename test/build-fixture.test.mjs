// Builds test/fixture-site against THIS checkout of the package and asserts every
// output the template's upgrade ledger detectors used to assert by hand. This is
// the test that says the package is a working Docusaurus preset, not just a pile
// of compiled files; everything under src/ is unit-tested, this is the integration.
//
//   npm run test:fixture            (about 1-2 minutes; installs into a temp dir)
//   KEEP_FIXTURE=1 npm run test:fixture   leaves the temp site behind for inspection
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

// Docusaurus minifies attributes (`content=#101826`, `name=robots`), so head checks
// tolerate the quotes being absent.
const q = (v) => `(?:"${v}"|${v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})`;
const attr = (name, value) => new RegExp(`${name}=${q(value)}`);

function sh(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')} in ${cwd} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
}

test('a fixture instance builds from the package and emits every framework output', { timeout: 900_000 }, () => {
  sh('npm', ['run', 'build'], PKG);

  const site = mkdtempSync(join(tmpdir(), 'fixture-site-'));
  cpSync(join(HERE, 'fixture-site'), site, {
    recursive: true,
    filter: (p) => !/node_modules|[\\/]build$|\.docusaurus|search-index\.json|llms.*\.txt$/.test(p),
  });
  // The fixture's file: points at ../.. from its committed location; the copy needs the absolute path.
  const pj = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'));
  pj.dependencies['@supersuit/docusaurus-preset-wiki'] = `file:${PKG}`;
  writeFileSync(join(site, 'package.json'), JSON.stringify(pj, null, 2));

  // The changelog plugin reads git history; one commit is enough to give every page a date.
  sh('git', ['init', '-q'], site);
  sh('git', ['add', '-A'], site);
  sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'fixture'], site);

  sh('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], site);
  const log = sh('npm', ['run', 'build'], site);

  const out = join(site, 'build');
  assert.ok(existsSync(join(out, 'search-index.json')), 'search index emitted');
  assert.ok(existsSync(join(out, 'manifest.webmanifest')), 'manifest emitted');
  assert.ok(existsSync(join(out, 'llms.txt')) && existsSync(join(out, 'llms-full.txt')), 'llms.txt pair emitted');

  const mirrorPath = join(out, 'share-view', 'concepts', 'alpha', 'index.html');
  assert.ok(existsSync(mirrorPath), 'share-view mirror emitted');
  const mirror = readFileSync(mirrorPath, 'utf8');
  assert.equal((mirror.match(/<script/g) ?? []).length, 0, 'mirror has no scripts');

  const page = readFileSync(join(out, 'concepts', 'alpha', 'index.html'), 'utf8');
  assert.match(page, attr('property', 'og:image'), 'og:image present');
  assert.match(page, attr('content', 'https://fixture.example/img/og/concepts--alpha.png'), 'og card injected into head');
  assert.ok(existsSync(join(out, 'img', 'og', 'concepts--alpha.png')), 'og card rendered to disk');
  assert.match(page, /name=("robots"|robots) content="noindex, nofollow"/, 'noindex meta from wiki.config');
  assert.match(page, attr('href', '/manifest.webmanifest'), 'manifest link in head');
  assert.match(page, attr('content', '#101826'), 'theme-color from og.bg');
  assert.match(page, /property=("og:site_name"|og:site_name) content="Fixture Wiki"/, 'themeConfig metadata');

  const css = readdirSync(join(out, 'assets', 'css')).filter((f) => f.endsWith('.css'));
  assert.ok(css.length > 0, 'css emitted');
  const cssText = css.map((f) => readFileSync(join(out, 'assets', 'css', f), 'utf8')).join('\n');
  assert.match(cssText, /doc-meta-slot|\.markdown h1\s*\+\s*p/, 'framework wiki.css bundled');
  assert.match(cssText, /--ifm-color-primary/, 'instance brand tokens bundled');

  const changelog = JSON.parse(readFileSync(join(site, 'src', 'data', 'changelog-events.json'), 'utf8'));
  assert.ok(changelog.changeEvents.some((e) => e.docKey === 'concepts/alpha' && e.type === 'new'), 'changelog snapshot written from git');

  assert.match(log, /\[share-view\] emitted \d+ chrome-less share pages/, 'share-view plugin ran');
  assert.match(log, /\[manifest-plugin\] wrote manifest\.webmanifest/, 'manifest plugin ran');

  if (!process.env.KEEP_FIXTURE) rmSync(site, { recursive: true, force: true });
  else console.log(`fixture kept at ${site}`);
});
