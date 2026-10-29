import type { XYPosition } from '@xyflow/react';

export const CARD_WIDTH = 253;
export const CARD_HEIGHT = 80;
const CARD_GAP = 32;

// Find the closest free position, leaving existing cards where the user put them.
// A free rectangle starts either at the requested x or at an obstacle's boundary.
export function separateCard(requested: XYPosition, occupied: XYPosition[]): XYPosition {
  const dx = CARD_WIDTH + CARD_GAP; const dy = CARD_HEIGHT + CARD_GAP;
  const collides = (p: XYPosition) => occupied.some(o => Math.abs(p.x - o.x) < dx && Math.abs(p.y - o.y) < dy);
  if (!collides(requested)) return requested;
  let best: XYPosition | undefined; let distance = Infinity;
  const columns = new Set([requested.x, ...occupied.flatMap(o => [o.x - dx, o.x + dx])]);
  for (const x of columns) {
    const intervals = occupied.filter(o => Math.abs(x - o.x) < dx).map(o => ({ start: o.y - dy, end: o.y + dy })).sort((a, b) => a.start - b.start);
    const merged: typeof intervals = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval.start < last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    const blocked = merged.find(i => requested.y > i.start && requested.y < i.end);
    const y = blocked ? (requested.y - blocked.start <= blocked.end - requested.y ? blocked.start : blocked.end) : requested.y;
    const candidateDistance = (x - requested.x) ** 2 + (y - requested.y) ** 2;
    if (candidateDistance < distance) { best = { x, y }; distance = candidateDistance; }
  }
  return best!;
}
