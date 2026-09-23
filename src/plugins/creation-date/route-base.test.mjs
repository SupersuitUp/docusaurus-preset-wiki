import {test} from 'node:test';
import assert from 'node:assert/strict';
import {docsRouteBasePath, withBase} from './index.js';

// A wiki whose docs are NOT at `/` got a changelog where every link 404s. routePathFor builds a
// route from the page's own `slug:`, and Docusaurus resolves that slug relative to the docs
// routeBasePath, so the two disagree the moment anything else occupies the root.
//
// Found 2026-09-22 on the first wiki in the family to put a landing experience at `/`. Every
// internal check passed, because check-links resolves against slugs and the slugs were correct.
// Only Docusaurus' own onBrokenLinks caught it, and only on the changelog.

const ctx = (base) => ({siteConfig: {presets: [['classic', {docs: {routeBasePath: base}}]]}});

test("a docs tree at the root needs no prefix", () => {
  assert.equal(docsRouteBasePath(ctx('/')), '/');
  assert.equal(docsRouteBasePath({siteConfig: {presets: []}}), '/');
  assert.equal(docsRouteBasePath({}), '/', "a context with no presets must not throw");
});

test("a docs tree mounted elsewhere is found and normalised", () => {
  assert.equal(docsRouteBasePath(ctx('/wiki')), '/wiki');
  assert.equal(docsRouteBasePath(ctx('wiki')), '/wiki', "with or without the leading slash");
  assert.equal(docsRouteBasePath(ctx('/wiki/')), '/wiki', "and with or without a trailing one");
});

test("an event's route moves under the base path", () => {
  assert.deepEqual(withBase({routePath: '/concepts/x'}, '/wiki'), {routePath: '/wiki/concepts/x'});
});

test("nothing is prefixed twice, which would be a silent 404 of its own", () => {
  assert.deepEqual(withBase({routePath: '/wiki/concepts/x'}, '/wiki'), {routePath: '/wiki/concepts/x'});
  assert.deepEqual(withBase({routePath: '/wiki'}, '/wiki'), {routePath: '/wiki'});
});

test("a root-mounted wiki is untouched, and so is an event with no route", () => {
  const e = {routePath: '/concepts/x'};
  assert.equal(withBase(e, '/'), e, "returned by identity, so nothing is rebuilt for nothing");
  assert.deepEqual(withBase({title: 'deleted page'}, '/wiki'), {title: 'deleted page'},
    "a deleted page has no link and must not acquire one");
});
