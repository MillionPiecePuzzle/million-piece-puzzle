/**
 * Convert a piece geometry into a flat 2D outline as path commands.
 *
 * The outline is a closed loop walking clockwise around the piece. Each curved
 * edge is approximated by 8 cubic Bezier segments: two flat shoulders bracket
 * a six-segment tab (rise-lower, rise-upper, two head quarter-arcs, fall-upper,
 * fall-lower). The bulb is a true circular arc whose radius is strictly larger
 * than the neck pinch, giving a classical lightbulb silhouette. Flat edges are
 * single straight lines.
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
const CIRCLE_CUBIC = 0.5522847498; // cubic Bezier handle length for a quarter circle of radius 1

function curvedSegments(edge: CurvedEdge, length: number): CubicSeg[] {
  const L = length;
  const s = edge.sign;
  const cx = edge.center;
  const nk = edge.neck;
  const dp = edge.depth;
  const sh = edge.shoulder;
  const tn = edge.tension;
  const tl = edge.tilt;
  const sr = edge.shoulderRun;
  const hr = edge.headRoundness;

  const bulbR = hr * dp * L;
  const bulbCx = (cx + tl) * L;
  const bulbCy = (dp - hr * dp) * L * s;
  const apexY = dp * L * s;
  const eqLeftX = bulbCx - bulbR;
  const eqRightX = bulbCx + bulbR;

  const leftFlatEndX = sr * L;
  const rightFlatStartX = (1 - sr) * L;
  const leftNeckX = (cx - nk) * L;
  const rightNeckX = (cx + nk) * L;
  const shoulderY = sh * L * s;

  const flatTan = tn * (leftNeckX - leftFlatEndX) * 0.5;
  const riseHeight = bulbCy - shoulderY;
  const magic = CIRCLE_CUBIC * bulbR;
  const magicS = magic * s;

  return [
    // 1. flat shoulder left
    {
      cp1: { x: leftFlatEndX / 3, y: 0 },
      cp2: { x: (2 * leftFlatEndX) / 3, y: 0 },
      end: { x: leftFlatEndX, y: 0 },
    },
    // 2. rise lower: baseline curves down to the neck undercut, tangent vertical at the pinch
    {
      cp1: { x: leftFlatEndX + flatTan, y: 0 },
      cp2: { x: leftNeckX, y: shoulderY - riseHeight * 0.25 },
      end: { x: leftNeckX, y: shoulderY },
    },
    // 3. rise upper: neck pinch swings outward and up to the bulb's left equator
    {
      cp1: { x: leftNeckX, y: shoulderY + riseHeight * 0.5 },
      cp2: { x: eqLeftX, y: bulbCy - magicS },
      end: { x: eqLeftX, y: bulbCy },
    },
    // 4. bulb top-left quarter arc: equator-left up to apex
    {
      cp1: { x: eqLeftX, y: bulbCy + magicS },
      cp2: { x: bulbCx - magic, y: apexY },
      end: { x: bulbCx, y: apexY },
    },
    // 5. bulb top-right quarter arc: apex down to equator-right
    {
      cp1: { x: bulbCx + magic, y: apexY },
      cp2: { x: eqRightX, y: bulbCy + magicS },
      end: { x: eqRightX, y: bulbCy },
    },
    // 6. fall upper: bulb's right equator back inward to the neck pinch
    {
      cp1: { x: eqRightX, y: bulbCy - magicS },
      cp2: { x: rightNeckX, y: shoulderY + riseHeight * 0.5 },
      end: { x: rightNeckX, y: shoulderY },
    },
    // 7. fall lower: neck pinch back to the baseline
    {
      cp1: { x: rightNeckX, y: shoulderY - riseHeight * 0.25 },
      cp2: { x: rightFlatStartX - flatTan, y: 0 },
      end: { x: rightFlatStartX, y: 0 },
    },
    // 8. flat shoulder right
    {
      cp1: { x: rightFlatStartX + (L - rightFlatStartX) / 3, y: 0 },
      cp2: { x: rightFlatStartX + (2 * (L - rightFlatStartX)) / 3, y: 0 },
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
