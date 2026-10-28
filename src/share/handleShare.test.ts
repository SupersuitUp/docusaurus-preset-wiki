// The middleware layer's decisions, with no network and no host gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleShare } from './handleShare';
import { sharePath } from './signedRoute';

const SECRET = 's3';
const ORIGIN = 'https://example.wiki';
const req = (path: string, o: Partial<{ authorized: boolean; secret: string; gated: boolean; reader: string; shareAdmins: readonly string[] }> = {}) =>
  handleShare({ url: new URL(path, ORIGIN), authorized: false, secret: SECRET, gated: true, ...o });

test('mint: an authorized reader on a gated wiki gets the focused link', async () => {
  const r = (await req('/s/mint?path=/concepts/x', { authorized: true }))!;
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.focused, true);
  assert.equal(body.url, ORIGIN + (await sharePath(SECRET, '/concepts/x')));
});

test('mint: nobody else gets one', async () => {
  const r = (await req('/s/mint?path=/concepts/x'))!;
  assert.equal(r.status, 401);
});

test('mint: an open wiki answers with the page itself, since it is already open', async () => {
  const r = (await req('/s/mint?path=/concepts/x', { authorized: true, gated: false }))!;
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { url: `${ORIGIN}/concepts/x`, focused: false });
});

test('mint: no secret means sharing is off, said plainly', async () => {
  const r = (await req('/s/mint?path=/concepts/x', { authorized: true, secret: '' }))!;
  assert.equal(r.status, 503);
});

test('mint: a bad path is refused before authorization is even considered', async () => {
  assert.equal((await req('/s/mint?path=concepts/x', { authorized: true }))!.status, 400);
  assert.equal((await req('/s/mint', { authorized: true }))!.status, 400);
  assert.equal((await req('/s/mint?path=/s/abc', { authorized: true }))!.status, 400);
});

test('a genuine address and an anonymous visitor: the chrome-less mirror, by rewrite', async () => {
  const p = (await sharePath(SECRET, '/concepts/x'))!;
  const r = (await req(p))!;
  assert.equal(r.headers.get('x-middleware-rewrite'), `${ORIGIN}/share-view/concepts/x/`);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('a genuine address and an authorized visitor: the canonical page, by redirect', async () => {
  const p = (await sharePath(SECRET, '/concepts/x'))!;
  const r = (await req(p, { authorized: true }))!;
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `${ORIGIN}/concepts/x`);
});

test('a genuine address on an open wiki redirects too: there is nothing to focus away from', async () => {
  const p = (await sharePath(SECRET, '/concepts/x'))!;
  const r = (await req(p, { gated: false }))!;
  assert.equal(r.status, 302);
});

test('a forged or unknown address is not this layer\'s to answer', async () => {
  const p = (await sharePath(SECRET, '/concepts/x'))!;
  assert.equal(await req(p.replace('/concepts/x', '/concepts/y')), undefined);
  assert.equal(await req('/s/aa3a052d187791dd'), undefined);
  assert.equal(await req('/concepts/x'), undefined);
  assert.equal(await req(p, { secret: '' }), undefined, 'with no secret nothing verifies');
});

test('mint: with share admins set, only an admin gets a link; every other reader is refused 403', async () => {
  const admins = ['gary', 'wilson'];
  assert.equal((await req('/s/mint?path=/concepts/x', { authorized: true, reader: 'wilson', shareAdmins: admins }))!.status, 200);
  const refused = (await req('/s/mint?path=/concepts/x', { authorized: true, reader: 'stranger', shareAdmins: admins }))!;
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'not_share_admin');
  assert.equal((await req('/s/mint?path=/concepts/x', { authorized: true, reader: 'key', shareAdmins: admins }))!.status, 403, 'an hourly key names no admin');
  assert.equal((await req('/s/mint?path=/concepts/x', { authorized: true, shareAdmins: admins }))!.status, 403, 'no reader: no admin');
  assert.equal((await req('/s/mint?path=/concepts/x', { authorized: true, reader: 'gary', shareAdmins: [] }))!.status, 403, 'an empty list admits nobody');
});

