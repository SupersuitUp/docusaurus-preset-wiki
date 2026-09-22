// The reader-analytics beacon, a Docusaurus client module (the theme registers it).
//
// On every route the SPA renders, including the first, it tells the wiki's own edge which page
// is on screen: `POST /_wiki/read {path, title, ref}`. That is ALL it says. Who the reader is
// comes from the signed grant cookie at the edge (src/analytics/reads.ts), never from here; no
// cookie is set, no third-party script is loaded, nothing is fingerprinted.
//
// Harmless anywhere: at build (SSR) nothing runs, on localhost it is skipped, under automation
// (`navigator.webdriver`) it is skipped, and on a wiki with no sink the edge answers 204 and
// drops it. So it ships on for every wiki rather than asking each one whether it is gated.

let first = true;
let lastPath: string | null = null;

function send(path: string): void {
  const payload: { path: string; title: string; ref?: string } = { path, title: document.title };
  if (first && document.referrer) payload.ref = document.referrer;
  first = false;
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/_wiki/read', body)) return;
  } catch { /* fall through to fetch */ }
  try {
    void fetch('/_wiki/read', { method: 'POST', body, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
  } catch { /* never let analytics break a page */ }
}

export function onRouteDidUpdate({ location }: { location: { pathname: string } }): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (navigator.webdriver) return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return;
  // A hash or query change on the same page is not a new read.
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  // The title is set by the page's head after the route renders; one tick later it is current.
  setTimeout(() => send(location.pathname), 0);
}
