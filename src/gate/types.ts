// The contract between createMiddleware and a gate. Its own file so a gate can be mirrored
// into a wiki that is not yet on the package (the mirror carries this file beside it), and so
// the middleware and every gate agree on one definition.

export interface GateVerdict {
  authorized: boolean;
  /** What to send when not authorized: the login page, or a 303 that sets the cookie
   *  for a `?key=` prefilled link. Ignored when `authorized` is true. */
  response?: Response;
  /** WHO an authorized reader is, for reader analytics (src/analytics/reads.ts). The account
   *  gate sets the grant's uid (`key` for a grant the hourly key bought); the password gate sets
   *  `password`, since a shared word names nobody. Absent means unknown, and the event says
   *  `anonymous`. Never read from anything the browser can write. */
  reader?: string;
  /** Set by a gate in ACT mode (accountGate `mode: 'act'`) on an authorized verdict whose reader may
   *  READ but may not ACT (mint a share or superlink). `signInUrl`: no grant, so the share layer
   *  sends them to sign in and back. `refused`: signed in, but not an account this wiki lets act.
   *  Absent: whoever is authorized may act, as every gate before act mode. */
  cannotAct?: { signInUrl: string } | { refused: 'not_allowed' };
}

/** A gate is a function; `readSink` is the analytics endpoint it implies with no config, if any
 *  (the account gate's portal: `<origin of signInUrl>/api/wiki-reads`). */
export type GateFn = ((request: Request) => Promise<GateVerdict> | GateVerdict) & { readSink?: string };
