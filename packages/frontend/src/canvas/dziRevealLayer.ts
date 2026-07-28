// Spike-only (see ROADMAP backlog: DZI native in Pixi). Used instead of
// CompositeTileLayer when ?dziReveal=1 is set: no server-baked AVIF, no R2
// dependency, no cellCompositor involvement at all.
//
// Two independent concerns, deliberately not tied to the same grid:
// - The DZI background is a standard deep-zoom tile layer (own native grid,
//   own level chosen from the current camera zoom, see dziTiles.ts's
//   levelForZoom), fetching only whatever the viewport needs at whatever
//   detail the current zoom warrants, exactly like any map/deep-zoom viewer.
//   An earlier version of this file tied DZI tiles to the 2048-unit
//   composite cell grid at one fixed level: cheap to build, but a fixed
//   level never sharpens on zoom-in, and a real fix would have meant
//   stitching dozens of native tiles per cell at fine zoom for no benefit (a
//   native tile only ever needs fetching and drawing once, at its own
//   position, regardless of which cells it happens to overlap).
// - What of that background is actually visible is a single mask built from
//   locked pieces' own rectangular bounds (see puzzleStage.ts's
//   LockedPieceSlot): no curvy silhouette, no seam lines between adjacent
//   pieces yet (out of scope until this core mechanism is validated). Pieces
//   tile the plane with no gaps, so a solid locked region still reads as one
//   seamless revealed area with no border drawn.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Aabb } from "./cull";
import { dziTilesForRect, levelForZoom, type DziInfo } from "./dziTiles";

const DZI_VRAM_BUDGET_MB = 128;
const DZI_MAX_INFLIGHT = 8;

type Tile = {
  key: string;
  level: number;
  bounds: Aabb;
  sprite: Sprite | null;
  hydrating: boolean;
  lru: number;
};

export type DziRevealLayerDeps = {
  container: Container;
  loadTexture: (url: string) => Promise<Texture | null>;
  dziInfo: DziInfo;
  dziBaseUrl: string;
  // Locked piece ids known within a world rect (see puzzleStage.ts's
  // lockedPieceGrid.queryRect) and a piece's own world rect (see
  // puzzleStage.ts's lockedPieces map).
  lockedIdsInRect: (bounds: Aabb) => ReadonlySet<number>;
  lockedPieceBounds: (id: number) => Aabb | undefined;
};

function rectContains(outer: Aabb, inner: Aabb): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function rectsOverlap(a: Aabb, b: Aabb): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export class DziRevealLayer {
  private readonly tileContainer: Container;
  private readonly tiles = new Map<string, Tile>();
  private lruClock = 0;
  private inFlight = 0;
  private mask: Graphics | null = null;
  private maskCoveredRect: Aabb | null = null;
  private maskedCount = -1;

  constructor(private readonly deps: DziRevealLayerDeps) {
    this.tileContainer = new Container();
    this.deps.container.addChild(this.tileContainer);
  }

  reconcile(hydrateRing: Aabb, keepRing: Aabb, zoom: number): void {
    const level = levelForZoom(this.deps.dziInfo, zoom);
    const needed = dziTilesForRect(this.deps.dziInfo, level, hydrateRing, this.deps.dziBaseUrl);

    const neededSet = new Set(needed.map((t) => `${level}:${t.col}:${t.row}`));
    for (const t of needed) {
      const key = `${level}:${t.col}:${t.row}`;
      let tile = this.tiles.get(key);
      if (!tile) {
        tile = { key, level, bounds: t.worldRect, sprite: null, hydrating: false, lru: 0 };
        this.tiles.set(key, tile);
      }
      tile.lru = ++this.lruClock;
      if (!tile.sprite && !tile.hydrating && this.inFlight < DZI_MAX_INFLIGHT) {
        void this.hydrateTile(tile, t.url);
      }
    }

    // Eviction here is spatial only, at any level: a tile from the
    // previous level stays as a visible fallback (Pixi draws it under
    // whatever newer tile lands on top, since addChild always appends)
    // until the current level's replacement has actually loaded, instead of
    // flashing blank on every zoom step that crosses a level boundary. It is
    // still cleared eventually by evictOverBudget below, since it is never
    // part of neededSet once its level is stale.
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      if (!rectsOverlap(tile.bounds, keepRing)) this.freeTile(tile);
    }

    this.evictOverBudget(neededSet);
    this.updateMask(hydrateRing, keepRing);
  }

  private async hydrateTile(tile: Tile, url: string): Promise<void> {
    tile.hydrating = true;
    this.inFlight++;
    const texture = await this.deps.loadTexture(url);
    this.inFlight--;
    tile.hydrating = false;
    if (!texture || this.tiles.get(tile.key) !== tile) return;
    const sprite = new Sprite(texture);
    sprite.x = tile.bounds.minX;
    sprite.y = tile.bounds.minY;
    sprite.width = tile.bounds.maxX - tile.bounds.minX;
    sprite.height = tile.bounds.maxY - tile.bounds.minY;
    this.tileContainer.addChild(sprite);
    tile.sprite = sprite;
    tile.lru = ++this.lruClock;
  }

  private freeTile(tile: Tile): void {
    if (!tile.sprite) return;
    this.tileContainer.removeChild(tile.sprite);
    tile.sprite.destroy();
    tile.sprite = null;
    if (!tile.hydrating) this.tiles.delete(tile.key);
  }

  private evictOverBudget(neededSet: ReadonlySet<string>): void {
    const budget = DZI_VRAM_BUDGET_MB * 1e6;
    const candidates: Tile[] = [];
    let total = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      const tex = tile.sprite.texture;
      total += tex.width * tex.height * 4;
      if (!neededSet.has(tile.key)) candidates.push(tile);
    }
    if (total <= budget) return;
    candidates.sort((a, b) => a.lru - b.lru);
    for (const tile of candidates) {
      if (total <= budget) break;
      const tex = tile.sprite!.texture;
      total -= tex.width * tex.height * 4;
      this.freeTile(tile);
    }
  }

  // Rebuilt only when the last mask no longer covers the hydrate ring (a
  // meaningful pan/zoom) or the locked count within the wider keep ring
  // changed (a new lock), the same hysteresis idiom compositeTiles.ts's
  // hydrate/keep rings use: a mask covering thousands of locked pieces is not
  // free to rebuild, so a still camera with no new locks should not pay it
  // every frame.
  private updateMask(hydrateRing: Aabb, keepRing: Aabb): void {
    const ids = this.deps.lockedIdsInRect(keepRing);
    const ringStale = !this.maskCoveredRect || !rectContains(this.maskCoveredRect, hydrateRing);
    if (!ringStale && ids.size === this.maskedCount) return;
    const g = new Graphics();
    for (const id of ids) {
      const bounds = this.deps.lockedPieceBounds(id);
      if (!bounds) continue;
      g.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }
    g.fill(0xffffff);
    this.tileContainer.mask = g;
    this.mask?.destroy();
    this.mask = g;
    this.maskCoveredRect = keepRing;
    this.maskedCount = ids.size;
  }

  residentBytes(): number {
    let total = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.sprite) continue;
      const tex = tile.sprite.texture;
      total += tex.width * tex.height * 4;
    }
    return total;
  }

  budgetBytes(): number {
    return DZI_VRAM_BUDGET_MB * 1e6;
  }

  clear(): void {
    for (const tile of this.tiles.values()) this.freeTile(tile);
    this.tiles.clear();
    this.tileContainer.mask = null;
    this.mask?.destroy();
    this.mask = null;
    this.maskCoveredRect = null;
    this.maskedCount = -1;
  }
}
