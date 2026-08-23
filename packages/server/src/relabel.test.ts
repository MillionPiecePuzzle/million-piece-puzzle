import { describe, it, expect } from "vitest";
import { buildPermutation, type GroupRuntime } from "@mpp/shared";
import { relabelOrigins, sourceForTarget, reconcileBoardSeed } from "./relabel.js";
import type { BoardOrigin } from "./relabel.js";
import type { PuzzleMeta, StoredPiece } from "./state.js";

const COLS = 5;
const ROWS = 4;
const TOTAL = COLS * ROWS;
const PIECE = 10;
const FROM = "board-was-built-with-this";
const TO = "assets-were-sliced-with-this";

const offsetX = (id: number): number => (id % COLS) * PIECE;
const offsetY = (id: number): number => Math.floor(id / COLS) * PIECE;

// The art a client actually sees on the piece stored under `gridId`: the server
// hands out `P(servedSeed, gridId)`, and the tile at that name holds the art the
// slicer put there under `assetSeed`.
function artOf(gridId: number, servedSeed: string, assetSeed: string): number {
  const served = buildPermutation(servedSeed, TOTAL);
  const assets = buildPermutation(assetSeed, TOTAL);
  return assets.gridForWire[served.wireForGrid[gridId]!]!;
}

const anchorOf = (o: BoardOrigin): string =>
  `${o.worldX + offsetX(o.id)},${o.worldY + offsetY(o.id)}`;

function scatter(seed: number): GroupRuntime[] {
  let s = seed;
  const rand = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  return Array.from({ length: TOTAL }, (_, id) => ({
    id,
    worldX: Math.round(rand() * 1000) - 500,
    worldY: Math.round(rand() * 1000) - 500,
    size: 1,
    heldBy: null,
  }));
}

const pieces = (): StoredPiece[] =>
  Array.from({ length: TOTAL }, (_, id) => ({ id, groupId: id, rotation: 0, locked: false }));

const meta = (): PuzzleMeta => ({
  totalPieces: TOTAL,
  gridRows: ROWS,
  gridCols: COLS,
  pieceSize: PIECE,
  snapTolerance: 2,
  generationSeed: FROM,
  status: "active",
  startedAt: 0,
});

// In-memory board: writes land in it exactly as they would in Redis, so a
// failure injected mid-write leaves the same half-applied state behind.
class FakeStore {
  meta: PuzzleMeta;
  backup = new Map<number, BoardOrigin>();
  failAfterPositions = Infinity;
  failAfterBackups = Infinity;

  constructor(
    readonly groups: GroupRuntime[],
    private readonly board: StoredPiece[] = pieces(),
  ) {
    this.meta = meta();
  }

  readAllGroups(): Promise<GroupRuntime[]> {
    return Promise.resolve(this.groups.map((g) => ({ ...g })));
  }

  readAllPieces(): Promise<StoredPiece[]> {
    return Promise.resolve(this.board);
  }

  setGroupPositions(entries: readonly BoardOrigin[]): Promise<void> {
    let written = 0;
    for (const e of entries) {
      if (written >= this.failAfterPositions) return Promise.reject(new Error("redis died"));
      const g = this.groups[e.id]!;
      g.worldX = e.worldX;
      g.worldY = e.worldY;
      written++;
    }
    return Promise.resolve();
  }

  saveOriginBackup(entries: readonly BoardOrigin[]): Promise<void> {
    let written = 0;
    for (const e of entries) {
      if (written >= this.failAfterBackups) return Promise.reject(new Error("redis died"));
      this.backup.set(e.id, { id: e.id, worldX: e.worldX, worldY: e.worldY });
      written++;
    }
    return Promise.resolve();
  }

  readOriginBackup(): Promise<BoardOrigin[] | null> {
    return Promise.resolve(this.backup.size === 0 ? null : [...this.backup.values()]);
  }

  clearOriginBackup(): Promise<void> {
    this.backup.clear();
    return Promise.resolve();
  }

  writeMeta(m: PuzzleMeta): Promise<void> {
    this.meta = m;
    return Promise.resolve();
  }
}

// Where each piece of art sits on screen, keyed by the art itself rather than by
// the id holding it, which is the only thing a player can see.
function artAnchors(store: FakeStore, servedSeed: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const g of store.groups) out.set(artOf(g.id, servedSeed, TO), anchorOf(g));
  return out;
}

describe("sourceForTarget", () => {
  it("is a permutation of every id", () => {
    const sources = sourceForTarget(FROM, TO, TOTAL);
    expect([...sources].sort((a, b) => a - b)).toEqual([...Array(TOTAL).keys()]);
  });

  it("points an id at the group currently rendering its art", () => {
    const sources = sourceForTarget(FROM, TO, TOTAL);
    for (let id = 0; id < TOTAL; id++) {
      expect(artOf(sources[id]!, FROM, TO)).toBe(id);
    }
  });

  it("is the identity when both seeds match", () => {
    expect([...sourceForTarget(FROM, FROM, TOTAL)]).toEqual([...Array(TOTAL).keys()]);
  });
});

