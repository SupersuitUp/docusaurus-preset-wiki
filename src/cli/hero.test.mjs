import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parseHeroArgs, selectProps, main, TIERS } from './hero.mjs';

const WIKI = join(dirname(fileURLToPath(import.meta.url)), 'wiki.mjs');
const run = (cwd, env, ...args) => spawnSync(process.execPath, [WIKI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

/** A wiki root with a hero block, and a packs dir holding the pack it names. */
function site() {
  const packs = mkdtempSync(join(tmpdir(), 'packs-'));
  const dir = join(packs, 'plain');
  mkdirSync(join(dir, 'refs'), { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({
    id: 'plain', name: 'plain', anchor: 'refs/a.png', refs: ['refs/a.png', 'refs/b.png'],
    palette: { ground: ['#EFE6D2'], fill: ['#8FB0CE'], line: ['#3B382F'] },
    styleLine: 'warm editorial illustration', rejectedPoles: ['neon'], gate: ['muted palette'],
  }));
  writeFileSync(join(dir, 'refs', 'a.png'), '');
  writeFileSync(join(dir, 'refs', 'b.png'), '');
  const root = mkdtempSync(join(tmpdir(), 'wiki-hero-cli-'));
  mkdirSync(join(root, 'illustrations', 'props'), { recursive: true });
  writeFileSync(join(root, 'illustrations', 'props', 'glasses.png'), '');
  writeFileSync(join(root, 'wiki.config.json'), JSON.stringify({
    title: 'T', tagline: 't', url: 'https://t.wiki', organizationName: 'o', projectName: 'p', copyright: 'c', noindex: true, description: 'd',
    hero: { stylePack: 'plain', layout: 'row', beats: 2, props: { glasses: ['illustrations/props/glasses.png'] }, gate: ['the glasses match the prop photo'] },
  }));
  return { root, env: { WIKI_STYLE_PACKS: packs } };
}

const PAGE = ['--title', 'TWO BEATS', '--beat', 'A person opens a notebook.', '--beat', 'The notebook fills.', '--label', 'A person opens the notebook', '--label', 'The notebook fills by itself'];

test('parseHeroArgs collects repeatable beats, labels and props, and the pipe form of labels', () => {
  const a = parseHeroArgs(['my-page', ...PAGE, '--prop', 'glasses', '--dry-run']);
  assert.equal(a.slug, 'my-page');
  assert.equal(a.title, 'TWO BEATS');
  assert.deepEqual(a.beats, ['A person opens a notebook.', 'The notebook fills.']);
  assert.deepEqual(a.labels, ['A person opens the notebook', 'The notebook fills by itself']);
  assert.deepEqual(a.props, ['glasses']);
  assert.equal(a.dryRun, true);
  assert.deepEqual(parseHeroArgs(['p', '--labels', 'a|b|c']).labels, ['a', 'b', 'c']);
  assert.throws(() => parseHeroArgs(['p', '--frob']), /unknown flag/);
  assert.throws(() => parseHeroArgs(['p', '--title']), /needs a value/);
  assert.deepEqual(parseHeroArgs(['p', 'one beat|two beat']).beats, ['one beat', 'two beat']);
  assert.throws(() => parseHeroArgs(['p', 'a|b', 'stray']), /unexpected/);
});

test('selectProps takes only declared props and names the declared ones on a miss', () => {
  assert.deepEqual(selectProps(['g'], { g: ['x.png'], h: ['y.png'] }), { g: ['x.png'] });
  assert.throws(() => selectProps(['nope'], { g: ['x.png'] }), /nope[\s\S]*declared: g/);
});

test('wiki hero --help exits 0 and names the flags', () => {
  const r = run(process.cwd(), {}, 'hero', '--help');
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['--title', '--beat', '--label', '--prop', '--dry-run']) assert.match(r.stdout, new RegExp(f));
});

test('wiki hero --dry-run prints the compiled prompt, refs, strings and gate as JSON and exits 0', () => {
  const { root, env } = site();
  const r = run(root, env, 'hero', 'my-page', ...PAGE, '--prop', 'glasses', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'my-page');
  assert.equal(out.pack, 'plain');
  assert.equal(out.out, 'static/img/illustrations/my-page.webp');
  assert.match(out.prompt, /^warm editorial illustration/);
  assert.match(out.prompt, /2 CLEAR PANELS[\s\S]*horizontal row/);
  assert.match(out.prompt, /reading "TWO BEATS"/);
  assert.match(out.prompt, /PROP references/);
  assert.deepEqual(out.refs.map((x) => x.role), ['anchor', 'style', 'prop']);
  assert.equal(out.refs[2].path, join(realpathSync(root), 'illustrations', 'props', 'glasses.png'));
  assert.deepEqual(out.strings.map((s) => s.text), ['TWO BEATS', 'A person opens the notebook', 'The notebook fills by itself']);
  assert.equal(out.gate.at(-1), 'the glasses match the prop photo');
  assert.ok(out.gate.includes('muted palette'));
});

test('a compile refusal reaches the terminal by message and exits 1', () => {
  const { root, env } = site();
  const r = run(root, env, 'hero', 'my-page', '--title', 'X', '--beat', 'A notebook on a surface.', '--beat', 'b', '--label', 'a', '--label', 'b', '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /surface/);
  const missing = run(root, env, 'hero', 'my-page', ...PAGE, '--prop', 'hat', '--dry-run');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /hat[\s\S]*declared: glasses/);
});

test('parseHeroArgs takes the Task 3 flags: --beats, --beats-file, --pack, --layout, --tier, --prop name=path, --no-readback, --write, --page, --json', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'beats-')), 'beats.txt');
  writeFileSync(f, '1. A person opens a notebook.\n\n2. The notebook fills.\n');
  const a = parseHeroArgs(['p', '--beats-file', f, '--pack', 'other', '--layout', 'row', '--tier', 'fast', '--prop', 'hat=illustrations/props/hat.png', '--prop', 'glasses', '--no-readback', '--write', '--page', 'docs/x.md', '--json']);
  assert.deepEqual(a.beats, ['A person opens a notebook.', 'The notebook fills.']);
  assert.equal(a.pack, 'other');
  assert.equal(a.layout, 'row');
  assert.equal(a.tier, 'fast');
  assert.deepEqual(a.props, ['glasses']);
  assert.deepEqual(a.adHocProps, { hat: ['illustrations/props/hat.png'] });
  assert.equal(a.readback, false);
  assert.equal(a.write, true);
  assert.equal(a.page, 'docs/x.md');
  assert.equal(a.json, true);
  assert.deepEqual(parseHeroArgs(['p', '--beats', 'a|b|c']).beats, ['a', 'b', 'c']);
  assert.throws(() => parseHeroArgs(['p', '--tier', 'cheap']), /best|fast/);
  assert.throws(() => parseHeroArgs(['p', '--layout', 'stack']), /row|grid/);
});

