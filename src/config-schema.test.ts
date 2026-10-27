// The editor's schema (wiki.config.schema.json, additionalProperties: false) must know every
// top-level key the config type declares, or a wiki that follows the README is told its config is
// wrong. Earned on 1.21.0, whose README documented `superlinks.shut` while the schema refused it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every top-level key of WikiConfig is a property of the schema', () => {
  const src = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export interface WikiConfig {'));
  const block = body.slice(0, body.indexOf('\n}\n'));
  const keys = [...block.matchAll(/^  ([a-z_]+)\??:/gm)].map((m) => m[1]);
  const schema = JSON.parse(readFileSync(new URL('../wiki.config.schema.json', import.meta.url), 'utf8'));
  assert.ok(keys.includes('superlinks'), 'the scan finds the keys');
  for (const k of keys) assert.ok(k in schema.properties, `wiki.config.schema.json has no "${k}"`);
});
