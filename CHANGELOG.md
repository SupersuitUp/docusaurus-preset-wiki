# Changelog

`@supersuit/docusaurus-preset-wiki`. One entry per version, newest first. Before the package
existed, the same framework shipped as copied files from `SupersuitUp/wiki-template`, and that
repo's `UPGRADE-LEDGER.md` recorded each version with a detector and a remedy; those entries are
carried in below under "Before the package" so the history reads in one place.

## 1.6.0 (2026-09-18)

- `wiki hero <slug>`: one command that renders a page's hero through the wiki's Style Pack, reads it back, and publishes it. The `hero` block of `wiki.config.json` (or a legacy `hero_register`, migrated in memory: its register sentence becomes an inline pack, `multipanel` becomes `row`, and no layout at all becomes `row`, which is what the shell door had been rendering all along) supplies the pack, the layout, the size, the model and the declared props; the page supplies `--title`, `--labels` and `--beats`. The compiler puts the style line, the palette, the row or two-by-two grid law, the beats verbatim, the prop law, the exact-spelling text law and the pack's negatives into one prompt with the anchor first, up to three style refs and every prop photo last, and `--dry-run` prints all of it as JSON for nothing. The render goes through the Agentic Brand Universe on-brand-image adapter (`$ABU_ADAPTER`, else the newest installed `abu` plugin), falling back to the wiki's own `illustrations/scripts/generate.py` with a printed note that entities and `--ref-first` are not on that path, else a refusal naming the install. The pack is applied ONCE, by the compiler, so ABU is handed the prompt and the refs and never `--style-pack`, which would append the style line and the poles a second time and cannot read a migrated register anyway. Read-back is one Responses API call (OPENAI_API_KEY, model in `WIKI_HERO_VISION_MODEL`) carrying the PNG and every assertion: the five wiki-layer gate lines, the pack's, the wiki's, the adapter's own `guardGate`, and one per declared string checked character for character, answered in strict JSON and parsed strictly, because a read-back that guesses is a gate that is open. A DEFECT re-rolls with every defect seen so far appended as corrections (the union across rounds, so a fixed defect cannot quietly return untold), up to three rounds; `--tier fast` renders the flare model at high, 1536x1024, never the wiki's premium size; one that survives publishes nothing and exits 3. The winner is published through `optimize-images.py`, now able to take the files to convert as arguments, so the hero satisfies the weight gate by the very code that enforces it and its recipe carries the same transform record as every other converted image, plus `readback: { rounds, verdicts, history }`, the pack id and the inputs; the published recipe passes `wiki check provenance` by test. Every round's verdicts are written beside it as `<png>.readback.json`, ABU's own convention, and `--publish <png>` publishes a round a person has looked at and overruled, rendering nothing, asking nothing, and carrying those verdicts into the recipe marked `overruled`. `--write` puts `image:` in the page's frontmatter and the image line under its italic definition, idempotently; `--json` prints `{ png, webp, recipe, verdicts, rounds, history }` for a frapp to read. `readHeroConfig` returns `root`, so a caller resolving relative prop paths never splices it in. First real render, hyperdocumentation-wiki's capture page through ABU 1.29.1: three rounds, each refused by the read-back, one of the four surviving defects being a line in that wiki's own `gate` that only fits its start-here page; the third round was published by hand with `--publish` and the wiki's weight and provenance gates passed on it.
- `wiki hero` reads three more things. A pack's `pairings` (a string each, or the `{ rule, subject, shownAs, from, at }` entry the hero-review frapp writes with Make-it-a-rule) are emitted as one "Standing rules for every scene:" block between the layout law and the beats, one line each, deduplicated; until now the frapp wrote them and nothing read them. `hero.tier` (`best` or `fast`) is the tier a render runs at when no `--tier` flag is given, and the recipe records the tier that actually ran. A prop under `hero.props` may be `{ refs, gate }` as well as a bare list of photos; its `gate` lines join the read-back only on a render that passes that prop, so a wiki-wide gate holds only wiki-wide truths (hyperdocumentation's "smart glasses match the prop photos" moves onto the prop, and its "labeling happens in the machine" becomes a pairing of the watercolor pack). `readHeroConfig` hands every prop back as `{ refs, gate }` whichever way the file wrote it, and `normalizeProp` is exported for the CLI's ad hoc `--prop name=path`, which merges into the declared prop instead of replacing it. The schema carries `tier` and the two prop shapes.

## 1.5.0 (2026-09-17)

- `wiki migrate` no longer overwrites a wiki's own password gate with an open one. The template never shipped a password gate ("a gated wiki adds its gate BELOW the share layer"), so every pre-package `middleware.ts` that reads `WIKI_PASSWORD` was written by a person, and the step that treated it as the template's and replaced it with `createPasswordGate()` was replacing a hand-written door with the family default in 100% of the cases it fired. The family default leaves machine paths OPEN, so a private wiki whose own gate covered `.md` and `.txt` came out of a SUCCESSFUL migration serving `/llms-full.txt`, its entire corpus in one file, to anyone holding the URL, for about twenty minutes, with every live check green because they ask about the home page and about assets. Now the operator's file is kept byte for byte as `middleware.pre-package.ts` (the same pattern the config step already used), the package gate is written CLOSED (`createPasswordGate({ machinePaths: 'gated' })`, because the false positive costs a re-run and the false negative costs a published corpus), a NEEDS A PERSON note names the two files, and the verb exits 3 so nothing downstream commits or pushes it. `middlewareKind(text)` is exported and tested: `open`, `password`, or `identity`, with identity winning over password because such a file reads both. The fixture test asserts the exit code, the kept file, the closed gate and that the written literal still passes `wiki check middleware`, and was watched fail against both an open gate and a silent exit. Reported with the fix for the consuming skill by @brayantenesaca10-boop (ContinentalWorks/freedom#159, freedom-dev#164); this is the producer half, so a migration run by hand rather than through Freedom is covered too.

