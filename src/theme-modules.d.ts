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
