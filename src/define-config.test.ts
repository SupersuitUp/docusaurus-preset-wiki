import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineWikiConfig } from './define-config';

const wiki = {
  title: 'T', tagline: 'tag', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
  copyright: '© T', noindex: true, description: 'd', og: { bg: '#123456' },
};

test('builds title, url and the preset entry', () => {
  const c = defineWikiConfig(wiki);
  assert.equal(c.title, 'T');
  assert.equal(c.url, 'https://t.wiki');
  const preset = (c.presets as any[])[0];
  assert.equal(preset[0], '@supersuit/docusaurus-preset-wiki');
  assert.equal(preset[1].title, 'T');
});

test('noindex adds the robots meta and disables the sitemap', () => {
  const c = defineWikiConfig(wiki);
  const robots = (c.headTags as any[]).find((t) => t.attributes?.name === 'robots');
  assert.equal(robots.attributes.content, 'noindex, nofollow');
  const classic = (c.presets as any[])[1];
  assert.equal(classic[1].sitemap, false);
});

test('an indexed wiki has no robots meta and keeps the sitemap', () => {
  const c = defineWikiConfig({ ...wiki, noindex: false });
  assert.equal((c.headTags as any[]).some((t) => t.attributes?.name === 'robots'), false);
  assert.equal((c.presets as any[])[1][1].sitemap, undefined);
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
