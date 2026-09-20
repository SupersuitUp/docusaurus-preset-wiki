// Vercel Routing Middleware: the family bot-block, the one-page share layer, and whatever gate
// wiki.config.json declares, all from the preset. With no `gate` block this is the family
// password gate, dark until WIKI_PASSWORD and WIKI_GATE_SECRET are set on the deployment
// (`wiki gate set --password "<word>"`); `"gate": { "type": "freedom-account" }` is the door
// for people running Freedom (`wiki gate set --type freedom-account --pass-secret ...`);
// `"type": "none"` is never gated. Changing the gate is a config edit, never an edit here.
//
// A wiki with a gate of its own (an identity provider, a member list) passes its verdict
// instead: createMiddleware({ gate }), where gate returns { authorized } or { authorized: false,
// response }. Live example of that shape: agenticbusiness-wiki/middleware.ts.
import wiki from './wiki.config.json';
import { createMiddlewareFromConfig } from '@supersuit/docusaurus-preset-wiki/middleware';

export default createMiddlewareFromConfig(wiki);

// Vercel reads `config` STATICALLY from this file, so it cannot come from the package: a
// re-export is invisible to it and the middleware runs on every path, which on a gated wiki
// 401s its own og cards and manifest (found live 2026-09-13). The literal is the package's;
// `wiki check middleware` refuses a build where it drifts.
export const config = {
  matcher: [
    '/((?!assets/|img/|skills/|generators/|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.json|.*\\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map|json|webmanifest|xml)$).*)',
  ],
  runtime: 'edge',
};
