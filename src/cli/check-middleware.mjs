#!/usr/bin/env node
// Does this instance's middleware.ts carry the family matcher LITERALLY?
//
// Vercel reads `export const config = { matcher: [...] }` statically from the middleware
// file. A re-export (`export { config } from '@supersuit/...'`) or an imported constant is
// invisible to it, so the middleware runs on EVERY path, and a gated wiki then 401s its own
// og cards, manifest and fonts. Found live on the first deploy of a gated instance
// (2026-09-13): the page served, the share card was blank, and nothing in the build said why.
//
// So the literal lives in the instance, and this check refuses a build where it has drifted
// from the package's copy (src/cli/matcher.json, which the runtime MATCHER also reads).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const HERE = dirname(fileURLToPath(import.meta.url));
const file = join(ROOT, "middleware.ts");

if (!existsSync(file)) {
  console.log("[middleware] no middleware.ts; nothing to check");
  process.exit(0);
}
const src = readFileSync(file, "utf8");
const { matcher } = JSON.parse(readFileSync(join(HERE, "matcher.json"), "utf8"));
// The JSON value is the regex text; in TS source each backslash is written doubled.
const literal = matcher[0].replace(/\\/g, "\\\\");

const problems = [];
if (/export\s*\{[^}]*\bconfig\b[^}]*\}\s*from/.test(src)) {
  problems.push("`config` is RE-EXPORTED from the package. Vercel cannot see it; declare `export const config = { matcher: [...], runtime: 'edge' }` in this file.");
}
if (!/export\s+const\s+config\s*=/.test(src)) {
  problems.push("no `export const config = { ... }` in middleware.ts; the middleware will run on every path.");
}
if (!src.includes(`'${literal}'`) && !src.includes(`"${literal}"`)) {
  problems.push("the matcher literal differs from the package's (or is missing). Copy it exactly:\n    '" + literal + "'");
}
if (problems.length) {
  console.error("[middleware] " + problems.join("\n[middleware] "));
  process.exit(1);
}
console.log("[middleware] ok: config declared literally, matcher matches the package");
