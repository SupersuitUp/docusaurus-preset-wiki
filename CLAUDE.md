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
