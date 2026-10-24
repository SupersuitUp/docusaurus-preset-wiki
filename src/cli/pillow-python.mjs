// Which command runs a Python script that needs Pillow. A machine's python3 often has no Pillow
// (macOS's never does), and every Pillow tool here used to stop and print the uv recipe for a
// person to retype. uv can supply Pillow for one run with nothing installed, so when python3
// lacks it and uv is on PATH, that is the command. Earned 2026-10-23: two wiki publishes in one
// evening hit a missing Pillow, one worked around it with a scratch venv, one skipped a check.
import { spawnSync } from 'node:child_process';

const ok = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

/**
 * The argv prefix that runs Python with Pillow importable, or null when nothing on this machine
 * can. `has(cmd, args)` reports whether a command exits 0, and is injected so tests need neither.
 */
export function pillowPython(has = ok) {
  if (has('python3', ['-c', 'import PIL'])) return ['python3'];
  if (has('uv', ['--version'])) return ['uv', 'run', '--quiet', '--with', 'pillow', 'python3'];
  return null;
}

export const NO_PILLOW = 'python3 with Pillow is needed (`pip install pillow`, or install uv and it is supplied per run)';
