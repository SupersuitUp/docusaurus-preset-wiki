import * as fs from 'fs';
import * as path from 'path';

/**
 * A wiki in its owner's brand universe (freedom#163).
 *
 * A wiki builds on Vercel from its own repo, so it cannot read the universe on its owner's
 * laptop. Its colors are therefore EMITTED from canon into `brand.json` at the site root by
 * Freedom's `freedom-brand.mjs emit --universe <universe> --surface wiki`, which reads the
 * roles the universe declares (ground, text, accent, and a dark set when it names one), and
 * this reads that file. No brand.json, no change: every wiki keeps its own CSS until its owner
 * emits one, so shipping this moves nothing by itself.
 *
 * The rules use `html[data-theme=...]`, one step more specific than the `:root` and
 * `[data-theme='dark']` a wiki's custom.css sets, so the brand wins whatever order the
 * stylesheets load in, and a wiki's own non-color rules are untouched.
 */
export type Palette = { ground: string; text: string; accent: string };
export type Brand = Palette & { dark?: Palette; provenance?: Record<string, unknown> };

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function readBrand(root: string): Brand | null {
  const f = path.join(root, 'brand.json');
  if (!fs.existsSync(f)) return null;
  const b = JSON.parse(fs.readFileSync(f, 'utf8')) as Brand;
  const bad = (p: Palette | undefined, where: string) => {
    for (const k of ['ground', 'text', 'accent'] as const) {
      if (!p || typeof p[k] !== 'string' || !HEX.test(p[k])) throw new Error(`brand.json: ${where}${k} must be a hex color, got ${JSON.stringify(p?.[k])}`);
    }
  };
  bad(b, '');
  if (b.dark !== undefined) bad(b.dark, 'dark.');
  return b;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `hex` moved toward black (t < 0) or white (t > 0) by |t|. Docusaurus wants seven primary shades. */
export function shade(hex: string, t: number): string {
  const target = t < 0 ? 0 : 255;
  return '#' + rgb(hex).map((c) => Math.round(c + (target - c) * Math.abs(t)).toString(16).padStart(2, '0')).join('');
}

function vars(p: Palette): string {
  const a = p.accent;
  const v: Record<string, string> = {
    '--ifm-background-color': p.ground,
    '--ifm-background-surface-color': p.ground,
    '--ifm-navbar-background-color': p.ground,
    '--ifm-footer-background-color': p.ground,
    '--ifm-font-color-base': p.text,
    '--ifm-heading-color': p.text,
    '--ifm-color-primary': a,
    '--ifm-color-primary-dark': shade(a, -0.1),
    '--ifm-color-primary-darker': shade(a, -0.15),
    '--ifm-color-primary-darkest': shade(a, -0.3),
    '--ifm-color-primary-light': shade(a, 0.1),
    '--ifm-color-primary-lighter': shade(a, 0.15),
    '--ifm-color-primary-lightest': shade(a, 0.3),
    '--ifm-link-color': a,
  };
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
}

export function brandCss(b: Brand): string {
  let css = `html[data-theme='light']{${vars(b)}}`;
  if (b.dark) css += `html[data-theme='dark']{${vars(b.dark)}}`;
  return css;
}