describe("relabelOrigins", () => {
  it("moves an id onto the rendered anchor of the group holding its art", () => {
    const groups = scatter(7);
    const sources = sourceForTarget(FROM, TO, TOTAL);
    const next = relabelOrigins(groups, sources, COLS, PIECE);
    const src = sources[1]!;
    expect(next[1]!.worldX).toBe(groups[src]!.worldX + offsetX(src) - offsetX(1));
    expect(next[1]!.worldY).toBe(groups[src]!.worldY + offsetY(src) - offsetY(1));
  });

  it("keeps the set of rendered anchors identical", () => {
    const groups = scatter(13);
    const next = relabelOrigins(groups, sourceForTarget(FROM, TO, TOTAL), COLS, PIECE);
    expect(next.map(anchorOf).sort()).toEqual(groups.map(anchorOf).sort());
  });

  it("is a no-op when the seeds match", () => {
    const groups = scatter(17);
    const next = relabelOrigins(groups, sourceForTarget(FROM, FROM, TOTAL), COLS, PIECE);
    expect(next).toEqual(groups.map(({ id, worldX, worldY }) => ({ id, worldX, worldY })));
  });
});

describe("reconcileBoardSeed", () => {
  it("does nothing when the board already carries the loaded seed", async () => {
    const store = new FakeStore(scatter(19));
    const before = artAnchors(store, FROM);
    const out = await reconcileBoardSeed(store, meta(), FROM);
    expect(artAnchors(store, FROM)).toEqual(before);
    expect(out.generationSeed).toBe(FROM);
  });

  it("leaves every piece of art on the exact pixel it already occupied", async () => {
    const store = new FakeStore(scatter(23));
    const before = artAnchors(store, FROM);
    const out = await reconcileBoardSeed(store, meta(), TO);
    expect(out.generationSeed).toBe(TO);
    expect(store.meta.generationSeed).toBe(TO);
    expect(artAnchors(store, TO)).toEqual(before);
  });

  it("puts every piece under the id whose art it shows", async () => {
    const store = new FakeStore(scatter(29));
    await reconcileBoardSeed(store, meta(), TO);
    for (const g of store.groups) expect(artOf(g.id, TO, TO)).toBe(g.id);
  });

  it("drops the snapshot once the new seed is committed", async () => {
    const store = new FakeStore(scatter(31));
    await reconcileBoardSeed(store, meta(), TO);
    expect(store.backup.size).toBe(0);
  });

  it("clears a snapshot left behind by a crash after the seed was committed", async () => {
    const store = new FakeStore(scatter(37));
    store.backup.set(0, { id: 0, worldX: 1, worldY: 2 });
    await reconcileBoardSeed(store, meta(), FROM);
    expect(store.backup.size).toBe(0);
  });

  it("resumes correctly after a crash midway through rewriting positions", async () => {
    const clean = new FakeStore(scatter(41));
    await reconcileBoardSeed(clean, meta(), TO);

    const crashed = new FakeStore(scatter(41));
    const before = artAnchors(crashed, FROM);
    crashed.failAfterPositions = 7;
    await expect(reconcileBoardSeed(crashed, meta(), TO)).rejects.toThrow("redis died");
    expect(crashed.meta.generationSeed).toBe(FROM);
    expect(crashed.backup.size).toBe(TOTAL);

    crashed.failAfterPositions = Infinity;
    await reconcileBoardSeed(crashed, meta(), TO);
    expect(artAnchors(crashed, TO)).toEqual(before);
    expect(crashed.groups).toEqual(clean.groups);
    expect(crashed.backup.size).toBe(0);
  });

  it("resumes correctly after a crash midway through writing the snapshot", async () => {
    const clean = new FakeStore(scatter(43));
    await reconcileBoardSeed(clean, meta(), TO);

    const crashed = new FakeStore(scatter(43));
    const before = artAnchors(crashed, FROM);
    crashed.failAfterBackups = 4;
    await expect(reconcileBoardSeed(crashed, meta(), TO)).rejects.toThrow("redis died");
    expect(crashed.backup.size).toBeLessThan(TOTAL);

    crashed.failAfterBackups = Infinity;
    await reconcileBoardSeed(crashed, meta(), TO);
    expect(artAnchors(crashed, TO)).toEqual(before);
    expect(crashed.groups).toEqual(clean.groups);
  });

  it("refuses a board that already has a locked piece", async () => {
    const board = pieces();
    board[3]!.locked = true;
    const store = new FakeStore(scatter(47), board);
    await expect(reconcileBoardSeed(store, meta(), TO)).rejects.toThrow(/piece 3 is locked/);
  });

  it("refuses a board that already has a merged cluster", async () => {
    const groups = scatter(53);
    groups[2]!.size = 2;
    const store = new FakeStore(groups);
    await expect(reconcileBoardSeed(store, meta(), TO)).rejects.toThrow(/group 2 holds 2 pieces/);
  });

  it("refuses a board that lost a group to a merge", async () => {
    const store = new FakeStore(scatter(59).filter((g) => g.id !== 5));
    await expect(reconcileBoardSeed(store, meta(), TO)).rejects.toThrow(/already merged away/);
  });

  it("refuses a board whose piece left its own group", async () => {
    const board = pieces();
    board[6]!.groupId = 5;
    const store = new FakeStore(scatter(61), board);
    await expect(reconcileBoardSeed(store, meta(), TO)).rejects.toThrow(/piece 6 sits in group 5/);
  });

  it("touches nothing when it refuses", async () => {
    const board = pieces();
    board[3]!.locked = true;
    const store = new FakeStore(scatter(67), board);
    const before = artAnchors(store, FROM);
    await expect(reconcileBoardSeed(store, meta(), TO)).rejects.toThrow();
    expect(artAnchors(store, FROM)).toEqual(before);
    expect(store.backup.size).toBe(0);
    expect(store.meta.generationSeed).toBe(FROM);
  });
});
