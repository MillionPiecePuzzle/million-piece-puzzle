// Server-composited locked-tile layer (see ROADMAP Phase 5 Stages 3, 5). A
// locked piece has no other rendering path left: this layer fetches an
// already-composited AVIF from the server and shows it as a Sprite. Unlike
// LodTileLayer (bakes the live Pixi scene into a RenderTexture, synchronously,
// only below LOD_ENTER_ZOOM), fetching is asynchronous with retry/timeout, so
// this is a sibling module rather than a merge into LodTileLayer: the two
// lifecycles are different enough that combining them would make both harder
// to read. It mirrors LodTileLayer's shape (its own sized budget, LRU
// eviction) instead of sharing its tile Map.

import { Assets, Sprite, type Container, type Texture } from "pixi.js";
import type { Aabb } from "./cull";
import { LOD_TILE_WORLD, packCell, unpackWireCellKey, type CellKey } from "./groupGrid";

export type CellCoord = { cx: number; cy: number };

// Every cell a box spans, at the fixed LOD_TILE_WORLD pitch every composited
// tile is baked at.
export function neededCompositeTiles(box: Aabb): CellCoord[] {
  const out: CellCoord[] = [];
  const cx0 = Math.floor(box.minX / LOD_TILE_WORLD);
  const cx1 = Math.floor(box.maxX / LOD_TILE_WORLD);
  const cy0 = Math.floor(box.minY / LOD_TILE_WORLD);
  const cy1 = Math.floor(box.maxY / LOD_TILE_WORLD);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) out.push({ cx, cy });
  }
  return out;
}

const EMPTY_PIECE_IDS: ReadonlySet<number> = new Set();

type Tile = {
  cx: number;
  cy: number;
  wireCellKey: number;
  bounds: Aabb;
  version: number;
  appliedVersion: number;
  sprite: Sprite | null;
  hydrating: boolean;
  bytes: number;
  lru: number;
  // Locked piece ids known to be within this tile's bounds at the moment
  // appliedVersion's sprite was hydrated (see hydrateTile): the server always
  // rebakes a cell from its full current locked set, so this snapshot is
  // exactly what that sprite draws. A piece locked after this snapshot is not
  // in it, so isPieceCovered correctly keeps treating it as uncovered until a
  // later hydrate replaces the snapshot - without this, a piece salvaged into
  // a cell whose composite was hydrated *before* the piece locked would read
  // as already-covered purely by falling within the tile's bounds, freeing
  // the salvage bridge before the composite actually shows it.
  coveredPieceIds: ReadonlySet<number>;
};

// Comfort budget for this layer's own resident bytes (a soft MB figure
// divided by the real decoded size), the same way LodTileLayer sizes its own.
// Evicting a composite tile under budget pressure is always safe (it just
// re-fetches the next time it's needed), so eviction candidates are exactly
// "hydrated but outside the immediate needed set", never the tiles the
// current viewport actually needs right now.
const COMPOSITE_VRAM_BUDGET_MB = 256;
const COMPOSITE_MAX_INFLIGHT = 8;

export type CompositeTileLayerDeps = {
  container: Container;
  margin: number;
  loadTexture: (url: string) => Promise<Texture | null>;
  urlFor: (wireCellKey: number, version: number) => string;
  // Locked piece ids currently known within a world rect (see
  // GroupGrid.queryRect over puzzleStage's lockedPieceGrid), snapshotted at
  // hydrate time into Tile.coveredPieceIds.
  piecesInBounds: (bounds: Aabb) => ReadonlySet<number>;
};

export class CompositeTileLayer {
  private readonly tiles = new Map<CellKey, Tile>();
  private lruClock = 0;
  private inFlight = 0;

  constructor(private readonly deps: CompositeTileLayerDeps) {}

  // Records or bumps one cell's known composite version. Shared by the
  // region_state batch and the live cell_composite push, mirroring the
  // pre-Stage-5 applyCellComposite: both just report a fact here, reconcile
  // decides whether/when to actually fetch it. A stale or duplicate report is
  // a no-op.
  reportVersion(wireCellKey: number, version: number): void {
    const { cx, cy } = unpackWireCellKey(wireCellKey);
    const key = packCell(cx, cy);
    const existing = this.tiles.get(key);
    if (existing) {
      if (version <= existing.version) return;
      existing.version = version;
      return;
    }
    const bounds: Aabb = {
      minX: cx * LOD_TILE_WORLD - this.deps.margin,
      minY: cy * LOD_TILE_WORLD - this.deps.margin,
      maxX: (cx + 1) * LOD_TILE_WORLD + this.deps.margin,
      maxY: (cy + 1) * LOD_TILE_WORLD + this.deps.margin,
    };
    this.tiles.set(key, {
      cx,
      cy,
      wireCellKey,
      bounds,
      version,
      appliedVersion: 0,
      sprite: null,
      hydrating: false,
      bytes: 0,
      lru: 0,
      coveredPieceIds: EMPTY_PIECE_IDS,
    });
  }

  isHydrated(cx: number, cy: number): boolean {
    return this.tiles.get(packCell(cx, cy))?.sprite != null;
  }

  // Whether some hydrated tile currently covers a world point, ignoring piece
  // identity. Used only by the minimap detail modal's tile overview (a
  // diagnostic, not a rendering decision), where "some composite is showing
  // here" is precise enough. The salvage bridge needs the stricter
  // isPieceCovered instead (see its own doc comment for why).
  isWorldPointCovered(x: number, y: number): boolean {
    return this.tileCovering(x, y) !== undefined;
  }

