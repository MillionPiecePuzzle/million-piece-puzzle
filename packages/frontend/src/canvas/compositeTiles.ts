// Zoom-adaptive server-composited locked-tile pyramid (see ROADMAP Phase 5
// Stages 3-5). A locked piece has no other rendering path left: this layer
// fetches an already-composited AVIF from the server and shows it as a
// Sprite, active at every zoom, picking whichever pyramid level (0-3) best
// matches the current screen density, mipmap-style. Unlike LodTileLayer
// (bakes the live Pixi scene into a RenderTexture, synchronously, only below
// LOD_ENTER_ZOOM), fetching is asynchronous with retry/timeout, so this is a
// sibling module rather than a merge into LodTileLayer: the two lifecycles
// are different enough that combining them would make both harder to read.
// It mirrors LodTileLayer's shape (its own sized budget, LRU eviction)
// instead of sharing its tile Map.

import { Assets, Sprite, type Container, type Texture } from "pixi.js";
import type { Aabb } from "./cull";
import { LOD_TILE_WORLD, packCell, unpackWireCellKey, type CellKey } from "./groupGrid";

// A small hysteresis band (in level-units) around each integer boundary, the
// same shape LOD_ENTER_ZOOM/LOD_EXIT_ZOOM already uses for the baked-tile
// band, so a zoom sitting exactly on a switch point does not thrash between
// two levels every frame.
const LEVEL_HYSTERESIS = 0.15;

// Mipmap-style level selection for the current zoom: picks whichever pyramid
// level's own native resolution is closest to what the screen actually needs
// (zoom * dpr texels per world-unit, the same "no oversampling beyond dpr"
// assumption LodTileLayer's own texel sizing already uses), clamped to the
// levels the server actually builds. `previousLevel` is -1 before the first
// call (always computes fresh then); every later call only moves away from it
// once the raw value has crossed a full level boundary plus the hysteresis
// margin.
export function desiredLevel(
  zoom: number,
  dpr: number,
  nativeDensity: number,
  previousLevel: number,
  maxLevel: number,
): number {
  const raw = Math.log2(nativeDensity / (zoom * dpr));
  if (previousLevel >= 0 && Math.abs(raw - previousLevel) < 0.5 + LEVEL_HYSTERESIS) {
    return previousLevel;
  }
  return clamp(Math.round(raw), 0, maxLevel);
}

export type LevelCell = { level: number; cx: number; cy: number };

