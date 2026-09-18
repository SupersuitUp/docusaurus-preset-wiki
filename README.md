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
middleware.ts             a re-export plus the matcher literal (Vercel reads config statically)
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
export { default } from '@supersuit/docusaurus-preset-wiki/middleware';
// Vercel reads `config` STATICALLY from this file, so it cannot be re-exported. Copy the
// literal; `wiki check middleware` refuses a build where it drifts from the package's.
export const config = {
  matcher: [
    '/((?!assets/|img/|skills/|generators/|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.json|.*\\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map|json|webmanifest|xml)$).*)',
  ],
  runtime: 'edge',
};
```

Start from [`SupersuitUp/wiki-template`](https://github.com/SupersuitUp/wiki-template), which is
exactly this shape with sample docs. **Upgrading is `wiki upgrade`** in the wiki root: it moves the
dependency to the newest release, prints the CHANGELOG entries between, and builds. **A wiki still
carrying copied framework files (wiki-template v1.x) takes `wiki migrate`**, which is the v2.0.0
ledger remedy as code and leaves a note for anything only a person can decide.

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
| `wiki` CLI | `wiki check` (owned-files, middleware, admonitions, llms, links, image-weight, provenance), `wiki migrate` (a v1.x copy onto the package), `wiki upgrade` (to the newest release, with the CHANGELOG between), `wiki gate set\|status\|link` (the deployed gate, through the Vercel API with read-back, redeploy and live checks), `wiki share`, `wiki hero` (render a page's hero through the wiki's Style Pack, read it back, publish it), `wiki icons`, `wiki optimize-images` |

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

**The family password gate ships in the package.** Set `WIKI_PASSWORD` and `WIKI_GATE_SECRET`
on the deployment and the wiki is gated; unset them and the same file is an open wiki:

```ts
import { createMiddleware, createPasswordGate } from '@supersuit/docusaurus-preset-wiki/middleware';
export default createMiddleware({ gate: createPasswordGate() });
export const config = { matcher: [/* the literal above */], runtime: 'edge' };
```

Set it from the wiki root after `vercel link`, never by hand:

```bash
wiki gate set --password "the word"      # mints the secrets, reads back, redeploys, checks live
wiki gate link /some/page --password "the word"
wiki gate set --rotate-secrets           # every ticket and share link ever issued stops working
```

A preloaded link is `<any page>?key=<password>`: it sets a thirty-day ticket cookie and lands the
reader on the page, with the key stripped from the address. Any capitalization of the password
works. `llms.txt`, `skills/`, `generators/` and media stay open for agents that cannot answer a
door. A password with no secret fails open and says so in an `x-wiki-gate` header.

**A wiki with its own gate** (Google identity, a member list) supplies its verdict instead:

```ts
import { createMiddleware, type GateVerdict } from '@supersuit/docusaurus-preset-wiki/middleware';
export const config = { matcher: [/* the literal above */], runtime: 'edge' };

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

## A page's hero

`wiki hero` makes an article hero the way every wiki in the family makes one: a strip of beats
painted in the wiki's Style Pack, lettered with a title and one label per panel, read back before
it ships. The wiki declares the pack and the defaults once, in `wiki.config.json`:

```json
"hero": {
  "stylePack": "warm-editorial-titled",
  "layout": "grid",
  "props": { "smart-glasses": ["illustrations/props/smart-glasses.png"] },
  "gate": ["the smart glasses match the prop photos"]
}
```

`stylePack` is a path, or an id looked up in `$WIKI_STYLE_PACKS` and then `../wiki-style-packs/packs`
beside the wiki. A wiki still carrying the older `hero_register` block is migrated in memory. The
page supplies the rest:

```bash
wiki hero capture --title "CAPTURE WITHOUT THE WALL" --labels "the phone|the glasses|the second angle|still there" \
  --beats "A father holds a phone up between himself and a toddler.|...|...|..." --prop smart-glasses --dry-run
```

`--dry-run` prints the compiled prompt, the ordered references, the declared strings and the
read-back gate as JSON and spends nothing. Without it the render goes through the Agentic Brand
Universe on-brand-image adapter (`$ABU_ADAPTER`, else the newest installed `abu` plugin), falling
back to the wiki's own `illustrations/scripts/generate.py`; the PNG is read back against every gate
line and the spelling of every declared string by a vision model (`OPENAI_API_KEY`,
`WIKI_HERO_VISION_MODEL`); a DEFECT re-rolls with the defect named as a correction, up to three
rounds; the winner is converted to a WebP at most 1536 wide by the same optimizer the weight gate
trusts and published beside its recipe, which now carries `readback`. `--write` puts the two
lines into the page; `--json` prints `{ png, webp, recipe, verdicts, rounds }`. A DEFECT that
survives every round publishes nothing and exits 3, leaving the rounds and their verdicts on disk;
a person who looks and disagrees publishes that round with `--publish <png>`, and the recipe says so.

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
- **The instance declares `export const config` itself.** Vercel reads the middleware config
  statically; a re-export is invisible and the middleware runs on every path, which on a gated
  wiki 401s its own og cards and manifest. Found on the first live deploy. `wiki check
  middleware` refuses the re-export and a drifted literal.
- **Wrap with `@theme-init/<X>`, never `@theme-original/<X>`, inside this theme.** `@theme-original`
  is for a site's swizzle; inside a theme it resolves to the theme's own component and recurses
  until the heap dies.

Versioning is semver: a plugin behaviour change is a minor, a change to what an instance must do
(config options, the middleware signature) is a major. `CHANGELOG.md` carries every version and,
before it, the template's upgrade ledger.

## License

MIT