## 1.4.0 (2026-09-16)

- `machinePaths: 'gated'` now SERVES a machine path to a correct `?key=`, in one request, instead of 303ing to a clean URL and setting a ticket. The redirect is right for an HTML page, where it gets the password out of the address bar, out of the referer and out of history, and leaves a cookie so the rest of the visit needs no key. Every one of those reasons is about a browser. A machine path is fetched by a program: no address bar to clean, and frequently no cookie jar, so the redirect was an instruction the caller could not follow. A single stateless `fetch` landed on the clean URL carrying no ticket, got a 401, and reported it as a wrong password: `registry.mjs probe --key` printed `llmsFull: "gated: the key was refused"` on a wiki whose password was correct and where `curl -L -c jar -b jar` returned the whole file. So `machinePaths: 'gated'` was unusable by the only caller it exists for, and its own done-condition could never be met. Reported by @brayantenesaca10-boop (ContinentalWorks/freedom#137), who worked around it by hand-writing a gate that does exactly this, which is the tell that the shipped one was wrong. No access is granted that the redirect did not already grant, since a caller with the right password could always get there in two requests with a jar; what goes is the jar. A page still redirects, pinned by its own test so the machine-path case cannot widen into it, and a wrong key or no key is still 401 on both.

## 1.3.1 (2026-09-15)

- The paragraph inside a blockquote kept the `.markdown p` bottom margin, and that margin sits INSIDE the left rule, so every quote on every wiki rendered with a blank line hanging off its end. Measured on supersuit.wiki before the fix: 4px of space above the text and 25.6px below, against a 27.2px line height, which is why the quote reads as sagging rather than as evenly padded. Zeroing the margins on the first and last child makes the rule wrap the text evenly at 4px / 4px, and leaves the gap BETWEEN paragraphs of a multi-paragraph quote untouched, because only the outer children match. Reported by the owner off a phone screenshot, which is the only place it is obvious: on a wide column the trailing gap reads as ordinary padding. The fixture test asserts the reset survives minification into the shipped bundle, because nothing fails when the rule is dropped and the quote simply sags again. Every wiki still carrying the framework as copied files got the same fix in its own `custom.css` the same day, so a migration onto this package does not regress it.

## 1.3.0 (2026-09-14)

- `@supersuit/docusaurus-preset-wiki/figures` exports `<Loop>`, the drawn cycle the new check points at when it refuses a typed one. A gate that names a rule and leaves each wiki to invent the remedy gets worked around, and the remedy here is not obvious: the first hand-written version of this figure got two things wrong that a reader would have paid for. An arrowhead sized with ONE number for length and width comes out near-equilateral, so at page size the eye cannot tell which corner is the tip and the loop reads as having no direction; and a wide ring squeezed into a phone column renders its labels at about six CSS pixels, so `<Loop>` ships a stacked layout under 700px chosen by media query, off the same beats array, and the two cannot disagree. Geometry is computed from one ellipse and N angles rather than hand-placed, `currentColor` makes one asset correct in both themes, and the generated `aria-label` reads the beats in order, which is the half of a figure a fenced ASCII ring cannot carry at all. Usage: `<Loop beats={[...]} middle={[...]} caption="..." />`.

- `wiki check ascii-diagrams`, new and in the default prebuild order between `admonitions` and `links`. A diagram on a page is RENDERED, never typed out of dashes, pipes and arrows inside a fence: the typed kind cannot theme with the page, is unreadable on a phone column, and hands a screen reader a wall of punctuation. It is also the cheapest thing in the world to write and it looks correct in the editor it was aligned in, so nothing downstream ever complains. The check reads only fences with NO language tag, and needs several lines carrying box marks plus at least one line that is nothing but marks, so a real code fence, a markdown table and an arrow in prose all pass untouched. Nine tests, six of them negatives, because a gate that fires on real code gets switched off and is then worse than having none. Earned on supersuit.wiki, where a new concept page shipped a four-beat loop as a fenced ASCII ring and the only thing that caught it was the owner reading the page. The failure message names the fix and points at `supersuit-wiki src/components/ImaginationLoop/`, which also carries the two things a first attempt at a drawn figure gets wrong: an arrowhead sized with one number for length and width comes out near-equilateral and reads as having no direction, and a wide ring squeezed into a phone column renders its labels at about six CSS pixels. Two false positives were found by sweeping all 30 registered wikis before this shipped anywhere, and both are now tests: a DIRECTORY TREE is built from the same box-drawing characters as a picture and is the correct way to show a repo layout, and a fence carrying Docusaurus meta (```bash title="Terminal", ```js {1,3}) was not recognised as an opener at all, so its CLOSER was read as an untagged opener and the prose after an ordinary shell block was scanned as fence contents. The sweep now reports two real diagrams across the fleet, which is the number a gate should find on the day it lands.

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
