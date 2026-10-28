// The share layer of the edge middleware, as one call the host middleware makes AFTER its
// bot-block 403 and BEFORE its gate refuses. It answers two addresses and nothing else:
//
//   GET /s/mint?path=<route>     an AUTHORIZED reader asks for the share link of one page and
//                                gets {url}. Nobody else gets one: the answer is 401. When the
//                                wiki names share admins, an authorized reader who is not one
//                                is refused 403: reading a page is not the right to hand it to
//                                a stranger (Gary, 2026-10-23: "only admins"). A wiki
//                                with no gate answers with the page's own URL, because an open
//                                page needs no other address.
//   GET /s/<sig>/<route>         a share address. Genuine and the visitor is anonymous: serve
//                                the chrome-less mirror by rewrite. Genuine and the visitor is
//                                authorized: redirect to the canonical page. Not genuine: fall
//                                through, so the gate refuses it exactly as it refuses any
//                                other unknown path.
//
// Order matters and it is the host's responsibility: a training crawler must never reach a
// share address (the bot block comes first), and a share recipient must never meet the
// password door (this comes before the gate's own 401).
//
// The rewrite serves static HTML with every <script> stripped (see share-view-plugin), so it
// does not matter whether the host gates /assets/js: nothing hydrates, the client router never
// runs, and no other page's content rides along in a chunk. Images and CSS DO have to be
// reachable by an anonymous visitor for the mirror to render; every wiki in this family already
// excludes /img/ and /assets/ from its matcher.

import { MINT_PATH, canonicalRoute, sharePath, shareViewPath, verifySharePath } from './signedRoute';
import { verifySuperlink, mintSuperlink, type ForwardMode } from './superlink';

export interface ShareRequest {
  url: URL;
  /** The host gate's own verdict on this request. On a wiki with no gate, always true. */
  authorized: boolean;
  /** The signing secret. Empty disables sharing: mint answers 503, share addresses fall through. */
  secret: string;
  /** Whether a gate is live at all. Off: mint hands back the canonical URL, since the page is
   *  already open to anyone and a share address would only redirect there. */
  gated: boolean;
  /** The account the gate named, when it named one. An hourly key reads as 'key'. */
  reader?: string;
  /** Who may mint. Absent: every authorized reader, as before. Present: only these account ids,
   *  and an empty list admits nobody, so a missing variable fails CLOSED. Share addresses
   *  already minted keep opening: this limits who makes links, never who follows them. */
  shareAdmins?: readonly string[];
  /** Superlink ids that no longer open (wiki.config.json `superlinks.shut`). A shut id also shuts
   *  every link forwarded from it. */
  shut?: readonly string[];
  /** The superlink lineage beyond each token's signed parent (wiki.config.json
   *  `superlinks.parents`, rid -> parent rid), so a shut id shuts forwards of forwards too (#9). */
  parents?: Readonly<Record<string, string>>;
  /** The request's Accept header: JSON gets a 401 naming the sign-in, anything else a 303. */
  accept?: string | null;
  /** The gate's `cannotAct` (act mode): this reader may read but not mint. */
  cannotAct?: { signInUrl: string } | { refused: 'not_allowed' };
}

/** Where a reader who must sign in to act goes back to: the page, marked so the Share button
 *  finishes the mint it started (src/theme/ShareButton). The portal returns them with a pass,
 *  the gate redeems it and keeps the marker. */
export const ACT_RETURN_PARAM = 'act';

const GONE = '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Link closed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;line-height:1.6"><p>This link is no longer available.</p></body>';

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/** Returns a Response when the request is the share layer's to answer, else undefined so the
 *  host gate carries on. */
