import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageGraphic, findPagesWithoutGraphics} from './check-page-graphics.mjs';

// THE RULE the diagram kit's README already states and nothing enforced: "A page without a
// graphic is not finished", except the pure reference pages, because a lookup page has no
// argument to draw. It was prose in one README, so a wiki could ship eleven pages and zero
// graphics with every other check green. antisocialcontract.com did exactly that on 2026-09-22.

test('a body image embed counts, whatever its extension', () => {
  for (const src of ['/img/diagrams/x.svg', '/img/illustrations/y.webp', './z.png']) {
    assert.equal(pageGraphic(`# T\n\n![what it argues](${src})\n`).has, true, src);
  }
});

test('a frontmatter image counts, because a rendered hero is the paid half of the same rule', () => {
  const r = pageGraphic('---\ntitle: T\nimage: /img/illustrations/hero.webp\n---\n\n# T\n');
  assert.equal(r.has, true);
  assert.equal(r.kind, 'frontmatter-image');
});

test('an imported chart or diagram component counts, since MDX pages draw that way', () => {
  const mdx = "---\ntitle: T\n---\n\nimport Flow from '@site/src/components/Flow';\n\n# T\n\n<Flow />\n";
  assert.equal(pageGraphic(mdx).has, true);
});

test('prose alone does not count, and an empty alt does not either', () => {
  assert.equal(pageGraphic('---\ntitle: T\n---\n\n# T\n\nWords only.\n').has, false);
  // An embed with no alt text is not a graphic for a screen reader, and the README is explicit
  // that the alt IS the one sentence saying what the reader now knows.
  const r = pageGraphic('# T\n\n![](/img/diagrams/x.svg)\n');
  assert.equal(r.has, false);
  assert.equal(r.reason, 'empty-alt');
});

test('a fenced code block containing an image line does not count', () => {
  const md = '# T\n\n```md\n![example](/img/diagrams/x.svg)\n```\n';
  assert.equal(pageGraphic(md).has, false, 'documentation about embedding is not an embed');
});

test('a page can declare itself exempt, and must say why', () => {
  const ok = pageGraphic('---\ntitle: Glossary\ngraphic: none\ngraphic_reason: a lookup page has no argument to draw\n---\n\n# G\n');
  assert.equal(ok.exempt, true);
  const bare = pageGraphic('---\ntitle: Glossary\ngraphic: none\n---\n\n# G\n');
  assert.equal(bare.exempt, false, 'an exemption with no reason is how a gate gets switched off');
  assert.equal(bare.reason, 'exempt-without-reason');
});

test('the default exemptions are the three the README names, by route not by filename', () => {
  const findings = findPagesWithoutGraphics({
    pages: [
      {route: '/reference/glossary', body: '# Glossary\n'},
      {route: '/reference/voice-rules', body: '# Voice\n'},
      {route: '/changelog', body: '# Changelog\n'},
      {route: '/concepts/a-real-idea', body: '# Idea\n\nWords.\n'},
    ],
  });
  assert.deepEqual(findings.map((f) => f.route), ['/concepts/a-real-idea'],
    'only the page with an argument is owed a graphic');
});

test('a wiki can widen the exemptions in its own config, and cannot narrow the rule to nothing', () => {
  const pages = [{route: '/reference/tools/x', body: '# X\n'}, {route: '/concepts/y', body: '# Y\n'}];
  assert.deepEqual(
    findPagesWithoutGraphics({pages, exempt: ['/reference/**']}).map((f) => f.route), ['/concepts/y']);
  assert.throws(() => findPagesWithoutGraphics({pages, exempt: ['**']}),
    /exempt everything/i, 'a pattern that exempts the whole wiki is refused');
});

test('the finding says which of the two ways to fix it', () => {
  const [f] = findPagesWithoutGraphics({pages: [{route: '/concepts/y', body: '# Y\n'}]});
  assert.match(f.fix, /diagrams\/build\.mjs/);
  assert.match(f.fix, /render-hero\.sh/);
});

// THE BASELINE, which is the only reason this could ship at all. Measured across the fleet on
// 2026-09-22: 43 of 53 pages on one wiki, 24 of 80 on another, 18 of 47 on a third. A gate that
// breaks four live wikis on its own release is one whose first PR turns it off.

test('a grandfathered route passes, and an identical NEW one does not', () => {
  const pages = [
    {route: '/concepts/old', body: '# Old\n'},
    {route: '/concepts/new', body: '# New\n'},
  ];
  const findings = findPagesWithoutGraphics({pages, baseline: ['/concepts/old']});
  assert.deepEqual(findings.map((f) => f.route), ['/concepts/new'],
    'grandfathering covers what exists and launders nothing new');
});

