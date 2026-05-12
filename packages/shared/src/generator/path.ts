/**
 * Convert a piece geometry into a flat 2D outline as path commands.
 *
 * The outline is a closed loop walking clockwise around the piece. Each curved
 * edge is approximated by 4 cubic Bezier segments. Flat edges are single
 * straight lines.
 *
 * Edge params are defined in canonical direction (see edge.ts). Two edges of
 * the loop (bottom and left) are traversed against canonical direction; for
 * those we emit canonical segments in reverse order with cp1/cp2 swapped, so
 * the physical curve drawn on a shared edge is identical from either side.
 *
 * Coordinates are in piece-local space, origin at the piece's top-left corner,
 * x to the right, y down.
 */

import type { CurvedEdge, Edge, PieceGeometry } from "./edge.js";

export type PathCommand =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "C"; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { t: "Z" };

type Vec = { x: number; y: number };
type CubicSeg = { cp1: Vec; cp2: Vec; end: Vec };

/**
 * Build cubic segments in canonical edge-local space.
 *
 * Edge-local axes: x runs 0 to L from canonical start to canonical end, y
 * points outward (away from piece center). Tab (sign +1) has y > 0, socket
 * (sign -1) has y < 0. The first segment starts at (0,0); the last segment
 * ends at (L,0).
 */
function curvedSegments(edge: CurvedEdge, length: number): CubicSeg[] {
  const L = length;
  const s = edge.sign;
  const cx = edge.center;
  const nk = edge.neck;
  const dp = edge.depth;
  const sh = edge.shoulder;
  const tn = edge.tension;
  const tl = edge.tilt;

  const leftNeckX = (cx - nk) * L;
  const rightNeckX = (cx + nk) * L;
  const shoulderY = sh * L * s;
  const headY = dp * L * s;
  const headLeftX = (cx - nk * 0.4 + tl) * L;
  const headRightX = (cx + nk * 0.4 + tl) * L;
  const tensionLen = tn * 0.5 * L;

  return [
    {
      cp1: { x: tensionLen, y: 0 },
      cp2: { x: leftNeckX - nk * L * 0.5, y: shoulderY },
      end: { x: leftNeckX, y: shoulderY },
    },
    {
      cp1: { x: leftNeckX + tl * L, y: shoulderY + (headY - shoulderY) * 0.4 },
      cp2: { x: headLeftX, y: headY },
      end: { x: cx * L, y: headY },
    },
    {
      cp1: { x: headRightX, y: headY },
      cp2: { x: rightNeckX + tl * L, y: shoulderY + (headY - shoulderY) * 0.4 },
      end: { x: rightNeckX, y: shoulderY },
    },
    {
      cp1: { x: rightNeckX + nk * L * 0.5, y: shoulderY },
      cp2: { x: L - tensionLen, y: 0 },
      end: { x: L, y: 0 },
    },
  ];
}

type CanonicalAxis = {
  start: Vec;
  fx: number;
  fy: number;
  nx: number;
  ny: number;
};

function transform(axis: CanonicalAxis, p: Vec): Vec {
  return {
    x: axis.start.x + axis.fx * p.x + axis.nx * p.y,
    y: axis.start.y + axis.fy * p.x + axis.ny * p.y,
  };
}

function emitEdge(
  cmds: PathCommand[],
  edge: Edge,
  axis: CanonicalAxis,
  length: number,
  reversed: boolean,
): void {
  if (edge.type === "flat") {
    const end = transform(axis, { x: length, y: 0 });
    if (reversed) {
      cmds.push({ t: "L", x: axis.start.x, y: axis.start.y });
    } else {
      cmds.push({ t: "L", x: end.x, y: end.y });
    }
    return;
  }

  const segs = curvedSegments(edge, length);
  if (!reversed) {
    for (const seg of segs) {
      const cp1 = transform(axis, seg.cp1);
      const cp2 = transform(axis, seg.cp2);
      const end = transform(axis, seg.end);
      cmds.push({ t: "C", cp1x: cp1.x, cp1y: cp1.y, cp2x: cp2.x, cp2y: cp2.y, x: end.x, y: end.y });
    }
    return;
  }

  // Reverse traversal: walk segments end-to-start. Each emitted segment has
  // cp1/cp2 swapped relative to canonical and ends at the previous canonical
  // start point.
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i]!;
    const prevEnd: Vec = i === 0 ? { x: 0, y: 0 } : segs[i - 1]!.end;
    const cp1 = transform(axis, seg.cp2);
    const cp2 = transform(axis, seg.cp1);
    const end = transform(axis, prevEnd);
    cmds.push({ t: "C", cp1x: cp1.x, cp1y: cp1.y, cp2x: cp2.x, cp2y: cp2.y, x: end.x, y: end.y });
  }
}

export function piecePath(piece: PieceGeometry, pieceSize: number): PathCommand[] {
  const L = pieceSize;
  const cmds: PathCommand[] = [];

  // Walk corners clockwise: top-left -> top-right -> bottom-right -> bottom-left.
  cmds.push({ t: "M", x: 0, y: 0 });

  // Top edge: canonical (left -> right), forward.
  emitEdge(
    cmds,
    piece.edges.top,
    { start: { x: 0, y: 0 }, fx: 1, fy: 0, nx: 0, ny: -1 },
    L,
    false,
  );
  // Right edge: canonical (top -> bottom), forward.
  emitEdge(
    cmds,
    piece.edges.right,
    { start: { x: L, y: 0 }, fx: 0, fy: 1, nx: 1, ny: 0 },
    L,
    false,
  );
  // Bottom edge: canonical (left -> right). We walk right -> left, reversed.
  emitEdge(
    cmds,
    piece.edges.bottom,
    { start: { x: 0, y: L }, fx: 1, fy: 0, nx: 0, ny: 1 },
    L,
    true,
  );
  // Left edge: canonical (top -> bottom). We walk bottom -> top, reversed.
  emitEdge(
    cmds,
    piece.edges.left,
    { start: { x: 0, y: 0 }, fx: 0, fy: 1, nx: -1, ny: 0 },
    L,
    true,
  );

  cmds.push({ t: "Z" });
  return cmds;
}
