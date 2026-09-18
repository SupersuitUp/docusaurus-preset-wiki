// The publish step of `wiki hero`: a read-back-clean PNG and its recipe become the deploy
// asset. TWO records leave here, and the split is the point:
//
//   illustrations/<slug>.png              the full-size render, kept, never converted
//   illustrations/<slug>.png.recipe.json  the FULL recipe: model, exact prompt, every ref by
//                                         path, the read-back in full, where it was published from
//   static/<...>/<slug>.webp              the deploy asset, at most 1536 wide
//   static/<...>/<slug>.webp.recipe.json  a DERIVE record: it names the source and the tool and
//                                         summarises the read-back, and carries no prompt and no
//                                         path outside this repo
//
// The served sidecar is a public file on a public site, so it points back at the source rather
// than restating it. Before 2026-09-18 the only copy of the PNG went under static/, the
// optimizer unlinked it, and the 2560-wide render existed nowhere after approval, while the
// served recipe shipped the whole prompt and absolute /Users/... paths.
//
// The conversion is the preset's own optimize-images.py, run on this one file, so the hero
// satisfies the weight gate by the same code that enforces it and its sidecar gets the same
// transform record every other converted image gets (the PNG's hash, the tool, the width).
// Writing a second converter here would be a second contract to keep in step with the gate.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPTIMIZER = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'python', 'optimize-images.py');
/** Where the full-size source and its full recipe live, under the wiki root. */
export const SOURCE_DIR = 'illustrations';
/** What the served derive record names as its transform. */
export const DERIVE_GENERATOR = 'optimize-images.py (wiki optimize-images)';

/** The site URL of a hero: the outputDir with its leading `static` dropped. */
export function heroUrl(outputDir, slug) {
  const dir = outputDir.replace(/\/+$/, '');
  if (dir !== 'static' && !dir.startsWith('static/')) throw new Error(`hero.outputDir must sit under static/ so a page can reference it; got ${JSON.stringify(outputDir)}`);
  return `${dir.slice('static'.length) || ''}/${slug}.webp`;
}

/** Run optimize-images.py on exactly these files, from the wiki root, output on our stderr. */
function defaultOptimize(root, files) {
  const probe = spawnSync('python3', ['-c', 'import PIL']);
  if (probe.status !== 0) {
    return { status: 1, error: 'python3 with Pillow is needed to write the WebP (`pip install pillow`, or `uv run --with pillow python3`)' };
  }
  const r = spawnSync('python3', [OPTIMIZER, ...files], { cwd: root, stdio: ['ignore', 2, 2] });
  return { status: r.status ?? 1 };
}

/**
 * The read-back as the served record carries it: the round count, whether a person overruled
 * a DEFECT, and the verdicts themselves. Nothing else: `publishedFrom` is a path on the
 * machine that rendered it, `history` repeats the verdicts per round, and the vision model is
 * in the full recipe. Pure.
 */
export function summarizeReadback(readback = {}) {
  const verdicts = Array.isArray(readback.verdicts) ? readback.verdicts.map((v) => ({ assertion: String(v.assertion ?? ''), verdict: String(v.verdict ?? ''), note: String(v.note ?? '') })) : [];
  return { rounds: Number.isInteger(readback.rounds) ? readback.rounds : 0, overruled: Boolean(readback.overruled), verdicts };
}

const repoRel = (root, p) => relative(root, p).split(sep).join('/');

/**
 * Publish one hero. Returns `{ webp, recipeOut, sourcePng, sourceRecipe, url, frontmatterLine,
 * bodyLine, pageWritten }`.
 *   png, recipe   the winning round's render and the recipe its adapter wrote
 *   slug          names the output; may contain a slash
 *   outputDir     hero.outputDir, under static/
 *   root          the wiki root
 *   alt           the image's alt text
 *   readback      `{ rounds, verdicts, ... }`: in full in the source recipe, summarised in the served one
 *   extra         more fields for both recipes (the pack id, the CLI inputs)
 *   optimize      injected in tests; defaults to the preset's optimize-images.py
 *   page, write   with `write`, patch the page (found by slug when `page` is not given)
 */
