// Zoom-out level-of-detail tile cache. The whole play zone is covered by a grid
// of small render-texture tiles, baked on demand from the live scene, cached,
// and invalidated per tile. Per-piece texel density is constant regardless of
// board size, and both VRAM and per-frame work are bounded by the visible window
// (the resident tile set), not by the board. The grid pitch is LOD_TILE_WORLD,
// so a tile key is a GroupGrid cell key: a group's cells are exactly its tiles.
//
// The stage owns the per-tile scene render (it knows groups, held clusters, the
// frame and the backdrop); this layer owns tile geometry, texture lifecycle,
// sprites, the resident-set budget, and dirty/ready bookkeeping.

import { Container, Matrix, RenderTexture, Sprite } from "pixi.js";
import type { PlayZone } from "@mpp/shared";
import type { Aabb, Viewport } from "./cull";
import { LOD_TILE_WORLD, cellKeysForRect, unpackCell, type CellKey } from "./groupGrid";

// Device texels per world pixel. ~1.5x sharper than a screen device pixel at
// MIN_ZOOM (vs ~0.05 for a single play-zone texture on the alpha board), the
// sharpness/VRAM knob. dpr is folded into the texel count, so this ratio is
// device-independent and only the texture size (VRAM) grows with dpr.
const LOD_TILE_DENSITY = 0.22;
// Extra ring of tiles kept resident around the viewport so a pan reveals cached
// tiles instead of baking on the critical path.
const LOD_TILE_MARGIN_FRAC = 0.25;
// Comfort floor for the resident set: the LRU keeps at least this many tiles, on
// top of the screen-cover floor below, never fewer.
const LOD_VRAM_BUDGET_MB = 256;
// Hard safety ceiling. These tiles sit on top of the live per-piece textures, so
// the screen-cover floor must fit well under the WebGL context limit. On an
// extreme display the density is degraded until it does, accepting softer tiles
// over context loss (exceeding VRAM) or thrash (evicting a needed tile).
const LOD_VRAM_CEILING_MB = 768;
const LOD_MIN_DENSITY = 0.05;

type Tile = {
  key: CellKey;
  texture: RenderTexture;
  sprite: Sprite;
  // World space to texture space, the root transform for this tile's bake.
  matrix: Matrix;
  ready: boolean;
  lru: number;
};

export class LodTileLayer {
  readonly container: Container;
  private readonly zone: PlayZone;
  private readonly dpr: number;
  private readonly tiles = new Map<CellKey, Tile>();
  private lruClock = 0;

  // Sizing, (re)computed in configure().
  private texels = 1;
  private effDensity = LOD_TILE_DENSITY;
  private bytesPerTile = 4;
  private screenCoverTiles = 1;
  private maxResident = 1;

  constructor(zone: PlayZone, dpr: number) {
    this.zone = zone;
    this.dpr = dpr;
    this.container = new Container();
    this.container.eventMode = "none";
    this.container.visible = false;
  }

  // Sizes the tile texture and the resident-set cap for the current screen. The
  // resident cap is max(budget tiles, screen-cover tiles): the screen-cover floor
  // guarantees a currently-needed tile is never evicted (no re-bake thrash), even
  // when it pushes the resident set above the comfort budget. Recompute on resize.
  configure(screenW: number, screenH: number, minZoom: number): void {
    const prevTexels = this.texels;
    this.screenCoverTiles = this.computeScreenCover(screenW, screenH, minZoom);

    // Density is the only VRAM-effective knob: shrinking the tile world size
    // would keep the total screen-cover texel count constant, so only density is
    // degraded to fit the ceiling, which also keeps the tile grid aligned with
    // the GroupGrid cell grid.
    let density = LOD_TILE_DENSITY;
    let texels = this.texelsFor(density);
    while (
      this.screenCoverTiles * bytesFor(texels) > LOD_VRAM_CEILING_MB * 1e6 &&
      density > LOD_MIN_DENSITY
    ) {
      density = Math.max(LOD_MIN_DENSITY, density * 0.85);
      texels = this.texelsFor(density);
    }

    this.texels = texels;
    this.effDensity = texels / LOD_TILE_WORLD;
    this.bytesPerTile = bytesFor(texels);
    const tilesFromBudget = Math.floor((LOD_VRAM_BUDGET_MB * 1e6) / this.bytesPerTile);
    this.maxResident = Math.max(tilesFromBudget, this.screenCoverTiles);

    // A density change resized the texture; existing tiles are stale-sized.
    if (texels !== prevTexels) this.clearTiles();
  }

  // Tile keys whose world cell overlaps the viewport plus a margin ring,
  // restricted to cells that overlap the play zone (empty backdrop is not baked).
  neededTiles(view: Viewport): CellKey[] {
    const mx = view.worldW * LOD_TILE_MARGIN_FRAC;
    const my = view.worldH * LOD_TILE_MARGIN_FRAC;
    const box: Aabb = {
      minX: view.worldX - mx,
      minY: view.worldY - my,
      maxX: view.worldX + view.worldW + mx,
      maxY: view.worldY + view.worldH + my,
    };
    const out: CellKey[] = [];
    for (const key of cellKeysForRect(box, LOD_TILE_WORLD)) {
      if (this.cellOverlapsZone(key)) out.push(key);
    }
    return out;
  }

  isReady(key: CellKey): boolean {
    return this.tiles.get(key)?.ready === true;
  }

