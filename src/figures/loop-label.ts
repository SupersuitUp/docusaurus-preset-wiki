/**
 * The accessible description of a Loop, kept in its own module so it can be tested without
 * importing the component (which imports a CSS module and therefore cannot be loaded by plain
 * node). The label is the half of the figure a screen reader gets, so it is the half worth a test.
 */
export function loopLabel(beats: readonly string[]): string {
  return `A loop of ${beats.length} beats. ${beats.join(', then ')}, and back to ${beats[0]}.`;
}