test('share admins restrict minting only: a link an admin already made still opens for anyone', async () => {
  const r = (await req(await sharePath(SECRET, '/concepts/x') as string, { shareAdmins: ['gary'] }))!;
  assert.match(r.headers.get('x-middleware-rewrite') ?? '', /share-view\/concepts\/x/);
});

// Superlinks (step 4): the same one-article view, plus which link it was, and "gone" for a shut one.
import { mintSuperlink } from './superlink';

test('superlink: an anonymous reader gets the one-article view, tagged with the link it came through', async () => {
  const m = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'off' }))!;
  const r = (await req(m.path))!;
  assert.equal(r.headers.get('x-middleware-rewrite'), `${ORIGIN}/share-view/concepts/x/`);
  assert.equal(r.headers.get('x-wiki-superlink'), m.rid);
});

test('superlink: a member is sent to the page itself', async () => {
  const m = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'off' }))!;
  const r = (await req(m.path, { authorized: true }))!;
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `${ORIGIN}/concepts/x`);
});

test('superlink: a shut link, or one forwarded from it, answers 410 and shows nothing of the page', async () => {
  const parent = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'signed-in' }))!;
  const child = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'signed-in', parent: parent.rid }))!;
  for (const p of [parent.path, child.path]) {
    const r = (await handleShare({ url: new URL(p, ORIGIN), authorized: false, secret: SECRET, gated: true, shut: [parent.rid] }))!;
    assert.equal(r.status, 410);
    assert.equal(r.headers.get('x-middleware-rewrite'), null);
    assert.match(await r.text(), /no longer available/);
  }
});

test('superlink: a forward of a forward answers 410 once the original is shut (#9)', async () => {
  const a = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'open' }))!;
  const b = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'open', parent: a.rid }))!;
  const c = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'open', parent: b.rid }))!;
  const parents = { [b.rid]: a.rid, [c.rid]: b.rid };
  const r = (await handleShare({ url: new URL(c.path, ORIGIN), authorized: false, secret: SECRET, gated: true, shut: [a.rid], parents }))!;
  assert.equal(r.status, 410);
  assert.equal(r.headers.get('x-middleware-rewrite'), null);
});

test('superlink: a forged one falls through to the gate like any unknown path', async () => {
  const m = (await mintSuperlink(SECRET, '/concepts/x', { forward: 'off' }))!;
  assert.equal(await req(m.path.replace('/concepts/x', '/concepts/y')), undefined);
});

test('mint with to=: an authorized reader gets a superlink for that person; the name never appears in it', async () => {
  const r = (await req('/s/mint?path=/concepts/x&to=Tim%20Dort-Golts', { authorized: true }))!;
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.superlink, true);
  assert.match(body.rid, /^[a-z0-9]{12}$/);
  assert.ok(!/tim/i.test(body.url));
  assert.equal(r.headers.get('x-wiki-superlink-minted'), body.rid);
  const opened = (await req(new URL(body.url).pathname))!;
  assert.equal(opened.headers.get('x-wiki-superlink'), body.rid);
});

test('mint with to=: refused unauthorized, refused on an open wiki, refused a bad name', async () => {
  assert.equal((await req('/s/mint?path=/concepts/x&to=Tim'))!.status, 401);
  assert.equal((await req('/s/mint?path=/concepts/x&to=Tim', { authorized: true, gated: false }))!.status, 403);
  assert.equal((await req(`/s/mint?path=/concepts/x&to=${'x'.repeat(61)}`, { authorized: true }))!.status, 400);
  assert.equal((await req('/s/mint?path=/concepts/x&to=Tim&forward=sideways', { authorized: true }))!.status, 400);
});
