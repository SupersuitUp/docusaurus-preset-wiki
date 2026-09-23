# docusaurus-preset-wiki

## Releasing: npm publishing runs in GitHub Actions, never on this machine

**Never run `npm publish` here, and never go looking for an npm token.** There is no usable
one. `npm whoami` answers `E401` on this machine and that is the expected state rather than a
problem to solve: publishing is done by `.github/workflows/publish.yml` through **OIDC trusted
publishing**, where GitHub mints a short-lived identity for the workflow and npm verifies it
against the trusted-publisher record on the package. The credential is *who ran the workflow*.
There is deliberately no `NODE_AUTH_TOKEN` and no `registry-url` in that workflow, and adding
either one breaks the publish. The header of the workflow file explains each trap and what it
cost; read it before changing anything in there.

**The release is a tag push, and it is four steps:**

```bash
npm version minor --no-git-tag-version   # or patch/major
# write the CHANGELOG entry: what broke, the DETECTOR, the REMEDY, the tests
git add package.json package-lock.json CHANGELOG.md
git commit -m "<version>: <one line>"
git push -u origin main
git tag v<version> && git push origin v<version>
```

**Stage `package-lock.json` with `package.json`, always.** `npm version` bumps both, and the
workflow runs `npm ci`, which refuses a lockfile that disagrees with the manifest. Committing
only the manifest tags a release that cannot install. Caught on 2026-09-23 by watching the run
rather than by any check here; the remedy was a second commit, `git tag -d`, `git push origin
:refs/tags/v<version>`, and a fresh tag.

**The workflow refuses a tag that disagrees with `package.json`, and refuses a version already
on npm.** Both refusals are correct and mean you skipped a step above.

## Consumers install from the registry, so a local `lib/` fix reaches nobody

Every wiki depends on the published package with a caret range, and Vercel installs from the
registry on a clean tree. So a fix that exists only in this repo's `src/`, or only as a file
hand-copied into some wiki's `node_modules`, is invisible to every build that matters and is
deleted by the next install with nothing pointing back.

**A gate fix is not shipped until a version carrying it is on npm and the consuming wiki's
lockfile has moved.** `lib/` is gitignored and there is no `prepare` script, so a git
dependency on this repo installs an empty package. Do not reach for one.

## `onBrokenLinks` is not a check you can rely on locally

Docusaurus 3.10.1 does not fire it on this machine and **does** fire it on a clean CI install.
That asymmetry is why `src/cli/check-links.mjs` exists and why a green local build proves
nothing about a deploy. When a link change is involved, the honest verification is the CI build.

## Anything that emits a doc URL must apply the docs `routeBasePath`

**This is the defect class this package is most prone to, and it has never once appeared in
only one place.** A wiki may mount its docs anywhere (`routeBasePath: '/wiki'`, so a landing
page can own `/`). Deriving a route from a file path under `docs/`, or from a page's `slug:`,
is the obvious thing to write, and nothing about writing it prompts you to ask where the docs
are mounted. The result is a 404 on every page of whatever surface you just built, and the
build reports success.

Found in **four** separate places in one sweep on 2026-09-23: the link gate, the changelog
plugin, the search index, and `llms.txt`. Two were fixed, shipped as 1.12.0, and the other two
were found only because somebody went looking afterwards.

**So when you add or touch anything that emits a doc URL, use a shared reader:**

| You have | Use |
|---|---|
| a `LoadContext` (any plugin) | `docsRouteBasePath(context)` from `src/route-base.ts` |
| only a directory (a CLI gate, which runs before Docusaurus) | `docsRouteBasePathFromConfigFile(root)` from `src/cli/docs-base.mjs` |
| a route to move | `withBaseRoute(route, base)`, which never prefixes twice |

The contract is **`''` for a root-mounted wiki**, so the base composes by concatenation and
every caller's falsy check means the same thing. `'/'` is accepted and treated as no base.

**There are deliberately two readers, and `src/route-base.test.mjs` asserts they agree.** The
inputs genuinely differ, so one implementation is not available; what is available is a test
that fails the moment they diverge. Do not add a third reader, and do not replace that test
with a comment.

**Neither the local build nor a passing gate proves this.** `onBrokenLinks` is unreliable
locally on 3.10.1 and fires on a clean CI install, and the search index and `llms.txt` are not
checked by anything at build time at all. The honest detectors are: follow a URL out of
`llms.txt`, and follow a search hit.
