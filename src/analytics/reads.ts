// Reader analytics: who reads what on a gated wiki, told from the edge.
//
// Docusaurus is an SPA, so after the first HTML load no navigation reaches the middleware.
// The client module (./client.ts) therefore POSTs one beacon per route to `/_wiki/read` saying
// only WHICH page it is on; this file decides WHO that is, from the gate's verdict on the
// signed grant cookie, never from anything the browser wrote. The middleware adds the two
// things a beacon cannot see: a DOOR hit (the 401 card runs no script) and a SHARE read (the
// `/s/<sig>/<route>` mirror has every script stripped).
//
// THE EVENT: { v: 1, kind: "read"|"door"|"share", host, path, title?, ref?, reader, at,
// country?, device: "mobile"|"desktop" }. No IP and no raw User-Agent ever leave the edge, and
// `ref` is cut to origin + path so a credential in a referring query string cannot ride along.
//
// THE TRANSPORT: POST <endpoint>, `x-wiki-read-sig: <first 32 hex of HMAC-SHA256(secret,
// "wiki-read:v1:" + body)>`. The secret is the gate's pass secret (WIKI_PASS_SECRET, then
// WIKI_GATE_SECRET), which the portal that receives the event already holds, so nothing new is
// minted. The portal receiver (continental-works-web POST /api/wiki-reads) verifies the same
// label; the test beside this file holds the signature to a node:crypto oracle.
//
// ON BY DEFAULT ONLY WHERE IT MEANS SOMETHING: a freedom-account gate reports to its own portal
// (`<origin of signInUrl>/api/wiki-reads`) with zero config. `analytics: { endpoint }` or
// WIKI_ANALYTICS_URL names another sink; `analytics: false` turns it off. An open wiki with no
// endpoint sends nothing, so the public package never phones home for a stranger.
//
// A SINK NEVER CHANGES A RESPONSE. The beacon is always answered 204, every send swallows its
// own failure, and a send is handed to `context.waitUntil` when the runtime passes one, else
// awaited for at most 800 ms.
//
// EDGE-SAFE and SELF-CONTAINED: Web Crypto only, no Node built-ins, and no import from the rest
// of the package, so a wiki not yet on the package can mirror this one file.

declare const process: { env: Record<string, string | undefined> };

export const READ_PATH = '/_wiki/read';
export const READ_SIG_HEADER = 'x-wiki-read-sig';
export const READ_SIG_LABEL = 'wiki-read:v1:';
export const MAX_BEACON_BYTES = 2048;
export const NO_WAIT_CAP_MS = 800;

export type ReadKind = 'read' | 'door' | 'share';

export interface ReadEvent {
  v: 1;
  kind: ReadKind;
  host: string;
  path: string;
  title?: string;
  ref?: string;
  reader: string;
  at: string;
  country?: string;
  device: 'mobile' | 'desktop';
}

/** `analytics` in wiki.config.json: absent/true = the default, false = off, or a named sink. */
export type AnalyticsOption = boolean | { endpoint?: string; secret?: string } | undefined;

export interface ReadSink {
  endpoint: string;
  secret: string;
}

/** What Vercel passes as the middleware's second argument. Only waitUntil is used. */
export interface MiddlewareContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

const encoder = new TextEncoder();

/** The signature the portal checks: first 32 hex of HMAC-SHA256(secret, label + body). */
export async function signReadBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(READ_SIG_LABEL + body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value === '') return false;
  try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; }
};

/**
 * Where events go, or null for nowhere. `analytics: false` wins over everything; then
 * WIKI_ANALYTICS_URL; then `analytics.endpoint`; then the gate's own default (`readSink`). No
 * secret means no sink, because an unsigned event is one the receiver refuses anyway (preview
 * deploys carry no secret).
 */
