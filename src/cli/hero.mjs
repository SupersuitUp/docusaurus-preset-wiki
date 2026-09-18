#!/usr/bin/env node
// One command that renders any wiki page's hero through the wiki's Style Pack:
//
//   wiki hero <slug> --title "WORDS ACROSS THE TOP" \
//     --beat "..." --beat "..." --beat "..." --beat "..." \
//     --label one --label two --label three --label four \
//     [--prop <name>] [--dry-run]
//
// Reads the `hero` block of wiki.config.json (or migrates a legacy `hero_register` in memory),
// resolves the pack, and compiles the prompt, the reference list, the declared strings and the
// read-back gate. `--dry-run` prints all of that as JSON and spends nothing.
//
// The render itself (generate, read back against the gate, write the WebP, the recipe and the
// frontmatter) is not here yet: this file ships the compile step only.
import { pathToFileURL } from 'node:url';
import { readHeroConfig } from '../hero/config.mjs';
import { compileHero } from '../hero/compile.mjs';

const HELP = `wiki hero <slug> --title "<words>" --beat "<scene>"... --label <word>... [--prop <name>]... [--dry-run]

  <slug>            the page the hero is for; the output is named after it
  --title           the words across the top of the image, verbatim
  --beat            one scene beat per panel, in order (repeat; a grid takes exactly four)
  --label           one label per panel, in order (repeat), or --labels "a|b|c|d"
  --prop <name>     a prop declared under hero.props in wiki.config.json (repeat)
  --dry-run         print the compiled prompt, refs, strings and gate as JSON; no API call

Run from the wiki root. The pack comes from hero.stylePack: a path, or an id looked up in
$WIKI_STYLE_PACKS and then ../wiki-style-packs/packs beside the wiki.`;

/** argv (after the subcommand) to the inputs the compiler takes. Pure, so it is testable. */
export function parseHeroArgs(argv) {
  const out = { slug: undefined, title: undefined, beats: [], labels: [], props: [], dryRun: false, help: false };
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
    else if (a === '--title') out.title = next();
    else if (a === '--beat') out.beats.push(next());
    else if (a === '--label') out.labels.push(next());
    else if (a === '--labels') out.labels.push(...next().split('|'));
    else if (a === '--prop') out.props.push(next());
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (out.slug === undefined) out.slug = a;
    else throw new Error(`unexpected argument ${JSON.stringify(a)}; beats go in --beat`);
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

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const args = parseHeroArgs(argv);
  if (args.help || argv.length === 0) { console.log(HELP); return 0; }
  if (!args.slug) { console.error('[hero] a page slug is required (see wiki hero --help)'); return 2; }
  const config = readHeroConfig(root);
  const props = selectProps(args.props, config.props);
  const compiled = compileHero({ pack: config.pack, config: { ...config, root }, title: args.title, labels: args.labels, beats: args.beats, props });
  if (args.dryRun) {
    console.log(JSON.stringify({
      slug: args.slug,
      layout: config.layout,
      size: config.size,
      model: config.model,
      quality: config.quality,
      out: `${config.outputDir}/${args.slug}.webp`,
      pack: config.pack.id,
      ...compiled,
    }, null, 2));
    return 0;
  }
  console.error('[hero] compiled; render is Task 3 (nothing generated). Use --dry-run to see the prompt.');
  return 2;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(`[hero] ${err.message}`); process.exit(1); });
