import type { LoadContext } from '@docusaurus/types';

// The plugin-side reader for where the docs are mounted. See the header of
// `src/cli/docs-base.mjs` for why there are two of these and what keeps them honest.

/** "" for root, otherwise "/wiki" with no trailing slash. */
export function normalizeDocsBase(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t || t === '/') return '';
  return '/' + t.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The docs `routeBasePath` for this site, or `''` when the docs are at the root.
 * Reads `siteConfig.presets`, which already reflects an imperative override, since a config
 * that mutates the preset array does so before exporting it.
 */
export function docsRouteBasePath(context: LoadContext): string {
  const presets = ((context.siteConfig as any)?.presets ?? []) as unknown[];
  for (const preset of presets) {
    if (!Array.isArray(preset)) continue;
    const base = (preset[1] as any)?.docs?.routeBasePath;
    if (typeof base === 'string') {
      const n = normalizeDocsBase(base);
      if (n) return n;
    }
  }
  return '';
}

/** `route` moved under `base`, never prefixed twice, and never applied to a non-route. */
export function withBaseRoute(route: string, base: string): string {
  const b = normalizeDocsBase(base);   // tolerates a caller still passing '/'
  if (!b || !route || !route.startsWith('/')) return route;
  if (route === b || route.startsWith(`${b}/`)) return route;
  return `${b}${route}`;
}

/** One change event with its routePath moved under the docs base path. */
export function withBase<T extends { routePath?: string }>(event: T, base: string): T {
  if (!normalizeDocsBase(base) || !event.routePath) return event;
  const moved = withBaseRoute(event.routePath, base);
  return moved === event.routePath ? event : { ...event, routePath: moved };
}
