import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkTldr from './remark-tldr.mjs';

const text = (value) => ({ type: 'text', value });
const h1 = { type: 'heading', depth: 1, children: [text('Alpha')] };
const lede = { type: 'paragraph', children: [{ type: 'emphasis', children: [text('A lede.')] }] };
const run = (children, tldr, path = 'docs/a.md') => {
  const tree = { type: 'root', children };
  remarkTldr()(tree, { path, data: { frontMatter: tldr === undefined ? {} : { tldr } } });
  return tree.children;
};

test('the block lands right after the H1 when there is no lede', () => {
  const kids = run([h1, { type: 'paragraph', children: [text('Body.')] }], 'Short.');
  assert.equal(kids[1].data.hName, 'aside');
  assert.deepEqual(kids[1].data.hProperties.className, ['wiki-tldr']);
  assert.equal(kids[1].children[1].children[0].value, 'Short.');
});

test('the block lands after the italic lede', () => {
  const kids = run([h1, lede], 'Short.');
  assert.equal(kids.length, 3);
  assert.equal(kids[1], lede);
  assert.equal(kids[2].data.hName, 'aside');
});

test('a page with no tldr is untouched', () => {
  assert.equal(run([h1], undefined).length, 1);
});

test('a 61-word tldr throws, naming the page', () => {
  const long = Array.from({ length: 61 }, () => 'word').join(' ') + '.';
  assert.throws(() => run([h1], long, 'docs/x.md'), /\[tldr\] docs\/x\.md/);
});

test('idempotent: a tree that already has a wiki-tldr aside gets no second block', () => {
  const existing = { type: 'tldrBlock', data: { hName: 'aside', hProperties: { className: ['wiki-tldr'] } }, children: [] };
  const kids = run([h1, existing], 'Short.');
  assert.equal(kids.length, 2);
  const tree = { type: 'root', children: [h1] };
  const file = { path: 'docs/a.md', data: { frontMatter: { tldr: 'Short.' } } };
  remarkTldr()(tree, file);
  remarkTldr()(tree, file);
  assert.equal(tree.children.filter((n) => n.data?.hName === 'aside').length, 1);
});