export async function handleShare(req: ShareRequest): Promise<Response | undefined> {
  const { url, authorized, secret, gated, reader, shareAdmins } = req;

  if (url.pathname === MINT_PATH || url.pathname === MINT_PATH + '/') {
    const route = canonicalRoute(url.searchParams.get('path') ?? '');
    if (route === null) return json(400, { error: 'bad_path' });
    if (!authorized) return json(401, { error: 'not_authorized' });
    if (req.cannotAct) {
      if ('refused' in req.cannotAct) return json(403, { error: req.cannotAct.refused });
      const back = new URL(route, url.origin);
      back.searchParams.set(ACT_RETURN_PARAM, 'share');
      const signIn = `${req.cannotAct.signInUrl}?to=${encodeURIComponent(back.toString())}`;
      // The Share button asks with fetch, which cannot follow a cross-site redirect into a
      // sign-in page, so it is told where to go; a navigation is simply sent there.
      if (/application\/json/.test(req.accept ?? '')) return json(401, { error: 'sign_in_to_act', signIn });
      return new Response(null, { status: 303, headers: { location: signIn, 'cache-control': 'no-store' } });
    }
    if (shareAdmins !== undefined && !(reader && reader !== 'key' && shareAdmins.includes(reader))) {
      return json(403, { error: 'not_share_admin' });
    }
    // A superlink for one named person (superlinks step 4). Gated wikis only: on an open wiki
    // every visitor reads as authorized, so anyone could write a made-up name into the
    // operator's reads. The name goes to the reads sink in the mint event, never into the link.
    const to = url.searchParams.get('to');
    if (to !== null) {
      const label = to.trim();
      if (!label || label.length > 60 || /[\r\n]/.test(label)) return json(400, { error: 'bad_name' });
      const fwd = url.searchParams.get('forward') ?? 'off';
      if (!['off', 'signed-in', 'open'].includes(fwd)) return json(400, { error: 'bad_forward' });
      if (!gated) return json(403, { error: 'superlinks_need_a_gate', why: 'an open wiki cannot tell who is minting' });
      if (!secret) return json(503, { error: 'sharing_disabled', why: 'no WIKI_SHARE_SECRET or WIKI_GATE_SECRET on this deployment' });
      const m = await mintSuperlink(secret, route, { forward: fwd as ForwardMode });
      if (!m) return json(400, { error: 'bad_path' });
      return json(200, { url: new URL(m.path, url.origin).toString(), focused: true, superlink: true, rid: m.rid },
        { 'x-wiki-superlink-minted': m.rid });
    }
    if (!gated) return json(200, { url: new URL(route, url.origin).toString(), focused: false });
    if (!secret) return json(503, { error: 'sharing_disabled', why: 'no WIKI_SHARE_SECRET or WIKI_GATE_SECRET on this deployment' });
    const path = await sharePath(secret, route);
    if (!path) return json(400, { error: 'bad_path' });
    return json(200, { url: new URL(path, url.origin).toString(), focused: true });
  }

  // A superlink is tried first: its token has dots, so it can never parse as a one-page share.
  const link = await verifySuperlink(secret, url.pathname, { shut: req.shut, parents: req.parents });
  if (link && link.state !== 'open') {
    return new Response(GONE, { status: 410, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  }
  if (link) {
    // A member of a gated wiki reads the page as a member. In act mode a reader who cannot act
    // is anybody, so they get the one-article view and the read counts against the link. Everyone else, on an open wiki too,
    // gets the one-article view, so the read is counted against the link it came through.
    if (authorized && gated && !req.cannotAct) return Response.redirect(new URL(link.route, url.origin), 302);
    return new Response(null, {
      headers: {
        'x-middleware-rewrite': new URL(shareViewPath(link.route), url.origin).toString(),
        'x-robots-tag': 'noindex, nofollow',
        'x-wiki-superlink': link.parent ? `${link.rid} ${link.parent}` : link.rid,
      },
    });
  }

  const route = await verifySharePath(secret, url.pathname);
  if (route === null) return undefined;

  if ((authorized && !req.cannotAct) || !gated) {
    return Response.redirect(new URL(route, url.origin), 302);
  }
  return new Response(null, {
    headers: {
      'x-middleware-rewrite': new URL(shareViewPath(route), url.origin).toString(),
      // A shared page is for the person it was sent to, never for an index.
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
