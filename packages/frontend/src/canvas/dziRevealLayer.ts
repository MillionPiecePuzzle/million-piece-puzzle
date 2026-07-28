// Spike-only (see ROADMAP backlog: DZI native in Pixi). Used instead of
// CompositeTileLayer when ?dziReveal=1 is set: no server-baked full-photo
// AVIF, no per-cell cellCompositor RGB compositing. The server still bakes
// (and this layer still fetches) two small per-cell textures derived straight
// from geometry: a silhouette mask and a seam (border-only) overlay (see
// DECISIONS: DZI reveal mask/seam bake) - both far cheaper than the photo
// composite CompositeTileLayer fetches, since neither needs a single piece
// tile byte, only the server's already-in-process generationSeed.
//
// Three independent concerns, deliberately not tied to the same lifecycle:
// - The DZI background is a standard deep-zoom tile layer (own native grid,
//   own level chosen from the current camera zoom, see dziTiles.ts's
//   levelForZoom), fetching only whatever the viewport needs at whatever
//   detail the current zoom warrants, exactly like any map/deep-zoom viewer.
// - The reveal mask is real per-piece silhouette geometry, but rasterized
//   server-side per cell (same LOD_TILE_WORLD grid CompositeTileLayer already
//   uses): a piece's tab can bulge past its own nominal box, so masking by a
//   piece's rectangular bounds (an earlier version of this file did exactly
//   that) still shows a straight edge at a partially-locked cell's frontier,
//   the same "flat rectangle" symptom this bake exists to remove. Since Pixi
//   only respects a texture's actual alpha channel when the mask is a single
//   Sprite (see AlphaMask.test in pixi.js's own mask effects: a Sprite inside
//   a plain Container falls back to StencilMask instead, which only tests
//   "did this sprite's rectangular quad draw here", not its sampled alpha -
//   silently reproducing the exact rectangle bug), every currently-hydrated
//   per-cell mask sprite is combined into one RenderTexture (mirroring
//   LodTileLayer's own bake-to-texture technique) and that one combined
//   Sprite is what actually gets assigned as tileContainer.mask.
// - The seam overlay draws directly on top, unmasked: the server only ever
//   strokes a border where a piece is actually locked, so it never paints
//   outside a valid reveal region on its own.

import { Container, Matrix, RenderTexture, Sprite, type Texture } from "pixi.js";
import type { Aabb } from "./cull";
import { neededCompositeTiles } from "./compositeTiles";
import { LOD_TILE_WORLD, packCell, unpackWireCellKey, type CellKey } from "./groupGrid";
import { dziTilesForRect, levelForZoom, type DziInfo } from "./dziTiles";

const DZI_VRAM_BUDGET_MB = 128;
const DZI_MAX_INFLIGHT = 8;
const CELL_ASSET_VRAM_BUDGET_MB = 64;
const CELL_ASSET_MAX_INFLIGHT = 8;
// Safety cap on the combined mask's own texel dimensions: texelsPerWorldUnit
// already shrinks with zoom (see updateCombinedMask), so this only guards
// against a pathological hydrate ring, never fires in ordinary play.
const MAX_MASK_TEXELS = 2048;

type DziTile = {
  key: string;
  level: number;
  bounds: Aabb;
  sprite: Sprite | null;
  hydrating: boolean;
  lru: number;
};

// One cell's mask + seam assets, on the same LOD_TILE_WORLD grid and the same
// {cellKey, version} facts CompositeTileLayer tracks (see reportVersion).
type CellAsset = {
  cx: number;
  cy: number;
  wireCellKey: number;
  bounds: Aabb;
  version: number;
  maskAppliedVersion: number;
  seamAppliedVersion: number;
  maskSprite: Sprite | null;
  seamSprite: Sprite | null;
  maskHydrating: boolean;
  seamHydrating: boolean;
  lru: number;
};

