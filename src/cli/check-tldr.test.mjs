import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-tldr.mjs');

function site(files) {
  const d = mkdtempSync(join(tmpdir(), 'tldr-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  return d;
}
const run = (d, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: d, encoding: 'utf8' });

test('a page with no tldr passes without --require', () => {
  assert.equal(run(site({ 'docs/a.md': '# A\n\nBody.\n' })).status, 0);
});
test('--require fails a page with no tldr and names it', () => {
  const r = run(site({ 'docs/a.md': '# A\n\nBody.\n' }), '--require');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/a\.md/);
});
test('--require accepts tldr_exempt', () => {
  const d = site({ 'docs/a.md': '---\ntldr_exempt: index stub\n---\n# A\n' });
  assert.equal(run(d, '--require').status, 0);
});
test('--require does not accept an empty tldr_exempt; it needs a reason', () => {
  for (const v of ['', '   ']) {
    const d = site({ 'docs/a.md': `---\ntldr_exempt: ${v}\n---\n# A\n` });
    const r = run(d, '--require');
    assert.equal(r.status, 1, `tldr_exempt: "${v}" must not exempt`);
    assert.match(r.stderr, /docs\/a\.md/);
    assert.match(r.stderr, /tldr_exempt needs a reason/);
  }
});
test('a bad tldr fails even without --require', () => {
  const d = site({ 'docs/a.md': '---\ntldr: "A. B. C. D."\n---\n# A\n' });
  const r = run(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/a\.md/);
});
