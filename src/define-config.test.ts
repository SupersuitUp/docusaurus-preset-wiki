import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineWikiConfig, gateDeclared } from './define-config';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const wiki = {
  title: 'T', tagline: 'tag', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
  copyright: '© T', noindex: true, description: 'd', og: { bg: '#123456' },
};

test('a declared gate puts Sign out in the navbar; an open wiki shows nothing', () => {
  const items = (c: any) => c.themeConfig.navbar.items;
  assert.deepEqual(items(defineWikiConfig(wiki)), []);
  // ABSOLUTE, so Docusaurus's broken-link check leaves it alone: /sign-out has no page, the
  // middleware answers it, and a relative href failed both wikis' deploys on 2026-09-20.
  const item = { href: 'https://t.wiki/sign-out', label: 'Sign out', position: 'right', target: '_self' };
  assert.deepEqual(items(defineWikiConfig({ ...wiki, gate: { type: 'freedom-account' } })), [item]);
  assert.deepEqual(items(defineWikiConfig({ ...wiki, gate: { unlockParam: 'k' } })), [item]);
  assert.deepEqual(items(defineWikiConfig({ ...wiki, gate: { type: 'none' } })), []);
  assert.equal(gateDeclared(wiki, { WIKI_PASSWORD: 'word' }), true, 'a live password at build time');
  assert.equal(gateDeclared(wiki, { WIKI_PASSWORD: '  ' }), false, 'the empty string one CLI stored is no password');
});

test('builds title, url and the preset entry', () => {
  const c = defineWikiConfig(wiki);
  assert.equal(c.title, 'T');
  assert.equal(c.url, 'https://t.wiki');
  const presets = c.presets as any[];
  // classic FIRST, the family preset LAST: the last theme to provide a component wins,
  // and the preset's SearchBar and MDXComponents/A must shadow theme-classic's.
  assert.equal(presets[0][0], 'classic');
  assert.equal(presets[1][0], '@supersuit/docusaurus-preset-wiki');
  assert.equal(presets[1][1].title, 'T');
});

test('noindex adds the robots meta and disables the sitemap', () => {
  const c = defineWikiConfig(wiki);
  const robots = (c.headTags as any[]).find((t) => t.attributes?.name === 'robots');
  assert.equal(robots.attributes.content, 'noindex, nofollow');
  const classic = (c.presets as any[])[0];
  assert.equal(classic[1].sitemap, false);
});

test('an indexed wiki has no robots meta and keeps the sitemap', () => {
  const c = defineWikiConfig({ ...wiki, noindex: false });
  assert.equal((c.headTags as any[]).some((t) => t.attributes?.name === 'robots'), false);
  assert.equal((c.presets as any[])[0][1].sitemap, undefined);
});

test('theme-color comes from og.bg', () => {
  const c = defineWikiConfig(wiki);
  const tc = (c.headTags as any[]).find((t) => t.attributes?.name === 'theme-color');
  assert.equal(tc.attributes.content, '#123456');
});

test('overrides merge into themeConfig without dropping defaults', () => {
  const c = defineWikiConfig(wiki, { themeConfig: { navbar: { items: [{ to: '/x', label: 'X' }] } } });
  const tc = c.themeConfig as any;
  assert.equal(tc.navbar.title, 'T');
  assert.equal(tc.navbar.items.length, 1);
  assert.equal(tc.footer.copyright, '© T');
});

test('top-level overrides replace their key', () => {
  const c = defineWikiConfig(wiki, { onBrokenLinks: 'warn' });
  assert.equal(c.onBrokenLinks, 'warn');
  assert.equal(c.title, 'T');
});

test('icon links are declared only for icon files that exist under static/img', () => {
  const none = mkdtempSync(join(tmpdir(), 'wiki-noicons-'));
  const some = mkdtempSync(join(tmpdir(), 'wiki-icons-'));
  try {
    mkdirSync(join(some, 'static', 'img'), { recursive: true });
    writeFileSync(join(some, 'static', 'img', 'icon-192.png'), 'x');
    writeFileSync(join(some, 'static', 'img', 'apple-touch-icon.png'), 'x');
    const hrefs = (dir: string) => (defineWikiConfig(wiki, { siteDir: dir }).headTags as any[])
      .filter((t) => t.tagName === 'link').map((t) => t.attributes.href);
    // No icons yet: the manifest link stays (the plugin writes the file at build time),
    // the three icon links go, so a fresh wiki ships no <link> to a 404.
    assert.deepEqual(hrefs(none), ['/manifest.webmanifest']);
    // Two of three present: exactly those two are declared.
    assert.deepEqual(hrefs(some), ['/img/apple-touch-icon.png', '/img/icon-192.png', '/manifest.webmanifest']);
  } finally { rmSync(none, { recursive: true, force: true }); rmSync(some, { recursive: true, force: true }); }
});