export type DziRevealLayerDeps = {
  container: Container;
  loadTexture: (url: string) => Promise<Texture | null>;
  dziInfo: DziInfo;
  dziBaseUrl: string;
  // Same cell canvas widening the server bakes with (see cellCompositor.ts),
  // needed to place a cell's mask/seam sprite at its true bleed-inclusive
  // bounds, exactly like CompositeTileLayer's own margin dep.
  margin: number;
  maskUrlFor: (wireCellKey: number, version: number) => string;
  seamUrlFor: (wireCellKey: number, version: number) => string;
  // Renders `source` into `target` using `transform`, the same trampoline
  // shape puzzleStage.ts already uses for LodTileLayer's own bakes
  // (app.renderer.render({ container, target, transform })), kept as an
  // injected callback so this layer never needs the renderer itself.
  renderToTexture: (source: Container, target: RenderTexture, transform: Matrix) => void;
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
  private readonly seamContainer: Container;
  // Never added to deps.container: exists only as a render source for the
  // combined mask bake below, never drawn directly by the normal scene walk.
  private readonly maskSourceContainer: Container;

  private readonly dziTiles = new Map<string, DziTile>();
  private readonly cellAssets = new Map<CellKey, CellAsset>();
  private lruClock = 0;
  private dziInFlight = 0;
  private maskInFlight = 0;
  private seamInFlight = 0;

  private maskTexture: RenderTexture | null = null;
  private maskSprite: Sprite | null = null;
  private maskCoveredRect: Aabb | null = null;
  // Bumped on every mask sprite (re)hydrate; a combined bake remembers which
  // generation it last used, so an unchanged input skips a re-render even
  // when the ring-staleness check alone would not have caught it.
  private maskGeneration = 0;
  private lastBakedGeneration = -1;

  constructor(private readonly deps: DziRevealLayerDeps) {
    this.tileContainer = new Container();
    this.deps.container.addChild(this.tileContainer);
    this.seamContainer = new Container();
    this.deps.container.addChild(this.seamContainer);
    this.maskSourceContainer = new Container();
  }

  // Records or bumps one cell's known mask/seam version, mirroring
  // CompositeTileLayer.reportVersion exactly (same wire facts, same
  // upsert-a-fact-let-reconcile-decide shape).
  reportVersion(wireCellKey: number, version: number): void {
    const { cx, cy } = unpackWireCellKey(wireCellKey);
    const key = packCell(cx, cy);
    const existing = this.cellAssets.get(key);
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
    this.cellAssets.set(key, {
      cx,
      cy,
      wireCellKey,
      bounds,
      version,
      maskAppliedVersion: 0,
      seamAppliedVersion: 0,
      maskSprite: null,
      seamSprite: null,
      maskHydrating: false,
      seamHydrating: false,
      lru: 0,
    });
  }

  reconcile(hydrateRing: Aabb, keepRing: Aabb, zoom: number): void {
    const level = levelForZoom(this.deps.dziInfo, zoom);
    this.reconcileDziTiles(hydrateRing, keepRing, level);
    this.reconcileCellAssets(hydrateRing, keepRing);
    this.updateCombinedMask(hydrateRing, keepRing, level);
  }

  private reconcileDziTiles(hydrateRing: Aabb, keepRing: Aabb, level: number): void {
    const needed = dziTilesForRect(this.deps.dziInfo, level, hydrateRing, this.deps.dziBaseUrl);

    const neededSet = new Set(needed.map((t) => `${level}:${t.col}:${t.row}`));
    for (const t of needed) {
      const key = `${level}:${t.col}:${t.row}`;
      let tile = this.dziTiles.get(key);
      if (!tile) {
        tile = { key, level, bounds: t.worldRect, sprite: null, hydrating: false, lru: 0 };
        this.dziTiles.set(key, tile);
      }
      tile.lru = ++this.lruClock;
      if (!tile.sprite && !tile.hydrating && this.dziInFlight < DZI_MAX_INFLIGHT) {
        void this.hydrateDziTile(tile, t.url);
      }
    }

    // Eviction here is spatial only, at any level: a tile from the
    // previous level stays as a visible fallback (Pixi draws it under
    // whatever newer tile lands on top, since addChild always appends)
    // until the current level's replacement has actually loaded, instead of
    // flashing blank on every zoom step that crosses a level boundary. It is
    // still cleared eventually by evictOverBudget below, since it is never
    // part of neededSet once its level is stale.
    for (const tile of this.dziTiles.values()) {
      if (!tile.sprite) continue;
      if (!rectsOverlap(tile.bounds, keepRing)) this.freeDziTile(tile);
    }

    this.evictDziTilesOverBudget(neededSet);
  }

  private async hydrateDziTile(tile: DziTile, url: string): Promise<void> {
    tile.hydrating = true;
    this.dziInFlight++;
    const texture = await this.deps.loadTexture(url);
    this.dziInFlight--;
    tile.hydrating = false;
    if (!texture || this.dziTiles.get(tile.key) !== tile) return;
    const sprite = new Sprite(texture);
    sprite.x = tile.bounds.minX;
    sprite.y = tile.bounds.minY;
    sprite.width = tile.bounds.maxX - tile.bounds.minX;
    sprite.height = tile.bounds.maxY - tile.bounds.minY;
    this.tileContainer.addChild(sprite);
    tile.sprite = sprite;
    tile.lru = ++this.lruClock;
  }

  private freeDziTile(tile: DziTile): void {
    if (!tile.sprite) return;
    this.tileContainer.removeChild(tile.sprite);
    tile.sprite.destroy();
    tile.sprite = null;
    if (!tile.hydrating) this.dziTiles.delete(tile.key);
  }

  private evictDziTilesOverBudget(neededSet: ReadonlySet<string>): void {
    const budget = DZI_VRAM_BUDGET_MB * 1e6;
    const candidates: DziTile[] = [];
    let total = 0;
    for (const tile of this.dziTiles.values()) {
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
      this.freeDziTile(tile);
    }
  }

  private reconcileCellAssets(hydrateRing: Aabb, keepRing: Aabb): void {
    const needed = neededCompositeTiles(hydrateRing);
    const kept = neededCompositeTiles(keepRing);
    const neededSet = new Set(needed.map((c) => packCell(c.cx, c.cy)));
    const keptSet = new Set(kept.map((c) => packCell(c.cx, c.cy)));

    for (const cell of needed) {
      const tile = this.cellAssets.get(packCell(cell.cx, cell.cy));
      if (!tile) continue; // no reportVersion yet for this cell
      tile.lru = ++this.lruClock;
      if (
        tile.version > tile.maskAppliedVersion &&
        !tile.maskHydrating &&
        this.maskInFlight < CELL_ASSET_MAX_INFLIGHT
      ) {
        void this.hydrateMask(tile);
      }
      if (
        tile.version > tile.seamAppliedVersion &&
        !tile.seamHydrating &&
        this.seamInFlight < CELL_ASSET_MAX_INFLIGHT
      ) {
        void this.hydrateSeam(tile);
      }
    }

    for (const tile of this.cellAssets.values()) {
      if (!keptSet.has(packCell(tile.cx, tile.cy))) this.freeCellAsset(tile);
    }

    this.evictCellAssetsOverBudget(neededSet);
  }

  private async hydrateMask(tile: CellAsset): Promise<void> {
    tile.maskHydrating = true;
    this.maskInFlight++;
    const version = tile.version;
    const url = this.deps.maskUrlFor(tile.wireCellKey, version);
    const texture = await this.deps.loadTexture(url);
    this.maskInFlight--;
    tile.maskHydrating = false;
    const stillMine = this.cellAssets.get(packCell(tile.cx, tile.cy)) === tile;
    if (!texture || !stillMine) return;
    const oldSprite = tile.maskSprite;
    const sprite = new Sprite(texture);
    sprite.x = tile.bounds.minX;
    sprite.y = tile.bounds.minY;
    sprite.width = tile.bounds.maxX - tile.bounds.minX;
    sprite.height = tile.bounds.maxY - tile.bounds.minY;
    this.maskSourceContainer.addChild(sprite);
    tile.maskSprite = sprite;
    tile.maskAppliedVersion = version;
    tile.lru = ++this.lruClock;
    this.maskGeneration++;
    if (oldSprite) {
      this.maskSourceContainer.removeChild(oldSprite);
      oldSprite.destroy();
    }
  }

  private async hydrateSeam(tile: CellAsset): Promise<void> {
    tile.seamHydrating = true;
    this.seamInFlight++;
    const version = tile.version;
    const url = this.deps.seamUrlFor(tile.wireCellKey, version);
    const texture = await this.deps.loadTexture(url);
    this.seamInFlight--;
    tile.seamHydrating = false;
    const stillMine = this.cellAssets.get(packCell(tile.cx, tile.cy)) === tile;
    if (!texture || !stillMine) return;
    const oldSprite = tile.seamSprite;
    const sprite = new Sprite(texture);
    sprite.x = tile.bounds.minX;
    sprite.y = tile.bounds.minY;
    sprite.width = tile.bounds.maxX - tile.bounds.minX;
    sprite.height = tile.bounds.maxY - tile.bounds.minY;
    this.seamContainer.addChild(sprite);
    tile.seamSprite = sprite;
    tile.seamAppliedVersion = version;
    tile.lru = ++this.lruClock;
    if (oldSprite) {
      this.seamContainer.removeChild(oldSprite);
      oldSprite.destroy();
    }
  }

  private freeCellAsset(tile: CellAsset): void {
    if (tile.maskSprite) {
      this.maskSourceContainer.removeChild(tile.maskSprite);
      tile.maskSprite.destroy();
      tile.maskSprite = null;
      tile.maskAppliedVersion = 0;
      this.maskGeneration++;
    }
    if (tile.seamSprite) {
      this.seamContainer.removeChild(tile.seamSprite);
      tile.seamSprite.destroy();
      tile.seamSprite = null;
      tile.seamAppliedVersion = 0;
    }
  }

  private evictCellAssetsOverBudget(neededSet: ReadonlySet<CellKey>): void {
    const budget = CELL_ASSET_VRAM_BUDGET_MB * 1e6;
    const candidates: CellAsset[] = [];
    let total = 0;
    for (const tile of this.cellAssets.values()) {
      if (tile.maskSprite) total += tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite) total += tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
      if ((tile.maskSprite || tile.seamSprite) && !neededSet.has(packCell(tile.cx, tile.cy))) {
        candidates.push(tile);
      }
    }
    if (total <= budget) return;
    candidates.sort((a, b) => a.lru - b.lru);
    for (const tile of candidates) {
      if (total <= budget) break;
      if (tile.maskSprite) total -= tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite) total -= tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
      this.freeCellAsset(tile);
    }
  }

  // Combines every currently-hydrated per-cell mask sprite into one
  // RenderTexture and assigns a single Sprite of it as tileContainer.mask:
  // the only way to get Pixi's real per-pixel AlphaMask instead of a coarse
  // per-sprite-quad StencilMask (see this file's own header comment).
  // Rebuilt only when the last bake no longer covers the hydrate ring (a
  // meaningful pan/zoom) or a mask sprite (re)hydrated since (maskGeneration),
  // the same hysteresis idiom compositeTiles.ts's hydrate/keep rings use: a
  // render-to-texture pass is not free enough to redo every frame.
  private updateCombinedMask(hydrateRing: Aabb, keepRing: Aabb, level: number): void {
    const ringStale = !this.maskCoveredRect || !rectContains(this.maskCoveredRect, hydrateRing);
    if (!ringStale && this.maskGeneration === this.lastBakedGeneration) return;

    const worldW = keepRing.maxX - keepRing.minX;
    const worldH = keepRing.maxY - keepRing.minY;
    // One native DZI pixel maps to one world unit at dziInfo.maxLevel (see
    // dziTiles.ts), so this is exactly the texel density the photo tiles
    // themselves render at, at the current level: the mask is never blurrier
    // or sharper than the content it is masking.
    const texelsPerWorldUnit = 2 ** (level - this.deps.dziInfo.maxLevel);
    const texW = Math.min(MAX_MASK_TEXELS, Math.max(1, Math.ceil(worldW * texelsPerWorldUnit)));
    const texH = Math.min(MAX_MASK_TEXELS, Math.max(1, Math.ceil(worldH * texelsPerWorldUnit)));

    if (!this.maskTexture || this.maskTexture.width !== texW || this.maskTexture.height !== texH) {
      this.maskTexture?.destroy(true);
      this.maskTexture = RenderTexture.create({
        width: texW,
        height: texH,
        resolution: 1,
        antialias: true,
      });
      this.maskSprite = new Sprite(this.maskTexture);
    }
    const sprite = this.maskSprite!;
    // Positioned in the same world-coordinate convention the old rectangular
    // Graphics mask used (no parent of its own, plain world-space x/y/width/
    // height against the same tileContainer it masks): already verified
    // aligned correctly at this layer's original prototyping, so the new
    // Sprite-based mask follows the identical convention rather than
    // re-deriving Pixi's transform resolution from scratch.
    sprite.x = keepRing.minX;
    sprite.y = keepRing.minY;
    sprite.width = worldW;
    sprite.height = worldH;

    const sx = texW / worldW;
    const sy = texH / worldH;
    const transform = new Matrix(sx, 0, 0, sy, -keepRing.minX * sx, -keepRing.minY * sy);
    this.deps.renderToTexture(this.maskSourceContainer, this.maskTexture, transform);

    this.tileContainer.mask = sprite;
    this.maskCoveredRect = keepRing;
    this.lastBakedGeneration = this.maskGeneration;
  }

  residentBytes(): number {
    let total = 0;
    for (const tile of this.dziTiles.values()) {
      if (!tile.sprite) continue;
      const tex = tile.sprite.texture;
      total += tex.width * tex.height * 4;
    }
    for (const tile of this.cellAssets.values()) {
      if (tile.maskSprite) total += tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite) total += tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
    }
    if (this.maskTexture) total += this.maskTexture.width * this.maskTexture.height * 4;
    return total;
  }

  budgetBytes(): number {
    return (DZI_VRAM_BUDGET_MB + CELL_ASSET_VRAM_BUDGET_MB) * 1e6;
  }

  clear(): void {
    for (const tile of this.dziTiles.values()) this.freeDziTile(tile);
    this.dziTiles.clear();
    for (const tile of this.cellAssets.values()) this.freeCellAsset(tile);
    this.cellAssets.clear();
    this.tileContainer.mask = null;
    this.maskSprite?.destroy();
    this.maskSprite = null;
    this.maskTexture?.destroy(true);
    this.maskTexture = null;
    this.maskCoveredRect = null;
    this.maskGeneration = 0;
    this.lastBakedGeneration = -1;
  }
}
