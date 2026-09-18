#!/usr/bin/env node
// One command that renders any wiki page's hero through the wiki's Style Pack:
//
//   wiki hero <slug> --title "WORDS ACROSS THE TOP" --labels "one|two|three|four" \
//     --beats "<beat>|<beat>|<beat>|<beat>"        (or --beats-file <path>, or one --beat per panel)
//     [--pack id] [--layout grid|row] [--tier best|fast] [--prop name[=path]]...
//     [--dry-run] [--no-readback] [--publish <png>] [--write] [--page <path>] [--json]
//
// compile -> render -> read back -> (re-roll with the defects as corrections, up to three
// rounds) -> publish. The `hero` block of wiki.config.json (or a legacy `hero_register`, migrated
// in memory) supplies the pack, the layout, the size, the model and the props; the page supplies
// its title, its labels and its beats. `--dry-run` prints the compiled prompt, refs, strings and
// gate as JSON and spends nothing.
//
// Exit codes: 0 published; 1 a refusal or an error; 2 usage; 3 a DEFECT survived every round
// (nothing published; the rounds are left in the work dir for a person to look at). When the
// person has looked and overrules the gate, `--publish <png>` publishes that round as it is,
// rendering nothing and asking nothing, and the recipe records that it was published that way.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readHeroConfig, resolvePackDir, loadPack } from '../hero/config.mjs';
import { compileHero } from '../hero/compile.mjs';
import { resolveAdapter, renderHero } from '../hero/render.mjs';
import { readBack, counterClauses, DEFAULT_VISION_MODEL } from '../hero/readback.mjs';
import { publishHero } from '../hero/publish.mjs';

/** The most renders one hero gets. The first plus two re-rolls; each round is a paid render. */
export const MAX_ROUNDS = 3;

/** `best` is the wiki's own configured model and quality; `fast` is the cheaper draft tier. */
export const TIERS = Object.freeze({
  best: null,
  fast: Object.freeze({ model: 'gpt-image-2.5-flare', quality: 'high' }),
});

const HELP = `wiki hero <slug> --title "<words>" --labels "a|b|c|d" --beats "<beat>|<beat>|..." [options]

  <slug>            the page the hero is for; the output is named after it (may contain a slash)
  --title           the words across the top of the image, verbatim
  --labels          one label per panel, in order, pipe-separated (or repeat --label)
  --beats           one scene beat per panel, in order, pipe-separated (or repeat --beat,
                    or --beats-file <path> with one beat per line, or the beats as a second argument)
  --prop <name>     a prop declared under hero.props in wiki.config.json (repeat)
  --prop <name>=<path>
                    an ad hoc prop photo for this page only, relative to the wiki root
  --pack <id|path>  use this Style Pack instead of hero.stylePack
  --layout grid|row override hero.layout (a grid takes exactly four beats)
  --tier best|fast  best (default) is hero.model at hero.quality; fast is ${TIERS.fast.model} at ${TIERS.fast.quality}
  --dry-run         print the compiled prompt, refs, strings and gate as JSON; no API call
  --no-readback     render once and publish without the vision check
  --publish <png>   publish this already-rendered round (its recipe beside it) without rendering
                    or reading back: the door for a person who looked at a refused round and
                    overrules the gate; recorded in the recipe
  --write           patch the page: image: in its frontmatter, the image line under its definition
  --page <path>     the page --write patches, when the slug alone is ambiguous
  --json            print one object: { png, webp, recipe, verdicts, rounds }; progress goes to stderr

Run from the wiki root. The pack comes from hero.stylePack: a path, or an id looked up in
$WIKI_STYLE_PACKS and then ../wiki-style-packs/packs beside the wiki. The render goes through the
Agentic Brand Universe adapter ($ABU_ADAPTER, else the newest installed abu plugin), falling back
to this wiki's own illustrations/scripts/generate.py. Read-back uses OPENAI_API_KEY and the model
in WIKI_HERO_VISION_MODEL. Up to ${MAX_ROUNDS} rounds: a DEFECT re-rolls with the defect named as
a correction; one that survives every round publishes nothing and exits 3.`;

