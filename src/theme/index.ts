import * as path from 'path';
import type { LoadContext, Plugin } from '@docusaurus/types';

// Every component the family wiki ships, and the CSS that lays a wiki out.
// Resolution order is the site's own src/theme, then this, then theme-classic,
// so an instance overrides one component by putting a file in its src/theme.
export default function wikiTheme(_context: LoadContext): Plugin<void> {
  return {
    name: 'supersuit-wiki-theme',
    getThemePath() {
      // At runtime this file is lib/theme/index.js; the compiled components sit beside it.
      return path.resolve(__dirname, './');
    },
    getTypeScriptThemePath() {
      return path.resolve(__dirname, '../../src/theme');
    },
    getClientModules() {
      // The reader-analytics beacon (src/analytics/client.ts) lives OUTSIDE the theme path, so it
      // never becomes an `@theme/` component a site could accidentally swizzle over.
      return [path.resolve(__dirname, './wiki.css'), path.resolve(__dirname, '../analytics/client.js')];
    },
  };
}
