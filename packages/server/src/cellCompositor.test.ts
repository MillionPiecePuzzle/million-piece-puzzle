import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
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
  persisted: { cellKey: number; version: number }[];
  composited: { cellKey: number; version: number }[];
  locked: Set<number>;
} {
  const index = new CellCompositeIndex();
  const uploads: { key: string; body: Buffer; contentType: string }[] = [];
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
    wire,
    pieceFileByWireId: (wireId) => `pieces/${wireId}.avif`,
    isLocked: (id) => locked.has(id),
    fetchTile: vi.fn(async () => solidTile(PIECE_SIZE + 2 * MARGIN, [255, 0, 0, 255])),
    upload: vi.fn(async (key: string, body: Buffer, contentType: string) => {
      uploads.push({ key, body, contentType });
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
  return { deps, index: overrides.index ?? index, uploads, persisted, composited, locked };
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
    const { deps, index, uploads, persisted, composited, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.key).toBe(`test-puzzle/cells/${cellKey(0, 0)}/1.avif`);
    expect(uploads[0]!.contentType).toBe("image/avif");
    expect(index.get(cellKey(0, 0))).toBe(1);
    expect(persisted).toEqual([{ cellKey: cellKey(0, 0), version: 1 }]);
    expect(composited).toEqual([{ cellKey: cellKey(0, 0), version: 1 }]);
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
    // three: 2 uploads total, never 4.
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(2);
  });

  it("bumps the version on a later rebake of the same cell", async () => {
    const { deps, uploads, locked } = makeDeps();
    locked.add(0);
    const compositor = new CellCompositor(deps);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    locked.add(1);
    compositor.markDirty([cellKey(0, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.key).toBe(`test-puzzle/cells/${cellKey(0, 0)}/2.avif`);
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
    compositor.markDirty([cellKey(0, 0), cellKey(1, 0)]);
    await compositor.whenIdle();
    expect(uploads).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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
