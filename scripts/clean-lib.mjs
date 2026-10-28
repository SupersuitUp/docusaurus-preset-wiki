// tsc never deletes what it emitted before, so a file compiled into lib/ by an older
// build (a test, a renamed module) would ship forever. Start every build from empty.
import { rmSync } from 'node:fs';
rmSync('lib', { recursive: true, force: true });
