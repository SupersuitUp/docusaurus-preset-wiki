// Theme-classic wikis (hyperagency, appliedai, agenticbusiness, truth-management) render the
// Share button from their own swizzled DocMetaRow. Until this export existed they imported it
// by a file path into node_modules (`@site/node_modules/@supersuit/docusaurus-preset-wiki/lib/
// theme/ShareButton`), which bypasses the exports map and breaks silently the day lib/ moves.
// `./share-button` is the supported entry point: these tests resolve it the way Node (import
// and require conditions) and webpack (which honours `exports`) do, and check its types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC = '@supersuit/docusaurus-preset-wiki/share-button';
const require = createRequire(import.meta.url);

test('the package exports ./share-button, resolving to the built ShareButton (ESM resolution)', () => {
  const resolved = import.meta.resolve(SPEC);
  assert.match(resolved, /\/lib\/theme\/ShareButton\/index\.js$/);
  assert.ok(existsSync(fileURLToPath(resolved)), 'run `npm run build` first: the export points into lib/');
});

test('./share-button resolves under the require condition and loads a component', () => {
  const resolved = require.resolve(SPEC);
  assert.match(resolved, /\/lib\/theme\/ShareButton\/index\.js$/);
  const mod = require(SPEC);
  assert.equal(typeof mod.default, 'function', 'default export is the ShareButton component');
});

test('./share-button declares types that exist after the build', () => {
  const pkg = JSON.parse(readFileSync(require.resolve('@supersuit/docusaurus-preset-wiki/package.json'), 'utf8'));
  const entry = pkg.exports['./share-button'];
  assert.ok(entry && typeof entry === 'object', 'exports["./share-button"] is declared with conditions');
  assert.equal(entry.types, './lib/theme/ShareButton/index.d.ts');
  const dts = fileURLToPath(new URL(`../../../${entry.types}`, import.meta.url));
  assert.ok(existsSync(dts), `types file emitted: ${entry.types}`);
  assert.match(readFileSync(dts, 'utf8'), /export default function ShareButton/);
});
