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

// The deterministic initial layout: the generated geometry plus each piece's
// scattered group origin, in piece-id order. A pure function of the manifest
// (seed and grid), so the server can replay it to derive the play zone without
// reading Redis.
function scatteredLayout(manifest: ImageManifest) {
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
  const placements = geom.pieces.map((piece) => ({
    id: piece.id,
    canonicalOffset: piece.canonicalOffset,
    worldX: (scatterRng() - 0.5) * worldW * 2,
    worldY: (scatterRng() - 0.5) * worldH * 2,
  }));
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
