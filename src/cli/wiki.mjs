#!/usr/bin/env node
// The build-time checks and operator commands every family wiki runs, as one bin,
// so an instance's package.json says `wiki check` and never carries the scripts.
// Every command resolves the wiki root from the cwd it is run in.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const [cmd, ...rest] = process.argv.slice(2);

// Paths the package owns, by the exact names the template shipped them under. Their presence
// in an instance means the framework was forked again, which is the one failure the package
// exists to prevent. Deliberately NOT `plugins/` or `src/theme/` wholesale: an instance may
// carry a plugin of its own (a book wiki's chat plugin) or swizzle one component, and both are
// the escape hatch, not the fork.
const OWNED = [
  'plugins/search-plugin',
  'plugins/creation-date-plugin',
  'plugins/og-image-plugin',
  'plugins/manifest-plugin',
  'plugins/share-view-plugin',
  'src/components/ShareButton.tsx',
  'src/components/PageDates.tsx',
  'src/components/Changelog.tsx',
  'src/components/ChangelogWidget.tsx',
  'src/share',
  'scripts/check-links.mjs',
  'scripts/check-image-weight.mjs',
  'scripts/check-image-provenance.mjs',
  'scripts/check-admonitions.mjs',
  'scripts/check-ascii-diagrams.mjs',
  'scripts/unlock-link.mjs',
  'scripts/generate-llms-txt.sh',
  'scripts/llms-txt-env.mjs',
  'scripts/build-icons.py',
  'scripts/optimize-images.py',
  'scripts/check-template-version.mjs',
  'scripts/bump.sh',
  'TEMPLATE-VERSION',
];

function node(script, ...args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
}

function python(script, ...args) {
  const probe = spawnSync('python3', ['--version']);
  if (probe.status !== 0) {
    console.error(`[wiki] ${script} needs python3 on PATH (with Pillow; \`uv run --with pillow python3\` also works).`);
    return 1;
  }
  const r = spawnSync('python3', [join(HERE, 'python', script), ...args], { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
}

const CHECKS = {
  'owned-files': () => {
    const found = OWNED.filter((p) => existsSync(join(ROOT, p)));
    if (found.length === 0) return 0;
    console.error(
      `[wiki check] these paths are owned by @supersuit/docusaurus-preset-wiki and must not exist in an instance:\n  ${found.join('\n  ')}\nDelete them; the package provides them.`,
    );
    return 1;
  },
  middleware: () => node('check-middleware.mjs'),
  admonitions: () => node('check-admonitions.mjs'),
  'ascii-diagrams': () => node('check-ascii-diagrams.mjs'),
  llms: () => node('llms-txt.mjs'),
  links: () => node('check-links.mjs'),
  'image-weight': () => node('check-image-weight.mjs'),
  provenance: () => node('check-image-provenance.mjs', ...rest.filter((a) => a.startsWith('--'))),
};

function help() {
  console.log(`wiki <command>

  check [${Object.keys(CHECKS).join('|')}]
                       run one build-time check, or all of them in that order (the prebuild)
  share [...]          the unlock-link CLI: OPEN / UNLOCKED / BLOCKED / MINTABLE, focused shares
  migrate              move a wiki still carrying copied framework files (wiki-template v1.x) onto the package
  upgrade [--to v]     bring a wiki on the package to the newest release, printing the CHANGELOG between
  gate set|status|link the password gate of the deployed wiki: set or rotate it through the Vercel API,
                       verify by read-back, redeploy, check the live site (wiki gate --help)
  icons                draw the favicon and PWA icon set from wiki.config.json (python3 + Pillow)
  optimize-images      WebP-convert and resize static images (python3 + Pillow)

Run from the wiki root (where wiki.config.json is).`);
}

let status;
switch (cmd) {
  case undefined:
  case '-h':
  case '--help':
  case 'help':
    help();
    status = 0;
    break;
  case 'check': {
    const which = rest.find((a) => !a.startsWith('--'));
    const order = which ? [which] : Object.keys(CHECKS);
    status = 0;
    for (const name of order) {
      if (!CHECKS[name]) {
        console.error(`[wiki check] unknown check "${name}". One of: ${Object.keys(CHECKS).join(', ')}`);
        status = 2;
        break;
      }
      status = CHECKS[name]();
      if (status !== 0) break;
    }
    break;
  }
  case 'share':
    status = node('unlock-link.mjs', ...rest);
    break;
  case 'gate':
    status = node('gate.mjs', ...rest);
    break;
  case 'migrate':
    status = node('migrate.mjs', ...rest);
    break;
  case 'upgrade':
    status = node('upgrade.mjs', ...rest);
    break;
  case 'icons':
    status = python('build-icons.py', ...rest);
    break;
  case 'optimize-images':
    status = python('optimize-images.py', ...rest);
    break;
  default:
    console.error(`[wiki] unknown command "${cmd}". Try --help.`);
    status = 2;
}
process.exit(status);
