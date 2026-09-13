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
  void url;
  writeFileSync(join(dir, 'wiki.config.json'), JSON.stringify(rest));
  assert.throws(() => readWikiConfig(dir), /wiki\.config\.json.*"url"/);
});

test('no file and no options is an error, not an empty config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  assert.throws(() => readWikiConfig(dir), /wiki\.config\.json/);
});
