import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'llms-txt.mjs');

function wiki(config) {
  const d = mkdtempSync(join(tmpdir(), 'wiki-llms-'));
  const page = (p, fm, body = 'Body.') => {
    mkdirSync(dirname(join(d, 'docs', p)), { recursive: true });
    writeFileSync(join(d, 'docs', p), `---\n${fm}\n---\n\n${body}\n`);
  };
  mkdirSync(join(d, 'static'));
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ title: 'T', description: 'D', url: 'https://w.example', ...config }));
  page('index.md', 'title: Home');
  page('concepts/index.md', 'title: The words');
  page('concepts/toil.md', 'title: Toil\ndescription: Work a machine could do.', "import X from '@theme/X';\n\nToil is.\n\n<X />\n\n{/* a note */}");
  page('start-here/install.md', 'title: Install');
  page('zebra/a.md', 'title: Zebra page');
  page('concepts/hidden.md', 'title: Hidden\ndraft: true');
  mkdirSync(join(d, 'plain'));
  writeFileSync(join(d, 'plain', 'twin.md'), '---\ntitle: Twin\n---\n');
  const r = spawnSync(process.execPath, [BIN], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { txt: readFileSync(join(d, 'static/llms.txt'), 'utf8'), full: readFileSync(join(d, 'static/llms-full.txt'), 'utf8') };
}

function tldrSite(pages) {
  const d = mkdtempSync(join(tmpdir(), 'wiki-llms-tldr-'));
  mkdirSync(join(d, 'static'));
  writeFileSync(join(d, 'wiki.config.json'), JSON.stringify({ title: 'T', description: 'D', url: 'https://w.example' }));
  for (const [p, src] of Object.entries(pages)) {
    mkdirSync(dirname(join(d, 'docs', p)), { recursive: true });
    writeFileSync(join(d, 'docs', p), src);
  }
  const r = spawnSync(process.execPath, [BIN], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { txt: readFileSync(join(d, 'static/llms.txt'), 'utf8'), full: readFileSync(join(d, 'static/llms-full.txt'), 'utf8'), d };
}

test('a page tldr is spliced into llms.txt and llms-full.txt', () => {
  const { txt, full } = tldrSite({
    'index.md': '---\ntitle: Home\n---\n\nHi.\n',
    'concepts/toil.md': '---\ntitle: Toil\ntldr: Toil is work a machine could do.\n---\n\n# Toil\n\nBody.\n',
    'concepts/plain.md': '---\ntitle: Plain\n---\n\nBody.\n',
  });
  assert.match(txt, /- \[Toil\]\(https:\/\/w\.example\/concepts\/toil\)[^\n]*\n  TL;DR: Toil is work a machine could do\.\n/);
  assert.match(full, /URL: https:\/\/w\.example\/concepts\/toil\nTL;DR: Toil is work a machine could do\.\n/);
  assert.equal((txt.match(/TL;DR:/g) ?? []).length, 1, 'only the page that has one');
});

test('a wiki with no tldr pages gets byte-identical llms files', () => {
  const pages = {
    'index.md': '---\ntitle: Home\n---\n\nHi.\n',
    'concepts/toil.md': '---\ntitle: Toil\n---\n\nBody.\n',
  };
  const a = tldrSite(pages);
  assert.ok(!a.txt.includes('TL;DR') && !a.full.includes('TL;DR'));
  const b = tldrSite(pages);
  assert.equal(a.txt, b.txt);
  assert.equal(a.full, b.full);
});

test('llms.txt opens with the preamble and points at the full file', () => {
  const { txt, full } = wiki({ llms_preamble: 'Read concepts first.' });
  assert.match(txt, /^# T\n\n> D\n\nRead concepts first\.\n\nEvery page below, in full, in one file: https:\/\/w\.example\/llms-full\.txt/);
  assert.match(full, /Read concepts first\./);
});

test('sections come in the declared reading order, then the rest A to Z, then root pages', () => {
  const { txt } = wiki({ llms_sections: ['start-here', 'concepts'] });
  const at = (s) => txt.indexOf(s);
  assert.ok(at('## Start here') < at('## The words'), 'declared order, and an index page names its section');
  assert.ok(at('## The words') < at('## Zebra'), 'an undeclared section still appears, after');
  assert.ok(at('## Zebra') < at('## Elsewhere'), 'root pages last');
  assert.match(txt, /- \[Toil\]\(https:\/\/w\.example\/concepts\/toil\): Work a machine could do\./);
});

test('with no declared order every section still appears, alphabetically', () => {
  const { txt } = wiki({});
  assert.ok(txt.indexOf('## The words') < txt.indexOf('## Start here'), 'concepts before start-here by folder name');
});

test('a draft page, a second docs tree, and MDX-only lines never reach the corpus', () => {
  const { txt, full } = wiki({});
  assert.doesNotMatch(txt + full, /Hidden|Twin/);
  assert.match(full, /Toil is\./);
  assert.doesNotMatch(full, /import X|<X \/>|a note/);
});