  // Current resident tile bytes and the nominal soft budget, for the minimap
  // detail modal's memory readout. Reports the configured LOD_VRAM_BUDGET_MB
  // rather than the screen-cover-adjusted maxResident, so the readout stays a
  // stable reference point rather than shifting with viewport size.
  residentBytes(): number {
    return this.tiles.size * this.bytesPerTile;
  }

  budgetBytes(): number {
    return LOD_VRAM_BUDGET_MB * 1e6;
  }

  // Ensures the tile is resident and returns its bake target. The stage renders
  // the tile's groups into it, then calls markBaked.
  prepareBake(key: CellKey): { texture: RenderTexture; matrix: Matrix } | null {
    const tile = this.tiles.get(key) ?? this.createTile(key);
    tile.lru = ++this.lruClock;
    return { texture: tile.texture, matrix: tile.matrix };
  }

  markBaked(key: CellKey): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    tile.ready = true;
    tile.sprite.visible = true;
    tile.lru = ++this.lruClock;
  }

  // Marks the resident tile for one cell stale, if present. A stale tile hides its
  // sprite; the bake queue re-bakes it while it stays in view. The stage coalesces a
  // frame's dirty rects to cells, so each touched tile is invalidated once.
  markDirtyCell(key: CellKey): void {
    const tile = this.tiles.get(key);
    if (tile) this.markTileDirty(tile);
  }

  // Marks every resident tile stale, forcing a full re-bake. Used when a global
  // bake input changes rather than one cell, e.g. the dynamic-loading gate.
  markAllDirty(): void {
    for (const tile of this.tiles.values()) this.markTileDirty(tile);
  }

  // World rectangle of one tile cell, for the stage to query the cell's groups.
  cellRect(key: CellKey): Aabb {
    const { cx, cy } = unpackCell(key);
    const minX = cx * LOD_TILE_WORLD;
    const minY = cy * LOD_TILE_WORLD;
    return { minX, minY, maxX: minX + LOD_TILE_WORLD, maxY: minY + LOD_TILE_WORLD };
  }

  // Marks needed tiles recently used, then evicts the least-recently-used tiles
  // beyond the resident cap. Needed tiles are never evicted (cap >= screen-cover),
  // nor are pinned ones: a pin is a player-chosen exemption from the LRU budget.
  cull(view: Viewport, pinned: ReadonlySet<CellKey>): void {
    const needed = new Set(this.neededTiles(view));
    for (const key of needed) {
      const tile = this.tiles.get(key);
      if (tile) tile.lru = ++this.lruClock;
    }
    if (this.tiles.size <= this.maxResident) return;
    const evictable = [...this.tiles.values()]
      .filter((t) => !needed.has(t.key) && !pinned.has(t.key))
      .sort((a, b) => a.lru - b.lru);
    let over = this.tiles.size - this.maxResident;
    for (const tile of evictable) {
      if (over-- <= 0) break;
      this.destroyTile(tile);
    }
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  destroy(): void {
    this.clearTiles();
    this.container.destroy({ children: true });
  }

  private markTileDirty(tile: Tile): void {
    tile.ready = false;
    tile.sprite.visible = false;
  }

  private createTile(key: CellKey): Tile {
    const { cx, cy } = unpackCell(key);
    const originX = cx * LOD_TILE_WORLD;
    const originY = cy * LOD_TILE_WORLD;
    // dpr is folded into the texel count at resolution 1, so the bake matches the
    // existing render-to-texture path exactly regardless of target resolution.
    const texture = RenderTexture.create({
      width: this.texels,
      height: this.texels,
      resolution: 1,
      antialias: true,
    });
    const sprite = new Sprite(texture);
    sprite.eventMode = "none";
    sprite.position.set(originX, originY);
    const spriteScale = LOD_TILE_WORLD / this.texels;
    sprite.scale.set(spriteScale, spriteScale);
    sprite.visible = false;
    this.container.addChild(sprite);
    const matrix = new Matrix(
      this.effDensity,
      0,
      0,
      this.effDensity,
      -originX * this.effDensity,
      -originY * this.effDensity,
    );
    const tile: Tile = { key, texture, sprite, matrix, ready: false, lru: ++this.lruClock };
    this.tiles.set(key, tile);
    return tile;
  }

  private destroyTile(tile: Tile): void {
    tile.sprite.destroy();
    tile.texture.destroy(true);
    this.tiles.delete(tile.key);
  }

  private clearTiles(): void {
    for (const tile of [...this.tiles.values()]) this.destroyTile(tile);
  }

  private cellOverlapsZone(key: CellKey): boolean {
    const { cx, cy } = unpackCell(key);
    const minX = cx * LOD_TILE_WORLD;
    const minY = cy * LOD_TILE_WORLD;
    return (
      minX < this.zone.maxX &&
      minX + LOD_TILE_WORLD > this.zone.minX &&
      minY < this.zone.maxY &&
      minY + LOD_TILE_WORLD > this.zone.minY
    );
  }

  private texelsFor(density: number): number {
    return Math.max(1, Math.round(LOD_TILE_WORLD * density * this.dpr));
  }

  private computeScreenCover(screenW: number, screenH: number, minZoom: number): number {
    return tilesAcross(screenW / minZoom) * tilesAcross(screenH / minZoom);
  }
}

function bytesFor(texels: number): number {
  return texels * texels * 4;
}

// Worst-case tile count a world span overlaps once expanded by the margin ring:
// the +1 covers a span straddling one extra cell from arbitrary grid alignment.
function tilesAcross(span: number): number {
  const expanded = span * (1 + 2 * LOD_TILE_MARGIN_FRAC);
  return Math.ceil(expanded / LOD_TILE_WORLD) + 1;
}
