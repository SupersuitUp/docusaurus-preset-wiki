import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  for (const s of ['check', 'share', 'icons', 'optimize-images', 'owned-files']) assert.match(r.stdout, new RegExp(s));
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

test('check admonitions fails on the broken form', () => {
  const d = site();
  writeFileSync(join(d, 'docs', 'b.md'), '---\ntitle: B\n---\n\n# B\n\n:::note Title\ntext\n:::\n');
  assert.equal(run(d, 'check', 'admonitions').status, 1);
});
