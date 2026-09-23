// WHERE THE DOCS ACTUALLY LIVE, for the CLI gates.
//
// A wiki that moves its docs so a homepage can own `/` (`routeBasePath: '/wiki'`) serves
// docs/sources/x.md at /wiki/sources/x. Anything that derives a doc URL from the docs/ tree
// and does not apply this base emits a 404, silently, for every page.
//
// Four separate places in this package did exactly that, found in one sweep on 2026-09-23:
// the link gate, the changelog plugin, the search index, and llms.txt. That is the shape of
// this defect: it is never in one place, because deriving a route from a file path is the
// obvious thing to write and nothing about writing it prompts you to ask where the docs are
// mounted.
//
// There are deliberately TWO readers of this setting in the package and they take different
// inputs: this one reads the config FILE, because a CLI gate runs before Docusaurus does and
// has no LoadContext; `src/route-base.ts` reads `siteConfig`, because a plugin has one and
// should not be re-parsing source. `src/route-base.test.ts` asserts the two agree on the same
// fixture, so they cannot drift apart unnoticed.
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** "" for root, otherwise "/wiki" with no trailing slash. */
export function normalizeDocsBase(v) {
  const t = String(v ?? "").trim();
  if (!t || t === "/") return "";
  return "/" + t.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * The docs routeBasePath for the wiki rooted at `root`, read from its Docusaurus config.
 * Both spellings are supported: the declared `docs: { routeBasePath }` preset option, and the
 * imperative `classic[1].docs.routeBasePath = '/wiki'` assignment some configs use because the
 * preset hardcodes the option. An imperative assignment wins, being an override of whatever
 * the preset declared.
 */
export function docsRouteBasePathFromConfigFile(root, override = null) {
  if (override) return normalizeDocsBase(override);
  for (const name of ["docusaurus.config.ts", "docusaurus.config.js",
                      "docusaurus.config.mjs", "docusaurus.config.cjs"]) {
    const f = join(root, name);
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    const imperative = /\bdocs\s*\.\s*routeBasePath\s*=\s*['"`]([^'"`]+)['"`]/.exec(src);
    if (imperative) return normalizeDocsBase(imperative[1]);
    const declared = /\bdocs\s*:\s*\{[\s\S]{0,4000}?\brouteBasePath\s*:\s*['"`]([^'"`]+)['"`]/.exec(src);
    if (declared) return normalizeDocsBase(declared[1]);
  }
  return "";
}
