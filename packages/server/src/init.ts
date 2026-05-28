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

// Outer bound of the scatter ring as a multiple of the frame, centered on the
// frame. Pieces are scattered in the band between the frame and this rectangle.
const SCATTER_RING_SCALE = 2;

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

const rectArea = (r: Rect): number => (r.maxX - r.minX) * (r.maxY - r.minY);

const sampleRect = (r: Rect, rng: () => number): { x: number; y: number } => ({
  x: r.minX + rng() * (r.maxX - r.minX),
  y: r.minY + rng() * (r.maxY - r.minY),
});

// The ring between the frame and the frame scaled by SCATTER_RING_SCALE about
// its center, as four non-overlapping bands. A body placed in any band clears
// the frame interior, so the assembly area stays empty.
function scatterRing(frameW: number, frameH: number, pieceSize: number) {
  const cx = frameW / 2;
  const cy = frameH / 2;
  const outer: Rect = {
    minX: cx - (frameW * SCATTER_RING_SCALE) / 2,
    minY: cy - (frameH * SCATTER_RING_SCALE) / 2,
    maxX: cx + (frameW * SCATTER_RING_SCALE) / 2,
    maxY: cy + (frameH * SCATTER_RING_SCALE) / 2,
  };
  // Frame interior to exclude. The left and top edges are pulled out by one
  // piece size so a body placed against them (it extends right and down) still
  // clears the frame; the right and bottom edges sit on the frame, since a body
  // there already extends away from it.
  const inner: Rect = { minX: -pieceSize, minY: -pieceSize, maxX: frameW, maxY: frameH };
  return {
    top: { minX: outer.minX, minY: outer.minY, maxX: outer.maxX, maxY: inner.minY },
    bottom: { minX: outer.minX, minY: inner.maxY, maxX: outer.maxX, maxY: outer.maxY },
    left: { minX: outer.minX, minY: inner.minY, maxX: inner.minX, maxY: inner.maxY },
    right: { minX: inner.maxX, minY: inner.minY, maxX: outer.maxX, maxY: inner.maxY },
  };
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
  const ring = scatterRing(worldW, worldH, geom.pieceSize);
  const aTop = rectArea(ring.top);
  const aBottom = rectArea(ring.bottom);
  const aLeft = rectArea(ring.left);
  const total = aTop + aBottom + aLeft + rectArea(ring.right);
  const placements = geom.pieces.map((piece) => {
    // Pick a band by area, then a uniform point in it. The point is the piece
    // body (origin + canonicalOffset); the group origin is backed out from it.
    // Randomizing the body rather than the origin decorrelates the scatter from
    // the solved layout: pieces render at origin + canonicalOffset, and
    // canonicalOffset is the solved cell, so randomizing the origin alone leaves
    // the solved image in place.
    const pick = scatterRng() * total;
    const band =
      pick < aTop
        ? ring.top
        : pick < aTop + aBottom
          ? ring.bottom
          : pick < aTop + aBottom + aLeft
            ? ring.left
            : ring.right;
    const body = sampleRect(band, scatterRng);
    return {
      id: piece.id,
      canonicalOffset: piece.canonicalOffset,
      worldX: body.x - piece.canonicalOffset.x,
      worldY: body.y - piece.canonicalOffset.y,
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
