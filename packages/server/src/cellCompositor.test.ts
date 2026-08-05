import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { seedFromString } from "@mpp/shared";
import { CellCompositor, type CellCompositorDeps } from "./cellCompositor.js";
import { CellCompositeIndex } from "./cellComposite.js";
import { cellKey } from "./worldGrid.js";

const GRID_COLS = 4;
const GRID_ROWS = 4;
const PIECE_SIZE = 10;
const MARGIN = 3;
const CELL_SIZE = 20; // exactly 2x2 pieces per cell, so cell (0,0) owns ids 0,1,4,5

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
  const deps: CellCompositorDeps = {
    gridCols: GRID_COLS,
    gridRows: GRID_ROWS,
    pieceSize: PIECE_SIZE,
    margin: MARGIN,
    cellSize: CELL_SIZE,
    generationSeed: seedFromString("test-seed"),
    isLocked: (id) => locked.has(id),
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
  });

  it("composites, uploads, versions, persists and broadcasts once a cell has a locked piece", async () => {
    const { deps, index, uploads, removed, persisted, composited, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();

    // One bake produces a mask+seam pair at every LOD tier (see DECISIONS:
    // DZI reveal mask/seam LOD tiers), all at the same version, so the
    // client can derive every URL from the one {cellKey, version} pair
    // region_state/cell_composite already carries.
    expect(uploads).toHaveLength(6);
    expect(uploads.map((u) => u.key)).toEqual([
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

  it("coalesces marks that arrive on a cell already mid-bake into one follow-up, not one each", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    // The first call pops the cell out of the dirty set synchronously (before
    // any await), so these three marks all land while it is already being
    // processed. They collapse into a single Set entry, so the drain loop
    // does exactly one necessary follow-up bake once the first finishes, not
    // three: 2 bakes total (12 uploads: 6 each), never 4 bakes.
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(12);
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
    expect(uploads).toHaveLength(12);
    expect(uploads.slice(6).map((u) => u.key)).toEqual([
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-0.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-1.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-mask-2.avif`,
      `test-puzzle/cells/${cellKey(0, 0)}/2-seam-2.avif`,
    ]);
    // The now-superseded v1 objects (every mask/seam tier) are cleaned up
    // once v2 is fully live.
    expect(removed).toEqual([
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
    expect(uploads).toHaveLength(12);
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
      // Fails only the first six upload calls (cell (0,0)'s own first
      // attempt); every later call, including cell (0,0)'s own retry,
      // succeeds.
      upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
        calls++;
        if (calls <= 6) throw new Error("network blip");
        uploads.push({ key, body, contentType });
      }),
    });
    locked.add(0); // cell (0,0)
    locked.add(2); // cell (1,0): ids 2,3,6,7 at CELL_SIZE=20/PIECE_SIZE=10
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0), cellKey(1, 0)]);
    await compositor.whenIdle();
    // Cell (0,0)'s first attempt fully failed (its 6 uploads are the ones
    // that throw) but the queue moved on to cell (1,0) instead of stalling,
    // and cell (0,0) itself got requeued behind it and succeeded on retry:
    // both cells' 6 uploads each end up recorded, 12 total, not stuck at 6.
    expect(uploads).toHaveLength(12);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("attempt 1/3"),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it("gives up on a cell after CELL_BAKE_MAX_ATTEMPTS attempts, instead of retrying forever", async () => {
    const { deps, uploads, locked } = makeDeps({
      upload: vi.fn().mockRejectedValue(new Error("permanent failure")),
    });
    locked.add(0);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    // Never succeeds, but does not hang or retry indefinitely either: exactly
    // 3 attempts (CELL_BAKE_MAX_ATTEMPTS) of 6 upload calls each, then dropped,
    // queue left idle.
    expect(uploads).toEqual([]);
    expect(deps.upload).toHaveBeenCalledTimes(18);
    expect(compositor.pendingCount()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("after 3 attempts, giving up"),
      expect.any(String),
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("gives a retried cell its own fresh attempt budget on a later, independent markDirty", async () => {
    let shouldFail = true;
    const { deps, uploads, locked } = makeDeps({
      upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
        if (shouldFail) throw new Error("network blip");
        uploads.push({ key, body, contentType });
      }),
    });
    locked.add(0);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compositor = new CellCompositor(deps);
    // Exhausts all 3 attempts while every upload fails.
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("giving up"), expect.any(String));
    errorSpy.mockClear();
    // A later, independent dirty mark (e.g. a real lock event touching this
    // cell again) is not penalized by the earlier exhausted budget.
    shouldFail = false;
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(6);
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
});

describe("CellCompositor.pendingCount", () => {
  it("reports the backlog size right after markDirty, before it drains to 0", () => {
    const { deps, locked } = makeDeps();
    locked.add(0); // cell (0,0)
    locked.add(2); // cell (1,0)
    locked.add(8); // cell (0,1)
    const compositor = new CellCompositor(deps);
    expect(compositor.pendingCount()).toBe(0);
    compositor.markDirty([cellKey(0, 0), cellKey(1, 0), cellKey(0, 1)]);
    // The drain loop synchronously pulls and starts the first cell before its
    // first real await (the mask/seam bake), so 2 of the 3 marked cells are
    // still queued at this exact point, not yet 3 or already 0.
    expect(compositor.pendingCount()).toBe(2);
  });

  it("returns to 0 once the whole backlog has drained", async () => {
    const { deps, locked } = makeDeps();
    locked.add(0);
    locked.add(2);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0), cellKey(1, 0)]);
    await compositor.whenIdle();
    expect(compositor.pendingCount()).toBe(0);
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
