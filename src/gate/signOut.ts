// Sign out of a gated wiki: one address that forgets every credential the wiki ever set.
//
// Any site that signs a reader in owes them a way out (Gary, 2026-09-20: "Anytime that there's
// an authentication system, should there be a way to log out? I think so"). `/sign-out` expires
// BOTH cookies this family issues, the account grant and the password ticket, because the
// middleware does not know which gate is in front of it and a reader does not care. It then
// lands on the wiki's front page, which the gate answers with its door carrying a
// "you are signed out" line (`?signed-out`).
//
// It signs out of THIS wiki only. The Freedom portal's own Google session is a different site's
// cookie and is ended there; the door says so, because a reader who taps Sign in straight after
// will be bounced back in without a prompt and would otherwise wonder whether sign-out worked.
//
// EDGE-SAFE: no Node built-ins.

export const SIGN_OUT_PATH = '/sign-out';
export const SIGNED_OUT_PARAM = 'signed-out';

/** Every cookie a family gate has ever set, by name. Add here when a gate adds one. */
export const GATE_COOKIES = ['fw_gate', 'wiki_gate'];

const expire = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Whether this request is the sign-out address. Trailing slash tolerated, method ignored:
 *  a link is a GET and a form may POST, and both mean the same thing. */
export function isSignOut(url: URL): boolean {
  return url.pathname === SIGN_OUT_PATH || url.pathname === SIGN_OUT_PATH + '/';
}

/** The response that signs a reader out, or undefined when this is not that request. */
export function handleSignOut(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (!isSignOut(url)) return undefined;
  const headers = new Headers({ location: `/?${SIGNED_OUT_PARAM}`, 'cache-control': 'no-store' });
  for (const name of GATE_COOKIES) headers.append('set-cookie', expire(name));
  return new Response(null, { status: 303, headers });
}

/** Whether a door is being shown right after a sign-out, so it can say so. */
export function justSignedOut(url: URL): boolean {
  return url.searchParams.has(SIGNED_OUT_PARAM);
}
