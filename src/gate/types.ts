// The contract between createMiddleware and a gate. Its own file so a gate can be mirrored
// into a wiki that is not yet on the package (the mirror carries this file beside it), and so
// the middleware and every gate agree on one definition.

export interface GateVerdict {
  authorized: boolean;
  /** What to send when not authorized: the login page, or a 303 that sets the cookie
   *  for a `?key=` prefilled link. Ignored when `authorized` is true. */
  response?: Response;
}

export type GateFn = (request: Request) => Promise<GateVerdict> | GateVerdict;