export function resolveSink(
  analytics: AnalyticsOption,
  gateDefault: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ReadSink | null {
  if (analytics === false) return null;
  const named = typeof analytics === 'object' && analytics !== null ? analytics : {};
  const endpoint = [env.WIKI_ANALYTICS_URL, named.endpoint, gateDefault].find(isHttpUrl);
  const secret = named.secret || env.WIKI_PASS_SECRET || env.WIKI_GATE_SECRET || '';
  if (!endpoint || !secret) return null;
  return { endpoint, secret };
}

/** A site-absolute route, normalized the way the share layer's canonicalRoute is: one leading
 *  slash, no trailing slash but the root's, no query, no fragment, no `..` or `//`. A full URL
 *  is accepted only when its host is this one. Null for anything else. */
export function sameSiteRoute(input: unknown, host: string): string | null {
  if (typeof input !== 'string' || input === '' || input.length > 1024) return null;
  let route = input;
  if (/^https?:\/\//i.test(route)) {
    try {
      const u = new URL(route);
      if (u.host !== host) return null;
      route = u.pathname;
    } catch { return null; }
  }
  route = route.split('#')[0].split('?')[0];
  if (!route.startsWith('/')) return null;
  if (route.includes('//') || route.includes('..')) return null;
  if (!/^[A-Za-z0-9\-._~/%]*$/.test(route)) return null;
  if (route.length > 1) route = route.replace(/\/+$/, '');
  return route || '/';
}

/** A referrer cut to origin + path, so a `?pass=` or `?k=` in it never leaves the edge. */
export function cleanRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return (u.origin + u.pathname).slice(0, 300);
  } catch { return undefined; }
}

const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i;
export const deviceOf = (ua: string | null): 'mobile' | 'desktop' => (ua && MOBILE_UA.test(ua) ? 'mobile' : 'desktop');

export interface EventParts {
  kind: ReadKind;
  path: string;
  reader: string;
  title?: unknown;
  ref?: unknown;
  now?: Date;
}

/** One event, from the request and the parts the caller knows. Nothing here reads a cookie. */
export function buildEvent(request: Request, parts: EventParts): ReadEvent {
  const url = new URL(request.url);
  const event: ReadEvent = {
    v: 1,
    kind: parts.kind,
    host: url.host,
    path: parts.path,
    reader: parts.reader,
    at: (parts.now ?? new Date()).toISOString(),
    device: deviceOf(request.headers.get('user-agent')),
  };
  if (typeof parts.title === 'string' && parts.title.trim()) event.title = parts.title.trim().slice(0, 200);
  const ref = cleanRef(parts.ref);
  if (ref) event.ref = ref;
  const country = request.headers.get('x-vercel-ip-country');
  if (country && /^[A-Z]{2}$/.test(country)) event.country = country;
  return event;
}

/** The event a `/_wiki/read` beacon describes, or null when the body is not one: too big, not
 *  JSON, or a path that is not a route on this site. */
export async function eventFromBeacon(request: Request, reader: string): Promise<ReadEvent | null> {
  if (request.method !== 'POST') return null;
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BEACON_BYTES) return null;
  let text: string;
  try { text = await request.text(); } catch { return null; }
  if (encoder.encode(text).length > MAX_BEACON_BYTES) return null;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const b = body as { path?: unknown; title?: unknown; ref?: unknown };
  const host = new URL(request.url).host;
  const path = sameSiteRoute(b.path, host);
  if (path === null) return null;
  return buildEvent(request, { kind: 'read', path, reader, title: b.title, ref: b.ref });
}

/** What `/_wiki/read` always answers, whatever happened. */
export function readAck(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/** POST one signed event. Never throws. */
export async function sendEvent(sink: ReadSink, event: ReadEvent, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const body = JSON.stringify(event);
    const sig = await signReadBody(sink.secret, body);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', [READ_SIG_HEADER]: sig },
      body,
    };
    const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
    if (typeof timeout === 'function') init.signal = timeout.call(AbortSignal, 5000);
    await fetchImpl(sink.endpoint, init);
  } catch {
    // A sink that is down, slow or refusing never reaches the reader.
  }
}

/** Hand a send to the runtime (waitUntil), else wait for it at most NO_WAIT_CAP_MS. */
export async function dispatch(send: Promise<unknown>, context?: MiddlewareContext): Promise<void> {
  const safe = send.catch(() => undefined);
  if (context && typeof context.waitUntil === 'function') {
    try { context.waitUntil(safe); return; } catch { /* fall through to the capped wait */ }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([safe, new Promise<void>((resolve) => { timer = setTimeout(resolve, NO_WAIT_CAP_MS); })]);
  if (timer !== undefined) clearTimeout(timer);
}

/** Is this GET a real page view, as opposed to a prefetch or a speculative load? */
export function isPrefetch(request: Request): boolean {
  const purpose = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''} ${request.headers.get('x-purpose') ?? ''}`;
  return /prefetch|prerender|preview/i.test(purpose);
}
