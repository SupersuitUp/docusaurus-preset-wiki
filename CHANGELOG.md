# Changelog

`@supersuit/docusaurus-preset-wiki`. One entry per version, newest first. Before the package
existed, the same framework shipped as copied files from `SupersuitUp/wiki-template`, and that
repo's `UPGRADE-LEDGER.md` recorded each version with a detector and a remedy; those entries are
carried in below under "Before the package" so the history reads in one place.

## 1.12.1 (2026-09-23)

**The same defect was in four places, not two.** 1.12.0 fixed the link gate and the changelog plugin. Sweeping for other copies of "derives a doc URL from the `docs/` tree without applying `routeBasePath`" found two more, both shipping 404s on any wiki whose docs are not at the root.

- **Search results.** `buildSearchIndex` built every entry's `path` from the file path or the frontmatter slug with no base, so on a moved wiki **every search hit was a 404**. The plugin now passes the base in.
- **`llms.txt` and `llms-full.txt`.** Every URL in the agent-facing index was built as `$BASE_URL/$url_path` straight off the docs tree, so the whole index pointed at 404s. On an edge knowledge wiki, whose first reader is an agent, this was the worst of the four. The base is folded into `BASE_URL` in the bridge rather than threaded through the shell script.
- **One reader per input, and a test that they agree.** `src/route-base.ts` (from `siteConfig`, for plugins) and `src/cli/docs-base.mjs` (from the config file, for CLI gates that run before Docusaurus). Two exist because the inputs genuinely differ; `src/route-base.test.mjs` holds them to identical answers on identical inputs, so a fix cannot land in one and not the other. The changelog plugin, the search plugin and `check-links` all now delegate rather than carry their own copy.
- **The contract is `''` for a root-mounted wiki**, so the base composes by concatenation and every caller's falsy check means the same thing. A caller still passing `'/'` is accepted and treated as no base, so it cannot double-prefix.
- **DETECTOR:** on a wiki with a non-root `routeBasePath`, open `llms.txt` and follow any URL, and run a search and follow any hit. A 404 from either is this defect. Both are invisible from the build, which reports success.
- **REMEDY:** `pnpm update @supersuit/docusaurus-preset-wiki`, rebuild, redeploy. Root-mounted wikis are unaffected: every path normalizes to the previous behaviour.
- 14 new tests (4 search, 5 cross-reader agreement, plus the 1.12.0 suites now covering the shared module). The search tests were verified to FAIL without the fix: 3 of 4 bite.

## 1.12.0 (2026-09-23)

**Both link gates now know where the docs actually live.** A wiki that moves its docs so a homepage can own `/` (`routeBasePath: '/wiki'`) was served two independent, silent 404 factories, and together they held a production deploy at an hour stale while every local check read green.

- **`check-links` read `routeBasePath` instead of assuming `/`.** It derives routes from the `docs/` tree, so with no knowledge of the base it built every route one prefix short and then INVERTED its own verdict: correct links were reported broken and broken ones passed. It told an agent to strip the `/wiki` prefix off 20 correct links across a corpus. The local build passed, because Docusaurus' `onBrokenLinks` does not fire locally on 3.10.1, and five consecutive Vercel production builds failed, because it does fire on a clean CI install. Both config spellings are read: the declared `docs.routeBasePath` preset option and the imperative `classic[1].docs.routeBasePath = '...'` assignment used where the preset hardcodes the option; an imperative assignment wins, being an override. `--route-base <path>` overrides both. A root base normalizes to empty, so **nothing changes for a wiki whose docs are at `/`**.
- The detected base now prints on success (`41 routes under /wiki`) and the failure hint names it. What made this expensive was that the output gave no sign the gate held a different idea of the routes than the build did. The footer no longer claims `onBrokenLinks` never fires; it is unreliable locally and does fire on a clean CI install.
- `check-links.mjs` guards its CLI behind `main()`. Importing the module for its pure helpers walked a directory, printed, and called `process.exit`, which silently truncated its own first test run to one test.
- **`creation-date` moves changelog routes under the docs base.** `routePathFor` builds a route from a page's own `slug:`, which Docusaurus resolves relative to `routeBasePath`, so on a moved wiki every changelog link was a 404. The plugin is the only layer that can see both halves, so the prefix is applied there rather than threaded through the collector.
- **DETECTOR:** on a wiki with a non-root `routeBasePath`, run `wiki check links`. If it reports zero problems while the site's own in-docs links omit the base, or reports the prefixed links as broken, this defect is present. The honest confirmation is a clean-install build (CI), where `onBrokenLinks` fires.
- **REMEDY:** `pnpm update @supersuit/docusaurus-preset-wiki`, then prefix in-docs links with the base. Every instance's range is a caret, so no `package.json` edit is needed. Root-mounted wikis need no action.
- 14 tests: 9 in `src/cli/check-links.test.mjs` covering both directions of the inversion and both config spellings, 5 in `src/plugins/creation-date/route-base.test.mjs` including the double-prefix case, which would be a silent 404 of its own.

