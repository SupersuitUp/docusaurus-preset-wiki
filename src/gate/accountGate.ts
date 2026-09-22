// The Freedom account gate, as a GateFn for createMiddleware.
//
//   export default createMiddleware({ gate: createFreedomAccountGate({ signInUrl }) });
//
// A wiki behind this gate is for people running Freedom. A stranger meets one card with one
// button, "Sign in with your Freedom account", which goes to the portal's sign-in page carrying
// the page they asked for (`<signInUrl>?to=<url>`). The portal runs the Google sign-in it
// already has, checks the account is active (the SAME check the portal and the CLI use, so a
// revoked account is refused here the moment it is refused there), and sends the reader back
// with a short-lived PASS: `<url>?pass=v1.<uid>.<exp>.<sig>`. The gate verifies the pass, swaps
// it for a week-long GRANT cookie, and 303s to the clean URL so the pass never sits in the
// address bar, the history or a referer.
//
// THE PASS AND THE GRANT ARE SIGNED WITH ONE SHARED SECRET, the portal's and the wiki's. The
// portal signs with node:crypto, this file verifies with Web Crypto, and the test beside this
// file holds both to a node:crypto oracle so neither can drift without the other's test saying
// so. Default `WIKI_PASS_SECRET`, falling back to `WIKI_GATE_SECRET`.
//
// THE HOURLY KEY STILL OPENS THE DOOR. Freedom's portal header and `/freedom:profile` put
// `?k=<hourly key>` on every wiki link, derived from `WIKI_GATE_SECRET` in the portal's
// `/api/wiki-key`. That path is kept, byte for byte, so an operator already running Freedom
// never meets the door. `keySecret` defaults to `WIKI_GATE_SECRET`, then the pass secret.
//
// THE KEY CAN NAME ITS HOLDER (1.10.0). A bare key (32 hex) proves an account asked this hour,
// not which one, so its grant and every read it buys say `key`. A NAMED key, `<uid>.<sig>` with
// sig = HMAC(`wiki-gate:<hour>:<uid>`), is what `/api/wiki-key` now hands back beside the bare one
// as `named`: same secret, same two-hour window, but the grant carries the account id, so reader
// analytics name the reader. Both shapes are accepted; old plugins keep sending the bare one.
//
// WHY THE SIGN-IN LIVES ON THE PORTAL AND NOT ON THE WIKI. The wiki is a static site behind an
// edge function; the portal already has the Firebase project, the Google OAuth client, the
// authorized domain, the entitlement check and the revocation path. Putting a second sign-in
// on each wiki means a second copy of every one of those, and a second place a revocation has
// to reach. One sign-in, one check, N wikis.
//
// MACHINE PATHS STAY OPEN by default (hosted skills, generators, llms.txt, audio, video, pdf):
// an agent fetching a SKILL.md cannot answer a door. `openPaths` REPLACES that default for a
// wiki where the default is wrong, such as one whose `/skills/` prefix is a docs reference and
// only the `.md` files under it are for agents.
//
// A MISSING SECRET FAILS OPEN with an `x-wiki-gate` header naming the misconfiguration, the
// family's never-brick-the-wiki posture: preview deploys carry no secret.
//
// EDGE-SAFE: Web Crypto only, no Node built-ins.

import type { GateFn, GateVerdict } from './types';
import { justSignedOut } from './signOut';

export interface AccountGateOptions {
  /** The portal page that signs a reader in and bounces them back: `<signInUrl>?to=<url>`. */
  signInUrl?: string;
  /** Signs the pass and the grant. Defaults to WIKI_PASS_SECRET, then WIKI_GATE_SECRET, read per request. */
  secret?: string;
  /** Verifies the hourly `?k=` key. Defaults to WIKI_GATE_SECRET, then `secret`. */
  keySecret?: string;
  /** How long a grant lasts. Default seven days. */
  grantDays?: number;
  /** Replaces the default machine-path pattern: paths matching it are served with no grant. */
  openPaths?: RegExp;
  /** Shown on the door. Defaults to the request host. */
  title?: string;
}

declare const process: { env: Record<string, string | undefined> };

export const GRANT_COOKIE = 'fw_gate';
const PASS_PARAM = 'pass';
const KEY_PARAM = 'k';
const VERSION = 'v1';
const HOUR_MS = 3_600_000;
const DEFAULT_GRANT_DAYS = 7;
const DEFAULT_SIGN_IN = 'https://freedom.continentalworks.ai/wiki/sign-in';
/** Hosted skills and generators, llms.txt, and the media a player fetches. */
export const DEFAULT_OPEN_PATHS = /^\/(llms\.txt|llms-full\.txt|skills\/|generators\/)|\.(?:md|txt|mp3|mp4|m4a|wav|pdf)$/i;
// A uid is a Firebase uid (28 url-safe characters) or the word `key` for a grant the hourly
// key bought. Nothing else may appear between the dots.
const UID = /^[A-Za-z0-9_-]{1,64}$/;

