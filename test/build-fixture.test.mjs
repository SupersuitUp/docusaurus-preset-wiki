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
  // Install the PACKED tarball, not a file: link to the checkout. A link resolves the
  // package to its real path, so its own node_modules shadow the site's and every
  // `@docusaurus/*` module the theme imports (useDoc's DocProvider context, for one) is
  // loaded twice; a registry install has no nested copy and never hits that. The tarball is
  // what npm publish ships, so this also proves `files` in package.json is complete.
  sh('npm', ['pack', '--pack-destination', site], PKG);
  const tarball = join(site, readdirSync(site).find((f) => f.endsWith('.tgz')));
  const pj = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'));
  pj.dependencies['@supersuit/docusaurus-preset-wiki'] = `file:${tarball}`;
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

  // Theme components must SHADOW theme-classic's, which only happens when the family
  // preset is registered after classic. Two visible proofs on the rendered page:
  assert.match(page, /aria-label=("Search"|Search)/, 'preset SearchBar rendered in the navbar (theme-classic\'s is empty)');
  assert.match(page, /<a[^>]*href=("\/"|\/)[^>]*target=("_blank"|_blank)/, 'preset MDXComponents/A wrapper applied to a body link');

  const css = readdirSync(join(out, 'assets', 'css')).filter((f) => f.endsWith('.css'));
  assert.ok(css.length > 0, 'css emitted');
  const cssText = css.map((f) => readFileSync(join(out, 'assets', 'css', f), 'utf8')).join('\n');
  assert.match(cssText, /doc-meta-slot|\.markdown h1\s*\+\s*p/, 'framework wiki.css bundled');
  assert.match(cssText, /--ifm-color-primary/, 'instance brand tokens bundled');
  const js = readdirSync(join(out, 'assets', 'js')).filter((f) => f.endsWith('.js'));
  const jsText = js.map((f) => readFileSync(join(out, 'assets', 'js', f), 'utf8')).join('\n');
  assert.match(jsText, /\/_wiki\/read/, 'reader-analytics beacon bundled as a client module');
  // The minifier may keep `:is(h1, header, .doc-meta-slot) + p` or expand it per selector
  // (with `:not(.does-not-exist)` specificity padding), depending on the browserslist;
  // the `.doc-meta-slot + p` arm survives either way.
  assert.match(
    cssText,
    /\.doc-meta-slot\s*\+\s*p\s*>\s*em:only-child/,
    'the definition-line rule reaches past the meta row (h1 + p alone no longer matches)',
  );

  // A blockquote's inner <p> keeps the `.markdown p` bottom margin, and that margin sits
  // INSIDE the left rule, hanging a phantom blank line off the end of every quote
  // (measured 2026-09-15: 4px above the text, 25.6px below, against a 27.2px line).
  // The reset is easy to drop silently, because nothing fails when it goes -- the quote
  // just sags again. Assert it survives minification into the shipped bundle.
  assert.match(
    cssText,
    /blockquote\s*>\s*:last-child\s*\{[^}]*margin-bottom:\s*0/,
    'blockquote last-child margin reset bundled (no phantom trailing line)',
  );

  const changelog = JSON.parse(readFileSync(join(site, 'src', 'data', 'changelog-events.json'), 'utf8'));
  assert.ok(changelog.changeEvents.some((e) => e.docKey === 'concepts/alpha' && e.type === 'new'), 'changelog snapshot written from git');
  assert.ok(changelog.pageDates['concepts/alpha']?.created, 'page dates written into the snapshot');
  assert.ok(changelog.pageDates['index']?.created, 'the front page (excluded from the changelog) is dated');

  // Created / Updated is in the STATIC HTML, directly under the H1, on both title paths:
  // a page that writes its own `# Alpha`, and one titled by frontmatter alone. Until
  // 2026-09-20 the row was portalled in after hydration, so the scriptless share mirror
  // never showed it and a page committed after the snapshot showed nothing at all.
  const metaAfterH1 = /<h1[^>]*>[\s\S]*?<\/h1>\s*<div class=("doc-meta-slot"|doc-meta-slot)[^>]*>[\s\S]*?Created <time datetime=("?\d{4}-\d{2}-\d{2}"?)/;
  assert.match(page, metaAfterH1, 'alpha (content H1): Created row rendered server-side under the title');
  const beta = readFileSync(join(out, 'concepts', 'beta', 'index.html'), 'utf8');
  assert.match(beta, metaAfterH1, 'beta (synthetic title): Created row rendered server-side under the title');
  assert.equal((beta.match(/doc-meta-slot/g) ?? []).length, 1, 'exactly one meta row on a synthetic-title page');
  assert.equal((page.match(/doc-meta-slot/g) ?? []).length, 1, 'exactly one meta row on a content-H1 page');
  const front = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(front, /Created <time/, 'the front page, which the changelog excludes, still shows its dates');
  assert.match(mirror, /Created <time datetime=/, 'the share mirror carries the dates (it has no scripts to add them later)');
  assert.match(mirror, /\.doc-meta-slot \.doc-share-button \{ display: none/, 'the mirror hides the copy-link button, not the dates');

  // The snapshot keeps itself fresh: `refresh-dates --check` sees the build's snapshot as
  // current, a commit that touches a doc makes it stale, the pre-commit hook refreshes it
  // from the history before that commit, and the following commit carries the refresh.
  const wiki = join(site, 'node_modules', '.bin', 'wiki');
  const gitc = (...args) => sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...args], site);
  sh(wiki, ['refresh-dates', '--check'], site);
  gitc('add', '-A');
  gitc('commit', '-q', '-m', 'snapshot from the build');
  const hookLog = sh(wiki, ['install-hooks'], site);
  assert.match(hookLog, /pre-commit hook written/);
  writeFileSync(join(site, 'docs', 'concepts', 'alpha.md'), readFileSync(join(site, 'docs', 'concepts', 'alpha.md'), 'utf8') + '\nA later edit.\n');
  gitc('add', 'docs/concepts/alpha.md');
  gitc('commit', '-q', '-m', 'edit alpha');
  const check = spawnSync(wiki, ['refresh-dates', '--check'], { cwd: site, encoding: 'utf8' });
  assert.equal(check.status, 1, 'the snapshot is one commit behind, as designed, and --check says so');
  writeFileSync(join(site, 'docs', 'concepts', 'beta.md'), readFileSync(join(site, 'docs', 'concepts', 'beta.md'), 'utf8') + '\nAnother edit.\n');
  gitc('add', 'docs/concepts/beta.md');
  gitc('commit', '-q', '-m', 'edit beta');
  const committed = JSON.parse(sh('git', ['show', 'HEAD:src/data/changelog-events.json'], site));
  assert.ok(
    committed.changeEvents.some((e) => e.docKey === 'concepts/alpha' && e.type === 'updated'),
    'the hook refreshed the snapshot with the previous commit and staged it into this one',
  );

  assert.match(log, /\[share-view\] emitted \d+ chrome-less share pages/, 'share-view plugin ran');
  assert.match(log, /\[manifest-plugin\] wrote manifest\.webmanifest/, 'manifest plugin ran');

  if (!process.env.KEEP_FIXTURE) rmSync(site, { recursive: true, force: true });
  else console.log(`fixture kept at ${site}`);
});