## 1.11.0 (2026-09-22)

**Dark mode follows the stylesheet again.** Every text colour here now reads a `--wiki-*` token that declares its dark value in this same file, so a rule and the dark half of that rule cannot be separated by an edit to either one.

- Thirteen hardcoded light-mode colours became seven tokens (`--wiki-text-body`, `-heading`, `-lede`, `-quote`, `-sidebar`, `-faint`, `--wiki-code-color`), each with a `[data-theme='dark']` value. An instance may still override any token or any rule in its own `custom.css`; those selectors carry `[data-theme='dark']` and win on specificity either way.
- **The defect.** Dark mode lived in each instance's `custom.css` keyed to `h1 + p`. 1.8.0 moved the definition line here to `:is(h1, header, .doc-meta-slot) + p`, because the meta row now sits between the title and the line. The instance overrides stopped matching, this file kept applying, and the italic definition line under every H1 rendered `#555` on a near-black page: **2.5:1, against a 4.5:1 floor.** Measured on 16 of the 20 live wikis that could be read; it read as a styling opinion rather than a defect and shipped for a month.
- **DETECTOR** (live site or built output, not source): load a doc page, set `data-theme="dark"`, and compute the WCAG contrast of the definition line's computed `color` against its effective background. Below 4.5 is the defect. A source grep encodes one spelling of it; this encodes the defect.
- **REMEDY** for an instance: `pnpm update @supersuit/docusaurus-preset-wiki`, rebuild, deploy. Every instance's range is a caret, so no `package.json` edit is needed. The stale `h1 + p` dark block in an instance's `custom.css` becomes dead code and is harmless; it can be deleted whenever that file is next touched.
- `src/theme/wiki.css.test.mjs` refuses a raw text colour in a rule, a token with no dark value, a dark token below 4.5:1 on `#111111`, and a definition-line selector that has lost the meta row.

## 1.10.2

- On a gated wiki, a `/_wiki/read` beacon from someone the gate would not let in is dropped instead of counted as an `anonymous` read. Nobody reads a gated page without passing the door, so those pings were scripts and stale tabs, and they outnumbered the real reads on the first dashboard (2026-09-21). Still answered 204. Open wikis are unchanged.

## 1.10.1

- `wiki gate set` no longer mints or rotates `WIKI_GATE_SECRET` on a `freedom-account` wiki. The hourly `?k=` key is derived by the portal from ITS secret, so a wiki-local one meant every key link met the door (supersuit.wiki, found 2026-09-21 by the first named-key read). New `--key-secret "<portal's WIKI_GATE_SECRET>"` sets it; without it the command says the key links open the wiki only if the value already matches.

## 1.10.0 (2026-09-21)

**The hourly key can say who it was issued to.** 1.9.0 logged every reader who came in on the portal's `?k=` link as `reader: "key"`, because the bare key proves an account asked this hour and not which one (the gap named in the reader-analytics design doc).

- The account gate accepts a NAMED key beside the bare one: `<uid>.<sig>`, uid matching the gate's UID rule, sig = first 32 hex of HMAC-SHA256(`WIKI_GATE_SECRET`, `wiki-gate:<hour>:<uid>`), valid this hour and the last. Its grant carries the uid, so `verdict.reader` and every analytics event it buys name the account. The bare key is unchanged and still grants `key`.
- `namedHourKey(secret, at, uid)` is exported. The portal's `/api/wiki-key` returns it as `named` beside the unchanged `key`; the Freedom plugin prefers it, older plugins ignore it. The test holds it to a node:crypto oracle and to a fixed vector the portal's test shares.
- A wrong uid, a forged or foreign-secret sig, a stale hour or a malformed value is the door with no cookie.