const encoder = new TextEncoder();

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** The portal's hourly key, derived identically in continental-works-web/src/app/api/wiki-key. */
export const hourKey = (secret: string, at: number) => hmacHex(secret, `wiki-gate:${Math.floor(at / HOUR_MS)}`);

/** The portal's NAMED hourly key, `<uid>.<sig>` with sig over `wiki-gate:<hour>:<uid>`. Its grant
 *  carries `uid`, so reads it buys are named. Minted in continental-works-web's wiki-key route. */
export async function namedHourKey(secret: string, at: number, uid: string): Promise<string> {
  if (!UID.test(uid)) throw new Error(`namedHourKey: uid must match ${UID}`);
  return `${uid}.${await hmacHex(secret, `wiki-gate:${Math.floor(at / HOUR_MS)}:${uid}`)}`;
}

/** The uid a `?k=` value buys: `key` for the bare hourly key, the named uid for `<uid>.<sig>`,
 *  null when it is neither, this hour or the last. */
async function keyHolder(k: string, secret: string, now: number): Promise<string | null> {
  for (const at of [now, now - HOUR_MS]) {
    if (/^[a-f0-9]{32}$/.test(k)) {
      if (constantTimeEqual(k, await hourKey(secret, at))) return 'key';
      continue;
    }
    const dot = k.indexOf('.');
    if (dot === -1) return null;
    const uid = k.slice(0, dot);
    const sig = k.slice(dot + 1);
    if (!UID.test(uid) || !/^[a-f0-9]{32}$/.test(sig)) return null;
    if (constantTimeEqual(k, await namedHourKey(secret, at, uid))) return uid;
  }
  return null;
}

/** A pass: `v1.<uid>.<exp>.<sig>`, exp in unix seconds. Minted by the portal; exported for tests and tooling. */
export async function mintPass(secret: string, uid: string, exp: number): Promise<string> {
  const payload = `${VERSION}.${uid}.${exp}`;
  return `${payload}.${await hmacHex(secret, `wiki-pass:${payload}`)}`;
}

/** A grant: the cookie value, same shape as a pass under a different label so one cannot stand in for the other. */
export async function grantCookieValue(secret: string, uid: string, exp: number): Promise<string> {
  const payload = `${VERSION}.${uid}.${exp}`;
  return `${payload}.${await hmacHex(secret, `wiki-grant:${payload}`)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parse and verify a `v1.<uid>.<exp>.<sig>` token under `label` (`wiki-pass` or `wiki-grant`). */
async function verifyToken(raw: string | null, secret: string, label: string, nowSeconds: number): Promise<{ uid: string } | null> {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [version, uid, exp, sig] = parts;
  if (version !== VERSION || !UID.test(uid) || !/^\d{1,12}$/.test(exp) || !/^[a-f0-9]{32}$/.test(sig)) return null;
  if (Number(exp) < nowSeconds) return null;
  const expected = await hmacHex(secret, `${label}:${version}.${uid}.${exp}`);
  return constantTimeEqual(sig, expected) ? { uid } : null;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The uid a live grant names (`key` for one the hourly key bought), or null when there is none. */
export async function grantReader(request: Request, secret: string, now = Date.now()): Promise<string | null> {
  const ok = await verifyToken(readCookie(request, GRANT_COOKIE), secret, 'wiki-grant', Math.floor(now / 1000));
  return ok ? ok.uid : null;
}

/** Does this request hold a live grant? Exported so a share layer can ask the same question. */
export async function hasValidGrant(request: Request, secret: string, now = Date.now()): Promise<boolean> {
  return (await grantReader(request, secret, now)) !== null;
}

/** Where reader analytics go for a wiki behind this gate, with no config: the portal that signs
 *  its passes, `<origin of signInUrl>/api/wiki-reads`. Null when signInUrl is not a URL. */
export function readSinkFor(signInUrl: string = DEFAULT_SIGN_IN): string | null {
  try { return new URL('/api/wiki-reads', signInUrl).toString(); } catch { return null; }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One neutral door that names the wiki by its host. It says nothing about WHAT the program is
// (Gary, 2026-09-20: "should not mention the word Freedom ... more ambiguous"): a stranger learns
// only that the site is gated and that an invited Google account opens it. The button carries the
// page the reader asked for, so signing in lands them on it rather than on the front page.
export interface DoorState {
  /** The pass on the link was expired or wrong. */
  expired?: boolean;
  /** The reader just signed out of this wiki. */
  signedOut?: boolean;
}

export function doorPage(title: string, signInHref: string, state: DoorState | boolean = {}): string {
  const { expired = false, signedOut = false } = typeof state === 'boolean' ? { expired: state } : state;
  const t = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="robots" content="noindex" />
<style>
  :root { --ink: #1c1c1a; --paper: #fdfcf9; --card: #ffffff; --muted: #6d6a63; --line: #e5e1d8; --accent: #2f6f5f; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--paper); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.65; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
  main { width: 100%; max-width: 32rem; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 2.25rem 2rem; }
  .eyebrow { font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin: 0 0 0.9rem; font-weight: 600; }
  h1 { font-size: clamp(1.4rem, 5vw, 1.75rem); line-height: 1.25; margin: 0 0 1rem; }
  p { margin: 0 0 1.1rem; color: #3c3a34; }
  a.button { display: inline-block; font-size: 1rem; font-weight: 600; color: #fff; background: var(--accent); border: 1px solid var(--accent); border-radius: 6px; padding: 0.7rem 1.4rem; text-decoration: none; }
  a.button:hover { filter: brightness(1.08); }
  a.button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error { color: #a3543c; font-size: 0.95rem; margin: 0 0 1rem; }
  .note { color: var(--accent); font-size: 0.95rem; margin: 0 0 1rem; }
  .actions { margin-top: 1.25rem; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">${t}</p>
  <h1>This website is gated to those who are part of an early access program.</h1>
  <p>Sign in with the Google account you were invited with and you will land back on this page.</p>
  ${signedOut ? '<p class="note">You are signed out of this site. Signing in again is one tap unless you also signed out of the account itself.</p>' : ''}
  ${expired ? '<p class="error">That sign-in link expired. Sign in again and it will bring you straight here.</p>' : ''}
  <div class="actions"><a class="button" href="${escapeHtml(signInHref)}">Sign in</a></div>
</main>
</body>
</html>`;
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

function redirect(location: string, setCookie: string): Response {
  return new Response(null, { status: 303, headers: { location, 'set-cookie': setCookie, 'cache-control': 'no-store' } });
}

function passThroughWithWarning(reason: string): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1', 'x-wiki-gate': reason } });
}