test('the tiers: best is the wiki\'s configured model and quality, fast is the flare model at high', () => {
  assert.equal(TIERS.best, null);
  assert.deepEqual(TIERS.fast, { model: 'gpt-image-2.5-flare', quality: 'high', size: '1536x1024' });
});

/** Fakes for an in-process run: an adapter that draws a png, a vision that answers as told, an optimizer without Pillow. */
function fakes({ verdictsByRound = [] } = {}) {
  const log = { renders: [], readbacks: [], optimized: [] };
  const run = (argv) => {
    const out = argv[argv.indexOf('--out') + 1];
    const promptFile = argv[argv.indexOf('--prompt-file') + 1];
    log.renders.push({ argv, prompt: readFileSync(promptFile, 'utf8') });
    writeFileSync(out, 'png');
    writeFileSync(`${out}.recipe.json`, JSON.stringify({ model: 'm', prompt: 'p', refs: [], timestamp: 't', guardGate: ['DEVICE FACING: every screen faces its user'] }));
    return { status: 0 };
  };
  const vision = async ({ questions }) => {
    const round = log.readbacks.length;
    log.readbacks.push(questions);
    const defects = verdictsByRound[round] ?? {};
    return JSON.stringify({ verdicts: questions.map((_, i) => ({ index: i + 1, verdict: defects[i + 1] ? 'DEFECT' : 'PASS', note: defects[i + 1] ?? 'ok' })) });
  };
  const optimize = (root, files) => {
    for (const png of files) {
      const webp = png.replace(/\.png$/, '.webp');
      writeFileSync(webp, 'webp');
      const recipe = JSON.parse(readFileSync(`${png}.recipe.json`, 'utf8'));
      recipe.asset = webp.slice(root.length + 1);
      writeFileSync(`${webp}.recipe.json`, JSON.stringify(recipe));
      unlinkSync(png);
      unlinkSync(`${png}.recipe.json`);
      log.optimized.push(webp);
    }
    return { status: 0 };
  };
  const adapter = { kind: 'abu', script: '/abu/generate.py' };
  return { log, deps: { run, vision, optimize, adapter } };
}

