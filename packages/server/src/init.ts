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

  for (const piece of geom.pieces) {
    await state.writePiece(piece.id, piece.id, 0);

    const isAnchor = piece.id === 0;
    const worldX = isAnchor ? 0 : -worldW * 0.5 + scatterRng() * worldW * 2;
    const worldY = isAnchor ? 0 : -worldH * 0.5 + scatterRng() * worldH * 2;

    await state.writeGroup({
      id: piece.id,
      worldX,
      worldY,
      size: 1,
      locked: isAnchor,
      heldBy: null,
    });
    await state.addGroupPieces(piece.id, [piece.id]);
  }

  await state.addLockedCount(1);

  return meta;
}
