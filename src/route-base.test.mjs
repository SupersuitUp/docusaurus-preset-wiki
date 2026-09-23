import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docsRouteBasePath, normalizeDocsBase, withBaseRoute } from './route-base';
import { docsRouteBasePathFromConfigFile, normalizeDocsBase as normalizeCli } from './cli/docs-base.mjs';

// THE ASSERTION THIS FILE EXISTS FOR.
//
// There are two readers of the docs routeBasePath in this package, because they take
// different inputs: a CLI gate runs before Docusaurus and must parse the config file, while a
// plugin is handed siteConfig and should not re-parse source. Two implementations of one
// setting is exactly how a fix lands in one of them and not the other, which is the defect
// this whole module was written to end.
//
// So they are held to the same answers on the same inputs here. A divergence fails this test
// rather than shipping as a 404 on whichever surface was missed.

const cases = [
  ['/wiki', '/wiki'],
  ['wiki', '/wiki'],
  ['/wiki/', '/wiki'],
  ['/', ''],
  ['', ''],
];

function configFileWith(base) {
  const dir = mkdtempSync(join(tmpdir(), 'route-base-'));
  writeFileSync(join(dir, 'docusaurus.config.ts'),
    `classic[1].docs.routeBasePath = '${base}';\n`);
  return dir;
}
const ctx = (base) => ({ siteConfig: { presets: [['classic', { docs: { routeBasePath: base } }]] } });

test('both readers normalize identically', () => {
  for (const [input, expected] of cases) {
    assert.equal(normalizeDocsBase(input), expected, `plugin-side: ${JSON.stringify(input)}`);
    assert.equal(normalizeCli(input), expected, `cli-side: ${JSON.stringify(input)}`);
  }
});

test('both readers agree on the same wiki', () => {
  for (const [input, expected] of cases) {
    if (input === '') continue; // an empty literal in a config is not a case either reader sees
    assert.equal(docsRouteBasePath(ctx(input)), expected, `plugin-side: ${input}`);
    assert.equal(docsRouteBasePathFromConfigFile(configFileWith(input)), expected, `cli-side: ${input}`);
  }
});

test('a wiki with no docs config reads as root on both sides', () => {
  assert.equal(docsRouteBasePath({}), '');
  assert.equal(docsRouteBasePathFromConfigFile(mkdtempSync(join(tmpdir(), 'route-base-'))), '');
});

test('withBaseRoute moves a route once and only once', () => {
  assert.equal(withBaseRoute('/concepts/x', '/wiki'), '/wiki/concepts/x');
  assert.equal(withBaseRoute('/wiki/concepts/x', '/wiki'), '/wiki/concepts/x');
  assert.equal(withBaseRoute('/wiki', '/wiki'), '/wiki');
});

test('withBaseRoute leaves alone what is not a route', () => {
  assert.equal(withBaseRoute('/concepts/x', ''), '/concepts/x');
  assert.equal(withBaseRoute('/concepts/x', '/'), '/concepts/x', "a caller still passing '/'");
  assert.equal(withBaseRoute('https://example.com/x', '/wiki'), 'https://example.com/x');
  assert.equal(withBaseRoute('', '/wiki'), '');
});
