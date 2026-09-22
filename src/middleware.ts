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
//   After the block, `/_wiki/read` (src/analytics/reads.ts): the reader-analytics beacon, always
//   204, the reader named by the gate's verdict on the cookie; and door knocks and served share
//   mirrors are reported beside the responses they already were.
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
import { handleSignOut } from './gate/signOut';
import { gateFromConfig as gateFromConfigFn, type WikiGateConfig as WikiGateConfigShape } from './gate/fromConfig';
import {
  READ_PATH, readAck, eventFromBeacon, buildEvent, sendEvent, dispatch, resolveSink, sameSiteRoute, isPrefetch,
  type AnalyticsOption, type MiddlewareContext, type ReadEvent, type ReadSink,
} from './analytics/reads';

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

import type { GateFn, GateVerdict } from './gate/types';
export type { GateFn, GateVerdict };

export interface MiddlewareOptions {
  /** Absent means an open wiki: every reader is authorized and share addresses redirect. */
  gate?: GateFn;
  /** The share-signing secret. Defaults to WIKI_SHARE_SECRET, then WIKI_GATE_SECRET. */
  secret?: string;
  /** Reader analytics (src/analytics/reads.ts). Absent: the gate's default sink if it has one
   *  (the account gate's portal), else WIKI_ANALYTICS_URL, else nothing. `false` turns it off. */
  analytics?: AnalyticsOption;
  /** For tests: the fetch that carries an event to the sink. */
  fetch?: typeof fetch;
}

export {
  READ_PATH, READ_SIG_HEADER, READ_SIG_LABEL, signReadBody, resolveSink, buildEvent, sameSiteRoute,
} from './analytics/reads';
export type { ReadEvent, ReadSink, AnalyticsOption, MiddlewareContext } from './analytics/reads';

export function createMiddleware(opts: MiddlewareOptions = {}) {
  // Vercel calls routing middleware as (request, context); context.waitUntil keeps an event's
  // send alive after the response is sent. Without it the send is awaited for at most 800 ms.
  return async function middleware(request: Request, context?: MiddlewareContext): Promise<Response | undefined> {
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

    // Resolved per request because the env is. Null: nothing is ever sent.
    const sink: ReadSink | null = resolveSink(opts.analytics, opts.gate?.readSink);
    const report = (event: ReadEvent) => (sink ? dispatch(sendEvent(sink, event, opts.fetch), context) : Promise.resolve());

    // THE READ BEACON comes right after the block and before any verdict is sent: it is always
    // answered 204, reader or not, sink or not. The reader is the gate's verdict on the SAME
    // cookies presented as a GET, so a gate that reads a POST body (the password form) never
    // sees the beacon's, and the browser's claim is only ever the page.
    if (new URL(request.url).pathname === READ_PATH) {
      if (sink && request.method === 'POST') {
        let reader = 'anonymous';
        if (opts.gate) {
          try {
            const probe = await opts.gate(new Request(request.url, { method: 'GET', headers: request.headers }));
            if (probe.authorized && probe.reader) reader = probe.reader;
          } catch { /* a gate that throws names nobody */ }
        }
        const event = await eventFromBeacon(request, reader);
        if (event) await report(event);
      }
      return readAck();
    }

    // SIGN OUT comes right after the block and before any verdict: it needs no credential, it
    // is only meaningful on a gated wiki (an open one has nothing to forget, so the address is
    // left to the static site), and a reader holding a grant must be able to reach it without
    // the share layer or the gate having an opinion.
    if (opts.gate) {
      const out = handleSignOut(request);
      if (out) return out;
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
    if (share) {
      // A served mirror is a read the beacon cannot see: the mirror runs no script.
      const rewrite = share.headers.get('x-middleware-rewrite');
      if (sink && rewrite && !isUnfurlBot && !isPrefetch(request)) {
        const mirrored = new URL(rewrite).pathname.replace(/^\/share-view/, '') || '/';
        const path = sameSiteRoute(mirrored, new URL(request.url).host);
        if (path) await report(buildEvent(request, { kind: 'share', path, reader: 'share', ref: request.headers.get('referer') }));
      }
      return share;
    }

    if (isUnfurlBot) return undefined;
    if (gated && !verdict.authorized) {
      // A knock on the door is the other thing the beacon cannot see: the 401 card runs no script.
      const res = verdict.response;
      if (sink && res && res.status === 401 && request.method === 'GET' && !isPrefetch(request)
          && /text\/html/.test(res.headers.get('content-type') ?? '')) {
        const path = sameSiteRoute(new URL(request.url).pathname, new URL(request.url).host);
        if (path) await report(buildEvent(request, { kind: 'door', path, reader: 'anonymous', ref: request.headers.get('referer') }));
      }
      return res;
    }
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
export { handleSignOut, isSignOut, justSignedOut, SIGN_OUT_PATH, GATE_COOKIES } from './gate/signOut';
export type { AccountGateOptions } from './gate/accountGate';
export { gateFromConfig, unlockParamFor } from './gate/fromConfig';
export type { WikiGateConfig, WikiGateType } from './gate/fromConfig';

/**
 * The whole middleware of a wiki, from its wiki.config.json: bot-block, share layer, and the
 * gate the `gate` block declares (src/gate/fromConfig.ts). The instance's middleware.ts is then
 * two lines plus the matcher literal, and changing the gate is a config edit:
 *
 *   import wiki from './wiki.config.json';
 *   export default createMiddlewareFromConfig(wiki);
 */
export function createMiddlewareFromConfig(wiki: { gate?: WikiGateConfigShape; analytics?: AnalyticsOption }) {
  return createMiddleware({ gate: gateFromConfigFn(wiki.gate), analytics: wiki.analytics });
}
