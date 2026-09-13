import type { LoadContext } from '@docusaurus/types';
import { readWikiConfig, type WikiConfig } from './config';

export type { WikiConfig };
export { readWikiConfig };

export default function wikiPreset(context: LoadContext, options: Partial<WikiConfig> = {}) {
  const wiki = readWikiConfig(context.siteDir, options);
  void wiki;
  return { plugins: [], themes: [] };
}
