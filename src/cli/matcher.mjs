// Which middleware matcher literal a wiki must carry, by the name wiki.config.json gives it.
//
// The family matcher skips `skills/` and `generators/` wholesale, because on most wikis those
// prefixes hold agent files served openly (static/skills/<name>/SKILL.md). On a wiki whose
// /skills/* routes are gated DOCS PAGES (getfreedom, where the skill reference sits behind the
// account), that exclusion publishes the reference: the middleware never runs, so the gate never
// sees the request. Such a wiki names the `skills-are-pages` variant, which lets /skills/ reach
// the gate and instead skips only the files an agent fetches (.md, .json). The bulk exports
// (llms.txt, llms-full.txt, search-index.json) reach the gate, which keys them: until
// 2026-10-28 this variant skipped them too, and the gated Supersuit Wiki's whole text was one
// curl away (supersuit-wiki#15). The family matcher skipped every .json until the same day, so
// a gated wiki on it served search-index.json open (docusaurus-preset-wiki#7); it now carves
// search-index.json out of the .json skip the same way. Retired literals stay in matcher.json
// under `retired`, so `wiki check middleware` can say why an instance's copy is stale.
//
// A named variant rather than a free-form literal, so `wiki check middleware` still refuses
// drift: an instance may pick among the package's literals, never write its own.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MATCHERS = JSON.parse(readFileSync(join(HERE, 'matcher.json'), 'utf8'));

export const MATCHER_NAMES = ['default', ...Object.keys(MATCHERS.variants ?? {})];

/** The matcher array for a variant name; `default` (or nothing) is the family matcher. */
export function matcherFor(name) {
  if (!name || name === 'default') return MATCHERS.matcher;
  const v = MATCHERS.variants?.[name];
  if (!v) throw new Error(`unknown matcher "${name}" in wiki.config.json; one of: ${MATCHER_NAMES.join(', ')}`);
  return v;
}

/** The first matcher entry as it is written in TS source: each backslash doubled. */
export function matcherSource(name) {
  return matcherFor(name)[0].replace(/\\/g, '\\\\');
}

/** Literals the package used to ship, in TS source form, each with why it was retired. */
export function retiredMatchers() {
  return (MATCHERS.retired ?? []).map((r) => ({ source: r.matcher.replace(/\\/g, '\\\\'), why: r.why }));
}

/** The variant name a wiki root declares (`matcher` in wiki.config.json), or undefined. */
export function declaredMatcher(root) {
  const f = join(root, 'wiki.config.json');
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, 'utf8')).matcher;
}
