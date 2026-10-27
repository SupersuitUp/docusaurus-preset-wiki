// SUPERLINKS ON A WIKI (superlinks step 4, 2026-10-26): one article sent to one person as a link
// that knows which link it is. The one-page share (./signedRoute.ts) names the page and nobody;
// a superlink also carries an opaque id, the link it was forwarded from, the article's forward
// setting at mint, and an optional expiry, all under one signature, so the edge can check it with
// no database:
//
//   /s/<rid>.<parent|0>.<f><exp|0>.<sig>/<route>      f: n (off), s (signed-in), o (open)
//
// WHO IT IS FOR NEVER RIDES IN THE LINK. Anyone holding a link can read what is in it, so a name
// inside would tell a forwardee who it was first sent to. The id-to-person map is written once, at
// mint, into the operator's own reads sink (a `mint` event), and every read through the link names
// only the id. Shutting one link is a committed list of ids the edge reads; a shut id shuts every
// link forwarded from it, because the parent is part of what is signed.
//
// Pure, Web Crypto only: runs in the edge runtime, the browser and under `node --test` unchanged.

import { SHARE_PREFIX, canonicalRoute } from './signedRoute';

export type ForwardMode = 'off' | 'signed-in' | 'open';
const FLAG: Record<ForwardMode, string> = { off: 'n', 'signed-in': 's', open: 'o' };
const MODE: Record<string, ForwardMode> = { n: 'off', s: 'signed-in', o: 'open' };
const DOMAIN = 'wiki-superlink:v1:';
const TOKEN = /^([a-z0-9]{12})\.([a-z0-9]{12}|0)\.([nso])([0-9a-z]{1,9})\.([A-Za-z0-9_-]{22})$/;
const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(DOMAIN + message))).slice(0, 22);
}

function newRid(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const body = (route: string, rid: string, parent: string, flag: string, exp: string) => `${route}\n${rid}.${parent}.${flag}${exp}`;

/** A new superlink to one route. Null with no secret or an unshareable route. */
export async function mintSuperlink(
  secret: string,
  route: string,
  opts: { forward: ForwardMode; parent?: string; expires?: Date },
): Promise<{ rid: string; path: string } | null> {
  const canonical = canonicalRoute(route);
  if (!secret || canonical === null) return null;
  const rid = newRid();
  const parent = opts.parent && /^[a-z0-9]{12}$/.test(opts.parent) ? opts.parent : '0';
  const exp = opts.expires ? Math.floor(opts.expires.getTime() / 1000).toString(36) : '0';
  const flag = FLAG[opts.forward] ?? 'n';
  const sig = await sign(secret, body(canonical, rid, parent, flag, exp));
  const token = `${rid}.${parent}.${flag}${exp}.${sig}`;
  return { rid, path: canonical === '/' ? `${SHARE_PREFIX}${token}` : `${SHARE_PREFIX}${token}${canonical}` };
}

/** /s/<token>/<route> -> its parts, or null when the path is not shaped like a superlink. */
export function parseSuperlink(pathname: string) {
  if (!pathname.startsWith(SHARE_PREFIX)) return null;
  const rest = pathname.slice(SHARE_PREFIX.length);
  const slash = rest.indexOf('/');
  const m = TOKEN.exec(slash === -1 ? rest : rest.slice(0, slash));
  if (!m) return null;
  const route = canonicalRoute(slash === -1 ? '/' : rest.slice(slash));
  if (route === null) return null;
  return { rid: m[1], parent: m[2], flag: m[3], exp: m[4], sig: m[5], route };
}

export type SuperlinkVerdict =
  | { state: 'open'; route: string; rid: string; parent: string | null; forward: ForwardMode }
  | { state: 'shut' | 'expired'; rid: string };

/** The verdict on a superlink path: open (with its route), shut (its id or its parent's is on the
 *  shut list), expired, or null when it is not a genuine superlink under this secret. */
export async function verifySuperlink(
  secret: string,
  pathname: string,
  opts: { now?: number; shut?: readonly string[] } = {},
): Promise<SuperlinkVerdict | null> {
  const p = parseSuperlink(pathname);
  if (!p || !secret) return null;
  const expected = await sign(secret, body(p.route, p.rid, p.parent, p.flag, p.exp));
  if (expected.length !== p.sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ p.sig.charCodeAt(i);
  if (diff !== 0) return null;
  const shut = opts.shut ?? [];
  if (shut.includes(p.rid) || (p.parent !== '0' && shut.includes(p.parent))) return { state: 'shut', rid: p.rid };
  if (p.exp !== '0' && parseInt(p.exp, 36) * 1000 <= (opts.now ?? Date.now())) return { state: 'expired', rid: p.rid };
  return { state: 'open', route: p.route, rid: p.rid, parent: p.parent === '0' ? null : p.parent, forward: MODE[p.flag] };
}
