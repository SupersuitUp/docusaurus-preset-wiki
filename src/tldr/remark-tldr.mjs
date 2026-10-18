// Renders a page's frontmatter `tldr:` as a labelled block at the top of the article, into the
// static HTML (so the chrome-less share mirror and any reader without JavaScript get it too).
//
// Placement: directly after the italic one-line lede under the H1, and before the `---` divider.
// The lede stays the definition and the TL;DR is the takeaway, so they sit together and in that
// order. A page with no lede gets it right after its H1; a page with no H1 in its body gets it
// after its imports (and after a lede, if one opens the page).
//
// It re-validates the value Docusaurus actually parsed and throws, naming the file, so the build
// fails even when the prebuild gate was skipped (for example under `docusaurus build` directly).

import { tldrProblems } from '../tldr/tldr.mjs';

function isLede(node) {
  return (
    node?.type === 'paragraph' &&
    node.children.length === 1 &&
    node.children[0].type === 'emphasis'
  );
}

// Docusaurus wraps a doc's content H1 in a JSX <header> element before remarkPlugins run
// (measured 2026-09-27: yaml, mdxjsEsm, mdxJsxFlowElement[heading], paragraph[emphasis]).
function isTitle(node) {
  if (node?.type === 'heading' && node.depth === 1) return true;
  return (
    node?.type === 'mdxJsxFlowElement' &&
    Array.isArray(node.children) &&
    node.children.some((c) => c.type === 'heading' && c.depth === 1)
  );
}

function isTldrBlock(node) {
  const cn = node?.data?.hProperties?.className;
  return node?.data?.hName === 'aside' && (Array.isArray(cn) ? cn : [cn]).includes('wiki-tldr');
}

function tldrNode(text) {
  return {
    type: 'tldrBlock',
    data: {
      hName: 'aside',
      hProperties: { className: ['wiki-tldr'], 'aria-label': 'TL;DR' },
    },
    children: [
      {
        type: 'paragraph',
        data: { hName: 'p', hProperties: { className: ['wiki-tldr__label'] } },
        children: [{ type: 'text', value: 'TL;DR' }],
      },
      {
        type: 'paragraph',
        data: { hName: 'p', hProperties: { className: ['wiki-tldr__text'] } },
        children: [{ type: 'text', value: text.trim().replace(/\s+/g, ' ') }],
      },
    ],
  };
}

export default function remarkTldr() {
  return (tree, file) => {
    const fm = file.data?.frontMatter ?? {};
    const value = fm.tldr;
    if (value === undefined) return;
    const problems = tldrProblems(value);
    if (problems.length) {
      throw new Error(`[tldr] ${file.path}: ${problems.join('; ')}`);
    }

    const kids = tree.children;
    // Idempotent: a wiki that still wires its own copy of this plugin (until it drops it) would
    // otherwise render two blocks. The block is a node with hName aside and class wiki-tldr.
    if (kids.some(isTldrBlock)) return;
    const h1 = kids.findIndex(isTitle);
    let at;
    if (h1 === -1) {
      // No H1 in the body: keep frontmatter and MDX imports first, then any lede.
      at = 0;
      while (kids[at] && (kids[at].type === 'mdxjsEsm' || kids[at].type === 'yaml')) at++;
      if (isLede(kids[at])) at++;
    } else {
      at = isLede(kids[h1 + 1]) ? h1 + 2 : h1 + 1;
    }
    kids.splice(at, 0, tldrNode(value));
  };
}
