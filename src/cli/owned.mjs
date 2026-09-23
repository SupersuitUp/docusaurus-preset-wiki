// Paths the package owns, by the exact names the template shipped them under. ONE list, read by
// `wiki check owned-files` (which refuses them in an instance) and by `wiki migrate` (which
// deletes them). Until 1.13.0 these were two lists, and the check's had grown four scripts the
// migration's never learned (check-ascii-diagrams, check-page-graphics, check-voice,
// check-retired-words): a migrated wiki carrying one of them came out of `migrate` with a
// prebuild that refused it (getfreedom-wiki, 2026-09-23).
//
// Deliberately NOT `plugins/` or `src/theme/` wholesale: an instance may carry a plugin of its own
// (a book wiki's chat plugin) or swizzle one component, and both are the escape hatch, not the fork.

/** What `wiki check owned-files` refuses: a file or folder here means the framework was forked again. */
export const OWNED = [
  'plugins/search-plugin', 'plugins/creation-date-plugin', 'plugins/og-image-plugin',
  'plugins/manifest-plugin', 'plugins/share-view-plugin',
  'src/components/ShareButton.tsx', 'src/components/PageDates.tsx',
  'src/components/Changelog.tsx', 'src/components/ChangelogWidget.tsx',
  'src/share',
  'scripts/check-links.mjs', 'scripts/check-image-weight.mjs', 'scripts/check-image-provenance.mjs',
  'scripts/check-admonitions.mjs', 'scripts/check-ascii-diagrams.mjs', 'scripts/check-page-graphics.mjs',
  'scripts/check-voice.mjs', 'scripts/check-retired-words.mjs',
  'scripts/unlock-link.mjs', 'scripts/generate-llms-txt.sh', 'scripts/llms-txt-env.mjs',
  'scripts/build-icons.py', 'scripts/optimize-images.py',
  'scripts/check-template-version.mjs', 'scripts/bump.sh',
  'TEMPLATE-VERSION',
];

/** What `wiki migrate` deletes: everything owned, plus the template's copies of the theme files the
 *  package now ships and the tests and loaders that only existed to run the owned scripts. The
 *  theme paths are not in OWNED because a wiki may legitimately swizzle them after migrating. */
export const MIGRATE_DELETES = [
  ...OWNED,
  'src/theme/DocItem', 'src/theme/MDXComponents',
  'scripts/unlock-link.test.mjs', 'scripts/test-image-provenance.mjs',
  'scripts/check-template-version.test.mjs', 'scripts/check-retired-words.test.mjs',
  'scripts/check-ascii-diagrams.test.mjs', 'scripts/test-ascii-diagrams.mjs',
  'scripts/ts-resolve-hooks.mjs', 'scripts/ts-resolve-loader.mjs',
  'wiki.config.schema.json',
];
