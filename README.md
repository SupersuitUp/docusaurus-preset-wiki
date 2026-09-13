# @supersuit/docusaurus-preset-wiki

*The bones of every wiki in the Supersuit family, as one Docusaurus preset. A wiki is config plus docs plus brand tokens; a framework update is a version bump.*

---

## What an instance looks like

```
wiki.config.json          title, tagline, url, og colours, gate
docs/                     the content
sidebars.ts               the shape
static/img/               favicon, icons, heroes
src/css/custom.css        brand TOKENS only (:root and dark-mode variables)
src/data/changelog-events.json   committed changelog snapshot
docusaurus.config.ts      3 lines
middleware.ts             1 line (open wiki)
package.json              "prebuild": "wiki check"
```

```ts
// docusaurus.config.ts
import wiki from './wiki.config.json';
import { defineWikiConfig } from '@supersuit/docusaurus-preset-wiki';
export default defineWikiConfig(wiki);
```

```ts
// middleware.ts
export { default, config } from '@supersuit/docusaurus-preset-wiki/middleware';
```

Start from [`SupersuitUp/wiki-template`](https://github.com/SupersuitUp/wiki-template), which is
exactly this shape with sample docs. Upgrading is `pnpm up @supersuit/docusaurus-preset-wiki`,
build, deploy.

## What the preset does

Registered by `defineWikiConfig` after `classic`, so its theme components shadow theme-classic's
and an instance's own `src/theme/` still shadows both.

| Piece | What it does |
|---|---|
| search plugin | MiniSearch index of `docs/` written to `static/search-index.json`; `SearchBar` trigger in the navbar (Cmd+K or `/`), `SearchModal` overlay |
| creation-date plugin | Created / Updated per doc from git, renames followed, merged with the committed snapshot so a shallow Vercel clone still shows deep history |
| og-image plugin | post-build: every page without a frontmatter `image:` gets a branded 1200x630 card rendered from its title and description (satori + resvg), injected into its head; colours from `og` in the config |
| manifest plugin | `manifest.webmanifest` declaring only icons that exist on disk |
| share-view plugin | post-build: a chrome-less, scriptless mirror of every page under `share-view/`, served by the middleware at `/s/<sig>/<route>` |
| theme | `DocItem/Content` (meta row: dates + share button under the H1), `MDXComponents/A` (external links open in a new tab), `ShareButton`, `PageDates`, `Changelog`, `ChangelogWidget`, and `wiki.css` (layout, typography, components; reads the instance's tokens) |
| `defineWikiConfig(wiki, overrides?)` | the whole Docusaurus `Config` from `wiki.config.json`: head tags for icons and manifest, robots meta and sitemap from `noindex`, classic preset options including the index-stripping sidebar generator, `themeConfig` metadata, navbar, footer, prism, colour mode |
| `./middleware` | `createMiddleware({ gate?, secret? })`, `UNFURL_BOT_PATTERN`, `BLOCKED_BOT_PATTERN`, `MATCHER`, `config`, `handleShare`; edge-safe, no Node built-ins |
| `wiki` CLI | `wiki check` (owned-files, admonitions, llms, links, image-weight, provenance), `wiki share`, `wiki icons`, `wiki optimize-images` |

## Per-wiki additions

`themeConfig` deep-merges onto the defaults; any other key replaces its default.

```ts
export default defineWikiConfig(wiki, {
  themeConfig: {
    navbar: { items: [{ to: '/listen', label: 'Listen', position: 'right' }] },
    footer: { links: [{ title: 'Elsewhere', items: [{ label: 'Home', to: '/' }] }] },
  },
  plugins: ['./plugins/my-own-plugin'],
});
```

Use the components from docs and pages by their theme alias:

```mdx
import ChangelogWidget from '@theme/ChangelogWidget';

<ChangelogWidget limit={8} />
```

## A gated wiki

The middleware's order is load-bearing and lives in the package: training crawlers get 403
first, then the share layer answers `/s/mint` and `/s/<sig>/<route>`, then the gate refuses.
A gated wiki supplies only its verdict:

```ts
import { createMiddleware, type GateVerdict } from '@supersuit/docusaurus-preset-wiki/middleware';
export { config } from '@supersuit/docusaurus-preset-wiki/middleware';

async function gate(request: Request): Promise<GateVerdict> {
  // { authorized: true } for a valid cookie.
  // { authorized: false, response } otherwise, where response is the login page (401)
  // or, for a `?key=<password>` prefilled link, a 303 that sets the cookie.
}

export default createMiddleware({ gate });
```

Unfurl bots (iMessage, Slack, X, ...) pass the block and the gate but still meet the share layer,
so a shared link previews. The share secret is `WIKI_SHARE_SECRET`, then `WIKI_GATE_SECRET`;
rotating it revokes every share link at once.

## Overriding one component

A Docusaurus swizzle: `src/theme/<Component>/index.tsx` in the instance wins over the package's,
and `@theme-original/<Component>` inside it is the package's version. Override one thing, never
copy the package's directories back into the instance: `wiki check owned-files` fails the build
when a path the package owns reappears, because that fork is what this package exists to end.

## Developing the package

```bash
npm install
npm test            # unit tests (node --test via tsx) + the provenance CLI's own tests
npm run build       # tsc -> lib/, then copies css/fonts/sh/py/json/mjs beside the compiled files
npm run test:fixture   # builds test/fixture-site against this checkout; ~1-2 min
```

Two things that bit while extracting this from the template, kept here so they are not re-learned:

- **Register the preset AFTER `classic`.** Docusaurus resolves `@theme/<X>` against the last theme
  providing it. Listed first, theme-classic's empty `SearchBar` and original `A` win and the search
  trigger silently disappears.
- **Wrap with `@theme-init/<X>`, never `@theme-original/<X>`, inside this theme.** `@theme-original`
  is for a site's swizzle; inside a theme it resolves to the theme's own component and recurses
  until the heap dies.

Versioning is semver: a plugin behaviour change is a minor, a change to what an instance must do
(config options, the middleware signature) is a major. `CHANGELOG.md` carries every version and,
before it, the template's upgrade ledger.

## License

MIT
