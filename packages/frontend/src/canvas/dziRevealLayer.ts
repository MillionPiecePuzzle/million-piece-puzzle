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

import { Container, Matrix, Rectangle, RenderTexture, Sprite, type Texture } from "pixi.js";
import type { Aabb } from "./cull";
import { neededCompositeTiles } from "./compositeTiles";
import { LOD_TILE_WORLD, packCell, unpackWireCellKey, type CellKey } from "./groupGrid";
import { dziTilesForRect, levelForZoom, maskTierForZoom, pickBaseLevel, type DziInfo } from "./dziTiles";

// Each native DZI tile decodes to ~258KB (254px + 1px overlap, RGBA), so
// 256MB is headroom for roughly 1000 resident tiles at once: comfortably
// more than any single ring needs even at the finest reachable level (see
// levelForZoom), leaving slack for the estimate to be wrong without
// thrashing.
const DZI_VRAM_BUDGET_MB = 256;
const DZI_MAX_INFLIGHT = 8;
// A small, fixed-size deep-zoom viewport (this puzzle's own reference-image
// thumbnail) looks instant purely because a handful of coarse tiles already
// covers it. The main canvas has no such natural ceiling, so this caps how
// many tiles the base layer (see loadBaseLayer) is allowed to need to cover
// the WHOLE image: picked once via pickBaseLevel, fetched once, and kept
// resident for the rest of this layer's life. 64 tiles at ~254px each is a
// one-time, low-hundreds-of-KB cost regardless of source image size.
const BASE_LEVEL_MAX_TILES = 64;
// Rough fixed overhead for reporting purposes only (see budgetBytes): base
// tiles are never evicted, so unlike every other budget in this file this
// one is not an eviction threshold, just what residentBytes will include.
const BASE_LAYER_VRAM_BUDGET_MB = 16;
// Sized against LOD tiering (see dziTiles.ts's maskTierForZoom and its
// TIER_ZOOM_BREAKPOINTS), not native per-cell resolution: at native
// resolution a single cell's mask+seam pair alone is already ~33.6MB decoded
// ((cellSize+2*margin)^2*4*2 at the real 2048-unit cell/25px margin). With
// the breakpoints picking a coarser tier well before the ring gets big, the
// worst case at each band's own low-zoom edge (see dziTiles.ts's own
// comment) was already estimated to fit a 256MB budget, but only with ~12%
// headroom at the native-tier edge (~225MB of 256MB) - too tight given those
// ring-size numbers are estimates, not measured. Doubled for real slack: the
// same worst case now sits at ~44% of budget, room for the estimate to be
// off by roughly 2x before thrashing returns.
const CELL_ASSET_VRAM_BUDGET_MB = 512;
const CELL_ASSET_MAX_INFLIGHT = 16;
// Safety cap on the combined mask's own texel dimensions: texelsPerWorldUnit
// already shrinks with zoom (see updateCombinedMask), so this only guards
// against a pathological hydrate ring, never fires in ordinary play.
const MAX_MASK_TEXELS = 2048;
// Floor on how often a generation-only change re-renders the combined mask
// (see updateCombinedMask). A real ring move is never throttled by this: at
// real board scale, many cells can still be hydrating individually seconds
// after a pan lands, each bumping maskGeneration, and without this floor the
// full (up to MAX_MASK_TEXELS^2) re-render would fire on nearly every frame
// for that whole stretch instead of a real ring move.
const MIN_REBAKE_INTERVAL_MS = 200;

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
  // -1 (no real tier) so the very first hydrate always fires, regardless of
  // which tier turns out to be needed first.
  maskAppliedTier: number;
  seamAppliedTier: number;
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
  // tier indexes CELL_MASK_TIER_FACTORS (see dziTiles.ts's maskTierForZoom):
  // the client picks it from the current zoom, independently of anything
  // the server sends, so no wire protocol change is needed for it.
  maskUrlFor: (wireCellKey: number, version: number, tier: number) => string;
  seamUrlFor: (wireCellKey: number, version: number, tier: number) => string;
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
  // Child of tileContainer, added first (so it always stays at the bottom:
  // Pixi draws later-added children on top) and therefore covered by the
  // same tileContainer.mask every dynamic tile already is, with no separate
  // mask assignment needed. Holds the fixed base-level tiles loadBaseLayer
  // fetches once and never evicts (see BASE_LEVEL_MAX_TILES): the whole
  // point is that they are already there, on the very first frame, while
  // reconcileDziTiles's zoom-appropriate tiles are still streaming in on top.
  private readonly baseTileContainer: Container;
  private readonly seamContainer: Container;
  // Never added to deps.container: exists only as a render source for the
  // combined mask bake below, never drawn directly by the normal scene walk.
  private readonly maskSourceContainer: Container;

  private readonly dziTiles = new Map<string, DziTile>();
  private readonly baseTiles: Sprite[] = [];
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
  private lastBakeAtMs = -Infinity;

  constructor(private readonly deps: DziRevealLayerDeps) {
    this.tileContainer = new Container();
    // Overrides Pixi's own recursive bounds walk (getFastGlobalBoundsMixin):
    // without it, assigning tileContainer.mask routes through MaskFilter,
    // which hardcodes clipToViewport: false (FilterSystem's own bounds clip
    // is skipped), so the intermediate texture Pixi allocates for the mask
    // pass is sized to tileContainer's full recursive global bounds - which
    // include baseTileContainer's tiles, permanently resident and spanning
    // the WHOLE image regardless of camera position (see loadBaseLayer). At
    // low zoom that whole-image footprint is small on screen, but it scales
    // linearly with zoom like any other world-space content, so past a few
    // hundred percent it exceeds GL_MAX_TEXTURE_SIZE: the "texImage2D: width
    // or height out of range" / "Framebuffer is incomplete: Attachment has
    // zero size" crash reported at 500% zoom, a different failure mode than
    // the antialias/MSAA crashes already fixed at this same zoom range (see
    // DECISIONS), but the same underlying unbounded-mask-target root cause.
    // Kept in sync with keepRing every reconcile() (see below): nothing
    // outside keepRing is ever meant to be on screen, so clipping the mask's
    // render target to it costs no visible content.
    this.tileContainer.boundsArea = new Rectangle();
    this.deps.container.addChild(this.tileContainer);
    this.baseTileContainer = new Container();
    this.tileContainer.addChild(this.baseTileContainer);
    this.seamContainer = new Container();
    this.deps.container.addChild(this.seamContainer);
    this.maskSourceContainer = new Container();
    void this.loadBaseLayer();
  }

  // Fetches the whole image once, at whatever level needs at most
  // BASE_LEVEL_MAX_TILES tiles to cover it (see pickBaseLevel), and keeps
  // every tile resident for this layer's entire life: never touched by
  // reconcileDziTiles's ring-based hydrate/evict logic, since baseTiles is a
  // separate array evictDziTilesOverBudget never iterates. One-shot,
  // fire-and-forget from the constructor: nothing downstream awaits it,
  // reconcile() just finds more sprites in baseTileContainer as each
  // resolves, exactly like any other tile hydrate completing.
  private async loadBaseLayer(): Promise<void> {
    const { dziInfo, dziBaseUrl, loadTexture } = this.deps;
    const level = pickBaseLevel(dziInfo, BASE_LEVEL_MAX_TILES);
    const wholeImage: Aabb = { minX: 0, minY: 0, maxX: dziInfo.width, maxY: dziInfo.height };
    const tiles = dziTilesForRect(dziInfo, level, wholeImage, dziBaseUrl);
    await Promise.all(
      tiles.map(async (t) => {
        const texture = await loadTexture(t.url);
        if (!texture) return;
        const sprite = new Sprite(texture);
        sprite.x = t.worldRect.minX;
        sprite.y = t.worldRect.minY;
        sprite.width = t.worldRect.maxX - t.worldRect.minX;
        sprite.height = t.worldRect.maxY - t.worldRect.minY;
        this.baseTileContainer.addChild(sprite);
        this.baseTiles.push(sprite);
      }),
    );
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
      maskAppliedTier: -1,
      seamAppliedTier: -1,
      maskSprite: null,
      seamSprite: null,
      maskHydrating: false,
      seamHydrating: false,
      lru: 0,
    });
  }

  reconcile(hydrateRing: Aabb, keepRing: Aabb, zoom: number): void {
    const level = levelForZoom(this.deps.dziInfo, zoom);
    const tier = maskTierForZoom(zoom);
    const boundsArea = this.tileContainer.boundsArea;
    boundsArea.x = keepRing.minX;
    boundsArea.y = keepRing.minY;
    boundsArea.width = keepRing.maxX - keepRing.minX;
    boundsArea.height = keepRing.maxY - keepRing.minY;
    this.reconcileDziTiles(hydrateRing, keepRing, level);
    this.reconcileCellAssets(hydrateRing, keepRing, tier);
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

  private reconcileCellAssets(hydrateRing: Aabb, keepRing: Aabb, tier: number): void {
    const needed = neededCompositeTiles(hydrateRing);
    const kept = neededCompositeTiles(keepRing);
    const neededSet = new Set(needed.map((c) => packCell(c.cx, c.cy)));
    const keptSet = new Set(kept.map((c) => packCell(c.cx, c.cy)));

    for (const cell of needed) {
      const tile = this.cellAssets.get(packCell(cell.cx, cell.cy));
      if (!tile) continue; // no reportVersion yet for this cell
      tile.lru = ++this.lruClock;
      if (
        (tile.version > tile.maskAppliedVersion || tile.maskAppliedTier !== tier) &&
        !tile.maskHydrating &&
        this.maskInFlight < CELL_ASSET_MAX_INFLIGHT
      ) {
        void this.hydrateMask(tile, tier);
      }
      if (
        (tile.version > tile.seamAppliedVersion || tile.seamAppliedTier !== tier) &&
        !tile.seamHydrating &&
        this.seamInFlight < CELL_ASSET_MAX_INFLIGHT
      ) {
        void this.hydrateSeam(tile, tier);
      }
    }

    for (const tile of this.cellAssets.values()) {
      if (!keptSet.has(packCell(tile.cx, tile.cy))) this.freeCellAsset(tile);
    }

    this.evictCellAssetsOverBudget(neededSet);
  }

  private async hydrateMask(tile: CellAsset, tier: number): Promise<void> {
    tile.maskHydrating = true;
    this.maskInFlight++;
    const version = tile.version;
    const url = this.deps.maskUrlFor(tile.wireCellKey, version, tier);
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
    tile.maskAppliedTier = tier;
    tile.lru = ++this.lruClock;
    this.maskGeneration++;
    if (oldSprite) {
      this.maskSourceContainer.removeChild(oldSprite);
      oldSprite.destroy();
    }
  }

  private async hydrateSeam(tile: CellAsset, tier: number): Promise<void> {
    tile.seamHydrating = true;
    this.seamInFlight++;
    const version = tile.version;
    const url = this.deps.seamUrlFor(tile.wireCellKey, version, tier);
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
    tile.seamAppliedTier = tier;
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
      tile.maskAppliedTier = -1;
      this.maskGeneration++;
    }
    if (tile.seamSprite) {
      this.seamContainer.removeChild(tile.seamSprite);
      tile.seamSprite.destroy();
      tile.seamSprite = null;
      tile.seamAppliedVersion = 0;
      tile.seamAppliedTier = -1;
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
  // Rebuilt when the last bake no longer covers the hydrate ring (a
  // meaningful pan/zoom) or a mask sprite (re)hydrated since (maskGeneration).
  // Both cases share the same MIN_REBAKE_INTERVAL_MS throttle: an earlier
  // version only throttled the generation-changed case and let a ring move
  // rebake on every reconcile with no floor at all, on the theory that "the
  // view needs fresh coverage now". reconcile() runs every ticker frame
  // regardless of camera movement (see puzzleStage.ts), so a sustained pan
  // keeps the ring stale on essentially every frame, turning that
  // "un-throttled" path into a full up-to-MAX_MASK_TEXELS^2 GPU
  // render-to-texture on every single frame for the whole gesture, the
  // actual cause of reported pan lag. A stale mask sprite still gets
  // repositioned every frame below regardless of this throttle (cheap, no
  // render), so the coverage rect only ever trails the camera by at most
  // MIN_REBAKE_INTERVAL_MS, imperceptible against the cost this avoids.
  private updateCombinedMask(hydrateRing: Aabb, keepRing: Aabb, level: number): void {
    const ringStale = !this.maskCoveredRect || !rectContains(this.maskCoveredRect, hydrateRing);
    const generationChanged = this.maskGeneration !== this.lastBakedGeneration;
    if (!ringStale && !generationChanged) return;
    const now = performance.now();
    if (now - this.lastBakeAtMs < MIN_REBAKE_INTERVAL_MS) return;
    this.lastBakeAtMs = now;

    const worldW = keepRing.maxX - keepRing.minX;
    const worldH = keepRing.maxY - keepRing.minY;
    // One native DZI pixel maps to one world unit at dziInfo.maxLevel (see
    // dziTiles.ts), so this is exactly the texel density the photo tiles
    // themselves render at, at the current level: the mask is never blurrier
    // or sharper than the content it is masking.
    const texelsPerWorldUnit = 2 ** (level - this.deps.dziInfo.maxLevel);
    const texW = Math.min(MAX_MASK_TEXELS, Math.max(1, Math.ceil(worldW * texelsPerWorldUnit)));
    const texH = Math.min(MAX_MASK_TEXELS, Math.max(1, Math.ceil(worldH * texelsPerWorldUnit)));

    if (!this.maskTexture) {
      // No antialias: true here. Pixi's GL backend allocates a multisampled
      // renderbuffer (gl.renderbufferStorageMultisample) for an antialiased
      // RenderTexture and reallocates it on every resize() (GlRenderTargetAdaptor
      // _resizeColor), unlike a plain texture; on a real browser at real 1M
      // scale, resized up to 5x/second while zooming (MIN_REBAKE_INTERVAL_MS),
      // this produced GL_INVALID_OPERATION "Texture total allocation size is
      // too large" and "Framebuffer is incomplete: Attachment has zero size"
      // specifically past ~350% zoom, leaving tileContainer masked to nothing
      // (blank photo, seam overlay still visible since it is a separate,
      // unmasked container). The mask is a binary silhouette cutout, not
      // detailed content, and the true piece border is already drawn crisp and
      // unmasked by seamContainer, so losing MSAA costs a faint edge softness
      // at most.
      this.maskTexture = RenderTexture.create({
        width: texW,
        height: texH,
        resolution: 1,
      });
      this.maskSprite = new Sprite(this.maskTexture);
      // Pixi's mask filter maps the masked container's global bounds through
      // the mask sprite's own worldTransform (FilterSystem.calculateSpriteMatrix),
      // so the mask only lands correctly if it shares the same camera-transformed
      // ancestor as tileContainer (a descendant of the pan/zoom-scaled world
      // container, see puzzleStage.ts). A parentless sprite has no such
      // ancestor: its worldTransform is its bare local transform, so its
      // on-screen position never moved with the camera, only jumping to a new
      // (still wrong) spot on the next rebake. renderable = false keeps it out
      // of the normal draw pass (it must never paint its raw mask texture as
      // visible content), while still being a real child for transform purposes.
      this.maskSprite.renderable = false;
      this.deps.container.addChild(this.maskSprite);
    } else if (this.maskTexture.width !== texW || this.maskTexture.height !== texH) {
      // Resize in place instead of destroy+recreate. Destroying fires a
      // TextureSource 'change' event with destroyed=true, which PixiJS's
      // BindGroup.onResourceChange treats as fatal: it permanently nulls the
      // whole bind group of any shader still holding this texture, including
      // an unrelated pooled AlphaMaskEffect (see AlphaMaskPipe/BigPool) that
      // masked with this exact sprite on a previous frame and never released
      // it. The next mask push then reads a null resources map and crashes
      // (RenderTargetSystem -> BindGroup.getResource). resize() emits
      // 'change' without destroyed=true, so it never trips that path.
      this.maskTexture.resize(texW, texH);
    }
    const sprite = this.maskSprite!;
    // Plain world-space x/y/width/height, same convention tileContainer's own
    // children use: correct now that the sprite is a real child of the same
    // camera-transformed ancestor (see its creation above), so this position
    // composes with the camera exactly like the content it masks.
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
    for (const sprite of this.baseTiles) {
      total += sprite.texture.width * sprite.texture.height * 4;
    }
    for (const tile of this.cellAssets.values()) {
      if (tile.maskSprite) total += tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite) total += tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
    }
    if (this.maskTexture) total += this.maskTexture.width * this.maskTexture.height * 4;
    return total;
  }

  budgetBytes(): number {
    return (DZI_VRAM_BUDGET_MB + BASE_LAYER_VRAM_BUDGET_MB + CELL_ASSET_VRAM_BUDGET_MB) * 1e6;
  }

  clear(): void {
    for (const tile of this.dziTiles.values()) this.freeDziTile(tile);
    for (const sprite of this.baseTiles) {
      this.baseTileContainer.removeChild(sprite);
      sprite.destroy();
    }
    this.baseTiles.length = 0;
    this.dziTiles.clear();
    for (const tile of this.cellAssets.values()) this.freeCellAsset(tile);
    this.cellAssets.clear();
    this.tileContainer.mask = null;
    if (this.maskSprite) {
      this.deps.container.removeChild(this.maskSprite);
      this.maskSprite.destroy();
    }
    this.maskSprite = null;
    this.maskTexture?.destroy(true);
    this.maskTexture = null;
    this.maskCoveredRect = null;
    this.maskGeneration = 0;
    this.lastBakedGeneration = -1;
  }
}
