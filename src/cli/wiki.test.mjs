import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'wiki.mjs');
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

function site() {
  const d = mkdtempSync(join(tmpdir(), 'wiki-cli-'));
  mkdirSync(join(d, 'docs'), { recursive: true });
  mkdirSync(join(d, 'static'), { recursive: true });
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({
    title: 'T', tagline: 't', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
    copyright: 'c', noindex: true, description: 'd',
  }));
  writeFileSync(join(d, 'docs', 'a.md'), '---\ntitle: A\ndescription: a page\n---\n\n# A\n\n*One line.*\n\n---\n\n## Body\n\ntext\n');
  return d;
}

test('--help lists the subcommands and exits 0', () => {
  const r = run(process.cwd(), '--help');
  assert.equal(r.status, 0);
  for (const s of ['check', 'share', 'hero', 'icons', 'optimize-images', 'owned-files']) assert.match(r.stdout, new RegExp(s));
});

test('an unknown subcommand exits 2', () => {
  assert.equal(run(process.cwd(), 'frobnicate').status, 2);
});

test('an unknown check exits 2 and names the real ones', () => {
  const r = run(site(), 'check', 'nope');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /owned-files/);
});

test('check passes on a clean minimal site and writes llms.txt', () => {
  const d = site();
  const r = run(d, 'check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(spawnSync('test', ['-f', join(d, 'static', 'llms.txt')]).status, 0);
});

test('check owned-files allows an instance plugin and a swizzle', () => {
  const d = site();
  mkdirSync(join(d, 'plugins', 'chat-plugin'), { recursive: true });
  mkdirSync(join(d, 'src', 'theme', 'Footer'), { recursive: true });
  assert.equal(run(d, 'check', 'owned-files').status, 0);
});

test('check owned-files refuses a forked plugin directory', () => {
  const d = site();
  mkdirSync(join(d, 'plugins', 'search-plugin'), { recursive: true });
  const r = run(d, 'check', 'owned-files');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plugins/);
});

test('check middleware refuses a re-exported config and accepts the literal', () => {
  const d = site();
  writeFileSync(join(d, 'middleware.ts'), "export { default, config } from '@supersuit/docusaurus-preset-wiki/middleware';\n");
  const bad = run(d, 'check', 'middleware');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /RE-EXPORTED/);
  const { matcher } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'matcher.json'), 'utf8'));
  const literal = matcher[0].replace(/\\/g, '\\\\');
  writeFileSync(join(d, 'middleware.ts'), `export { default } from '@supersuit/docusaurus-preset-wiki/middleware';\nexport const config = { matcher: ['${literal}'], runtime: 'edge' };\n`);
  assert.equal(run(d, 'check', 'middleware').status, 0);
  writeFileSync(join(d, 'middleware.ts'), `export { default } from '@supersuit/docusaurus-preset-wiki/middleware';\nexport const config = { matcher: ['/((?!assets/).*)'], runtime: 'edge' };\n`);
  assert.equal(run(d, 'check', 'middleware').status, 1);
});

test('check admonitions fails on the broken form', () => {
  const d = site();
  writeFileSync(join(d, 'docs', 'b.md'), '---\ntitle: B\n---\n\n# B\n\n:::note Title\ntext\n:::\n');
  assert.equal(run(d, 'check', 'admonitions').status, 1);
});

// Found 2026-09-24 adopting the gate on getfreedom.wiki: the first-run message tells you to run
// `wiki check page-graphics --accept`, and the dispatcher dropped the flag, so that exact command
// ran a plain check, wrote no baseline, and reported nothing wrong.
test('check page-graphics passes its flags through, so the --accept it tells you to run works', () => {
  const d = site();
  const r = run(d, 'check', 'page-graphics', '--accept');
  assert.equal(r.status, 0, r.stderr);
  const baseline = JSON.parse(readFileSync(join(d, 'docs', '.page-graphics-baseline.json'), 'utf8'));
  assert.deepEqual(baseline.routes, ['/a']);
  const j = run(d, 'check', 'page-graphics', '--json');
  assert.equal(JSON.parse(j.stdout).adopted, true, '--json reaches the check too');
});

// The same day: --json output past 64KB was cut off mid-string when piped, because the script
// called process.exit() while stdout was still draining, and the half-document failed JSON.parse.
test('check page-graphics --json survives a large wiki through a pipe', () => {
  const d = site();
  for (let i = 0; i < 400; i++) writeFileSync(join(d, 'docs', `p${i}.md`), `# P${i}\n\nWords.\n`);
  const r = run(d, 'check', 'page-graphics', '--json');
  assert.ok(r.stdout.length > 65536, `the fixture must overflow one pipe buffer (${r.stdout.length})`);
  assert.equal(JSON.parse(r.stdout).findings.length, 401);
});
