// The render step of `wiki hero`: pick an image adapter, hand it the compiled prompt and the
// compiled reference list, and come back with a PNG and the recipe the adapter wrote beside it.
//
// Two adapters are known, in this order:
//
//   ABU    the on-brand-image adapter of the Agentic Brand Universe plugin, found through
//          $ABU_ADAPTER or as the newest version in the plugin cache. Runs under `uv run`
//          (its PEP 723 header resolves Pillow) and writes `<out>.recipe.json` itself.
//   wiki   a wiki's own vendored `illustrations/scripts/generate.py`, the local engine every
//          wiki forked from the template carries. Same provider, fewer powers: no locked
//          entities and no `--ref-first`, and this says so once when it falls back to it.
//
// THE PACK IS APPLIED ONCE, BY THE COMPILER, NEVER BY THE ADAPTER. `compileHero` already put the
// style line, the palette, the negatives and the anchor-first reference order into its output, so
// this passes that prompt and those refs verbatim and never hands ABU `--style-pack`: ABU would
// append the style line and the poles a second time and pass every pack ref uncapped, and a
// migrated legacy register has no pack.json on disk for it to read anyway. The pack is still
// named in the published recipe (publish.mjs adds `stylePack`), which is the provenance that
// flag existed to record.
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the ABU plugin cache keeps its versions, relative to the home dir. */
export const ABU_CACHE_REL = join('.claude', 'plugins', 'cache', 'agentic-brand-universe', 'abu');
const ABU_ADAPTER_REL = join('skills', 'on-brand-image', 'scripts', 'generate.py');
const WIKI_ADAPTER_REL = join('illustrations', 'scripts', 'generate.py');

const FALLBACK_NOTE = 'no ABU adapter found; rendering through this wiki\'s own illustrations/scripts/generate.py. '
  + 'Locked entities and --ref-first are unavailable on that path; install the agentic-brand-universe plugin (abu) to get them.';

/** Newest first, by numeric version parts; anything unparseable sorts last. */
function byVersionDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : -1;
    const y = Number.isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return y - x;
  }
  return 0;
}

/**
 * Which adapter renders, `{ kind: 'abu' | 'wiki', script, note? }`.
 * Order: $ABU_ADAPTER, the newest ABU plugin cache version carrying the adapter, the wiki's own
 * generate.py (with a printed note), else a refusal naming the install.
 */
export function resolveAdapter({ env = process.env, root = process.cwd(), home = homedir() } = {}) {
  if (env.ABU_ADAPTER) {
    if (!existsSync(env.ABU_ADAPTER)) throw new Error(`ABU_ADAPTER names ${env.ABU_ADAPTER}, which does not exist`);
    return { kind: 'abu', script: env.ABU_ADAPTER };
  }
  const cache = join(home, ABU_CACHE_REL);
  if (existsSync(cache)) {
    const versions = readdirSync(cache).filter((v) => statSync(join(cache, v)).isDirectory()).sort(byVersionDesc);
    for (const v of versions) {
      const script = join(cache, v, ABU_ADAPTER_REL);
      if (existsSync(script)) return { kind: 'abu', script };
    }
  }
  const own = join(root, WIKI_ADAPTER_REL);
  if (existsSync(own)) return { kind: 'wiki', script: own, note: FALLBACK_NOTE };
  throw new Error('no image adapter: install the Agentic Brand Universe plugin (agentic-brand-universe, `abu`) so its '
    + `on-brand-image adapter is in ~/${ABU_CACHE_REL}, or set ABU_ADAPTER=<path to its generate.py>, `
    + `or vendor a generate.py at ${WIKI_ADAPTER_REL}`);
}

/**
 * The exact command line for one adapter. Pure, so the shape is testable without a render.
 *   ABU:   uv run generate.py --out <png> --prompt-file <tmp> [--ref <path>]... --model M --size S --quality Q --no-open
 *   wiki:  uv run generate.py --prompt "<prompt>" --filename <png> [--input-image <path>]... --model M --size S --quality Q --no-open
 */
export function adapterArgv(adapter, { out, promptFile, prompt, refs, model, size, quality }) {
  const tail = ['--model', model, '--size', size, '--quality', quality, '--no-open'];
  if (adapter.kind === 'abu') {
    return ['uv', 'run', adapter.script, '--out', out, '--prompt-file', promptFile, ...refs.flatMap((r) => ['--ref', r.path]), ...tail];
  }
  return ['uv', 'run', adapter.script, '--prompt', prompt, '--filename', out, ...refs.flatMap((r) => ['--input-image', r.path]), ...tail];
}

/** Run a command with its output on OUR stderr, so stdout stays clean for `--json`. */
function defaultRun(argv, { cwd }) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 2, 2] });
  if (r.error) throw new Error(`could not start ${argv[0]}: ${r.error.message}`);
  return { status: r.status ?? 1 };
}

/**
 * Render one hero. `compiled` is `compileHero`'s output (its `prompt` may carry appended
 * corrections). Returns `{ png, recipe, argv }`; refuses when the adapter fails, leaves no
 * image, or leaves no recipe, because an image with no recipe cannot be published.
 */
export async function renderHero(compiled, { adapter, out, model, size, quality, run = defaultRun, cwd = process.cwd() }) {
  if (!adapter) throw new Error('renderHero needs a resolved adapter');
  mkdirSync(dirname(out), { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'wiki-hero-prompt-'));
  const promptFile = join(scratch, 'prompt.txt');
  writeFileSync(promptFile, compiled.prompt);
  const argv = adapterArgv(adapter, { out, promptFile, prompt: compiled.prompt, refs: compiled.refs, model, size, quality });
  try {
    const r = run(argv, { cwd });
    if (r.status !== 0) throw new Error(`the ${adapter.kind} adapter exited ${r.status} (see its output above); no image, nothing published`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (!existsSync(out)) throw new Error(`the ${adapter.kind} adapter exited 0 but produced no file at ${out}`);
  const recipe = `${out}.recipe.json`;
  if (!existsSync(recipe)) throw new Error(`the ${adapter.kind} adapter wrote ${out} with no recipe beside it (${recipe}); an image without provenance cannot be published`);
  return { png: out, recipe, argv };
}
