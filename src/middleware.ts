// The edge middleware of a family wiki, as one composable call.
//
// Vercel Routing Middleware (platform-level, runs before the cache).
// Two layers, in a load-bearing order:
//   1. Bot-block: known LLM training and AI-search crawlers get a hard 403 by
//      User-Agent. Compliant crawlers that ignore robots.txt still stop here.
//   2. One-page shares: /s/<sig>/<route> and /s/mint (src/share/handleShare.ts).
//      DORMANT on this open template, since a share address only redirects to a
//      page anyone can already read. A GATED wiki wires the same call in with its
//      own gate's verdict, and then the address serves the chrome-less mirror the
//      share-view plugin builds, to a reader who has no password and needs none.
// No auth or password logic here; a gated wiki adds its gate BELOW the share layer.
//
// A wiki with no gate: `export { default, config } from '@supersuit/docusaurus-preset-wiki/middleware'`.
// A gated wiki: `export default createMiddleware({ gate })`, where `gate` is its own verdict on a
// request. Order is load-bearing and lives here so no instance has to get it right again:
// bot-block 403, then the share layer, then the gate's refusal.
//
// EDGE-SAFE: this file and src/share/* import no Node built-in. Vercel's edge bundler refuses them.

import { handleShare, type ShareRequest } from './share/handleShare';
import matcherJson from './cli/matcher.json';

export { handleShare };
export type { ShareRequest };

// Minimal ambient declaration: the Vercel edge runtime provides process.env.
declare const process: { env: Record<string, string | undefined> };

// Unfurl scrapers ALWAYS pass, and this is evaluated FIRST, before any block
// or gate below. These are the bots that build link-preview cards in iMessage,
// Slack, X, WhatsApp, Discord, LinkedIn, etc. A wiki that blocks or gates them
// unfurls as a blank card everywhere a link is pasted, and nothing in the page
// source explains why. This allowlist exists so no future edit to the blocked
// pattern (Facebot, Applebot variants) can break previews by accident.
//
// GATED WIKIS: keep this same early return ahead of the password check, and
// support prefilled links (`?key=<password>` -> set cookie, 303 to the clean
// URL) so a shared link lands the reader ON the page while still unfurling
// beautifully. Live copies: supersuit-wiki/middleware.ts (password only),
// agenticbusiness-wiki/middleware.ts (password + Google identity).
export const UNFURL_BOT_PATTERN =
  /\b(facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|Applebot|redditbot|Pinterest|SkypeUriPreview|Iframely|embedly|Mastodon|Bluesky|Cardyb|vkShare)\b/i;

export const BLOCKED_BOT_PATTERN =
  /\b(GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|anthropic-ai|CCBot|Google-Extended|GoogleOther|Applebot-Extended|FacebookBot|Meta-ExternalAgent|meta-externalagent|Bytespider|PerplexityBot|Perplexity-User|Amazonbot|AI2Bot|cohere-ai|Diffbot|Omgili|ImagesiftBot|YouBot|DuckAssistBot|peer39_crawler|TimpiBot|Webzio-Extended|Kangaroo|Cotoyogi)\b/i;

export interface GateVerdict {
  authorized: boolean;
  /** What to send when not authorized: the login page, or a 303 that sets the cookie
   *  for a `?key=` prefilled link. Ignored when `authorized` is true. */
  response?: Response;
}

export type GateFn = (request: Request) => Promise<GateVerdict> | GateVerdict;

export interface MiddlewareOptions {
  /** Absent means an open wiki: every reader is authorized and share addresses redirect. */
  gate?: GateFn;
  /** The share-signing secret. Defaults to WIKI_SHARE_SECRET, then WIKI_GATE_SECRET. */
  secret?: string;
}

export function createMiddleware(opts: MiddlewareOptions = {}) {
  return async function middleware(request: Request): Promise<Response | undefined> {
    const ua = request.headers.get('user-agent') ?? '';
    const isUnfurlBot = UNFURL_BOT_PATTERN.test(ua);
    // Unfurl bots skip the BLOCK here and skip any GATE below, but they do NOT skip
    // the share layer: a share address only exists as a rewrite, so a bot waved
    // straight through to the static site 404s on it and the shared link unfurls
    // as nothing (supersuit.wiki, 2026-09-12). The layer answers a bot the same
    // way it answers a recipient, with the mirror and its og tags.
    if (!isUnfurlBot && BLOCKED_BOT_PATTERN.test(ua)) {
      return new Response(
        'Forbidden: automated training and AI-search crawlers are not permitted on this site.',
        { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    // The gate's verdict is computed before the share layer runs because the share
    // layer needs it (an authorized reader's share address redirects to the page;
    // an anonymous one gets the mirror). Its REFUSAL is sent after the share layer
    // declines, so a share recipient never meets the door.
    const gated = Boolean(opts.gate);
    const verdict: GateVerdict = opts.gate ? await opts.gate(request) : { authorized: true };
    const secret = opts.secret ?? process.env.WIKI_SHARE_SECRET ?? process.env.WIKI_GATE_SECRET ?? '';

    const share = await handleShare({
      url: new URL(request.url),
      authorized: verdict.authorized,
      secret,
      gated,
    });
    if (share) return share;

    if (isUnfurlBot) return undefined;
    if (gated && !verdict.authorized) return verdict.response;
    // Implicit undefined return lets the request continue to the static site.
    return undefined;
  };
}

  // Run on HTML routes only. Skip static assets so we do not pay function
  // invocations on every CSS, JS, image, or font fetch.
  //
  // `skills/` and `generators/` are intentionally excluded too: this wiki hosts
  // canonical agent SKILL.md and GENERATE.md files under static/skills/<name>/SKILL.md
  // and static/generators/<name>/GENERATE.md, served openly so agents (including
  // blocked-UA crawlers like ClaudeBot) can fetch and run them. The rest stays bot-blocked.
  // `webmanifest` is listed separately because it is NOT covered by `json`, and
  // that omission is the trap: every icon a manifest declares can serve a clean
  // 200 while the manifest itself is gated, so nothing on earth requests them
  // and the breakage is invisible from an asset check. Found live on a gated
  // wiki 2026-08-22. Any allowlist keyed on file extension has this hole.
// The one string an instance has to carry itself. Vercel reads `export const config`
// STATICALLY from the instance's middleware.ts, so a re-exported config is invisible to it
// and the middleware runs on every path, including the og cards and the manifest the gate
// then 401s (glory-hour-wiki, 2026-09-13, first deploy). The instance declares the literal;
// `wiki check middleware` refuses a build whose literal has drifted from this one.
export const MATCHER: string[] = matcherJson.matcher;

/** For tests and for `wiki check middleware`. An instance must NOT re-export this; it declares
 *  the same literal itself (see the README), because Vercel cannot see a re-export. */
export const config = {
  matcher: MATCHER,
  runtime: 'edge' as const,
};

/** An open wiki's middleware: bot-block and share layer, no gate. */
export default createMiddleware();

export { createPasswordGate, hasValidTicket } from './gate/passwordGate';
export type { PasswordGateOptions } from './gate/passwordGate';
export { createFreedomAccountGate, hasValidGrant, hourKey, mintPass, grantCookieValue, DEFAULT_OPEN_PATHS } from './gate/accountGate';
export type { AccountGateOptions } from './gate/accountGate';