/** Capture what main() writes to stdout. */
async function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { return { code: await fn(), stdout: chunks.join('') }; } finally { process.stdout.write = orig; }
}

test('end to end: compile, render, read back clean, publish; --json prints png, webp, recipe, verdicts and rounds', async () => {
  const { root, env } = site();
  const { log, deps } = fakes();
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--prop', 'glasses', '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.rounds, 1);
  assert.equal(out.webp, join(root, 'static', 'img', 'illustrations', 'my-page.webp'));
  assert.equal(out.recipe, `${out.webp}.recipe.json`);
  assert.match(out.png, /round-1\.png$/);
  assert.equal(out.verdicts.length, 5 + 2 + 3 + 1, 'wiki gate, pack + config gate, three strings, one adapter guard');
  assert.ok(out.verdicts.every((v) => v.verdict === 'PASS'));
  assert.ok(out.verdicts.some((v) => /DEVICE FACING/.test(v.assertion)), 'the adapter\'s guardGate joins the read-back');
  assert.equal(log.renders.length, 1);
  assert.deepEqual(log.renders[0].argv.slice(0, 3), ['uv', 'run', '/abu/generate.py']);
  assert.ok(log.renders[0].argv.includes('--no-open'));
  assert.equal(log.renders[0].argv[log.renders[0].argv.indexOf('--model') + 1], 'gpt-image-2.5-sunburst');
  assert.equal(log.renders[0].argv[log.renders[0].argv.indexOf('--size') + 1], '2560x1440');
  const recipe = JSON.parse(readFileSync(out.recipe, 'utf8'));
  assert.equal(recipe.readback.rounds, 1);
  assert.deepEqual(recipe.readback.verdicts, out.verdicts);
  assert.equal(recipe.readback.overruled, false, 'a clean read-back is not an overrule');
  assert.equal(recipe.stylePack, 'plain');
  assert.equal(recipe.wikiHero.slug, 'my-page');
  assert.equal(recipe.mode, 'derive');
  assert.equal(recipe.prompt, undefined, 'the served record carries no prompt');
  assert.equal(out.sourcePng, join(root, 'illustrations', 'my-page.png'));
  assert.equal(out.sourceRecipe, `${out.sourcePng}.recipe.json`);
  assert.ok(existsSync(out.sourcePng), 'the full-size render survives publishing');
  const full = JSON.parse(readFileSync(out.sourceRecipe, 'utf8'));
  assert.equal(full.prompt, 'p');
  assert.equal(full.readback.vision, 'gpt-5.5', 'the full record names the vision model');
  const beside = JSON.parse(readFileSync(`${out.png}.readback.json`, 'utf8'));
  assert.equal(beside.vision, 'gpt-5.5', 'the read-back beside the round records which model looked, so --publish can carry it');
});

test('a DEFECT re-rolls with the notes appended as corrections, up to three rounds, and the recipe records every round', async () => {
  const { root, env } = site();
  const { log, deps } = fakes({ verdictsByRound: [{ 7: 'the label reads "opne"' }, { 4: 'three panels drawn' }] });
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.rounds, 3);
  assert.equal(log.renders.length, 3);
  assert.doesNotMatch(log.renders[0].prompt, /CORRECTIONS/);
  assert.match(log.renders[1].prompt, /CORRECTIONS[\s\S]*reads "opne"/);
  assert.match(log.renders[2].prompt, /CORRECTIONS[\s\S]*three panels drawn/);
  assert.match(log.renders[2].prompt, /opne/, 'round 3 is still told about round 1\'s defect, or the render can regress on it untold');
  assert.equal(log.renders[2].prompt.match(/opne/g).length, 1, 'one line per assertion, never a duplicate');
  const recipe = JSON.parse(readFileSync(out.recipe, 'utf8'));
  assert.equal(recipe.readback.rounds, 3);
  assert.equal(recipe.readback.history, undefined, 'the served summary does not repeat every round');
  const full = JSON.parse(readFileSync(out.sourceRecipe, 'utf8'));
  assert.equal(full.readback.history.length, 3);
  assert.equal(full.readback.history[0].verdicts.filter((v) => v.verdict === 'DEFECT').length, 1);
});

