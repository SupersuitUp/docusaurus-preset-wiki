import type { LoadContext, PluginModule } from '@docusaurus/types';
import { readWikiConfig, type WikiConfig } from './config';
import searchPlugin from './plugins/search';
import creationDatePlugin from './plugins/creation-date';
import ogImagePlugin from './plugins/og-image';
import manifestPlugin from './plugins/manifest';
import shareViewPlugin from './plugins/share-view';
import wikiTheme from './theme';

export type { WikiConfig };
export { readWikiConfig };
export { defineWikiConfig } from './define-config';

/** The preset: every plugin a family wiki runs, configured from wiki.config.json. */
export default function wikiPreset(context: LoadContext, options: Partial<WikiConfig> = {}) {
  const wiki = readWikiConfig(context.siteDir, options);
  return {
    plugins: [
      searchPlugin as unknown as PluginModule,
      creationDatePlugin as unknown as PluginModule,
      [manifestPlugin as unknown as PluginModule, { bg: wiki.og?.bg }],
      [ogImagePlugin as unknown as PluginModule, wiki.og ?? {}],
      [shareViewPlugin as unknown as PluginModule, { title: wiki.title }],
    ],
    themes: [wikiTheme as unknown as PluginModule],
  };
}
