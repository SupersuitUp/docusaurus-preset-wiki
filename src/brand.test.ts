import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineWikiConfig } from './define-config';
import { brandCss, shade, brandHeadTags } from './brand';

const wiki = {
  title: 'T', tagline: 'tag', url: 'https://t.wiki', organizationName: 'o', projectName: 'p',
  copyright: '© T', noindex: false, description: 'd', og: { bg: '#123456' },
};
const HA = { ground: '#f7f4ed', text: '#1a1a17', accent: '#cc785c', dark: { ground: '#141312', text: '#f0ede8', accent: '#e08b6d' } };

function site(brand?: unknown) {
  const d = mkdtempSync(join(tmpdir(), 'wiki-brand-'));
  mkdirSync(join(d, 'static'));
  if (brand !== undefined) writeFileSync(join(d, 'brand.json'), JSON.stringify(brand));
  return d;
}
const style = (c: any) => (c.headTags as any[]).find((t) => t.tagName === 'style');
const themeColor = (c: any) => (c.headTags as any[]).find((t) => t.attributes?.name === 'theme-color').attributes.content;

test('no brand.json changes nothing: the wiki keeps its own CSS', () => {
  const c = defineWikiConfig(wiki, { siteDir: site() });
  assert.equal(style(c), undefined);
  assert.equal(themeColor(c), '#123456');
});

test("a brand.json puts the universe's roles on both themes, beating custom.css on specificity", () => {
  const c = defineWikiConfig(wiki, { siteDir: site(HA) });
  const css = style(c).innerHTML as string;
  assert.match(css, /^html\[data-theme='light'\]\{--ifm-background-color:#f7f4ed;/);
  assert.match(css, /--ifm-font-color-base:#1a1a17/);
  assert.match(css, /--ifm-color-primary:#cc785c;/);
  assert.match(css, /html\[data-theme='dark'\]\{--ifm-background-color:#141312;.*--ifm-color-primary:#e08b6d;/);
  assert.equal(themeColor(c), '#f7f4ed');
});

test('a brand with no dark set leaves the dark theme to the wiki', () => {
  const { dark, ...light } = HA;
  assert.doesNotMatch(brandCss(light), /data-theme='dark'/);
});

test('a malformed brand.json fails the build by name rather than rendering half a theme', () => {
  assert.throws(() => defineWikiConfig(wiki, { siteDir: site({ ...HA, accent: 'clay' }) }), /accent must be a hex color/);
  assert.throws(() => defineWikiConfig(wiki, { siteDir: site({ ...HA, dark: { ground: '#000' } }) }), /dark\.text must be a hex/);
});

test('shades move toward black and white', () => {
  assert.equal(shade('#808080', -0.5), '#404040');
  assert.equal(shade('#808080', 0.5), '#c0c0c0');
});

test('brandHeadTags is the same tag for a wiki outside defineWikiConfig, and nothing without a file', () => {
  assert.deepEqual(brandHeadTags(site()), []);
  const d = site(HA);
  assert.deepEqual(brandHeadTags(d), [style(defineWikiConfig(wiki, { siteDir: d }))]);
});
