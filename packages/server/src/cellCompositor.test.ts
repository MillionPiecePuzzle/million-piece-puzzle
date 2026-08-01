import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { seedFromString } from "@mpp/shared";
import { CellCompositor, type CellCompositorDeps } from "./cellCompositor.js";
import { CellCompositeIndex } from "./cellComposite.js";
import { buildWireContext } from "./wire.js";
import { cellKey } from "./worldGrid.js";

const GRID_COLS = 4;
const GRID_ROWS = 4;
const PIECE_SIZE = 10;
const MARGIN = 3;
const CELL_SIZE = 20; // exactly 2x2 pieces per cell, so cell (0,0) owns ids 0,1,4,5

async function solidTile(size: number, rgba: [number, number, number, number]): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 },
    },
  })
    .png()
    .toBuffer();
}

function makeDeps(overrides: Partial<CellCompositorDeps> = {}): {
  deps: CellCompositorDeps;
  index: CellCompositeIndex;
  uploads: { key: string; body: Buffer; contentType: string }[];
  removed: string[];
  removedPrefixes: string[];
  persisted: { cellKey: number; version: number }[];
  composited: { cellKey: number; version: number }[];
  locked: Set<number>;
} {
  const index = new CellCompositeIndex();
  const uploads: { key: string; body: Buffer; contentType: string }[] = [];
  const removed: string[] = [];
  const removedPrefixes: string[] = [];
  const persisted: { cellKey: number; version: number }[] = [];
  const composited: { cellKey: number; version: number }[] = [];
  const locked = new Set<number>();
  const wire = buildWireContext("test-seed", GRID_COLS * GRID_ROWS, GRID_COLS, PIECE_SIZE);
  const deps: CellCompositorDeps = {
    gridCols: GRID_COLS,
    gridRows: GRID_ROWS,
    pieceSize: PIECE_SIZE,
    margin: MARGIN,
    cellSize: CELL_SIZE,
    generationSeed: seedFromString("test-seed"),
    wire,
    pieceFileByWireId: (wireId) => `pieces/${wireId}.avif`,
    isLocked: (id) => locked.has(id),
    fetchTile: vi.fn(async () => solidTile(PIECE_SIZE + 2 * MARGIN, [255, 0, 0, 255])),
    upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
      uploads.push({ key, body, contentType });
    }),
    remove: vi.fn(async (key: string) => {
      removed.push(key);
    }),
    removeByPrefix: vi.fn(async (prefix: string) => {
      removedPrefixes.push(prefix);
    }),
    persistVersion: vi.fn(async (key: number, version: number) => {
      persisted.push({ cellKey: key, version });
    }),
    onComposited: vi.fn((key: number, version: number) => {
      composited.push({ cellKey: key, version });
    }),
    puzzleId: "test-puzzle",
    index,
    ...overrides,
  };
  return {
    deps,
    index: overrides.index ?? index,
    uploads,
    removed,
    removedPrefixes,
    persisted,
    composited,
    locked,
  };
}

