import {
  computePlayZone,
  generatePuzzle,
  mulberry32,
  seedFromString,
  subseed,
  type ImageManifest,
  type PlayZone,
} from "@mpp/shared";
import type { RedisState, PuzzleMeta } from "./state.js";

const SCATTER_DOMAIN = 2;

// Outer bound of the elliptical scatter halo, as a multiple of the clear
// rectangle (the frame grown by half a piece). The halo shares the frame
// aspect ratio so the cloud reads as an oval around the assembly area, not a
// rectangular ring. Must be >= sqrt(2) so the outer ellipse fully encloses the
// clear rectangle, leaving a valid ring at every angle; larger spaces pieces
// further apart.
const SCATTER_HALO_SCALE = 2.6;

// Distance from the frame center to the clear rectangle (half-extents ax, ay)
// along the unit ray (dx, dy). A body centered at or beyond this distance never
// overlaps the frame interior.
function rayToRect(ax: number, ay: number, dx: number, dy: number): number {
  return 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay);
}

// Distance from the frame center to the halo ellipse (semi-axes ex, ey) along
// the unit ray (dx, dy).
function rayToEllipse(ex: number, ey: number, dx: number, dy: number): number {
  return 1 / Math.sqrt((dx * dx) / (ex * ex) + (dy * dy) / (ey * ey));
}

// The deterministic initial layout: the generated geometry plus each piece's
// scattered group origin, in piece-id order. A pure function of the manifest
// (seed and grid), so the server can replay it to derive the play zone without
// reading Redis.
export function scatteredLayout(manifest: ImageManifest) {
  const geom = generatePuzzle({
    seed: manifest.seed,
    rows: manifest.rows,
    cols: manifest.cols,
    pieceSize: manifest.pieceSize,
  });
  const base = seedFromString(manifest.seed);
  const scatterRng = mulberry32(subseed(base, SCATTER_DOMAIN, 0, 0));
  const worldW = geom.cols * geom.pieceSize;
  const worldH = geom.rows * geom.pieceSize;
  const half = geom.pieceSize / 2;
  const cx = worldW / 2;
  const cy = worldH / 2;
  // Clear rectangle: the frame grown by half a piece, plus one world unit to
  // absorb floating-point error at the ring's inner edge. A body centered
  // beyond it cannot overlap the frame interior.
  const ax = cx + half + 1;
  const ay = cy + half + 1;
  // Halo ellipse sharing the clear rectangle's aspect, scaled out so it always
  // encloses it.
  const ex = ax * SCATTER_HALO_SCALE;
  const ey = ay * SCATTER_HALO_SCALE;
  const placements = geom.pieces.map((piece) => {
    // Sample the piece body (origin + canonicalOffset) in the elliptical ring
    // around the frame, then back out the group origin. Randomizing the body
    // rather than the origin decorrelates the scatter from the solved layout:
    // pieces render at origin + canonicalOffset, and canonicalOffset is the
    // solved cell, so randomizing the origin alone leaves the solved image in
    // place.
    const theta = scatterRng() * Math.PI * 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const rInner = rayToRect(ax, ay, dx, dy);
    const rOuter = rayToEllipse(ex, ey, dx, dy);
    // Area-uniform radius across the ring so density does not pile up against
    // the frame edge. Clamped to rInner so float rounding never pulls a body
    // back inside the clear rectangle.
    const u = scatterRng();
    const r = Math.max(
      rInner,
      Math.sqrt(rInner * rInner + u * (rOuter * rOuter - rInner * rInner)),
    );
    const bodyX = cx + r * dx;
    const bodyY = cy + r * dy;
    return {
      id: piece.id,
      canonicalOffset: piece.canonicalOffset,
      worldX: bodyX - half - piece.canonicalOffset.x,
      worldY: bodyY - half - piece.canonicalOffset.y,
    };
  });
  return { geom, worldW, worldH, placements };
}

// The authoritative play zone for a puzzle: the frame unioned with every piece
// at its scattered position, widened and snapped (see computePlayZone). A pure
// function of the manifest, so it is recomputed rather than stored and every
// server run derives the identical zone.
export function playZoneForManifest(manifest: ImageManifest): PlayZone {
  const { worldW, worldH, placements } = scatteredLayout(manifest);
  const pieceBounds = placements.map((p) => ({
    minX: p.worldX + p.canonicalOffset.x - manifest.margin,
    minY: p.worldY + p.canonicalOffset.y - manifest.margin,
    maxX: p.worldX + p.canonicalOffset.x + manifest.pieceSize + manifest.margin,
    maxY: p.worldY + p.canonicalOffset.y + manifest.pieceSize + manifest.margin,
  }));
  return computePlayZone(worldW, worldH, pieceBounds);
}

export async function initPuzzleIfEmpty(
  state: RedisState,
  manifest: ImageManifest,
): Promise<PuzzleMeta> {
  if (await state.hasMeta()) {
    return state.readMeta();
  }
  return forceInitPuzzle(state, manifest);
}

export async function forceInitPuzzle(
  state: RedisState,
  manifest: ImageManifest,
): Promise<PuzzleMeta> {
  const { geom, placements } = scatteredLayout(manifest);

  const meta: PuzzleMeta = {
    totalPieces: geom.pieces.length,
    gridRows: geom.rows,
    gridCols: geom.cols,
    pieceSize: geom.pieceSize,
    snapTolerance: geom.snapTolerance,
    generationSeed: manifest.seed,
    status: "active",
    startedAt: Date.now(),
  };
  await state.writeMeta(meta);

  const entries = placements.map((p) => ({
    pieceId: p.id,
    group: {
      id: p.id,
      worldX: p.worldX,
      worldY: p.worldY,
      size: 1,
      locked: false,
      heldBy: null,
    },
  }));
  await state.writeInitialPieces(entries);

  return meta;
}