test('giving a baselined page a graphic makes it pass on its own merits', () => {
  const pages = [{route: '/concepts/old', body: '# Old\n\n![what it argues](/img/diagrams/o.svg)\n'}];
  assert.deepEqual(findPagesWithoutGraphics({pages, baseline: ['/concepts/old']}), [],
    'and the --accept run then drops it from the list');
});

// FIRST RUN. A wiki that has never been baselined cannot be failed for what predates the gate,
// and a brand-new scaffold would otherwise fail on its own starter pages from minute one, which
// is the surest way to teach somebody to delete the check on day one. Adoption is the act of
// writing the baseline, and it is deliberate.
test('the gate is adopted by writing a baseline, not by being installed', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('./check-page-graphics.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.exit\(adopted && findings\.length \? 1 : 0\)/,
    'no baseline means report and pass; a baseline means fail on anything new');
});

// THE FALSE POSITIVES found on supersuit.wiki on 2026-09-24. The gate only recognised a DEFAULT
// import from @site or a relative path, so three real ways of drawing a page were reported as
// "no graphic": the package's own house figure, an SVG written straight into the MDX, and a
// mermaid chart (getfreedom.wiki carries about ninety, and fences were stripped before scanning).

test("the package's own house figure counts, imported by name from the figures entry", () => {
  const mdx = "---\ntitle: T\n---\n\nimport { Loop } from '@supersuit/docusaurus-preset-wiki/figures';\n\n# T\n\n<Loop steps={['a', 'b']} />\n";
  const r = pageGraphic(mdx);
  assert.equal(r.has, true);
  assert.equal(r.kind, 'component');
  const aliased = "import { wrapLabel, Loop as Cycle } from '@supersuit/docusaurus-preset-wiki/figures';\n\n<Cycle />\n";
  assert.equal(pageGraphic(aliased).has, true, 'an aliased named import is the same figure');
});

test('a named import of a local component counts the same as a default one', () => {
  assert.equal(pageGraphic("import { Flow } from '@site/src/components/Flow';\n\n<Flow />\n").has, true);
});

test('an importable figure that is never used as an element does not count', () => {
  const mdx = "import { Loop, loopLabel } from '@supersuit/docusaurus-preset-wiki/figures';\n\n# T\n\nWords.\n";
  assert.equal(pageGraphic(mdx).has, false);
});

test('a plain import of a non-figure component does not count', () => {
  for (const imp of ["import Tabs from '@theme/Tabs';", "import { Tabs } from '@theme/Tabs';",
    "import { Callout } from 'some-ui-kit';", "import Admonition from '@theme/Admonition';"]) {
    const name = /import\s+\{?\s*(\w+)/.exec(imp)[1];
    assert.equal(pageGraphic(`${imp}\n\n# T\n\n<${name}>words</${name}>\n`).has, false, imp);
  }
});

test('an inline <svg> in an MDX page counts, bare or inside a <figure>', () => {
  const bare = '# T\n\n<svg viewBox="0 0 10 10" role="img"><circle cx="5" cy="5" r="4" /></svg>\n';
  assert.equal(pageGraphic(bare).has, true);
  assert.equal(pageGraphic(bare).kind, 'inline-svg');
  const fig = '# T\n\n<figure>\n  <svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>\n  <figcaption>What it argues</figcaption>\n</figure>\n';
  assert.equal(pageGraphic(fig).has, true);
});

test('a mermaid fenced block counts, since the fence IS the diagram', () => {
  const md = '# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
  const r = pageGraphic(md);
  assert.equal(r.has, true);
  assert.equal(r.kind, 'mermaid');
  assert.equal(pageGraphic('# T\n\n~~~mermaid\ngraph TD\n  A-->B\n~~~\n').has, true, 'tilde fences too');
});

test('documentation ABOUT embedding inside a code fence still does not count', () => {
  const figure = "# T\n\n```mdx\nimport { Loop } from '@supersuit/docusaurus-preset-wiki/figures';\n\n<Loop />\n```\n";
  assert.equal(pageGraphic(figure).has, false, 'a figure shown as code is not a figure');
  const svg = '# T\n\n```html\n<figure><svg viewBox="0 0 1 1"></svg></figure>\n```\n';
  assert.equal(pageGraphic(svg).has, false, 'an svg shown as code is not an svg');
  const mermaid = '# T\n\n````md\n```mermaid\nflowchart LR\n  A --> B\n```\n````\n';
  assert.equal(pageGraphic(mermaid).has, false, 'a mermaid block shown inside a longer fence is an example');
  assert.equal(pageGraphic('# T\n\nWrite `<svg>` inline, or a ```` ```mermaid ```` fence.\n').has, false,
    'inline code is not a drawing either');
});