// A cell's own 4 children live one level down at (2cx, 2cy), (2cx+1, 2cy),
// (2cx, 2cy+1), (2cx+1, 2cy+1) - the same convention the server's own pyramid
// build uses (see cellComposite.ts's parentCellKey). Enumerating them
// directly (rather than re-scanning a child-pitch Aabb) sidesteps an
// off-by-one at exact cell boundaries a rect scan would hit here (a parent
// cell's own edge always lands exactly on a child cell line).
const CHILD_OFFSETS: readonly [dc: number, dr: number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

// The tiles actually needed to cover `box` at `level`, falling back to finer
// levels (down to 0) wherever a level's own tile is not yet hydrated, so a
// coarse level still catching up never opens a gap where a finer tile is
// already displayed (the same gapless-fill idea used everywhere else in this
// codebase - groups, locked pieces, and the original level-0-only composite
// all render *something* until their target is ready). `isHydrated` reports
// whether a given tile is currently resident right now; the recursion bottoms
// out at level 0 regardless, since nothing finer exists to fall back to.
export function neededCompositeTiles(
  box: Aabb,
  level: number,
  isHydrated: (level: number, cx: number, cy: number) => boolean,
): LevelCell[] {
  const out: LevelCell[] = [];
  const worldSize = LOD_TILE_WORLD * 2 ** level;
  const cx0 = Math.floor(box.minX / worldSize);
  const cx1 = Math.floor(box.maxX / worldSize);
  const cy0 = Math.floor(box.minY / worldSize);
  const cy1 = Math.floor(box.maxY / worldSize);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) visit(level, cx, cy);
  }
  return out;

  function visit(lvl: number, cx: number, cy: number): void {
    out.push({ level: lvl, cx, cy });
    if (lvl > 0 && !isHydrated(lvl, cx, cy)) {
      for (const [dc, dr] of CHILD_OFFSETS) visit(lvl - 1, cx * 2 + dc, cy * 2 + dr);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const EMPTY_PIECE_IDS: ReadonlySet<number> = new Set();

type Tile = {
  level: number;
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

// Comfort budget for this layer's own resident bytes, sized the same way
// LodTileLayer sizes its own (a soft MB figure divided by the real decoded
// size), not the "1 unit like a single piece" approximation the level-0-only
// composite pool used before this replaced it: that approximation is unsafe
// now that a composite tile is the *only* rendering path for locked content,
// spanning up to 4 levels at several MB decoded each. Unlike a group or a
// locked piece's salvaged node, evicting a composite tile under budget
// pressure is always safe (it just re-fetches the next time it's needed), so
// eviction candidates are exactly "hydrated but outside the immediate needed
// set", never the tiles the current viewport actually needs right now.
const COMPOSITE_VRAM_BUDGET_MB = 256;
const COMPOSITE_MAX_INFLIGHT = 8;

export type CompositeTileLayerDeps = {
  container: Container;
  margin: number;
  maxLevel: number;
  loadTexture: (url: string) => Promise<Texture | null>;
  urlFor: (level: number, wireCellKey: number, version: number) => string;
  // Locked piece ids currently known within a world rect (see
  // GroupGrid.queryRect over puzzleStage's lockedPieceGrid), snapshotted at
  // hydrate time into Tile.coveredPieceIds.
  piecesInBounds: (bounds: Aabb) => ReadonlySet<number>;
};

export class CompositeTileLayer {
  private readonly tiles = new Map<number, Map<CellKey, Tile>>();
  private currentLevel = -1;
  private lruClock = 0;
  private inFlight = 0;

  constructor(private readonly deps: CompositeTileLayerDeps) {}

  // Level 0's own native density: its sprite bounds include the same
  // margin-widened bleed the server's canvas actually covers, so its true
  // displayed density is exactly (tile pixels) / (tile world-units) = 1;
  // levels 1-3 use a clean (non-widened) rect (see hydrateTile) and so form a
  // clean power-of-2 chain below whatever this resolves to. A small (~2%)
  // mismatch at the level 0/1 boundary from that difference is accepted, not
  // worth chasing for a heuristic selection threshold.
  private nativeDensity(): number {
    return (LOD_TILE_WORLD + 2 * this.deps.margin) / LOD_TILE_WORLD;
  }

  private levelMap(level: number): Map<CellKey, Tile> {
    let m = this.tiles.get(level);
    if (!m) {
      m = new Map();
      this.tiles.set(level, m);
    }
    return m;
  }

  // Records or bumps one (level, cell)'s known composite version. Shared by
  // the region_state batch and the live cell_composite push, mirroring the
  // pre-Stage-5 applyCellComposite: both just report a fact here, reconcile
  // decides whether/when to actually fetch it. A stale or duplicate report is
  // a no-op.
  reportVersion(level: number, wireCellKey: number, version: number): void {
    const { cx, cy } = unpackWireCellKey(wireCellKey);
    const key = packCell(cx, cy);
    const levelMap = this.levelMap(level);
    const existing = levelMap.get(key);
    if (existing) {
      if (version <= existing.version) return;
      existing.version = version;
      return;
    }
    const worldSize = LOD_TILE_WORLD * 2 ** level;
    const bounds: Aabb =
      level === 0
        ? {
            minX: cx * LOD_TILE_WORLD - this.deps.margin,
            minY: cy * LOD_TILE_WORLD - this.deps.margin,
            maxX: (cx + 1) * LOD_TILE_WORLD + this.deps.margin,
            maxY: (cy + 1) * LOD_TILE_WORLD + this.deps.margin,
          }
        : {
            minX: cx * worldSize,
            minY: cy * worldSize,
            maxX: (cx + 1) * worldSize,
            maxY: (cy + 1) * worldSize,
          };
    levelMap.set(key, {
      level,
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

  isHydrated(level: number, cx: number, cy: number): boolean {
    return this.tiles.get(level)?.get(packCell(cx, cy))?.sprite != null;
  }

  // Whether some hydrated tile, at any level, currently covers a world point,
  // ignoring piece identity. Used only by the minimap detail modal's tile
  // overview (a diagnostic, not a rendering decision), where "some composite
  // is showing here" is precise enough. The salvage bridge needs the
  // stricter isPieceCovered instead (see its own doc comment for why).
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

  // The hydrated tile (any level) whose bounds contain a world point, if any.
  // A small, bounded scan: this layer never holds more than a handful of
  // tiles per level.
  private tileCovering(x: number, y: number): Tile | undefined {
    for (const levelMap of this.tiles.values()) {
      for (const tile of levelMap.values()) {
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
    }
    return undefined;
  }

  // Per-frame reconcile, mirroring the two-ring shape reconcileGroups etc.
  // already use: hydrateRing decides what to actively fetch, the wider
  // keepRing decides what stays resident (hysteresis, so a tile hovering at
  // the ring boundary does not thrash). zoom/dpr pick the current level.
  reconcile(hydrateRing: Aabb, keepRing: Aabb, zoom: number, dpr: number): void {
    const level = desiredLevel(
      zoom,
      dpr,
      this.nativeDensity(),
      this.currentLevel,
      this.deps.maxLevel,
    );
    this.currentLevel = level;

    const isHydrated = (lvl: number, cx: number, cy: number): boolean =>
      this.isHydrated(lvl, cx, cy);
    const needed = neededCompositeTiles(hydrateRing, level, isHydrated);
    const kept = neededCompositeTiles(keepRing, level, isHydrated);

    const neededSet = new Set(needed.map(packLevelCell));
    for (const cell of needed) {
      const tile = this.tiles.get(cell.level)?.get(packCell(cell.cx, cell.cy));
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

    const keptSet = new Set(kept.map(packLevelCell));
    for (const levelMap of this.tiles.values()) {
      for (const tile of levelMap.values()) {
        if (!tile.sprite) continue;
        if (!keptSet.has(packLevelCell(tile))) this.freeTile(tile);
      }
    }

    this.evictOverBudget(neededSet);
  }

  private async hydrateTile(tile: Tile): Promise<void> {
    tile.hydrating = true;
    this.inFlight++;
    const version = tile.version;
    const url = this.deps.urlFor(tile.level, tile.wireCellKey, version);
    const texture = await this.deps.loadTexture(url);
    this.inFlight--;
    tile.hydrating = false;
    const stillMine = this.tiles.get(tile.level)?.get(packCell(tile.cx, tile.cy)) === tile;
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
      void Assets.unload(this.deps.urlFor(tile.level, tile.wireCellKey, oldVersion));
    }
  }

  private freeTile(tile: Tile): void {
    if (!tile.sprite) return;
    this.deps.container.removeChild(tile.sprite);
    tile.sprite.destroy();
    tile.sprite = null;
    tile.bytes = 0;
    void Assets.unload(this.deps.urlFor(tile.level, tile.wireCellKey, tile.appliedVersion));
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
    for (const levelMap of this.tiles.values()) {
      for (const tile of levelMap.values()) {
        if (!tile.sprite) continue;
        total += tile.bytes;
        if (!neededSet.has(packLevelCell(tile))) candidates.push(tile);
      }
    }
    if (total <= budget) return;
    candidates.sort((a, b) => a.lru - b.lru);
    for (const tile of candidates) {
      if (total <= budget) break;
      total -= tile.bytes;
      this.freeTile(tile);
    }
  }

  // Current resident bytes across every level, for the minimap detail
  // modal's memory readout (see PuzzleStage.getMemoryStats).
  residentBytes(): number {
    let total = 0;
    for (const levelMap of this.tiles.values()) {
      for (const tile of levelMap.values()) total += tile.bytes;
    }
    return total;
  }

  budgetBytes(): number {
    return COMPOSITE_VRAM_BUDGET_MB * 1e6;
  }

  clear(): void {
    for (const levelMap of this.tiles.values()) {
      for (const tile of levelMap.values()) this.freeTile(tile);
    }
    this.tiles.clear();
    this.currentLevel = -1;
  }
}

// Packs a LevelCell into one Set-friendly number (level is tiny, 0..3, so
// this never collides with packCell's own range).
function packLevelCell(c: { level: number; cx: number; cy: number }): number {
  return packCell(c.cx, c.cy) * 4 + c.level;
}
