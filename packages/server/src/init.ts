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
import type { GroupIndex } from "./groupIndex.js";
import { localAabbForPieces } from "./worldGrid.js";

const SCATTER_DOMAIN = 2;

// The scatter is a rounded-square band detached from the frame: pieces fill the
// ring between an inner gap superellipse and an outer halo superellipse, both
// sharing the frame aspect, leaving empty space around the assembly area. The
// scales are multiples of the clear rectangle (the frame grown by half a
// piece); both must be >= 2^(1/SCATTER_SHAPE_EXPONENT) so the curves fully
// enclose that rectangle, and the gap must be < the halo.
const SCATTER_GAP_SCALE = 1.4;
const SCATTER_HALO_SCALE = 2.8;

// Superellipse exponent for the band bounds: 2 is an ellipse, higher values
// square off the corners. ~4 reads as a rounded square ("squircle"), matching
// the rounded-rectangle silhouette.
const SCATTER_SHAPE_EXPONENT = 4;

// Distance from the frame center to the superellipse (semi-axes ex, ey,
// exponent n) along the unit ray (dx, dy). n = 2 is an ellipse; larger n
// rounds the corners toward a square.
function rayToSuperellipse(ex: number, ey: number, n: number, dx: number, dy: number): number {
  return 1 / Math.pow(Math.pow(Math.abs(dx) / ex, n) + Math.pow(Math.abs(dy) / ey, n), 1 / n);
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
  // absorb floating-point error. The band scales out from here, so its inner
  // gap superellipse always encloses the frame interior.
  const ax = cx + half + 1;
  const ay = cy + half + 1;
  // Inner gap and outer halo superellipses, both sharing the clear rectangle's
  // aspect. The empty ring between the frame and the gap detaches the cloud
  // from the assembly area.
  const gx = ax * SCATTER_GAP_SCALE;
  const gy = ay * SCATTER_GAP_SCALE;
  const ex = ax * SCATTER_HALO_SCALE;
  const ey = ay * SCATTER_HALO_SCALE;
  const placements = geom.pieces.map((piece) => {
    // Sample the piece body (origin + canonicalOffset) in the rounded-square
    // band around the frame, then back out the group origin. Randomizing the
    // body rather than the origin decorrelates the scatter from the solved
    // layout: pieces render at origin + canonicalOffset, and canonicalOffset is
    // the solved cell, so randomizing the origin alone leaves the solved image
    // in place.
    const theta = scatterRng() * Math.PI * 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const rInner = rayToSuperellipse(gx, gy, SCATTER_SHAPE_EXPONENT, dx, dy);
    const rOuter = rayToSuperellipse(ex, ey, SCATTER_SHAPE_EXPONENT, dx, dy);
    // Triangular radius (mean of two uniforms) peaks at the band's middle and
    // fades to both edges, so the cloud is dense mid-band and disperses inward
    // and outward, like a tipped-out packet of pieces.
    const t = (scatterRng() + scatterRng()) / 2;
    const r = rInner + (rOuter - rInner) * t;
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
    localAabb: localAabbForPieces([p.id], geom.cols, geom.pieceSize),
  }));
  await state.writeInitialPieces(entries);

  return meta;
}

// Rebuild the in-process group index from current Redis state. The index is a
// read model held in process memory; Redis survives a restart and a reset writes
// fresh groups, so the index is reconstructed from Redis rather than maintained
// across those boundaries. One bulk read, used at boot and after a reset.
export async function rebuildGroupIndex(
  groupIndex: GroupIndex,
  state: RedisState,
  totalPieces: number,
): Promise<void> {
  groupIndex.clear();
  const points = await state.readAllGroupPoints(totalPieces);
  for (const p of points) groupIndex.set(p.id, p.x, p.y);
}