describe("CellCompositor.markDirty", () => {
  it("skips a cell with no locked piece in its halo", async () => {
    const { deps, uploads } = makeDeps();
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toEqual([]);
    expect(deps.fetchTile).not.toHaveBeenCalled();
  });

  it("composites, uploads, versions, persists and broadcasts once a cell has a locked piece", async () => {
    const { deps, index, uploads, removed, persisted, composited, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();

    // One bake now produces the photo plus a mask+seam pair at every LOD tier
    // (see DECISIONS: DZI reveal mask/seam LOD tiers), all at the same
    // version, so the client can derive every URL from the one
    // {cellKey, version} pair region_state/cell_composite already carries.
    expect(uploads).toHaveLength(7);
    expect(uploads.map((u) => u.key)).toEqual([
      `test-puzzle/cells/${cellKey(0, 0)}/1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-2.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-2.avif`,
    ]);
    expect(uploads.every((u) => u.contentType === "image/avif")).toBe(true);
    expect(index.get(cellKey(0, 0))).toBe(1);
    expect(persisted).toEqual([{ cellKey: cellKey(0, 0), version: 1 }]);
    expect(composited).toEqual([{ cellKey: cellKey(0, 0), version: 1 }]);
    // No previous version to clean up on a cell's very first bake.
    expect(removed).toEqual([]);
  });

  it("only fetches locked pieces, not every piece in the cell's halo", async () => {
    const { deps, locked } = makeDeps();
    locked.add(0); // one of four candidates in cell (0,0): ids 0, 1, 4, 5
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(deps.fetchTile).toHaveBeenCalledTimes(1);
  });

  it("coalesces marks that arrive on a cell already mid-bake into one follow-up, not one each", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    // The first call pops the cell out of the dirty set synchronously (before
    // any await), so these three marks all land while it is already being
    // processed. They collapse into a single Set entry, so the drain loop
    // does exactly one necessary follow-up bake once the first finishes, not
    // three: 2 bakes total (14 uploads: 7 each), never 4 bakes.
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(14);
  });

  it("bumps the version on a later rebake of the same cell", async () => {
    const { deps, uploads, removed, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    locked.add(1);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(14);
    expect(uploads.slice(7).map((u) => u.key)).toEqual([
      `test-puzzle/cells/${cellKey(0, 0)}/2.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-2.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-2.avif`,
    ]);
    // The now-superseded v1 objects (photo + every mask/seam tier) are
    // cleaned up once v2 is fully live.
    expect(removed).toEqual([
      `test-puzzle/cells/${cellKey(0, 0)}/1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-mask-2.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/1-seam-2.avif`,
    ]);
  });

  it("logs and continues past a cell whose stale-version delete fails, instead of treating the bake as failed", async () => {
    const { deps, uploads, persisted, composited, locked } = makeDeps({
      remove: vi.fn().mockRejectedValueOnce(new Error("network blip")),
    });
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    locked.add(1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();

    // The bake itself (upload, version, persist, broadcast) still succeeds
    // even though cleaning up one of the old version's objects failed.
    expect(uploads).toHaveLength(14);
    expect(persisted).toEqual([
      { cellKey: cellKey(0, 0), version: 1 },
      { cellKey: cellKey(0, 0), version: 2 },
    ]);
    expect(composited).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs and continues past a cell whose upload fails, instead of losing the rest of the queue", async () => {
    let calls = 0;
    const uploads: { key: string; body: Buffer; contentType: string }[] = [];
    const { deps, locked } = makeDeps({
      // Fails all seven uploads of the first bake it sees (photo + mask/seam
      // at every tier), succeeds from the second cell's bake onward.
      upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
        calls++;
        if (calls <= 7) throw new Error("network blip");
        uploads.push({ key, body, contentType });
      }),
    });
    locked.add(0); // cell (0,0)
    locked.add(2); // cell (1,0): ids 2,3,6,7 at CELL_SIZE=20/PIECE_SIZE=10
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0), cellKey(1, 0)]);
    await compositor.whenIdle();
    // Cell (0,0)'s bake fully failed (0 uploads recorded); cell (1,0)'s bake
    // still completed with all seven of its own objects.
    expect(uploads).toHaveLength(7);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("bakes a silhouette mask that is opaque inside the locked piece and transparent outside it", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    // Tier 0 is the full-resolution bake (factor 1, no resize), so its pixel
    // coordinates match the canvas exactly like the pre-tiering single bake.
    const maskUpload = uploads.find((u) => u.key.endsWith("-mask-0.avif"))!;
    const { data, info } = await sharp(maskUpload.body)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    // Piece 0's own body sits at canvas-local [3,13)x[3,13) (col 0, row 0,
    // minus the canvas's own -margin origin), so its center is solidly inside
    // its silhouette regardless of tab wobble on its curved right/bottom
    // edges (its top/left edges are flat, the puzzle border).
    expect(alphaAt(8, 8)).toBeGreaterThan(250);
    // The canvas's far corner is well past even the largest possible tab
    // bulge, and pieces 1/4/5 (the cell's other halo candidates) are not
    // locked, so nothing should paint there.
    expect(alphaAt(25, 25)).toBeLessThan(5);
  });

  it("bakes a seam texture that only marks the border, not the whole piece body", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    const seamUpload = uploads.find((u) => u.key.endsWith("-seam-0.avif"))!;
    const { data, info } = await sharp(seamUpload.body)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    // Deep in piece 0's interior, away from any edge: the seam only strokes
    // the border, so unlike the mask, its interior stays transparent.
    expect(alphaAt(8, 8)).toBeLessThan(5);
  });

  it("produces a composite that actually shows the locked piece's pixels", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    const { data, info } = await sharp(uploads[0]!.body)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Piece 0 sits at the canvas's own top-left corner (col 0, row 0, minus
    // margin, minus the canvas's own margin origin: they cancel out), so its
    // solid red fill should show at the composite's own (0,0). The AVIF
    // encode is lossy (matches the slicer's own quality setting), so this
    // allows for rounding rather than asserting an exact byte value.
    const idx = 0;
    expect(info.channels).toBe(4);
    expect(data[idx]).toBeGreaterThan(250);
    expect(data[idx + 1]).toBeLessThan(5);
    expect(data[idx + 2]).toBeLessThan(5);
    expect(data[idx + 3]).toBeGreaterThan(250);
  });
});

describe("CellCompositor.clearAll", () => {
  it("bulk-deletes this puzzle's whole cell prefix, not a per-version key", async () => {
    const { deps, removedPrefixes } = makeDeps();
    const compositor = new CellCompositor(deps);
    await compositor.clearAll();
    expect(removedPrefixes).toEqual(["test-puzzle/cells/"]);
  });

  it("does not touch per-key remove", async () => {
    const { deps, removed } = makeDeps();
    const compositor = new CellCompositor(deps);
    await compositor.clearAll();
    expect(removed).toEqual([]);
  });
});