test('a DEFECT that survives every round publishes nothing, prints the verdicts, and exits 3', async () => {
  const { root, env } = site();
  const bad = { 1: 'eyes closed' };
  const { log, deps } = fakes({ verdictsByRound: [bad, bad, bad, bad] });
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 3);
  const out = JSON.parse(stdout);
  assert.equal(out.rounds, 3);
  assert.equal(out.webp, null);
  assert.equal(out.verdicts.filter((v) => v.verdict === 'DEFECT').length, 1);
  assert.equal(log.optimized.length, 0);
  assert.ok(!existsSync(join(root, 'static', 'img', 'illustrations', 'my-page.webp')));
});

test('--no-readback renders once, asks nothing, and publishes with an empty verdict list', async () => {
  const { root, env } = site();
  const { log, deps } = fakes();
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--no-readback', '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(log.readbacks.length, 0);
  assert.deepEqual(out.verdicts, []);
  assert.equal(out.rounds, 1);
  assert.ok(existsSync(out.webp));
});

test('--tier fast swaps in the flare model at high; --layout and --pack override the config', async () => {
  const { root, env } = site();
  const { log, deps } = fakes();
  const { code } = await capture(() => main(['my-page', ...PAGE, '--tier', 'fast', '--no-readback'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0);
  const argv = log.renders[0].argv;
  assert.equal(argv[argv.indexOf('--model') + 1], 'gpt-image-2.5-flare');
  assert.equal(argv[argv.indexOf('--quality') + 1], 'high');
  assert.equal(argv[argv.indexOf('--size') + 1], '1536x1024', 'the fast tier never renders at the premium size');
  const grid = ['--title', 'FOUR', '--beats', 'a|b|c|d', '--labels', 'The first beat lands here|The second beat follows it|The third beat turns it|The fourth beat closes it'];
  const r2 = await capture(() => main(['g', ...grid, '--layout', 'grid', '--dry-run'], root, { env: { ...process.env, ...env } }));
  assert.equal(r2.code, 0);
  assert.match(JSON.parse(r2.stdout).prompt, /two columns and two rows/);
  await assert.rejects(main(['g', ...PAGE, '--pack', 'nowhere', '--dry-run'], root, { env: { ...process.env, ...env } }), /nowhere[\s\S]*Looked in/);
});

test('without --json the two paste lines reach stdout, and --write patches the page found by slug', async () => {
  const { root, env } = site();
  mkdirSync(join(root, 'docs', 'concepts'), { recursive: true });
  const page = join(root, 'docs', 'concepts', 'my-page.md');
  writeFileSync(page, '---\ntitle: t\n---\n\n# T\n\n*Definition.*\n\nBody.\n');
  const { deps } = fakes();
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--write'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0);
  assert.match(stdout, /image: "\/img\/illustrations\/my-page\.webp"/);
  assert.match(stdout, /!\[Two-panel strip titled TWO BEATS[\s\S]*\]\(\/img\/illustrations\/my-page\.webp\)/);
  const text = readFileSync(page, 'utf8');
  assert.match(text, /image: "\/img\/illustrations\/my-page\.webp"/);
  assert.match(text, /\*Definition\.\*\n\n!\[Two-panel strip titled TWO BEATS/);
});

test('an unresolvable adapter refuses before anything is rendered, naming the install', async () => {
  const { root, env } = site();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  await assert.rejects(main(['my-page', ...PAGE], root, { env: { ...process.env, ...env, ABU_ADAPTER: '' }, home }), /agentic-brand-universe|ABU_ADAPTER/);
});

test('--publish <png> publishes a render a person has already looked at: no adapter, no vision, rounds 0, and the recipe says so', async () => {
  const { root, env } = site();
  const { log, deps } = fakes();
  const dir = mkdtempSync(join(tmpdir(), 'looked-'));
  const png = join(dir, 'round-3.png');
  writeFileSync(png, 'png');
  writeFileSync(`${png}.recipe.json`, JSON.stringify({ model: 'm', prompt: 'p', refs: [], timestamp: 't' }));
  writeFileSync(`${png}.readback.json`, JSON.stringify({ round: 3, vision: 'gpt-5.5', verdicts: [{ assertion: 'eyes open', verdict: 'DEFECT', note: 'turned away' }] }));
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--publish', png, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(log.renders.length, 0);
  assert.equal(log.readbacks.length, 0);
  assert.equal(out.png, png);
  assert.equal(out.rounds, 3, 'the round the published png came from');
  assert.deepEqual(out.verdicts, [{ assertion: 'eyes open', verdict: 'DEFECT', note: 'turned away' }], '--json shows what the recipe says');
  assert.ok(existsSync(out.webp));
  const full = JSON.parse(readFileSync(out.sourceRecipe, 'utf8'));
  assert.equal(full.readback.rounds, 3);
  assert.equal(full.readback.publishedFrom, png);
  assert.equal(full.readback.vision, 'gpt-5.5', 'the model that read the round back, carried from the readback file rather than reported as skipped');
  assert.match(full.readback.published, /operator/);
  assert.equal(full.readback.overruled, true, 'a DEFECT the person published over is an overrule');
  assert.deepEqual(full.readback.verdicts, [{ assertion: 'eyes open', verdict: 'DEFECT', note: 'turned away' }], 'the verdicts the person overruled travel with the asset');
  const served = JSON.parse(readFileSync(out.recipe, 'utf8'));
  assert.equal(served.readback.overruled, true);
  assert.equal(served.readback.publishedFrom, undefined, 'the served record names no path off the repo');
  await assert.rejects(main(['my-page', ...PAGE, '--publish', join(dir, 'nope.png')], root, { ...deps, env: { ...process.env, ...env } }), /nope\.png/);
});

test('--publish of a round whose read-back was clean is NOT an overrule; without a readback file the vision is recorded as skipped', async () => {
  const { root, env } = site();
  const { deps } = fakes();
  const dir = mkdtempSync(join(tmpdir(), 'looked-'));
  const png = join(dir, 'round-1.png');
  writeFileSync(png, 'png');
  writeFileSync(`${png}.recipe.json`, JSON.stringify({ model: 'm', prompt: 'p', refs: [], timestamp: 't' }));
  writeFileSync(`${png}.readback.json`, JSON.stringify({ round: 1, vision: 'gpt-5.5', verdicts: [{ assertion: 'eyes open', verdict: 'PASS', note: 'ok' }] }));
  const { code, stdout } = await capture(() => main(['my-page', ...PAGE, '--publish', png, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  const full = JSON.parse(readFileSync(out.sourceRecipe, 'utf8'));
  assert.equal(full.readback.overruled, false, 'every clean frapp approval used to be recorded as an overrule because a readback file sat beside the png');
  assert.equal(full.readback.rounds, 1);
  assert.equal(full.readback.vision, 'gpt-5.5');
  assert.equal(JSON.parse(readFileSync(out.recipe, 'utf8')).readback.overruled, false);

  const bare = join(dir, 'round-2.png');
  writeFileSync(bare, 'png');
  writeFileSync(`${bare}.recipe.json`, JSON.stringify({ model: 'm', prompt: 'p', refs: [], timestamp: 't' }));
  const r2 = await capture(() => main(['other-page', ...PAGE, '--publish', bare, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(r2.code, 0, r2.stdout);
  const full2 = JSON.parse(readFileSync(JSON.parse(r2.stdout).sourceRecipe, 'utf8'));
  assert.equal(full2.readback.overruled, false);
  assert.equal(full2.readback.rounds, 0);
  assert.match(full2.readback.vision, /skipped/);
});

test('--json on a surviving DEFECT and on success both carry the per-round history', async () => {
  const { root, env } = site();
  const bad = { 1: 'eyes closed' };
  const { deps } = fakes({ verdictsByRound: [bad, bad, bad] });
  const { stdout } = await capture(() => main(['my-page', ...PAGE, '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  const out = JSON.parse(stdout);
  assert.equal(out.history.length, 3);
  assert.equal(out.history[2].round, 3);
  const beside = JSON.parse(readFileSync(`${out.history[2].png}.readback.json`, 'utf8'));
  assert.equal(beside.round, 3);
  assert.equal(beside.verdicts[0].verdict, 'DEFECT');
  const ok = fakes();
  const good = await capture(() => main(['my-page', ...PAGE, '--json'], root, { ...ok.deps, env: { ...process.env, ...env } }));
  assert.equal(JSON.parse(good.stdout).history.length, 1);
});

test('a usage error from the flags exits 2 with the message, never 1', async () => {
  const { root, env } = site();
  const chunks = [];
  const orig = console.error;
  console.error = (...m) => chunks.push(m.join(' '));
  try {
    assert.equal(await main(['my-page', '--frob'], root, { env: { ...process.env, ...env } }), 2);
    assert.equal(await main(['my-page', '--tier', 'cheap'], root, { env: { ...process.env, ...env } }), 2);
  } finally { console.error = orig; }
  assert.match(chunks.join('\n'), /unknown flag --frob/);
  assert.match(chunks.join('\n'), /--tier must be best or fast/);
});

test('hero.tier in the config is the default tier; --tier overrides it; the recipe records the tier that ran', async () => {
  const { root, env } = site();
  const raw = JSON.parse(readFileSync(join(root, 'wiki.config.json'), 'utf8'));
  raw.hero.tier = 'fast';
  writeFileSync(join(root, 'wiki.config.json'), JSON.stringify(raw));
  const { log, deps } = fakes();
  const r1 = await capture(() => main(['my-page', ...PAGE, '--no-readback', '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(r1.code, 0);
  const argv = log.renders[0].argv;
  assert.equal(argv[argv.indexOf('--model') + 1], 'gpt-image-2.5-flare', 'hero.tier fast picks the draft model with no flag');
  assert.equal(argv[argv.indexOf('--size') + 1], '1536x1024');
  const recipe = JSON.parse(readFileSync(JSON.parse(r1.stdout).recipe, 'utf8'));
  assert.equal(recipe.wikiHero.tier, 'fast');

  const r2 = await capture(() => main(['my-page', ...PAGE, '--tier', 'best', '--no-readback', '--json'], root, { ...deps, env: { ...process.env, ...env } }));
  assert.equal(r2.code, 0);
  const argv2 = log.renders[1].argv;
  assert.equal(argv2[argv2.indexOf('--model') + 1], 'gpt-image-2.5-sunburst', '--tier best overrides hero.tier fast');
  assert.equal(JSON.parse(readFileSync(JSON.parse(r2.stdout).recipe, 'utf8')).wikiHero.tier, 'best');
  assert.equal(parseHeroArgs(['p']).tier, undefined, 'no flag means the config decides');
});

test('a prop declared as { refs, gate } renders its photo and its gate line reaches the read-back only when --prop names it; an ad hoc --prop name=path merges into it', async () => {
  const { root, env } = site();
  writeFileSync(join(root, 'illustrations', 'props', 'glasses-side.png'), '');
  const raw = JSON.parse(readFileSync(join(root, 'wiki.config.json'), 'utf8'));
  raw.hero.props = { glasses: { refs: ['illustrations/props/glasses.png'], gate: ['the glasses match the prop photos: thick black frames'] } };
  raw.hero.gate = [];
  writeFileSync(join(root, 'wiki.config.json'), JSON.stringify(raw));
  const E = { env: { ...process.env, ...env } };
  const without = await capture(() => main(['my-page', ...PAGE, '--dry-run'], root, E));
  assert.equal(without.code, 0);
  assert.ok(!JSON.parse(without.stdout).gate.includes('the glasses match the prop photos: thick black frames'));
  const withIt = await capture(() => main(['my-page', ...PAGE, '--prop', 'glasses', '--prop', 'glasses=illustrations/props/glasses-side.png', '--dry-run'], root, E));
  assert.equal(withIt.code, 0);
  const out = JSON.parse(withIt.stdout);
  assert.ok(out.gate.includes('the glasses match the prop photos: thick black frames'));
  assert.deepEqual(out.refs.filter((r) => r.role === 'prop').map((r) => r.path.split('/').pop()), ['glasses.png', 'glasses-side.png']);
  assert.match(out.prompt, /the glasses \(2 photographs\)/);
});
