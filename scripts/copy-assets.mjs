// tsc emits only .js/.d.ts. Everything else a component or CLI needs beside it
// (CSS modules, fonts, the llms shell script, the python tools, JSON defaults,
// the untranspiled .mjs CLI files) is copied here so lib/ is complete on its own.
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const KEEP = /\.(css|ttf|sh|py|json|mjs)$/;
const SRC = 'src';
const OUT = 'lib';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let n = 0;
for (const file of walk(SRC)) {
  if (!KEEP.test(file) || /\.test\.mjs$/.test(file)) continue;
  const dest = join(OUT, relative(SRC, file));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
  n += 1;
}
console.log(`[copy-assets] ${n} files copied into ${OUT}/`);