/** Beats from a file or a string: one per line, or pipe-separated on one line; numbering stripped. */
function splitBeats(text) {
  const raw = /\n/.test(text.trim()) ? text.split('\n') : text.split('|');
  return raw.map((b) => b.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
}

/** argv (after the subcommand) to the inputs the run takes. Pure, so it is testable. */
export function parseHeroArgs(argv) {
  const out = {
    slug: undefined, title: undefined, beats: [], labels: [], props: [], adHocProps: {},
    pack: undefined, layout: undefined, tier: 'best', page: undefined, publish: undefined,
    dryRun: false, readback: true, write: false, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-readback') out.readback = false;
    else if (a === '--write') out.write = true;
    else if (a === '--json') out.json = true;
    else if (a === '--title') out.title = next();
    else if (a === '--beat') out.beats.push(next());
    else if (a === '--beats') out.beats.push(...splitBeats(next()));
    else if (a === '--beats-file') out.beats.push(...splitBeats(readFileSync(next(), 'utf8')));
    else if (a === '--label') out.labels.push(next());
    else if (a === '--labels') out.labels.push(...next().split('|'));
    else if (a === '--prop') {
      const v = next();
      const eq = v.indexOf('=');
      if (eq === -1) out.props.push(v);
      else {
        const name = v.slice(0, eq);
        const path = v.slice(eq + 1);
        if (!name || !path) throw new Error(`--prop ${v}: expected name=path`);
        (out.adHocProps[name] ??= []).push(path);
      }
    } else if (a === '--pack') out.pack = next();
    else if (a === '--layout') {
      out.layout = next();
      if (!['row', 'grid'].includes(out.layout)) throw new Error(`--layout must be row or grid, got ${out.layout}`);
    } else if (a === '--tier') {
      out.tier = next();
      if (!Object.hasOwn(TIERS, out.tier)) throw new Error(`--tier must be best or fast, got ${out.tier}`);
    } else if (a === '--page') out.page = next();
    else if (a === '--publish') out.publish = next();
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (out.slug === undefined) out.slug = a;
    else if (out.beats.length === 0) out.beats.push(...splitBeats(a));
    else throw new Error(`unexpected argument ${JSON.stringify(a)}; beats go in --beats or --beat`);
  }
  return out;
}

/** The props this page uses, from the names given, each checked against the config. */
export function selectProps(names, configured) {
  const props = {};
  for (const name of names) {
    if (!configured[name]) {
      const have = Object.keys(configured);
      throw new Error(`prop "${name}" is not declared under hero.props${have.length ? `; declared: ${have.join(', ')}` : ''}`);
    }
    props[name] = configured[name];
  }
  return props;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const COUNTS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** The alt text: the strip described beat by beat with its lettering, so the page reads without the picture. */
export function heroAlt({ title, labels, beats }) {
  const n = beats.length;
  const count = COUNTS[n] ?? String(n);
  const parts = beats.map((b, i) => `${ORDINALS[i] ? ORDINALS[i][0].toUpperCase() + ORDINALS[i].slice(1) : `Beat ${i + 1}`} beat, labeled "${labels[i]}": ${b}`);
  return `${count}-panel strip titled ${title}. ${parts.join(' ')}`;
}

const log = (...m) => console.error('[hero]', ...m);

/**
 * `deps` is for tests and for callers embedding the command: `{ env, home, adapter, run,
 * vision, optimize }`. Everything not given resolves the way the CLI does.
 */
export async function main(argv = process.argv.slice(2), root = process.cwd(), deps = {}) {
  const env = deps.env ?? process.env;
  const args = parseHeroArgs(argv);
  if (args.help || argv.length === 0) { console.log(HELP); return 0; }
  if (!args.slug) { console.error('[hero] a page slug is required (see wiki hero --help)'); return 2; }

  const config = readHeroConfig(root, { env });
  if (args.pack) {
    config.packDir = resolvePackDir(args.pack, root, env);
    config.pack = loadPack(config.packDir);
    config.stylePack = args.pack;
  }
  if (args.layout) config.layout = args.layout;
  const tier = TIERS[args.tier];
  const model = tier?.model ?? config.model;
  const quality = tier?.quality ?? config.quality;

  const props = selectProps(args.props, config.props);
  for (const [name, paths] of Object.entries(args.adHocProps)) {
    props[name] = [...(props[name] ?? []), ...paths.map((p) => (isAbsolute(p) ? p : resolve(root, p)))];
  }
  const compiled = compileHero({ pack: config.pack, config, title: args.title, labels: args.labels, beats: args.beats, props });
  const alt = heroAlt({ title: args.title, labels: args.labels, beats: args.beats });

  if (args.dryRun) {
    let adapter = null;
    let adapterError = null;
    try { adapter = deps.adapter ?? resolveAdapter({ env, root, home: deps.home }); } catch (e) { adapterError = e.message; }
    console.log(JSON.stringify({
      slug: args.slug,
      layout: config.layout,
      size: config.size,
      model,
      quality,
      out: `${config.outputDir}/${args.slug}.webp`,
      pack: config.pack.id,
      adapter,
      ...(adapterError ? { adapterError } : {}),
      alt,
      ...compiled,
    }, null, 2));
    return 0;
  }

  const history = [];
  let png = null;
  let recipe = null;
  let verdicts = [];
  let round = 0;
  let workDir = null;
  let adapter = null;
  if (args.publish) {
    png = resolve(root, args.publish);
    recipe = `${png}.recipe.json`;
    if (!existsSync(png)) throw new Error(`--publish: no image at ${png}`);
    if (!existsSync(recipe)) throw new Error(`--publish: no recipe beside ${png} (${recipe}); an image without provenance cannot be published`);
    log(`publishing ${png} as it is: no render, no read-back (overruled by the operator)`);
  } else {
    adapter = deps.adapter ?? resolveAdapter({ env, root, home: deps.home });
    if (adapter.note) log(adapter.note);
    workDir = mkdtempSync(join(tmpdir(), `wiki-hero-${args.slug.replace(/\//g, '-')}-`));
    log(`rendering ${args.slug} through ${adapter.kind} (${model}, ${config.size}, ${quality}); rounds in ${workDir}`);
  }

  let prompt = compiled.prompt;
  while (!args.publish && round < MAX_ROUNDS) {
    round += 1;
    log(`round ${round} of ${MAX_ROUNDS}`);
    const out = join(workDir, `round-${round}.png`);
    ({ png, recipe } = await renderHero({ ...compiled, prompt }, { adapter, out, model, size: config.size, quality, run: deps.run, cwd: root }));
    if (!args.readback) { verdicts = []; break; }
    const written = JSON.parse(readFileSync(recipe, 'utf8'));
    const guardGate = Array.isArray(written.guardGate) ? written.guardGate.filter((g) => typeof g === 'string') : [];
    const gate = [...compiled.gate, ...guardGate.filter((g) => !compiled.gate.includes(g))];
    verdicts = await readBack(png, gate, compiled.strings, { vision: deps.vision, env });
    history.push({ round, png, verdicts });
    // Beside the round, ABU's own convention, so a person looking at a refused round sees what
    // refused it, and `--publish` can carry those verdicts into the recipe as overruled.
    writeFileSync(`${png}.readback.json`, `${JSON.stringify({ round, verdicts }, null, 2)}\n`);
    const defects = verdicts.filter((v) => v.verdict === 'DEFECT');
    for (const v of verdicts) log(`  ${v.verdict.padEnd(6)} ${v.assertion}${v.note ? `  (${v.note})` : ''}`);
    if (!defects.length) break;
    prompt = `${compiled.prompt}\n\n${counterClauses(verdicts)}`;
    if (round < MAX_ROUNDS) log(`${defects.length} defect(s); re-rolling with them as corrections`);
  }

  const defects = verdicts.filter((v) => v.verdict === 'DEFECT');
  if (defects.length) {
    log(`${defects.length} defect(s) survived ${round} round(s); nothing published. The renders are in ${workDir}.`);
    if (args.json) console.log(JSON.stringify({ png, webp: null, recipe, verdicts, rounds: round, history, workDir }, null, 2));
    return 3;
  }

  let readback;
  if (args.publish) {
    const beside = `${png}.readback.json`;
    const looked = existsSync(beside) ? JSON.parse(readFileSync(beside, 'utf8')) : null;
    readback = {
      rounds: 0,
      verdicts: Array.isArray(looked?.verdicts) ? looked.verdicts : [],
      vision: 'skipped: published from an existing render by the operator (--publish)',
      publishedFrom: png,
      ...(looked ? { overruled: true } : {}),
    };
  } else readback = { rounds: round, verdicts, ...(history.length ? { history } : {}), vision: args.readback ? (env.WIKI_HERO_VISION_MODEL || DEFAULT_VISION_MODEL) : 'skipped' };
  const published = await publishHero({
    png, recipe, slug: args.slug, outputDir: config.outputDir, root, alt, readback,
    extra: {
      stylePack: config.pack.id,
      wikiHero: { slug: args.slug, title: args.title, labels: args.labels, beats: args.beats, layout: config.layout, tier: args.tier, adapter: adapter?.kind ?? 'none (--publish)' },
    },
    optimize: deps.optimize, page: args.page, write: args.write,
  });
  log(`published ${published.webp}`);
  if (args.json) {
    console.log(JSON.stringify({ png, webp: published.webp, recipe: published.recipeOut, verdicts, rounds: round, history, workDir, pageWritten: published.pageWritten }, null, 2));
    return 0;
  }
  console.log(published.pageWritten
    ? `Done. ${published.pageWritten} now carries both lines:`
    : 'Done. Two lines to paste into the page:');
  console.log('');
  console.log('Frontmatter:');
  console.log(`  ${published.frontmatterLine}`);
  console.log('');
  console.log('Body, immediately after the italic definition line:');
  console.log(`  ${published.bodyLine}`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(`[hero] ${err.message}`); process.exit(1); });