export async function publishHero({ png, recipe, slug, outputDir, root, alt, readback, extra = {}, optimize = defaultOptimize, page, write = false }) {
  const url = heroUrl(outputDir, slug);
  const sourcePng = join(root, SOURCE_DIR, `${slug}.png`);
  const sourceRecipe = `${sourcePng}.recipe.json`;
  const destPng = join(root, outputDir, `${slug}.png`);
  const webp = join(root, outputDir, `${slug}.webp`);
  const recipeOut = `${webp}.recipe.json`;
  mkdirSync(dirname(sourcePng), { recursive: true });
  mkdirSync(dirname(destPng), { recursive: true });

  // The source, whole: the render as the adapter left it and everything it wrote about it.
  copyFileSync(png, sourcePng);
  const parsed = JSON.parse(readFileSync(recipe, 'utf8'));
  writeFileSync(sourceRecipe, `${JSON.stringify({ ...parsed, ...extra, asset: repoRel(root, sourcePng), readback }, null, 2)}\n`);

  // The deploy copy, and the derive record the optimizer will carry onto the webp. It names
  // the source by repo-relative path; the optimizer then sets `asset` to the webp and appends
  // its transform entry (tool, width, the PNG's hash), which is the chain the gate checks.
  copyFileSync(png, destPng);
  const derive = {
    mode: 'derive',
    derivedFrom: repoRel(root, sourcePng),
    sourceRecipe: repoRel(root, sourceRecipe),
    generator: DERIVE_GENERATOR,
    generatedAt: new Date().toISOString(),
    asset: repoRel(root, destPng),
    ...extra,
    readback: summarizeReadback(readback),
  };
  writeFileSync(`${destPng}.recipe.json`, `${JSON.stringify(derive, null, 2)}\n`);

  const r = optimize(root, [destPng]);
  if (r.status !== 0) throw new Error(`optimize-images failed on ${destPng}${r.error ? `: ${r.error}` : ' (see its output above)'}; the PNG and its recipe are left there for you to look at`);
  if (!existsSync(webp)) throw new Error(`optimize-images exited 0 but left no webp at ${webp}`);
  if (!existsSync(recipeOut)) throw new Error(`optimize-images left no recipe beside ${webp}`);

  const frontmatterLine = `image: "${url}"`;
  const bodyLine = `![${altText(alt)}](${url})`;
  let pageWritten = null;
  if (write) {
    const target = page ? resolve(root, page) : findPage(root, slug);
    if (!existsSync(target)) throw new Error(`--write: no page at ${target}`);
    writeFileSync(target, patchPage(readFileSync(target, 'utf8'), { url, bodyLine }));
    pageWritten = target;
  }
  return { webp, recipeOut, sourcePng, sourceRecipe, url, frontmatterLine, bodyLine, pageWritten };
}

/** Alt text that survives being the inside of `![...]`: one line, brackets escaped. */
function altText(alt) {
  return String(alt ?? '').replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

/**
 * Find docs/**\/<slug>.md or .mdx. `slug` may carry folders (concepts/capture), matched as a path
 * suffix. Refuses on zero or several hits, naming them and the `--page` flag.
 */
export function findPage(root, slug) {
  const docs = join(root, 'docs');
  const hits = [];
  const want = slug.split('/');
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(name)) {
        const parts = relative(docs, p).replace(/\.mdx?$/, '').split(sep);
        if (parts.length >= want.length && want.every((w, i) => parts[parts.length - want.length + i] === w)) hits.push(p);
      }
    }
  };
  walk(docs);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new Error(`no page for slug ${JSON.stringify(slug)} under ${docs}; pass --page <path> to name it`);
  throw new Error(`slug ${JSON.stringify(slug)} matches several pages, pass --page <path>:\n  ${hits.map((h) => relative(root, h)).join('\n  ')}`);
}

/**
 * The page text with `image:` set in its frontmatter and the image line in its body: an
 * existing image line for this url is replaced, otherwise the line goes under the italic
 * definition after the H1 (or after the H1, or after the frontmatter). Pure and idempotent.
 */
export function patchPage(text, { url, bodyLine }) {
  const fmLine = `image: "${url}"`;
  let head = '';
  let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (fm) {
    let inner = fm[1];
    if (/^image:/m.test(inner)) inner = inner.replace(/^image:.*$/m, fmLine);
    else inner = `${inner}\n${fmLine}`;
    head = `---\n${inner}\n---\n`;
    body = text.slice(fm[0].length);
  } else {
    head = `---\n${fmLine}\n---\n`;
  }

  const lines = body.split('\n');
  const isThisImage = (l) => l.includes(`](${url})`) && /^!\[/.test(l.trim());
  const existing = lines.findIndex(isThisImage);
  if (existing !== -1) {
    lines[existing] = bodyLine;
    return head + lines.join('\n');
  }
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  let anchor = h1;
  if (h1 !== -1) {
    for (let i = h1 + 1; i < lines.length; i += 1) {
      const t = lines[i].trim();
      if (!t) continue;
      if (/^\*[^*].*\*$/.test(t) || /^_[^_].*_$/.test(t)) anchor = i;
      break;
    }
  }
  if (anchor === -1) {
    // No H1: the image opens the body.
    const rest = body.replace(/^\n+/, '');
    return `${head}\n${bodyLine}\n\n${rest}`;
  }
  // Insert after the anchor line, keeping one blank line on each side.
  const before = lines.slice(0, anchor + 1);
  let after = lines.slice(anchor + 1);
  while (after.length && after[0].trim() === '') after = after.slice(1);
  return head + [...before, '', bodyLine, '', ...after].join('\n');
}
