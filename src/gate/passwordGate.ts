// The family password gate, as a GateFn for createMiddleware.
//
// Lifted from supersuit-wiki/middleware.ts (the password-only gate that stood alone
// because the older family gate could not run without Google identity), keeping the
// same cookie name, cookie version, HMAC ticket, `?key=` prefill and comparison
// semantics, so a wiki moving onto the package keeps every ticket it has issued.
//
//   export default createMiddleware({ gate: createPasswordGate() });
//
// DARK unless both WIKI_PASSWORD and WIKI_GATE_SECRET are set: with no password the
// gate returns undefined and createMiddleware runs open. A password with no secret
// fails OPEN with an `x-wiki-gate` header naming the misconfiguration, matching the
// family's never-brick-the-wiki posture, so a half-configured gate is visible rather
// than silently absent.
//
// CAPITALIZATION DOES NOT MATTER (Gary, 2026-09-11: "any capitalization of that word
// should work"): both sides are trimmed and lowercased.
//
// A PRELOADED LINK is `<any page>?key=<password>`. It sets the ticket cookie and 303s
// to the clean URL, so the reader lands ON the page and the key never rides along into
// anything they share. Thirty days later the cookie expires and the door reappears.
//
// EDGE-SAFE: Web Crypto only, no Node built-ins.

import type { GateFn, GateVerdict } from '../middleware';

export interface PasswordGateOptions {
  /** Defaults to process.env.WIKI_PASSWORD, read per request. */
  password?: string;
  /** Defaults to process.env.WIKI_GATE_SECRET, read per request. */
  secret?: string;
  /** The query parameter a prefilled link carries. `key` is the family convention. */
  unlockParam?: string;
  /** Ticket lifetime. Default thirty days. */
  maxAgeSeconds?: number;
  /** Shown on the door. Defaults to the request host. */
  title?: string;
}

declare const process: { env: Record<string, string | undefined> };

const COOKIE_NAME = 'wiki_gate';
const COOKIE_VERSION = 'v1';
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30;

// Machine paths stay open with the gate on, so hosted skills, llms.txt and audio keep
// working for agents and players that cannot answer a door.
const MACHINE_PATH_PATTERN = /\.(?:md|txt|mp3|mp4|m4a|wav|pdf)$/i;
const MACHINE_PREFIX_PATTERN = /^\/(llms\.txt|skills\/|generators\/)/;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

export async function hasValidTicket(request: Request, secret: string): Promise<boolean> {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return false;
  const [version, expires, signature] = raw.split('.');
  if (version !== COOKIE_VERSION || !expires || !signature) return false;
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
  const expected = await sign(`${version}.${expires}`, secret);
  return constantTimeEqual(signature, expected);
}

async function issueTicket(secret: string, maxAge: number): Promise<string> {
  const expires = String(Math.floor(Date.now() / 1000) + maxAge);
  const payload = `${COOKIE_VERSION}.${expires}`;
  return `${payload}.${await sign(payload, secret)}`;
}

function ticketCookie(ticket: string, maxAge: number): string {
  return `${COOKIE_NAME}=${ticket}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure; HttpOnly`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One neutral door that names the wiki by its host, so nothing per-wiki is needed.
export function gatePage(title: string, wrongAnswer: boolean): string {
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
  h1 { font-size: clamp(1.5rem, 5vw, 1.9rem); line-height: 1.2; margin: 0 0 1rem; }
  p { margin: 0 0 1.1rem; color: #3c3a34; }
  input[type="password"] { width: 100%; font-size: 1rem; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 0.7rem 0.85rem; font-family: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { display: inline-block; font-size: 1rem; font-weight: 600; color: #fff; background: var(--accent); border: 1px solid var(--accent); border-radius: 6px; padding: 0.7rem 1.4rem; cursor: pointer; font-family: inherit; }
  button:hover { filter: brightness(1.08); }
  .error { color: #a3543c; font-size: 0.95rem; margin: 0 0 1rem; }
  .actions { margin-top: 1.25rem; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">${t}</p>
  <h1>This wiki opens with a password.</h1>
  <p>If someone sent you here, they can tell you the word.</p>
  ${wrongAnswer ? '<p class="error">Not it. Ask whoever sent you the link.</p>' : ''}
  <form method="POST">
    <input type="password" name="password" placeholder="the password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Password" autofocus />
    <div class="actions"><button type="submit">Come in</button></div>
  </form>
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

function redirect(location: string, setCookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** Continue to the underlying route while saying why the gate is not running.
 *  `x-middleware-next` is the platform's documented way to say "keep going". */
function passThroughWithWarning(reason: string): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1', 'x-wiki-gate': reason } });
}

/**
 * Returns a GateFn, or undefined when there is no password to gate with, so
 * `createMiddleware({ gate: createPasswordGate() })` is an open wiki until the env
 * variable is set and a gated one the moment it is.
 */
export function createPasswordGate(opts: PasswordGateOptions = {}): GateFn | undefined {
  const envPassword = opts.password ?? process.env.WIKI_PASSWORD ?? '';
  if (!envPassword) return undefined;
  const unlockParam = opts.unlockParam ?? 'key';
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE;

  return async function passwordGate(request: Request): Promise<GateVerdict> {
    const password = opts.password ?? process.env.WIKI_PASSWORD ?? '';
    const secret = opts.secret ?? process.env.WIKI_GATE_SECRET ?? '';
    const url = new URL(request.url);
    if (!password) return { authorized: true };
    if (!secret) return { authorized: false, response: passThroughWithWarning('gate-misconfigured-no-secret') };

    if (MACHINE_PATH_PATTERN.test(url.pathname) || MACHINE_PREFIX_PATTERN.test(url.pathname)) {
      return { authorized: true };
    }

    if (request.method === 'POST') {
      const body = await request.text();
      const submitted = new URLSearchParams(body).get('password') ?? '';
      if (normalize(submitted) !== normalize(password)) {
        return { authorized: false, response: htmlResponse(gatePage(opts.title ?? url.host, true), 401) };
      }
      return {
        authorized: false,
        response: redirect(url.pathname + url.search, [ticketCookie(await issueTicket(secret, maxAge), maxAge)]),
      };
    }

    if (await hasValidTicket(request, secret)) return { authorized: true };

    const key = url.searchParams.get(unlockParam);
    if (key !== null && normalize(key) === normalize(password)) {
      const clean = new URL(url.toString());
      clean.searchParams.delete(unlockParam);
      return {
        authorized: false,
        response: redirect(clean.pathname + (clean.search || '') + clean.hash, [
          ticketCookie(await issueTicket(secret, maxAge), maxAge),
        ]),
      };
    }

    return { authorized: false, response: htmlResponse(gatePage(opts.title ?? url.host, false), 401) };
  };
}
