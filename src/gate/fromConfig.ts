// The gate a wiki declares in wiki.config.json, as a GateFn, so switching a wiki from open to
// password to Freedom-account is an edit to ONE JSON block and the env, never to middleware.ts.
//
//   import wiki from './wiki.config.json';
//   export default createMiddlewareFromConfig(wiki);
//
// The block:
//
//   "gate": {
//     "type": "password" | "freedom-account" | "none",   absent = "password"
//     "unlockParam": "key",         the query parameter a preloaded link carries; defaults by type
//     "machinePaths": "open",       password gate: "gated" puts .md/.txt/media/llms behind the door
//     "signInUrl": "https://…",     account gate: the portal page that signs a reader in
//     "openPaths": "regex source",  account gate: REPLACES the default machine-path pattern
//     "grantDays": 7,               account gate: how long a sign-in lasts
//     "shareAdminsEnv": "WIKI_SHARE_ADMINS"  account gate: only these accounts mint share links
//     "mode": "read" | "act",       account gate: "act" = public to read, sign in only to share
//     "title": "…"                  what the door calls the wiki; defaults to the host
//   }
//
// "password" is the default so that every wiki already deployed keeps its behaviour: the
// family gate is dark until WIKI_PASSWORD and WIKI_GATE_SECRET are set on the project, and open
// otherwise. "freedom-account" is the door for people running Freedom (src/gate/accountGate.ts),
// and a WIKI_PASSWORD on such a project opens nothing. "none" is never gated, whatever the
// project holds, for a wiki that must stay open even if someone sets a password variable on it.
//
// A type this file does not know is an ERROR at construction, not an open wiki: the failure to
// avoid is a typo in the config quietly publishing a private wiki.
//
// EDGE-SAFE: no Node built-ins, since this is bundled into the instance's middleware.

import type { GateFn } from './types';
import { createPasswordGate } from './passwordGate';
import { createFreedomAccountGate, parseAllowList, DOOR_THEMES, GATE_MODES, type DoorTheme, type GateMode } from './accountGate';

declare const process: { env: Record<string, string | undefined> };

export type WikiGateType = 'password' | 'freedom-account' | 'none';

export interface WikiGateConfig {
  type?: WikiGateType;
  unlockParam?: string | null;
  machinePaths?: 'open' | 'gated';
  signInUrl?: string;
  openPaths?: string;
  grantDays?: number;
  title?: string;
  /** freedom-account only: the NAME of an env var holding the allowed account ids, comma-separated. */
  allowEnv?: string;
  /** freedom-account only: the NAME of an env var holding the account ids that may mint
   *  one-page share links, comma-separated. Absent: every admitted reader may. */
  shareAdminsEnv?: string;
  /** freedom-account only: the door's own heading and line, for a wiki that is not early access. */
  door?: { heading?: string; body?: string; theme?: DoorTheme };
  /** freedom-account only: `read` (default) gates every page; `act` leaves every page readable
   *  and asks for sign-in only to mint a share or superlink. */
  mode?: GateMode;
}

const TYPES: WikiGateType[] = ['password', 'freedom-account', 'none'];

/** The query parameter `pnpm share` puts a credential in: declared, else by type. null means none. */
export function unlockParamFor(gate: WikiGateConfig | undefined): string | null {
  if (gate?.unlockParam !== undefined) return gate.unlockParam;
  const type = gate?.type ?? 'password';
  if (type === 'none') return null;
  return type === 'freedom-account' ? 'k' : 'key';
}

export function gateFromConfig(gate: WikiGateConfig | undefined): GateFn | undefined {
  const type = gate?.type ?? 'password';
  if (!TYPES.includes(type)) {
    throw new Error(`wiki.config.json gate.type "${String(type)}" is not one of ${TYPES.join(', ')}`);
  }
  if (gate?.mode !== undefined && type !== 'freedom-account') {
    throw new Error(`wiki.config.json gate.mode applies only to type freedom-account, not "${type}"`);
  }
  if (type === 'none') return undefined;
  if (type === 'password') {
    return createPasswordGate({
      unlockParam: unlockParamFor(gate) ?? 'key',
      machinePaths: gate?.machinePaths,
      title: gate?.title,
    });
  }
  if (gate?.mode !== undefined && !GATE_MODES.includes(gate.mode)) {
    throw new Error(`wiki.config.json gate.mode "${String(gate.mode)}" is not one of ${GATE_MODES.join(', ')}`);
  }
  if (gate?.door?.theme !== undefined && !DOOR_THEMES.includes(gate.door.theme)) {
    throw new Error(`wiki.config.json gate.door.theme "${String(gate.door.theme)}" is not one of ${DOOR_THEMES.join(', ')}`);
  }
  let openPaths: RegExp | undefined;
  if (gate?.openPaths !== undefined) {
    try { openPaths = new RegExp(gate.openPaths, 'i'); }
    catch (e) { throw new Error(`wiki.config.json gate.openPaths is not a regular expression: ${(e as Error).message}`); }
  }
  return createFreedomAccountGate({
    signInUrl: gate?.signInUrl,
    openPaths,
    grantDays: gate?.grantDays,
    title: gate?.title,
    // The ids live in the deployment's env, never in the committed config: read per request.
    allow: gate?.allowEnv ? () => parseAllowList(process.env[gate.allowEnv as string]) : undefined,
    door: gate?.door,
    mode: gate?.mode,
  });
}

/** Who may mint share links, from the config: a per-request read of the env var it names, or
 *  undefined (every authorized reader) when it names none. Missing or empty admits nobody. */
export function shareAdminsFromConfig(gate: WikiGateConfig | undefined): (() => string[]) | undefined {
  const name = gate?.shareAdminsEnv;
  if (!name || (gate?.type ?? 'password') !== 'freedom-account') return undefined;
  return () => parseAllowList(process.env[name]);
}
