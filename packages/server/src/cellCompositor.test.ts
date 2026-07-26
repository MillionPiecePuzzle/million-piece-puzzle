import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { CellCompositor, type CellCompositorDeps } from "./cellCompositor.js";
import { CellCompositeIndex, parentCellKey } from "./cellComposite.js";
import { buildWireContext } from "./wire.js";
import { cellKey, unpackCellKey } from "./worldGrid.js";

const GRID_COLS = 4;
const GRID_ROWS = 4;
const PIECE_SIZE = 10;
const MARGIN = 3;
const CELL_SIZE = 20; // exactly 2x2 pieces per cell, so cell (0,0) owns ids 0,1,4,5
// The whole GRID_COLS x GRID_ROWS grid is exactly 2x2 level-0 cells, so all
// four of them - (0,0), (1,0), (0,1), (1,1) - share the same single level-1
// parent, packed identically to level-0 cell (0,0) (see parentCellKey).
const PYRAMID_TILE_SIZE = CELL_SIZE + 2 * MARGIN;

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
  persisted: { level: number; cellKey: number; version: number }[];
  composited: { level: number; cellKey: number; version: number }[];
  locked: Set<number>;
} {
  const index = new CellCompositeIndex();
  const uploads: { key: string; body: Buffer; contentType: string }[] = [];
  const removed: string[] = [];
  const removedPrefixes: string[] = [];
  const persisted: { level: number; cellKey: number; version: number }[] = [];
  const composited: { level: number; cellKey: number; version: number }[] = [];
  const locked = new Set<number>();
  const wire = buildWireContext("test-seed", GRID_COLS * GRID_ROWS, GRID_COLS, PIECE_SIZE);
  const deps: CellCompositorDeps = {
    gridCols: GRID_COLS,
    gridRows: GRID_ROWS,
    pieceSize: PIECE_SIZE,
    margin: MARGIN,
    cellSize: CELL_SIZE,
    wire,
    pieceFileByWireId: (wireId) => `pieces/${wireId}.avif`,
    isLocked: (id) => locked.has(id),
    fetchTile: vi.fn(async () => solidTile(PIECE_SIZE + 2 * MARGIN, [255, 0, 0, 255])),
    fetchComposite: vi.fn(async () => solidTile(PYRAMID_TILE_SIZE, [0, 255, 0, 255])),
    upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
      uploads.push({ key, body, contentType });
    }),
    remove: vi.fn(async (key: string) => {
      removed.push(key);
    }),
    removeByPrefix: vi.fn(async (prefix: string) => {
      removedPrefixes.push(prefix);
    }),
    persistVersion: vi.fn(async (level: number, key: number, version: number) => {
      persisted.push({ level, cellKey: key, version });
    }),
    onComposited: vi.fn((level: number, key: number, version: number) => {
      composited.push({ level, cellKey: key, version });
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

describe("CellCompositor.markDirty (level 0)", () => {
  it("skips a cell with no locked piece in its halo", async () => {
    const { deps, uploads } = makeDeps();
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toEqual([]);
    expect(deps.fetchTile).not.toHaveBeenCalled();
  });

  it("composites, uploads, versions, persists and broadcasts once a cell has a locked piece", async () => {
    const { deps, index, uploads, removed, persisted, composited, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.key).toBe(`test-puzzle/cells/${cellKey(0, 0)}/1.avif`);
    expect(uploads[0]!.contentType).toBe("image/avif");
    expect(index.get(0, cellKey(0, 0))).toBe(1);
    expect(persisted).toEqual([{ level: 0, cellKey: cellKey(0, 0), version: 1 }]);
    expect(composited).toEqual([{ level: 0, cellKey: cellKey(0, 0), version: 1 }]);
    // No previous version to clean up on a cell's very first bake.
    expect(removed).toEqual([]);
  });

  it("only fetches locked pieces, not every piece in the cell's halo", async () => {
    const { deps, locked } = makeDeps();
    locked.add(0); // one of four candidates in cell (0,0): ids 0, 1, 4, 5
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
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
    // three: 2 uploads total, never 4.
    compositor.markDirty(0, [cellKey(0, 0)]);
    compositor.markDirty(0, [cellKey(0, 0)]);
    compositor.markDirty(0, [cellKey(0, 0)]);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(2);
  });

  it("bumps the version on a later rebake of the same cell", async () => {
    const { deps, uploads, removed, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();
    locked.add(1);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.key).toBe(`test-puzzle/cells/${cellKey(0, 0)}/2.avif`);
    // The now-superseded v1 object is cleaned up once v2 is fully live.
    expect(removed).toEqual([`test-puzzle/cells/${cellKey(0, 0)}/1.avif`]);
  });

  it("logs and continues past a cell whose stale-version delete fails, instead of treating the bake as failed", async () => {
    const { deps, uploads, persisted, composited, locked } = makeDeps({
      remove: vi.fn().mockRejectedValueOnce(new Error("network blip")),
    });
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();
    locked.add(1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();

    // The bake itself (upload, version, persist, broadcast) still succeeds
    // even though cleaning up the old version failed.
    expect(uploads).toHaveLength(2);
    expect(persisted).toEqual([
      { level: 0, cellKey: cellKey(0, 0), version: 1 },
      { level: 0, cellKey: cellKey(0, 0), version: 2 },
    ]);
    expect(composited).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs and continues past a cell whose upload fails, instead of losing the rest of the queue", async () => {
    const { deps, uploads, locked } = makeDeps({
      upload: vi
        .fn()
        .mockRejectedValueOnce(new Error("network blip"))
        .mockImplementation(async (key: string, body: Buffer, contentType: string) => {
          uploads.push({ key, body, contentType });
        }),
    });
    locked.add(0); // cell (0,0)
    locked.add(2); // cell (1,0): ids 2,3,6,7 at CELL_SIZE=20/PIECE_SIZE=10
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0), cellKey(1, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("produces a composite that actually shows the locked piece's pixels", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(0, [cellKey(0, 0)]);
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

describe("CellCompositor.markDirty (pyramid levels >= 1)", () => {
  it("composites up to 4 already-baked level-0 children into a level-1 tile", async () => {
    const { deps, index, uploads, persisted, composited } = makeDeps();
    index.set(0, cellKey(0, 0), 2);
    index.set(0, cellKey(1, 0), 5);
    index.set(0, cellKey(0, 1), 1);
    index.set(0, cellKey(1, 1), 3);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(1, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(deps.fetchComposite).toHaveBeenCalledTimes(4);
    expect(deps.fetchComposite).toHaveBeenCalledWith(`test-puzzle/cells/${cellKey(0, 0)}/2.avif`);
    expect(deps.fetchComposite).toHaveBeenCalledWith(`test-puzzle/cells/${cellKey(1, 0)}/5.avif`);
    expect(deps.fetchComposite).toHaveBeenCalledWith(`test-puzzle/cells/${cellKey(0, 1)}/1.avif`);
    expect(deps.fetchComposite).toHaveBeenCalledWith(`test-puzzle/cells/${cellKey(1, 1)}/3.avif`);
    // The pyramid's own key shape (L<level>), unlike level 0's bare one.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.key).toBe(`test-puzzle/cells/L1/${cellKey(0, 0)}/1.avif`);
    expect(index.get(1, cellKey(0, 0))).toBe(1);
    expect(persisted).toEqual([{ level: 1, cellKey: cellKey(0, 0), version: 1 }]);
    expect(composited).toEqual([{ level: 1, cellKey: cellKey(0, 0), version: 1 }]);
  });

  it("bakes from whichever children exist when fewer than 4 are baked, mirroring level 0's partial-cell shape", async () => {
    const { deps, uploads, index } = makeDeps();
    index.set(0, cellKey(0, 0), 1); // only the top-left child has ever baked
    const compositor = new CellCompositor(deps);
    compositor.markDirty(1, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(deps.fetchComposite).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
  });

  it("does nothing when no child has a bake yet", async () => {
    const { deps, uploads } = makeDeps();
    const compositor = new CellCompositor(deps);
    compositor.markDirty(1, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(uploads).toEqual([]);
    expect(deps.fetchComposite).not.toHaveBeenCalled();
  });

  it("resizes the raw 2x2 union down to the pyramid's one fixed tile size, not the doubled raw size", async () => {
    const { deps, uploads, index } = makeDeps();
    index.set(0, cellKey(0, 0), 1);
    index.set(0, cellKey(1, 0), 1);
    index.set(0, cellKey(0, 1), 1);
    index.set(0, cellKey(1, 1), 1);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(1, [cellKey(0, 0)]);
    await compositor.whenIdle();

    const metadata = await sharp(uploads[0]!.body).metadata();
    expect(metadata.width).toBe(PYRAMID_TILE_SIZE);
    expect(metadata.height).toBe(PYRAMID_TILE_SIZE);
  });

  it("keys a level>=1 object under its own L<level> segment, not just a generic level-1 shape", async () => {
    const { deps, uploads, index } = makeDeps();
    // A level-2 bake from a fabricated level-1 child, to check the level
    // number itself flows into the key rather than a hardcoded "L1".
    index.set(1, cellKey(0, 0), 7);
    const compositor = new CellCompositor(deps);
    compositor.markDirty(2, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.key).toBe(`test-puzzle/cells/L2/${cellKey(0, 0)}/1.avif`);
  });
});

describe("cascading dirtiness across levels", () => {
  it("a completion-triggered parent mark drains the whole chain within one whenIdle(), reading the child's fresh version", async () => {
    const composited: { level: number; cellKey: number; version: number }[] = [];
    // A mutable box, not a plain `let`, so the forward-reference below (the
    // compositor calling back into its own markDirty from inside a deps
    // callback it must be constructed with) does not read as a same-scope
    // single assignment eslint would rather see as `const`.
    const compositorRef: { current?: CellCompositor } = {};
    // Mirrors index.ts's real onComposited wiring: a completion at level 0
    // marks its own parent dirty one level up (this test cascades only that
    // one hop, unlike the real MAX_CELL_COMPOSITE_LEVEL ceiling, which is a
    // caller-side concern, not something CellCompositor itself knows about).
    const { deps, locked } = makeDeps({
      onComposited: (level, key, version) => {
        composited.push({ level, cellKey: key, version });
        if (level === 0) {
          const { cx, cy } = unpackCellKey(key);
          compositorRef.current?.markDirty(1, [parentCellKey(cx, cy)]);
        }
      },
    });
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositorRef.current = compositor;
    compositor.markDirty(0, [cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(composited.map((c) => c.level)).toEqual([0, 1]);
    // The level-1 bake read level 0's own just-finished version (1), proving
    // the cascade only fires after the child's finishBake (index.set) has
    // already landed, never from a stale pre-bake version.
    expect(deps.fetchComposite).toHaveBeenCalledWith(`test-puzzle/cells/${cellKey(0, 0)}/1.avif`);
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
