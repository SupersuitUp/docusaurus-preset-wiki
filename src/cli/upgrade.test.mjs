// `wiki upgrade` edits package.json twice: the package manager writes the new specifier, then the
// verb adds `prepare`. The second write must be from the file as it is THEN, never from an object
// read before the install. 1.8.1 got that wrong and every wiki it upgraded (17 on 2026-09-20)
// shipped a package.json back on its old range beside a lockfile on the new one, which Vercel
// refuses as ERR_PNPM_OUTDATED_LOCKFILE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPrepareToPackageJson, changelogBetween } from './upgrade.mjs';

test('adding prepare keeps the specifier the install just wrote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-'));
  const p = join(dir, 'package.json');
  // What the file looks like AFTER `pnpm add @supersuit/docusaurus-preset-wiki@1.8.1`.
  writeFileSync(p, JSON.stringify({ name: 'x', scripts: { build: 'docusaurus build' }, dependencies: { '@supersuit/docusaurus-preset-wiki': '^1.8.1' } }, null, 2) + '\n');
  assert.equal(addPrepareToPackageJson(p), true);
  const after = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(after.dependencies['@supersuit/docusaurus-preset-wiki'], '^1.8.1', 'the new range survives');
  assert.equal(after.scripts.prepare, 'wiki install-hooks');
  assert.equal(addPrepareToPackageJson(p), false, 'idempotent');
});

test('changelogBetween returns the sections above `from` up to `to`', () => {
  const cl = '# Changelog\n\n## 1.8.1 (a)\n\n- x\n\n## 1.8.0 (b)\n\n- y\n\n## 1.7.0 (c)\n\n- z\n';
  const between = changelogBetween(cl, '1.7.0', '1.8.1');
  assert.equal(between.length, 2);
  assert.ok(between[0].startsWith('## 1.8.1'));
  assert.ok(between[1].startsWith('## 1.8.0'));
});
