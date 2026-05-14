import {
  generatePuzzle,
  mulberry32,
  seedFromString,
  subseed,
  type ImageManifest,
} from "@mpp/shared";
import type { RedisState, PuzzleMeta } from "./state.js";

const SCATTER_DOMAIN = 2;

export async function initPuzzleIfEmpty(
  state: RedisState,
  manifest: ImageManifest,
): Promise<PuzzleMeta> {
  if (await state.hasMeta()) {
    return state.readMeta();
  }

  const geom = generatePuzzle({
    seed: manifest.seed,
    rows: manifest.rows,
    cols: manifest.cols,
    pieceSize: manifest.pieceSize,
  });

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

  const base = seedFromString(manifest.seed);
  const scatterRng = mulberry32(subseed(base, SCATTER_DOMAIN, 0, 0));
  const worldW = geom.cols * geom.pieceSize;
  const worldH = geom.rows * geom.pieceSize;

  const entries = geom.pieces.map((piece) => ({
    pieceId: piece.id,
    group: {
      id: piece.id,
      worldX: (scatterRng() - 0.5) * worldW * 2,
      worldY: (scatterRng() - 0.5) * worldH * 2,
      size: 1,
      locked: false,
      heldBy: null,
    },
  }));
  await state.writeInitialPieces(entries);

  return meta;
}
