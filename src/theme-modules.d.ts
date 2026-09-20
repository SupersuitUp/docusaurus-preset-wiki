// The components this theme adds, declared under the @theme alias the way
// theme-classic declares its own, so a component here can import a sibling
// through the alias and an instance's swizzle of that sibling is what it gets.
declare module '@theme/ShareButton' {
  export { default } from './theme/ShareButton';
}
declare module '@theme/PageDates' {
  export { default, usePageDates } from './theme/PageDates';
}
declare module '@theme/ChangelogWidget' {
  export { default, ChangeRow, useChangeEvents, type ChangeEvent } from './theme/ChangelogWidget';
}
declare module '@theme/Changelog' {
  export { default } from './theme/Changelog';
}
declare module '@theme/DocMetaRow' {
  export {
    default,
    DocMetaPlacementContext,
    useDocMetaPlacement,
    type DocMetaPlacement,
  } from './theme/DocMetaRow';
}

// The docs plugin publishes its client hooks (useDoc) only through its package `exports`
// map, which `moduleResolution: node` cannot read. The bundler resolves the bare specifier at
// build time; this tells tsc where the types are. Dropping it means upgrading the whole
// package to `moduleResolution: bundler`, which the CommonJS output does not allow.
//
// It is deliberately NOT a peerDependency. Declared as `^3.10.1` it pulled 3.10.2 to the
// top of the fixture's tree while theme-classic kept its pinned 3.10.1 nested, and the two
// copies each made their own DocProvider context: every page died with "useDoc is called
// outside the <DocProvider>" (2026-09-20). Undeclared, the import resolves to the one copy
// theme-classic already put in the site, which is the only copy that can work.
declare module '@docusaurus/plugin-content-docs/client' {
  export * from '@docusaurus/plugin-content-docs/lib/client/index';
}
