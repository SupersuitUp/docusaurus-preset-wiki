import React, {type JSX} from 'react';
import styles from './Loop.module.css';
import {loopLabel} from './loop-label';

// A cycle, DRAWN. The answer `wiki check ascii-diagrams` points at when it refuses a typed one.
//
// Nearly every diagram on these wikis is the same figure: three to six beats that come back round
// to the first. Typed out of dashes it cannot theme with the page, is unreadable in a phone
// column, and hands a screen reader a wall of punctuation. Drawn here it gets all three for free,
// and a wiki adds one by listing its beats.
//
// The geometry is COMPUTED from one ellipse and N angles rather than hand-placed, so a figure
// cannot drift out of alignment and adding a beat is a one-line change.
//
//   <Loop beats={['Map a workflow', 'Promote it', 'Hours come back', 'Capacity for the next']}
//         middle={['the catalog says', 'what is still manual']}
//         caption="Optional line under the figure." />

export type LoopProps = {
  /** Three or more beats, in the order they happen. Drawn clockwise from twelve o'clock. */
  beats: readonly string[];
  /** Optional lines set in the middle of the ring, in the accent colour. */
  middle?: readonly string[];
  /** Optional caption under the figure. */
  caption?: string;
  /**
   * Overrides the generated aria-label. The default reads the beats in order and says the loop
   * returns to the start, which is right for most figures and wrong for none silently.
   */
  label?: string;
};

/* ---------------------------------------------------------------- the ring, for wide screens */

const W = 880;
const H = 460;
const CX = W / 2;
const CY = H / 2;
const RX = 288;
const RY = 148;

const NODE_H = 52;
const NODE_PAD = 26;
const CHAR_W = 8.1; // 15px system sans, measured against a long label

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const pointAt = (deg: number) => ({x: CX + RX * Math.cos(rad(deg)), y: CY + RY * Math.sin(rad(deg))});

// Length and half-width are SEPARATE numbers on purpose. One value for both produces a
// near-equilateral triangle, and at the size this renders the eye cannot tell which of its three
// corners is the tip, so the loop reads as having no direction at all. Roughly two to one is
// where it stops being ambiguous.
function arrowPoints(x: number, y: number, tx: number, ty: number): string {
  const ahead = 15;
  const behind = 9;
  const halfWidth = 6;
  const nx = -ty;
  const ny = tx;
  return [
    `${x + tx * ahead},${y + ty * ahead}`,
    `${x - tx * behind + nx * halfWidth},${y - ty * behind + ny * halfWidth}`,
    `${x - tx * behind - nx * halfWidth},${y - ty * behind - ny * halfWidth}`,
  ].join(' ');
}

function arrowOnRing(deg: number): string {
  const {x, y} = pointAt(deg);
  const t = rad(deg);
  let tx = -RX * Math.sin(t);
  let ty = RY * Math.cos(t);
  const len = Math.hypot(tx, ty);
  return arrowPoints(x, y, tx / len, ty / len);
}

function Ring({beats, middle, label}: {beats: readonly string[]; middle: readonly string[]; label: string}) {
  const step = 360 / beats.length;
  return (
    <svg className={styles.ring} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

      {beats.map((_, i) => (
        <polygon key={`a${i}`} points={arrowOnRing(i * step + step / 2)} fill="var(--loop-accent)" />
      ))}

      {beats.map((text, i) => {
        const {x, y} = pointAt(i * step);
        const w = text.length * CHAR_W + NODE_PAD * 2;
        return (
          <g key={text}>
            <rect
              x={x - w / 2}
              y={y - NODE_H / 2}
              width={w}
              height={NODE_H}
              rx={8}
              fill="var(--ifm-background-color)"
              stroke="currentColor"
              strokeOpacity={0.85}
              strokeWidth={1.5}
            />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="currentColor"
              fontSize={15}
              fontFamily="var(--ifm-font-family-base)"
            >
              {text}
            </text>
          </g>
        );
      })}

      {middle.map((line, i) => (
        <text
          key={line}
          x={CX}
          y={CY - (middle.length - 1) * 12 + i * 24}
          textAnchor="middle"
          fill="var(--loop-accent)"
          fontSize={17}
          fontWeight={600}
          fontFamily="var(--ifm-font-family-base)"
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------- the stacked column, for phone widths */

const CW = 340;
const COL_NODE_H = 46;
const COL_GAP = 40;
const COL_TOP = 12;
const COL_X = 96; // leaves room on the left for the return arc
const COL_NODE_W = CW - COL_X - 12;
const COL_STEP = COL_NODE_H + COL_GAP;

function Column({beats, middle, label}: {beats: readonly string[]; middle: readonly string[]; label: string}) {
  const midX = COL_X + COL_NODE_W / 2;
  const top = (i: number) => COL_TOP + i * COL_STEP;
  const firstMid = top(0) + COL_NODE_H / 2;
  const lastMid = top(beats.length - 1) + COL_NODE_H / 2;
  const closerY = top(beats.length - 1) + COL_NODE_H + 30;
  const height = closerY + (middle.length ? 30 + middle.length * 20 : 0) + 12;
  const returnX = 30;

  return (
    <svg className={styles.column} viewBox={`0 0 ${CW} ${height}`} role="img" aria-label={label}>
      {beats.slice(0, -1).map((text, i) => (
        <g key={`link-${text}`}>
          <line
            x1={midX}
            y1={top(i) + COL_NODE_H}
            x2={midX}
            y2={top(i + 1) - 9}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={1.5}
          />
          <polygon points={arrowPoints(midX, top(i + 1) - 12, 0, 1)} fill="var(--loop-accent)" />
        </g>
      ))}

      {/* The return: out of the last beat, around the left, back into the first. */}
      <path
        d={`M ${COL_X} ${lastMid} H ${returnX} V ${firstMid} H ${COL_X - 12}`}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={1.5}
      />
      <polygon points={arrowPoints(COL_X - 9, firstMid, 1, 0)} fill="var(--loop-accent)" />

      {beats.map((text, i) => (
        <g key={text}>
          <rect
            x={COL_X}
            y={top(i)}
            width={COL_NODE_W}
            height={COL_NODE_H}
            rx={8}
            fill="var(--ifm-background-color)"
            stroke="currentColor"
            strokeOpacity={0.85}
            strokeWidth={1.5}
          />
          <text
            x={midX}
            y={top(i) + COL_NODE_H / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize={15}
            fontFamily="var(--ifm-font-family-base)"
          >
            {text}
          </text>
        </g>
      ))}

      {middle.map((line, i) => (
        <text
          key={line}
          x={CW / 2}
          y={closerY + 30 + i * 20}
          textAnchor="middle"
          fill="var(--loop-accent)"
          fontSize={14}
          fontWeight={600}
          fontFamily="var(--ifm-font-family-base)"
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

export default function Loop({beats, middle = [], caption, label}: LoopProps): JSX.Element {
  if (beats.length < 3) {
    throw new Error(`<Loop> needs at least three beats; got ${beats.length}. Two beats are a sentence.`);
  }
  const aria = label ?? loopLabel(beats);
  return (
    <figure className={styles.figure}>
      <Ring beats={beats} middle={middle} label={aria} />
      <Column beats={beats} middle={middle} label={aria} />
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
