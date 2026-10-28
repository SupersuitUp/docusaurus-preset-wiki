// Superlinks on a wiki (superlinks step 4): one article, sent to one person, as a link that knows
// which link it is, without a database and without the person's name inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintSuperlink, verifySuperlink, parseSuperlink, MAX_FORWARD_DEPTH } from './superlink';
import { parseSharePath } from './signedRoute';

const S = 'secret-for-tests';
const NOW = Date.parse('2026-10-26T12:00:00Z');

test('a minted superlink opens its one route and says which link it is', async () => {
  const m = (await mintSuperlink(S, '/concepts/kenosis', { forward: 'off' }))!;
  assert.match(m.rid, /^[a-z0-9]{12}$/);
  assert.match(m.path, /^\/s\/[a-z0-9]{12}\.0\.n0\.[A-Za-z0-9_-]{22}\/concepts\/kenosis$/);
  const v = await verifySuperlink(S, m.path, { now: NOW });
  assert.deepEqual(v, { state: 'open', route: '/concepts/kenosis', rid: m.rid, parent: null, forward: 'off' });
});

test('the name of who it is for never rides in the link', async () => {
  const m = (await mintSuperlink(S, '/x', { forward: 'off' }))!;
  assert.ok(!/tim/i.test(m.path));
  assert.equal(m.path.length < 80, true, 'short enough to read in a text');
});

test('a changed route, rid, parent, setting or expiry, or a wrong secret, is not a superlink', async () => {
  const m = (await mintSuperlink(S, '/a', { forward: 'off' }))!;
  assert.equal(await verifySuperlink(S, m.path.replace('/a', '/b'), { now: NOW }), null);
  assert.equal(await verifySuperlink(S, m.path.replace('.n0.', '.o0.'), { now: NOW }), null);
  assert.equal(await verifySuperlink('other', m.path, { now: NOW }), null);
  const t = m.path.split('/')[2];
  const swapped = m.path.replace(t.slice(0, 12), 'zzzzzzzzzzzz');
  assert.equal(await verifySuperlink(S, swapped, { now: NOW }), null);
  assert.equal(await verifySuperlink('', m.path, { now: NOW }), null, 'no secret verifies nothing');
});

test('a shut link, and every link made from it, answers shut; an expired link answers expired', async () => {
  const parent = (await mintSuperlink(S, '/a', { forward: 'signed-in' }))!;
  const child = (await mintSuperlink(S, '/a', { forward: 'signed-in', parent: parent.rid }))!;
  assert.equal((await verifySuperlink(S, child.path, { now: NOW }))!.state, 'open');
  assert.deepEqual(await verifySuperlink(S, child.path, { now: NOW, shut: [parent.rid] }), { state: 'shut', rid: child.rid });
  assert.deepEqual(await verifySuperlink(S, parent.path, { now: NOW, shut: [parent.rid] }), { state: 'shut', rid: parent.rid });
  const old = (await mintSuperlink(S, '/a', { forward: 'off', expires: new Date(NOW - 1000) }))!;
  assert.deepEqual(await verifySuperlink(S, old.path, { now: NOW }), { state: 'expired', rid: old.rid });
  const later = (await mintSuperlink(S, '/a', { forward: 'off', expires: new Date(NOW + 86_400_000) }))!;
  assert.equal((await verifySuperlink(S, later.path, { now: NOW }))!.state, 'open');
});

test('the old one-page share and a superlink never parse as each other', async () => {
  const m = (await mintSuperlink(S, '/a', { forward: 'off' }))!;
  assert.equal(parseSharePath(m.path), null);
  assert.equal(parseSuperlink('/s/Q2h1cmNoT2ZUaGVSZWFsTGlm/a'), null);
  assert.equal(parseSuperlink('/s/mint'), null);
});

test('a route that is not shareable mints nothing', async () => {
  assert.equal(await mintSuperlink(S, '/s/abc', { forward: 'off' }), null);
  assert.equal(await mintSuperlink('', '/a', { forward: 'off' }), null);
});

test('a wiki not yet on the package can reach superlinks and the read sender from ./middleware', async () => {
  const mw = await import('../middleware');
  for (const name of ['mintSuperlink', 'verifySuperlink', 'parseSuperlink', 'buildEvent', 'sendEvent', 'resolveSink']) {
    assert.equal(typeof (mw as Record<string, unknown>)[name], 'function', name);
  }
});

// Rule 7 of the superlink standard (https://hypercontext.wiki/standards/superlink/v1): a forward
// never outlives its parent, at ANY depth (#9). The token carries only the immediate parent, so the
// rest of the chain comes from the committed lineage (`superlinks.parents`, rid -> parent rid).
async function chain() {
  const a = (await mintSuperlink(S, '/a', { forward: 'open' }))!;
  const b = (await mintSuperlink(S, '/a', { forward: 'open', parent: a.rid }))!;
  const c = (await mintSuperlink(S, '/a', { forward: 'open', parent: b.rid }))!;
  return { a, b, c, parents: { [b.rid]: a.rid, [c.rid]: b.rid } };
}

test('a forward of a forward is shut when the original link is shut (#9)', async () => {
  const { a, b, c, parents } = await chain();
  for (const l of [a, b, c]) {
    assert.deepEqual(await verifySuperlink(S, l.path, { now: NOW, shut: [a.rid], parents }), { state: 'shut', rid: l.rid });
  }
});

test('an unshut chain still opens, and shutting the middle shuts below it, never above', async () => {
  const { a, b, c, parents } = await chain();
  assert.equal((await verifySuperlink(S, c.path, { now: NOW, shut: [], parents }))!.state, 'open');
  assert.equal((await verifySuperlink(S, c.path, { now: NOW, shut: ['zzzzzzzzzzzz'], parents }))!.state, 'open');
  assert.equal((await verifySuperlink(S, c.path, { now: NOW, shut: [b.rid], parents }))!.state, 'shut');
  assert.equal((await verifySuperlink(S, b.path, { now: NOW, shut: [b.rid], parents }))!.state, 'shut');
  assert.equal((await verifySuperlink(S, a.path, { now: NOW, shut: [b.rid], parents }))!.state, 'open');
});

test('the signed parent wins over the lineage: a lookup cannot reparent a link out of a shut chain', async () => {
  const { a, c, parents } = await chain();
  const lying = { ...parents, [c.rid]: 'zzzzzzzzzzzz' };
  assert.equal((await verifySuperlink(S, c.path, { now: NOW, shut: [a.rid], parents: lying }))!.state, 'shut');
});

test('a chain deeper than the bound, or a loop in the lineage, fails closed', async () => {
  const leaf = (await mintSuperlink(S, '/a', { forward: 'open', parent: 'p00000000001' }))!;
  const deep = (n: number) => {
    const m: Record<string, string> = {};
    for (let i = 1; i < n; i += 1) m[`p${String(i).padStart(11, '0')}`] = `p${String(i + 1).padStart(11, '0')}`;
    return m;
  };
  // MAX_FORWARD_DEPTH ancestors in all opens; one more is refused without being read.
  assert.equal((await verifySuperlink(S, leaf.path, { now: NOW, parents: deep(MAX_FORWARD_DEPTH) }))!.state, 'open');
  assert.equal((await verifySuperlink(S, leaf.path, { now: NOW, parents: deep(MAX_FORWARD_DEPTH + 1) }))!.state, 'shut');
  const loop = { p00000000001: 'p00000000002', p00000000002: 'p00000000001' };
  assert.equal((await verifySuperlink(S, leaf.path, { now: NOW, parents: loop }))!.state, 'shut');
});
