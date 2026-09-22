/* The theme stylesheet must not set a text colour that only exists in light mode.
 *
 * The defect this refuses shipped for a month across sixteen wikis: wiki.css hardcoded
 * `color: #555` on the italic definition line, dark mode lived in each instance's own
 * custom.css keyed to `h1 + p`, and 1.8.0 changed the selector here to
 * `:is(h1, header, .doc-meta-slot) + p`. The instance overrides stopped matching, this
 * file kept applying, and the line rendered #555 on #111 — 2.5:1 against a 4.5:1 floor.
 * Nothing errored, because a stylesheet cannot report that half of it went missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(fileURLToPath(new URL('./wiki.css', import.meta.url)), 'utf8');

/** Everything after the token block: the rules. */
const RULES = CSS.slice(CSS.indexOf('/* ============================\n   Article container'));

const tokenBlock = (selector) => {
  const i = CSS.indexOf(selector + ' {');
  assert.notEqual(i, -1, `no ${selector} token block in wiki.css`);
  const body = CSS.slice(i, CSS.indexOf('}', i));
  return new Map([...body.matchAll(/(--wiki-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};

test('no rule sets a raw text colour', () => {
  const raw = [...RULES.matchAll(/^\s*color:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/gm)].map((m) => m[0].trim());
  assert.deepEqual(
    raw,
    [],
    `wiki.css sets a text colour that dark mode cannot follow. Add a --wiki-* token with a ` +
      `[data-theme='dark'] value instead:\n  ${raw.join('\n  ')}`,
  );
});

test('every token has both a light and a dark value', () => {
  const light = tokenBlock(':root');
  const dark = tokenBlock("[data-theme='dark']");
  assert.ok(light.size >= 7, `expected the :root token block, found ${light.size} tokens`);
  const missing = [...light.keys()].filter((k) => !dark.has(k));
  assert.deepEqual(missing, [], `tokens with no dark value: ${missing.join(', ')}`);
  const sameInBothModes = [...light].filter(([k, v]) => dark.get(k) === v).map(([k]) => k);
  assert.deepEqual(sameInBothModes, [], `tokens whose dark value is just the light one: ${sameInBothModes.join(', ')}`);
});

test('every token a rule reads is declared', () => {
  const used = new Set([...RULES.matchAll(/var\((--wiki-[a-z-]+)\)/g)].map((m) => m[1]));
  const light = tokenBlock(':root');
  const undeclared = [...used].filter((t) => !light.has(t));
  assert.deepEqual(undeclared, [], `rules read tokens nothing declares: ${undeclared.join(', ')}`);
});

test('the definition line is styled by the selector the DOM actually produces', () => {
  // <h1>…</h1><div class="doc-meta-slot">…</div></header><p><em>lede</em></p>
  // so the lede paragraph follows </header>, not </h1>. `h1 + p` alone matches nothing.
  const ledeRules = RULES.split('\n').filter((l) => l.includes('em:only-child') || l.includes('em:first-child'));
  assert.ok(ledeRules.length > 0, 'no definition-line rule in wiki.css');
  for (const rule of ledeRules) {
    assert.match(rule, /:is\(h1, header, \.doc-meta-slot\)/, `definition-line rule misses the meta row: ${rule}`);
  }
});

test('the dark text tokens clear WCAG AA against a near-black page', () => {
  const srgb = (hex) => {
    const n = hex.replace('#', '');
    const p = n.length === 3 ? [...n].map((c) => c + c) : n.match(/../g);
    return p.map((h) => parseInt(h, 16));
  };
  const lum = (rgb) =>
    rgb
      .map((c) => c / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const [x, y] = [lum(srgb(a)), lum(srgb(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // #111111 is the family's dark page. An instance may set its own, which is why the
  // floor checked here is AA (4.5) rather than the 7.0 these values happen to clear.
  const PAGE = '#111111';
  for (const [token, value] of tokenBlock("[data-theme='dark']")) {
    const r = ratio(value, PAGE);
    assert.ok(r >= 4.5, `${token}: ${value} is ${r.toFixed(2)}:1 on ${PAGE}, below the 4.5:1 floor`);
  }
});
