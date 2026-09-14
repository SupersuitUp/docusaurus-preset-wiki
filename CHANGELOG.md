# Changelog

`@supersuit/docusaurus-preset-wiki`. One entry per version, newest first. Before the package
existed, the same framework shipped as copied files from `SupersuitUp/wiki-template`, and that
repo's `UPGRADE-LEDGER.md` recorded each version with a detector and a remedy; those entries are
carried in below under "Before the package" so the history reads in one place.

## 1.2.0 (2026-09-14)

- `createPasswordGate` takes `machinePaths: 'open' | 'gated'`. Open is the default and is unchanged, so no deployed wiki behaves differently on upgrade. `'gated'` puts `.md`, `.txt`, audio, video, `.pdf` and `/llms.txt` behind the same door and the same `?key=` link as every page, leaving `/skills/` and `/generators/` open at both settings because an agent has to fetch the instructions it is about to follow before it can hold a key. Open machine paths are right for a public-knowledge wiki whose agents and players cannot answer a door, and on a private one they publish everything: `/llms-full.txt` is every page in a single `.txt`, so a wiki registered `audience: private` with the gate on served its entire text to anyone who guessed that filename. Reported by @brayantenesaca10-boop against a real private wiki (ContinentalWorks/freedom#122). Any wiki whose content is not meant to be public wants `'gated'`.

## 1.1.1 (2026-09-13)

- `defineWikiConfig` declares the `apple-touch-icon`, `icon-192` and `icon-512` `<link>`s only when the file exists under `static/img`, the rule the manifest plugin already applied to its own entries. A wiki that has not run `wiki icons` otherwise shipped three links to 404s on every page; the first migration onto the package (pcs-wiki) surfaced it as the only difference in an otherwise identical build. `overrides.siteDir` sets the root the check reads (tests pass it; Docusaurus reads the config from the site root, so the default is the working directory).

## 1.1.0 (2026-09-13)

- `wiki check provenance` accepts a COMPOSITE recipe: `panelRecipes` (or `parts`) each validated on their own plus a `compositor`. pcs.wiki's code-lettered heroes are this shape and the flat check called three correct sidecars invalid.

- `wiki migrate`: the v2.0.0 upgrade-ledger remedy as code. Deletes what the package owns, writes the three-line config (keeping a customised one aside and naming what it carried), rewrites an open or password-gated middleware and leaves a custom gate alone by name, trims custom.css to its tokens, repoints docs imports, swaps the dependencies and scripts, installs and builds. Tested against the real wiki-template v1.1.3 tree.
- `wiki upgrade [--to v]`: bump a wiki already on the package, print the CHANGELOG entries between the versions, flag a major, build.

## 1.0.0 (2026-09-13)

- First release. Everything `wiki-template` v1.1.3 shipped as files, as one preset: search
  (MiniSearch, Cmd+K), changelog dates from git with the committed snapshot, per-page og cards,
  `manifest.webmanifest`, the chrome-less share mirror, the theme (SearchBar, SearchModal,
  DocItem/Content meta row, MDXComponents/A, ShareButton, PageDates, Changelog, ChangelogWidget)
  and the framework CSS, `defineWikiConfig`, the `./middleware` entry with `createMiddleware({ gate })`,
  and the `wiki` CLI (`check`, `share`, `icons`, `optimize-images`).
- `wiki check owned-files` refuses an instance that still carries a path the package owns.
- `wiki gate set|status|link`: the password gate of a deployed wiki as one command. Writes through the Vercel REST API (never the 52.x CLI's `env add`, which stores blanks when piped), mints the two secrets on first use, reads every value back by length through the per-variable endpoint (the list endpoint returns ciphertext even with `decrypt=true`), redeploys production, then runs the eight live checks a person would. The password is the operator's; `--rotate-secrets` kills every ticket and share link.
- `wiki check middleware`: refuses a middleware.ts that re-exports `config` or carries a matcher literal that differs from the package's. Vercel reads `config` statically, so the instance has to declare it; the first live gated deploy 401'd its own og cards and manifest before this existed.
- `createPasswordGate()` on the `./middleware` entry: the family password gate (HMAC ticket cookie, `?key=` preloaded links, any capitalization, machine paths open, fails open with an `x-wiki-gate` header when the secret is missing), lifted from supersuit-wiki's standalone middleware so a gated wiki is `createMiddleware({ gate: createPasswordGate() })` and nothing more. Dark until `WIKI_PASSWORD` and `WIKI_GATE_SECRET` are set.

## Before the package: wiki-template v1.0.0 to v1.1.3


### wiki-template v1.0.0 (baseline)

Everything the template shipped before it had a version: the family bot-block middleware, the
`?key=` prefill contract for gated wikis, search, the changelog collector and the article meta
row (Created / Updated / copy link), per-page og cards, the manifest, the icon builder, the
image-weight gate, the provenance gate, hosted skills and generators, `llms.txt`, and the
`pnpm share` unlock-link CLI that answers OPEN / UNLOCKED / BLOCKED / MINTABLE.

- **Detector:** `test -f scripts/unlock-link.mjs && test -f scripts/check-image-provenance.mjs`.
  Both landed in the 2026-09-10 fleet sweep, the last one before versioning existed.
- **Remedy:** copy the file the detector names from the template; each has its own test.

### wiki-template v1.1.0 (one-page shares out of a gated wiki, and the version machinery itself)

A gated wiki had one door, the password, and it opened the whole wiki. Sending someone a page
meant sending them that door. Now an authorized reader's copy-link button hands out
`/s/<sig>/<route>`: one page, served chrome-less (no navbar, sidebar, TOC, footer, scripts, or
links into the rest), to a reader who has no password and needs none. Deterministic HMAC over
the route, keyed by `WIKI_SHARE_SECRET` or `WIKI_GATE_SECRET`; revocation is rotating the secret.

New: `src/share/` (signing, the middleware layer, the mobile-safe clipboard), `plugins/share-view-plugin/`
(the mirror, built at postBuild), `src/components/ShareButton.tsx` (asks `/s/mint`, falls back to
the page URL), `TEMPLATE-VERSION`, this ledger, `scripts/bump.sh`, `scripts/check-template-version.mjs`.
Changed: `middleware.ts` calls `handleShare` after the bot-block and before any gate; `scripts/unlock-link.mjs`
prefers the focused link on a gated wiki (`--whole-wiki` for the old `?key=` link); `tsconfig.json`
gains `allowImportingTsExtensions`; `docusaurus.config.ts` registers the plugin.

- **Detector:** `test -f src/share/handleShare.ts && grep -q handleShare middleware.ts && grep -q share-view-plugin docusaurus.config.ts`.
  On a LIVE gated wiki, also: `curl -s -o /dev/null -w '%{http_code}' https://<wiki>/s/mint?path=/` answers
  401 (the layer is there and refusing an anonymous mint), not 401-with-the-gate-page or 404.
- **Remedy:** copy `src/share/`, `plugins/share-view-plugin/`, the tsconfig flag and the plugin
  registration verbatim. **Edit, never overwrite,** `middleware.ts` and `ShareButton.tsx`: every
  gated wiki's middleware is its own, so wire `handleShare({ url, authorized, secret, gated })` in
  with that gate's verdict, and keep any local behaviour the button grew (buildonanthropic strips
  the query string; reallife falls back to `?password=`). Run `pnpm test:share`, build, and check
  one emitted `build/share-view/<route>/index.html` has zero `<script>` tags.
- **Open wikis** get the code and no behaviour: the address redirects to the page, `/s/mint`
  answers with the page URL. Stamp them v1.1.0 once the detector passes.

### wiki-template v1.1.1 (edge-safe imports for the share layer)

v1.1.0 imported `./src/share/handleShare.ts` with the extension, which Node's test runner
needs and Vercel's edge bundler refuses: the first gated instance to deploy it failed with
"The Edge Function middleware is referencing unsupported modules". Every import under
`src/share/`, `plugins/share-view-plugin/` and `middleware.ts` is now extensionless; the tests
run through `scripts/ts-resolve-hooks.mjs`, a resolver hook that tries the TypeScript
extensions only under `node --test`. `tsconfig.json` no longer needs `allowImportingTsExtensions`.

- **Detector:** `! grep -rq "from '\./.*\.ts'" src/share plugins/share-view-plugin/src middleware.ts`
  and `test -f scripts/ts-resolve-hooks.mjs`.
- **Remedy:** copy `src/share/`, `plugins/share-view-plugin/src/`, `scripts/ts-resolve-hooks.mjs`,
  `scripts/ts-resolve-loader.mjs`; drop the `.ts` from the import in `middleware.ts`; point
  `test:share` in package.json at the hook; remove `allowImportingTsExtensions` from tsconfig.

### wiki-template v1.1.2 (unfurl bots reach the share layer)

The family middleware waved link-preview bots through before anything else ran, which was
right when the only things below it were a block and a gate. A share address exists only as
a rewrite, so a bot sent straight to the static site got a 404 and the shared link unfurled
as nothing. The unfurl exemption now skips the block and the gate and NOT the share layer.

- **Detector:** on a live gated wiki, `curl -s -o /dev/null -w '%{http_code}' -A Twitterbot/1.0 <a share url>`
  answers 200. In source: the unfurl early-return sits AFTER the `handleShare` call.
- **Remedy:** in `middleware.ts`, compute `isUnfurlBot` once, make the bot-block `!isUnfurlBot && BLOCKED`,
  and move `if (isUnfurlBot) return undefined;` to after `handleShare`.

### wiki-template v1.1.3 (the schema knows the gate block)

`scripts/unlock-link.mjs` has read `gate.unlockParam` from `wiki.config.json` since v1.0.0, but
`wiki.config.schema.json` (`additionalProperties: false`) never declared it, so an editor flagged
the one line a deviating wiki needs and nobody wrote it: reallife's CLI was quietly trying
`?key=` on a `?password=` gate until 2026-09-12. The schema now carries `gate.unlockParam`.

- **Detector:** `grep -q '"gate"' wiki.config.schema.json`.
- **Remedy:** copy `wiki.config.schema.json` from the template (it only grew). A wiki whose
  gate uses a parameter other than `key` sets `"gate": { "unlockParam": "password" }` in its
  `wiki.config.json`; the others change nothing.
