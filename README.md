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

## Releasing

**Publishing is a tag push. Nothing on any laptop publishes this package, and `npm login` is
never the answer** (Gary, 2026-09-20: "we publish via github actions bro"). Bump `version` in
package.json, write the CHANGELOG entry, commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
`.github/workflows/publish.yml` publishes through npm's OIDC trusted publishing: no token, no
one-time password, no human round trip. Its version guard refuses a tag that disagrees with
package.json and a version already on npm, so **a tag is not movable**: the first push of `v1.8.0`
published whatever main was at that moment, and the two commits landed under a force-moved
`v1.8.0` afterwards reached nobody until `v1.8.1`. A fix after the tag is the next version.

## What the preset does

Registered by `defineWikiConfig` after `classic`, so its theme components shadow theme-classic's
and an instance's own `src/theme/` still shadows both.

| Piece | What it does |
|---|---|
| search plugin | MiniSearch index of `docs/` written to `static/search-index.json`; `SearchBar` trigger in the navbar (Cmd+K or `/`), `SearchModal` overlay |
| creation-date plugin | Created / Updated for EVERY page (section indexes and intro included) plus the changelog stream, from git, renames followed, merged with the committed snapshot so a shallow Vercel clone still shows deep history. The snapshot refreshes from the pre-commit hook `wiki install-hooks` writes (the instance's `prepare` runs it), so it lags HEAD by one commit and HEAD is always inside the clone window; a shallow build warns with the pages it cannot date |
| og-image plugin | post-build: every page without a frontmatter `image:` gets a branded 1200x630 card rendered from its title and description (satori + resvg), injected into its head; colours from `og` in the config |
| manifest plugin | `manifest.webmanifest` declaring only icons that exist on disk |
| share-view plugin | post-build: a chrome-less, scriptless mirror of every page under `share-view/`, served by the middleware at `/s/<sig>/<route>` |
| theme | `DocItem/Content` (ejected from theme-classic: the meta row of dates + share button rendered server-side under the H1, so the static HTML and the share mirror carry it), `DocMetaRow`, `MDXComponents/Heading` (puts the row after a markdown `# Title`), `MDXComponents/A` (external links open in a new tab), `ShareButton`, `PageDates`, `Changelog`, `ChangelogWidget`, and `wiki.css` (layout, typography, components; reads the instance's tokens) |
| `defineWikiConfig(wiki, overrides?)` | the whole Docusaurus `Config` from `wiki.config.json`: head tags for icons and manifest, robots meta and sitemap from `noindex`, classic preset options including the index-stripping sidebar generator, `themeConfig` metadata, navbar, footer, prism, colour mode |
| `./middleware` | `createMiddleware({ gate?, secret? })`, `UNFURL_BOT_PATTERN`, `BLOCKED_BOT_PATTERN`, `MATCHER`, `config`, `handleShare`; edge-safe, no Node built-ins |
| `wiki` CLI | `wiki check` (owned-files, middleware, admonitions, llms, links, image-weight, provenance), `wiki migrate` (a v1.x copy onto the package), `wiki upgrade` (to the newest release, with the CHANGELOG between), `wiki refresh-dates` (rewrite and stage the page-dates snapshot; `--check`), `wiki install-hooks` (the pre-commit hook that runs it), `wiki gate set\|status\|link` (the deployed gate, through the Vercel API with read-back, redeploy and live checks), `wiki share`, `wiki hero` (render a page's hero through the wiki's Style Pack, read it back, publish it), `wiki icons`, `wiki optimize-images` |

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

**The gate is declared in `wiki.config.json`, and the middleware reads it.** The template's
`middleware.ts` is two lines plus the matcher literal, and changing the gate is a config edit:

```ts
import wiki from './wiki.config.json';
import { createMiddlewareFromConfig } from '@supersuit/docusaurus-preset-wiki/middleware';
export default createMiddlewareFromConfig(wiki);
export const config = { matcher: [/* the literal above */], runtime: 'edge' };
```

```json
"gate": { "type": "password" }           // the default when the block is absent
"gate": { "type": "password", "machinePaths": "gated" }
"gate": { "type": "freedom-account" }    // for people running Freedom
"gate": { "type": "none" }               // never gated, whatever the project holds
```

`password` is the family password gate: dark until `WIKI_PASSWORD` and `WIKI_GATE_SECRET` are set
on the deployment, gated the moment they are. Set it from the wiki root after `vercel link`,
never by hand:

```bash
wiki gate set --password "the word"      # mints the secrets, reads back, redeploys, checks live
wiki gate link /some/page --password "the word"
wiki gate set --rotate-secrets           # every ticket and share link ever issued stops working
```

`freedom-account` is the door for people running Freedom: a stranger's one button goes to the
Freedom portal's sign-in (`signInUrl`, default `https://freedom.continentalworks.ai/wiki/sign-in`)
carrying the page they asked for; an active Freedom account comes back with a five-minute `?pass=`
the gate swaps for a seven-day grant; the portal's hourly `?k=` link from `/freedom:profile` skips
the door. `WIKI_PASS_SECRET` (or `WIKI_GATE_SECRET`) must match the portal's, and a `WIKI_PASSWORD`
on such a project opens nothing. `openPaths` (a regex source) replaces the default set of paths
served without sign-in, for a wiki whose `/skills/` is a docs reference. One command sets it:

```bash
wiki gate set --type freedom-account --pass-secret "<the portal's value>"   # writes gate.type, sets the env, drops WIKI_PASSWORD, redeploys, checks live
wiki gate status                          # on an account wiki: no password needed, the key is read from the project
wiki gate link /some/page                 # the hourly ?k= link an operator gets
```

`pnpm share` on an account wiki unlocks with `WIKI_KEY` (the hourly key; the Freedom plugin's
`wikiKey()` fetches it with the operator's own login) and mints the focused one-page link as usual.

The gate functions are also exported on their own (`createPasswordGate`, `createFreedomAccountGate`)
for a middleware that composes them by hand; `gateFromConfig` is what `createMiddlewareFromConfig`
calls. See `src/gate/`.

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
  "tier": "best",
  "props": {
    "smart-glasses": {
      "refs": ["illustrations/props/smart-glasses.png"],
      "gate": ["the smart glasses match the prop photos: thick black frames, clear lenses"]
    }
  },
  "gate": ["every face is drawn, never a blank oval"]
}
```

`stylePack` is a path, or an id looked up in `$WIKI_STYLE_PACKS` and then `../wiki-style-packs/packs`
beside the wiki. A wiki still carrying the older `hero_register` block is migrated in memory.
`tier` is the render tier when no `--tier` is given. A prop is a list of photos, or `{ refs, gate }`
when it carries its own read-back lines: those join the gate only on a render that passes the prop,
so the wiki-wide `gate` holds only what is true of every hero. A rule about how a recurring subject
is always shown belongs in the pack's `pairings` (a string, or the `{ rule, subject, shownAs }`
entry the review frapp writes), which the compiler emits as one "Standing rules for every scene"
block between the layout law and the beats. A caption is a short plain sentence of four to twelve
words; one or two words is refused. The page supplies the rest:

```bash
wiki hero capture --title "CAPTURE WITHOUT THE WALL" --labels "The phone is a wall between them|The glasses keep him in the moment|A second angle from the shelf|The photo is still there that night" \
  --beats "A father holds a phone up between himself and a toddler.|...|...|..." --prop smart-glasses --dry-run
```

`--dry-run` prints the compiled prompt, the ordered references, the declared strings and the
read-back gate as JSON and spends nothing. Without it the render goes through the Agentic Brand
Universe on-brand-image adapter (`$ABU_ADAPTER`, else the newest installed `abu` plugin), falling
back to the wiki's own `illustrations/scripts/generate.py`; the PNG is read back against every gate
line and the spelling of every declared string by a vision model (`OPENAI_API_KEY`,
`WIKI_HERO_VISION_MODEL`); a DEFECT re-rolls with the defect named as a correction, up to three
rounds; the winner is kept full size as `illustrations/<slug>.png` with its full recipe (model,
exact prompt, every ref, the read-back in full) beside it, and converted to a WebP at most 1536
wide by the same optimizer the weight gate trusts, served with a derive record that names the
source and the tool and summarises the read-back (`{ rounds, overruled, verdicts }`) and carries
no prompt and no path off the repo. `--write` puts the two lines into the page; `--json` prints
`{ png, webp, recipe, sourcePng, sourceRecipe, verdicts, rounds }`. A DEFECT that survives every
round publishes nothing and exits 3, leaving the rounds and their verdicts on disk; a person who
looks and disagrees publishes that round with `--publish <png>`, and the recipe records
`overruled: true` only when a DEFECT was published over.

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