## 1.9.0 (2026-09-21)

**Reader analytics: who actually reads a gated wiki.** Gary, 2026-09-21: "I want analytics on who's actually reading our wikis ... a really great default thing that we can instrument into our Docusaurus template on NPM." Design: `projects/2026-09-13-wiki-framework-as-a-package/documents/2026-09-21-205834-wiki-reader-analytics-design.md` in the workspace.

- **A client module** (`src/analytics/client.ts`, registered by the theme's `getClientModules`) beacons `{path, title, ref}` to `/_wiki/read` on every route, `ref` on the first only, with `sendBeacon` (fetch `keepalive` as the fallback). Skipped under `navigator.webdriver`, on localhost, at SSR, and on a same-page hash or query change.
- **The middleware names the reader, never the browser.** `/_wiki/read` runs right after the bot block and is always `204`. The reader is the gate's verdict on the same cookies presented as a GET, so the password gate never parses a beacon as its form. `GateVerdict` gains `reader?`: the account gate sets the grant's uid (`key` for an hourly-key grant), the password gate sets `password`. Door knocks (a 401 HTML refusal of a GET, prefetches excluded) and served share mirrors are logged too, as `kind: "door"` and `kind: "share"`. Unfurl bots are never counted.
- **The event and its signature** are fixed by the design doc so the portal receiver can be built against it: `{ v: 1, kind, host, path, title?, ref?, reader, at, country?, device }`, posted with `x-wiki-read-sig` = first 32 hex of HMAC-SHA256(pass secret, `wiki-read:v1:` + body). No IP, no User-Agent, and `ref` is cut to origin + path so a credential in a referring query string never leaves the edge. The test holds the signature to a node:crypto oracle.
- **On by default only where it means something**: a `freedom-account` gate reports to `<origin of signInUrl>/api/wiki-reads` (exposed as the gate's `readSink`); `analytics: { endpoint }` in wiki.config.json (new, in the schema) or `WIKI_ANALYTICS_URL` names another; `analytics: false` turns it off; an open wiki with no endpoint sends nothing. `createMiddlewareFromConfig` reads the block.
- **The middleware takes Vercel's `(request, context)`** and hands each send to `context.waitUntil`, else awaits it for at most 800 ms. A sink failure never changes a response.
- `src/analytics/reads.ts` imports nothing from the rest of the package, so a wiki not yet on it can mirror the one file (getfreedom-wiki does).

## 1.8.2 (2026-09-20)

- `wiki upgrade` re-reads package.json after the package manager has written the new specifier before it adds `prepare`. 1.8.1 wrote the object it had read BEFORE the install back over the file, so the dependency line went back to its old range while the lockfile carried the new one, and all 17 wikis upgraded that evening failed their Vercel install with `ERR_PNPM_OUTDATED_LOCKFILE` (repaired by hand, one commit each). `addPrepareToPackageJson` is the tested piece.

## 1.8.1 (2026-09-20)

Two rules that had lived in one wiki's copy of the creation-date plugin each, lifted into the shared collector. They were committed under a force-moved `v1.8.0` tag after 1.8.0 had already published, and the publish workflow rightly refused the version, so they ship here.

- A changelog row whose page has since been deleted keeps its event and loses its link, on every build. The snapshot row still carried the route the page had the day it was written, a shallow clone never regenerates rows, and the changelog then linked a page that was gone: the production build failed on a broken link while the laptop build (full clone, fresh snapshot) passed. getfreedom-wiki fixed this in its own copy of the plugin on 2026-09-05 and the fix never reached the package or any other wiki; lifted here with a test.
- A page hidden with a `_` prefix and later restored gets its history back (birthday, updates, changelog rows); one still carrying the underscore, or hidden and then deleted, leaks nothing. appliedai-wiki carried this in its own copy of the collector since 2026-08-12 (unhiding nine drafts); lifted with a test.

## 1.8.0 (2026-09-20)

Every page shows Created / Updated, in production, in the share mirror, and on the pages the changelog leaves out. Gary, 2026-09-20: "why dont the supersuit and the freedom wikis or so many of the articles not have create and edit dates on the articles - fix and lift all boats - this should be default on for wikis". Three gaps, measured that day, each closed at its source:

- **The snapshot no longer goes stale.** Production reads `src/data/changelog-events.json` because Vercel's clone is shallow, and until now only a local build on a full clone rewrote it, and someone then had to commit it. A page committed after the last refresh had dates only while its commit sat inside the clone window (about ten doc-touching commits); getfreedom-wiki takes thirty commits a day, so three pages had no dates in the 17:27 deploy. `wiki refresh-dates` rewrites the snapshot from full history and stages it; `wiki install-hooks` writes the pre-commit hook that runs it (idempotent, keeps any hook already there, worktrees share it); `wiki migrate` and `wiki upgrade` give the instance `"prepare": "wiki install-hooks"` so every install and every clone gets the hook. The snapshot then lags HEAD by exactly one commit and HEAD is always inside the window, so the merge is complete. A shallow build that still cannot date a page WARNS with the list and the fix, instead of rendering nothing. `--check` exits 1 when the snapshot is behind, for CI.
- **Every page is dated, not only the changelog's.** The plugin now publishes `pageDates` (created, updated, keyed by docKey) for every built page BEFORE the changelog exclusions, so section indexes, `intro` and the front page carry dates while `/changelog` still does not list itself. On a shallow clone `created` comes only from a genuine "new" event inside the window; the oldest visible edit of an older page is never called its birthday. `PageDates` looks its page up by `useDoc().metadata.source`, which is exact, and falls back to the route match through the event stream for a snapshot written before this release. The snapshot file carries both; an old one still reads.
- **The row is server-rendered.** `DocItem/Content` is ejected from theme-classic (fifteen lines, kept verbatim) and renders `DocMetaRow` in the tree under the H1: after the synthetic `<header><h1>` when frontmatter titles the page, and, through a placement context and the new `MDXComponents/Heading` wrapper, after the markdown `# Title` when the page writes its own. No portal, no `useEffect`, no flash; the chrome-less `/s/<sig>/<route>` mirror is derived from the built HTML and therefore shows the dates for the first time (its CSS now hides only `.doc-share-button`, not the whole `.doc-meta-slot`). `wiki.css` styles the italic definition line as the paragraph after `h1`, `header` OR `.doc-meta-slot`: the old `h1 + p` never matched a synthetic-title page and stopped matching a content-H1 page the moment the portal put the row there, so the 1.1rem grey line had been rendering as body text on every wiki. `@docusaurus/plugin-content-docs` is deliberately NOT declared as a peer: as `^3.10.1` it pulled 3.10.2 beside theme-classic's pinned 3.10.1 and the two DocProvider contexts broke every page; undeclared, the import lands on the one copy the site already has.
- The fixture test installs the PACKED tarball rather than a `file:` link (a link resolves to the checkout and its own node_modules shadow the site's), and asserts the row is in the static HTML on both title paths, on the front page, and in the mirror; that `refresh-dates --check` sees the build's snapshot as current, a doc commit makes it stale, and the hook carries the refresh into the next commit.

## 1.7.0 (2026-09-20)

- **The gate is declared in `wiki.config.json`.** `createMiddlewareFromConfig(wiki)` reads the `gate` block (`type`: `password`, the default; `freedom-account`; `none`; plus `unlockParam`, `machinePaths`, `signInUrl`, `openPaths`, `grantDays`, `title`, all in the schema) and builds bot-block, share layer and the declared gate, so switching a wiki from open to password to Freedom-account is a config edit and never an edit to middleware.ts (Gary, 2026-09-20: "make it an easy built in wiki config for the npm package"). An unknown type refuses at construction rather than silently opening. The template's middleware.ts, the fixture site and both `wiki migrate` shapes now emit this form; a migrated password gate writes `{ type: 'password', machinePaths: 'gated' }` into the config rather than into the middleware. `gateFromConfig` and `unlockParamFor` are exported beside it.
- `wiki gate set --type freedom-account [--pass-secret <the portal's>]` writes `gate.type`, sets `WIKI_PASS_SECRET`, mints the family secrets if absent, DELETES `WIKI_PASSWORD` (it would open nothing and read as a lock in the dashboard), reads every value back by length, redeploys, and runs the account checks live: 401 with the sign-in link and no password form, the hourly `?k=` link 303s clean, the grant admits, a wrong key and a password link are refused, GPTBot 403, Twitterbot 200, og card and manifest open. `wiki gate status` and `wiki gate link` on an account wiki need no password: the key is read from the project. `set --type password --password "<word>"` goes back.
- `pnpm share` (`wiki share`) on a freedom-account wiki: the unlock parameter is `k` by type, the credential is `WIKI_KEY` (the portal's hourly account key, which the Freedom plugin's `wikiKey()` fetches with the operator's own login), and every message names the account key rather than a password.
- `createFreedomAccountGate({ signInUrl, secret?, keySecret?, grantDays?, openPaths?, title? })`: a GateFn for a wiki that is for people running Freedom. A stranger meets one card whose button goes to the Freedom portal's sign-in (`<signInUrl>?to=<url>`, default `https://freedom.continentalworks.ai/wiki/sign-in`); the portal runs its Google sign-in, checks the account is active with the same check the CLI uses, and bounces back with `?pass=v1.<uid>.<exp>.<sig>`, which the gate swaps for a seven-day `fw_gate` grant cookie and a 303 to the clean URL. The portal's hourly `?k=` key keeps opening the door, this hour and the last, so an operator's links from `/freedom:profile` never meet it. Pass and grant are HMAC-SHA256 over `wiki-pass:`/`wiki-grant:` labels with `WIKI_PASS_SECRET` (falling back to `WIKI_GATE_SECRET`); the test holds the Web Crypto side to a node:crypto oracle, which is what the portal signs with. Machine paths (skills, generators, llms.txt, media) are served first, before any redemption, so a keyed fetch of a SKILL.md is one request and never a 303 (freedom#137); `openPaths` replaces that default for a wiki whose `/skills/` is a docs reference. No secret fails open with `x-wiki-gate: gate-misconfigured-no-secret`. Exported from `/middleware` with `hourKey`, `mintPass`, `grantCookieValue`, `hasValidGrant`, `DEFAULT_OPEN_PATHS`. First wikis: supersuit.wiki and getfreedom.wiki (Gary, 2026-09-20: "gated by firebase/google auth ... users of freedom only").
- `wiki check retired-words`: refuses a live page that uses a word the operator retired. Config is `retired_words` in wiki.config.json (`words[{name, pattern, since, use}]`, `exempt[]` globs); a wiki not yet on the package reads `scripts/retired-words.json` with the same shape. First entries: worklife (2026-09-19, the thing is life infrastructure). Jarvis stays per-wiki because the meta pages that say it was retired must be allowed to say so.
- `wiki hero` refuses a panel caption of fewer than four words or more than twelve, naming the offender. A caption is a short plain sentence, never a one- or two-word tag: a hero shipped with bands reading "the phone" and "the glasses" on 2026-09-18 and the rule was named from a phone ("short sentences in very plain language not just 1-2 words"). The band carries about twelve words.

## 1.6.0 (2026-09-18)

- `wiki hero` publishing keeps the full-size render. `publishHero` now writes `illustrations/<slug>.png` and the FULL recipe beside it (`asset` repo-relative, the adapter's model, prompt and refs as written, the read-back in full with `vision`, `publishedFrom` and `history`), and the served `static/.../<slug>.webp.recipe.json` is a `derive` record (`mode`, `derivedFrom`, `sourceRecipe`, `generator`, `generatedAt`, the pack id and inputs, `readback: { rounds, overruled, verdicts }`) carrying no prompt and no absolute path, which the provenance gate already accepted. Before this the only PNG went under `static/`, the optimizer unlinked it, and the 2560-wide render existed nowhere after approval while the served sidecar shipped the whole prompt and `/Users/...` ref paths. `--json` adds `sourcePng` and `sourceRecipe`.
- `--publish <png>` records `overruled: true` only when a DEFECT verdict was published over; a round that read back clean and was published from the file is not an overrule (every clean frapp approval was recorded as one, because the readback file's presence was the test). Each round's `<png>.readback.json` now carries `vision`, the model that looked, and `--publish` carries it into the recipe instead of reporting the vision as skipped.

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
