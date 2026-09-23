import type { Plugin, LoadContext, PluginOptions } from '@docusaurus/types';
import type { ChangeEvent, PageDates } from './collect';
import { loadHistory, undatedPages, SNAPSHOT_RELATIVE_PATH } from './snapshot';

export interface CreationDatePluginContent {
  /** The changelog stream: newest first, meta pages excluded. */
  changeEvents: ChangeEvent[];
  /** Created / Updated for every built page, keyed by docKey. See collect.ts. */
  pageDates: Record<string, PageDates>;
}

// Git history in, two things out: the event stream /changelog renders and the
// per-page dates every article shows under its title. How the snapshot keeps
// production honest on Vercel's shallow clone is explained in snapshot.ts.
/** The docs plugin's `routeBasePath`, or `/` when it is not set. */
export function docsRouteBasePath(context: LoadContext): string {
  const presets = (context.siteConfig as any)?.presets ?? [];
  for (const preset of presets) {
    if (!Array.isArray(preset)) continue;
    const base = preset[1]?.docs?.routeBasePath;
    if (typeof base === 'string' && base !== '/') return `/${base.replace(/^\/+|\/+$/g, '')}`;
  }
  return '/';
}

/** One change event with its routePath moved under the docs base path. */
export function withBase<T extends {routePath?: string}>(event: T, base: string): T {
  if (base === '/' || !event.routePath || !event.routePath.startsWith('/')) return event;
  if (event.routePath === base || event.routePath.startsWith(`${base}/`)) return event;
  return {...event, routePath: `${base}${event.routePath}`};
}

export default function creationDatePlugin(
  context: LoadContext,
  _options: PluginOptions,
): Plugin<CreationDatePluginContent> {
  return {
    name: 'creation-date-plugin',

    async loadContent() {
      // THE DOCS MAY NOT BE AT THE ROOT. `routePathFor` builds a route from the page's own
      // `slug:`, which Docusaurus resolves RELATIVE to the docs `routeBasePath`, so a wiki
      // mounted at `/wiki` gets changelog links that are every one of them a 404. The plugin is
      // the only layer that can see both halves, so the prefix is applied here rather than
      // threaded through the collector.
      //
      // Found 2026-09-22 on the first wiki in the family to put something other than the docs at
      // `/`: every internal check passed (check-links resolves against slugs, which were right)
      // and only Docusaurus' own onBrokenLinks caught it, on the changelog alone.
      const docsBase = docsRouteBasePath(context);
      const history = loadHistory(context.siteDir);
      if (history.wroteSnapshot) {
        console.log(
          `[changelog] snapshot refreshed with ${history.changeEvents.length} events and ${Object.keys(history.pageDates).length} dated pages, commit ${SNAPSHOT_RELATIVE_PATH}`,
        );
      }
      // On the build host this is the only place the drift is visible: a page
      // with no dates renders nothing, silently, and nobody sees a blank line.
      if (history.shallow) {
        const undated = undatedPages(history, history.liveDocKeys ?? []);
        if (undated.length > 0) {
          console.warn(
            `[changelog] shallow clone: ${undated.length} page(s) have no Created/Updated dates because ${SNAPSHOT_RELATIVE_PATH} predates them and their commits are outside the clone window. Run \`wiki refresh-dates\` (or install the pre-commit hook with \`wiki install-hooks\`) and commit the snapshot:\n  ${undated.join('\n  ')}`,
          );
        }
      }
      return {
        changeEvents: history.changeEvents.map((e) => withBase(e, docsBase)),
        pageDates: history.pageDates,
      };
    },

    async contentLoaded({ content, actions }) {
      actions.setGlobalData(content);
    },
  };
}
