import type { Plugin, LoadContext } from '@docusaurus/types';
import * as path from 'path';
import * as fs from 'fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

// Per-page social share cards, generated at build time.
//
// The unfurl is the first thing a reader experiences of a page. This plugin
// guarantees every page unfurls with page-specific art: after the static HTML
// is written, it walks every route, and any page whose head has NO og:image
// (i.e. no frontmatter `image:` hero) gets a branded card rendered from its
// own title + description, written to img/og/, and injected into its head.
//
// Pages with a frontmatter `image:` (article heroes) are untouched: the hero
// stays the share image, per the family og:image rule. Post-build rewriting is
// deliberate: crawlers and unfurlers read the static HTML, so this is exactly
// the layer where the share card must exist.
//
// Brand tokens come from wiki.config.json's optional `og` block:
//   "og": { "bg": "#101826", "accent": "#e8a33d", "text": "#f8f5ef", "muted": "#b8c0cf" }
// Defaults below apply when the block is absent.

export interface OgImageOptions {
  bg?: string;
  accent?: string;
  text?: string;
  muted?: string;
}

const DEFAULTS: Required<OgImageOptions> = {
  bg: '#101826',
  accent: '#e8a33d',
  text: '#f8f5ef',
  muted: '#b8c0cf',
};

const SKIP_ROUTES = new Set(['/404.html', '/search']);

function cardName(route: string): string {
  const clean = route.replace(/^\/+|\/+$/g, '');
  return (clean === '' ? 'home' : clean.replace(/\//g, '--')) + '.png';
}

function htmlPathFor(outDir: string, route: string): string {
  if (route.endsWith('.html')) return path.join(outDir, route);
  return path.join(outDir, route, 'index.html');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

export default function ogImagePlugin(
  context: LoadContext,
  options: OgImageOptions = {}
): Plugin<void> {
  const tokens = { ...DEFAULTS, ...options };
  return {
    name: 'og-image-plugin',

    async postBuild({ outDir, routesPaths }) {
      const { title: siteTitle, url: siteUrl } = context.siteConfig;
      const domain = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const fontsDir = path.join(__dirname, 'fonts');
      const fonts = [
        {
          name: 'Inter',
          data: fs.readFileSync(path.join(fontsDir, 'Inter-Regular.ttf')),
          weight: 400 as const,
          style: 'normal' as const,
        },
        {
          name: 'Inter',
          data: fs.readFileSync(path.join(fontsDir, 'Inter-Bold.ttf')),
          weight: 700 as const,
          style: 'normal' as const,
        },
      ];

      const ogDir = path.join(outDir, 'img', 'og');
      fs.mkdirSync(ogDir, { recursive: true });
      let generated = 0;

      for (const route of routesPaths) {
        if (SKIP_ROUTES.has(route)) continue;
        const htmlPath = htmlPathFor(outDir, route);
        if (!fs.existsSync(htmlPath)) continue;
        let html = fs.readFileSync(htmlPath, 'utf8');
        // A page that already carries og:image (frontmatter hero) keeps it.
        // The html-minifier may strip attribute quotes, so match both forms, and
        // the match must END at og:image: the site's headTags put og:image:width and
        // og:image:height on every page, and with the closing quote optional the old
        // pattern matched those, so every page was skipped and the build reported
        // "generated 0 share cards" on a wiki whose pages had no card at all.
        if (/property=["']?og:image(?![:\w])/.test(html)) continue;

        const rawTitle = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? siteTitle;
        const suffix = ` | ${siteTitle}`;
        const pageTitle = decodeEntities(
          rawTitle.endsWith(suffix) ? rawTitle.slice(0, -suffix.length) : rawTitle
        );
        const description = decodeEntities(
          html.match(/<meta[^>]+name=["']?description["']?[^>]*content="([^"]*)"/)?.[1] ?? ''
        );

        const name = cardName(route);
        const svg = await satori(
          {
            type: 'div',
            props: {
              style: {
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                backgroundColor: tokens.bg,
                padding: '64px 72px',
                fontFamily: 'Inter',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: 14,
                            height: 14,
                            backgroundColor: tokens.accent,
                            borderRadius: 7,
                          },
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: 28,
                            fontWeight: 700,
                            letterSpacing: 6,
                            color: tokens.accent,
                          },
                          children: siteTitle.toUpperCase(),
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 26,
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: pageTitle.length > 48 ? 58 : 72,
                            fontWeight: 700,
                            lineHeight: 1.12,
                            color: tokens.text,
                          },
                          children: truncate(pageTitle, 90),
                        },
                      },
                      description
                        ? {
                            type: 'div',
                            props: {
                              style: {
                                fontSize: 30,
                                lineHeight: 1.4,
                                color: tokens.muted,
                              },
                              children: truncate(description, 140),
                            },
                          }
                        : { type: 'div', props: { style: { display: 'flex' } } },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { fontSize: 26, color: tokens.muted },
                          children: domain,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: 160,
                            height: 6,
                            backgroundColor: tokens.accent,
                            borderRadius: 3,
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          // satori accepts this plain element-object form at runtime; its types only
          // admit a ReactNode, so the cast is about the declaration, not the behaviour.
          } as unknown as Parameters<typeof satori>[0],
          { width: 1200, height: 630, fonts }
        );

        const png = new Resvg(svg, {
          fitTo: { mode: 'width', value: 1200 },
        }).render().asPng();
        fs.writeFileSync(path.join(ogDir, name), png);

        const imageUrl = `${siteUrl.replace(/\/$/, '')}/img/og/${name}`;
        const inject =
          `<meta property="og:image" content="${imageUrl}">` +
          `<meta property="og:image:width" content="1200">` +
          `<meta property="og:image:height" content="630">` +
          (/name=["']?twitter:image["']?/.test(html)
            ? ''
            : `<meta name="twitter:image" content="${imageUrl}">`) +
          (/name=["']?twitter:card["']?/.test(html)
            ? ''
            : `<meta name="twitter:card" content="summary_large_image">`);
        html = html.replace('</head>', `${inject}</head>`);
        fs.writeFileSync(htmlPath, html);
        generated += 1;
      }

      console.log(`[og-image-plugin] generated ${generated} share cards in img/og/`);
    },
  };
}