export function createFreedomAccountGate(opts: AccountGateOptions = {}): GateFn {
  const signInUrl = opts.signInUrl ?? DEFAULT_SIGN_IN;
  const grantDays = opts.grantDays ?? DEFAULT_GRANT_DAYS;
  const openPaths = opts.openPaths ?? DEFAULT_OPEN_PATHS;

  const gate: GateFn = async function accountGate(request: Request): Promise<GateVerdict> {
    const secret = opts.secret ?? process.env.WIKI_PASS_SECRET ?? process.env.WIKI_GATE_SECRET ?? '';
    const keySecret = opts.keySecret ?? process.env.WIKI_GATE_SECRET ?? secret;
    const url = new URL(request.url);
    if (!secret) return { authorized: false, response: passThroughWithWarning('gate-misconfigured-no-secret') };

    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const grantMaxAge = grantDays * 86400;
    const grantCookie = async (uid: string) =>
      `${GRANT_COOKIE}=${await grantCookieValue(secret, uid, nowSeconds + grantMaxAge)}; Path=/; Max-Age=${grantMaxAge}; HttpOnly; Secure; SameSite=Lax`;
    const cleanUrl = (drop: string) => {
      const clean = new URL(url.toString());
      clean.searchParams.delete(drop);
      return clean;
    };
    const redeem = async (uid: string, drop: string) => {
      const clean = cleanUrl(drop);
      return { authorized: false, response: redirect(clean.pathname + (clean.search || '') + clean.hash, await grantCookie(uid)) };
    };

    // AN OPEN PATH IS SERVED FIRST, credential or not. A machine path is fetched by a program
    // with no cookie jar, so a 303 that sets a grant is an instruction it cannot follow, and a
    // correct key would read as a refusal (freedom#137, on the password gate). No grant is lost:
    // the next HTML page with the same credential redeems it.
    if (openPaths.test(url.pathname)) return { authorized: true };

    // A PASS OR A KEY IS REDEEMED ON ANY OTHER PATH, gated or not, so a keyed link to the wiki's
    // front page still buys the grant that the first click into a gated page needs.
    const pass = url.searchParams.get(PASS_PARAM);
    let passExpired = false;
    if (pass !== null) {
      const ok = await verifyToken(pass, secret, 'wiki-pass', nowSeconds);
      if (ok) return redeem(ok.uid, PASS_PARAM);
      passExpired = true;
    }
    const k = url.searchParams.get(KEY_PARAM);
    if (k !== null) {
      const holder = await keyHolder(k, keySecret, now);
      if (holder !== null) return redeem(holder, KEY_PARAM);
    }

    const reader = await grantReader(request, secret, now);
    if (reader !== null) return { authorized: true, reader };

    // The door, carrying the page they asked for with any spent credential stripped off.
    const back = cleanUrl(PASS_PARAM);
    back.searchParams.delete(KEY_PARAM);
    back.searchParams.delete('signed-out');
    const signInHref = `${signInUrl}?to=${encodeURIComponent(back.toString())}`;
    return {
      authorized: false,
      response: htmlResponse(doorPage(opts.title ?? url.host, signInHref, { expired: passExpired, signedOut: justSignedOut(url) }), 401),
    };
  };
  const sink = readSinkFor(signInUrl);
  if (sink) gate.readSink = sink;
  return gate;
}