  // Whether a specific locked piece is actually drawn by whatever composite
  // currently covers its position, not merely "some tile's bounds contain the
  // point" (see Tile.coveredPieceIds for why the distinction matters). Used
  // by the salvage bridge (puzzleStage.ts's reconcileSalvagedLockedPieces) to
  // decide when a locally-dragged piece's temporary node can be freed.
  isPieceCovered(pieceId: number, x: number, y: number): boolean {
    return this.tileCovering(x, y)?.coveredPieceIds.has(pieceId) ?? false;
  }

  // The hydrated tile whose bounds contain a world point, if any. A small,
  // bounded scan: this layer never holds more than a handful of tiles.
  private tileCovering(x: number, y: number): Tile | undefined {
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      if (
        x >= tile.bounds.minX &&
        x < tile.bounds.maxX &&
        y >= tile.bounds.minY &&
        y < tile.bounds.maxY
      ) {
        return tile;
      }
    }
    return undefined;
  }

  // Per-frame reconcile, mirroring the two-ring shape reconcileGroups etc.
  // already use: hydrateRing decides what to actively fetch, the wider
  // keepRing decides what stays resident (hysteresis, so a tile hovering at
  // the ring boundary does not thrash).
  reconcile(hydrateRing: Aabb, keepRing: Aabb): void {
    const needed = neededCompositeTiles(hydrateRing);
    const kept = neededCompositeTiles(keepRing);

    const neededSet = new Set(needed.map((c) => packCell(c.cx, c.cy)));
    for (const cell of needed) {
      const tile = this.tiles.get(packCell(cell.cx, cell.cy));
      if (!tile) continue;
      tile.lru = ++this.lruClock;
      if (
        tile.version > tile.appliedVersion &&
        !tile.hydrating &&
        this.inFlight < COMPOSITE_MAX_INFLIGHT
      ) {
        void this.hydrateTile(tile);
      }
    }

    const keptSet = new Set(kept.map((c) => packCell(c.cx, c.cy)));
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      if (!keptSet.has(packCell(tile.cx, tile.cy))) this.freeTile(tile);
    }

    this.evictOverBudget(neededSet);
  }

  private async hydrateTile(tile: Tile): Promise<void> {
    tile.hydrating = true;
    this.inFlight++;
    const version = tile.version;
    const url = this.deps.urlFor(tile.wireCellKey, version);
    const texture = await this.deps.loadTexture(url);
    this.inFlight--;
    tile.hydrating = false;
    const stillMine = this.tiles.get(packCell(tile.cx, tile.cy)) === tile;
    if (!texture || !stillMine) {
      if (texture) void Assets.unload(url);
      return;
    }
    // The server always rebakes a cell from its full current locked set, so
    // every locked piece id known right now within this tile's bounds is
    // exactly what this version's sprite draws (see Tile.coveredPieceIds).
    const covered = this.deps.piecesInBounds(tile.bounds);
    const oldSprite = tile.sprite;
    const oldVersion = tile.appliedVersion;
    const sprite = new Sprite(texture);
    sprite.x = tile.bounds.minX;
    sprite.y = tile.bounds.minY;
    sprite.width = tile.bounds.maxX - tile.bounds.minX;
    sprite.height = tile.bounds.maxY - tile.bounds.minY;
    this.deps.container.addChild(sprite);
    tile.sprite = sprite;
    tile.appliedVersion = version;
    tile.coveredPieceIds = covered;
    tile.bytes = texture.width * texture.height * 4;
    tile.lru = ++this.lruClock;
    if (oldSprite) {
      this.deps.container.removeChild(oldSprite);
      oldSprite.destroy();
      void Assets.unload(this.deps.urlFor(tile.wireCellKey, oldVersion));
    }
  }

  private freeTile(tile: Tile): void {
    if (!tile.sprite) return;
    this.deps.container.removeChild(tile.sprite);
    tile.sprite.destroy();
    tile.sprite = null;
    tile.bytes = 0;
    void Assets.unload(this.deps.urlFor(tile.wireCellKey, tile.appliedVersion));
  }

  // LRU-evicts hydrated tiles once resident bytes exceed budget, but only
  // ever among tiles outside the immediate needed set: the currently
  // relevant tiles (whatever the viewport actually needs to show right now)
  // are never sacrificed for budget, only the wider keep-ring hysteresis
  // margin shrinks under pressure.
  private evictOverBudget(neededSet: ReadonlySet<number>): void {
    const budget = COMPOSITE_VRAM_BUDGET_MB * 1e6;
    const candidates: Tile[] = [];
    let total = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      total += tile.bytes;
      if (!neededSet.has(packCell(tile.cx, tile.cy))) candidates.push(tile);
    }
    if (total <= budget) return;
    candidates.sort((a, b) => a.lru - b.lru);
    for (const tile of candidates) {
      if (total <= budget) break;
      total -= tile.bytes;
      this.freeTile(tile);
    }
  }

  // Current resident bytes, for the minimap detail modal's memory readout
  // (see PuzzleStage.getMemoryStats).
  residentBytes(): number {
    let total = 0;
    for (const tile of this.tiles.values()) total += tile.bytes;
    return total;
  }

  budgetBytes(): number {
    return COMPOSITE_VRAM_BUDGET_MB * 1e6;
  }

  clear(): void {
    for (const tile of this.tiles.values()) this.freeTile(tile);
    this.tiles.clear();
  }
}
