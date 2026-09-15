/**
 * Label wrapping for <Loop>, in its own module so it can be tested without importing the
 * component (which imports a CSS module and cannot be loaded by plain node).
 *
 * The node at three o'clock is centred at CX + RX, so anything wider than twice the room left on
 * that side is drawn outside the viewBox and CLIPPED. A long beat therefore has to wrap rather
 * than run off the frame: "Promote it to something that runs" did exactly that on the first wiki
 * to use this with real labels, and a clipped box reads as a rendering bug rather than as a
 * caption that is too long.
 */
const W = 880;
const CX = W / 2;
const RX = 288;

export const NODE_PAD = 26;
export const CHAR_W = 8.1; // 15px system sans, measured against a long label
export const NODE_MAX_W = 2 * (W - (CX + RX)) - 8;

/** Greedy wrap on whole words, to at most `maxLines` lines. The last line keeps any overflow. */
export function wrapLabel(text: string, maxWidth = NODE_MAX_W, maxLines = 2): string[] {
  const budget = Math.floor((maxWidth - NODE_PAD * 2) / CHAR_W);
  if (text.length <= budget) return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > budget && line && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
