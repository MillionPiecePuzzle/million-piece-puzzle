// The only rendering path for locked content (see ROADMAP Phase 5 Stage 5):
// reveals the reference DZI pyramid through each locked piece's own
// server-baked silhouette, with a seam overlay drawn on top. This layer
// never fetches a full-photo AVIF or does per-cell RGB compositing itself;
// the server still bakes (and this layer still fetches) two small per-cell
// textures derived straight from geometry: a silhouette mask and a seam
// (border-only) overlay (see DECISIONS: DZI reveal mask/seam bake) - both
// far cheaper than the server's full per-cell photo composite (see
// cellCompositor.ts), since neither needs a single piece tile byte, only the
// server's already-in-process generationSeed.
//
// Three independent concerns, deliberately not tied to the same lifecycle:
// - The DZI background is a standard deep-zoom tile layer (own native grid,
//   own level chosen from the current camera zoom, see dziTiles.ts's
//   levelForZoom), fetching only whatever the viewport needs at whatever
//   detail the current zoom warrants, exactly like any map/deep-zoom viewer.
// - The reveal mask is real per-piece silhouette geometry, but rasterized
//   server-side per cell (the same LOD_TILE_WORLD grid every other per-cell
//   index in this codebase uses, see groupGrid.ts): a piece's tab can bulge
//   past its own nominal box, so masking by a
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

import {
  AlphaFilter,
  Container,
  Matrix,
  Rectangle,
  RenderTexture,
  Sprite,
  type Texture,
} from "pixi.js";
import type { Aabb } from "./cull";
import { LOD_TILE_WORLD, packCell, unpackWireCellKey, type CellKey } from "./groupGrid";
import {
  dziTilesForRect,
  levelForZoom,
  maskTierForZoom,
  pickBaseLevel,
  type DziInfo,
} from "./dziTiles";

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
// Reference underlay: the same DZI tiles this layer already streams, drawn a
// second time under the board with no mask, so the photo shows faintly
// wherever nothing is locked yet. The twin sprites share their textures with
// the masked ones, so the aid costs no fetch and no VRAM, only its own draws.
// The alpha is what separates ghost from locked content: over the light stage
// backdrop it dims the ghost and drops its chroma to the same fraction,
// leaving locked content the only saturated thing on the board.
const UNDERLAY_ALPHA = 0.32;
// Locked content then reads as sitting on top of that ghost rather than
// inside it: one offset copy of the combined mask, drawn dark under the
// locked tiles, so the locked slab casts a shadow onto the reference behind
// it. Offset in screen pixels (divided by the camera zoom where it is used)
// so the lift reads the same at every zoom, like the frame's own pixelLine
// border.
const LOCKED_SHADOW_COLOR = 0x1a1a1a;
const LOCKED_SHADOW_ALPHA = 0.45;
const LOCKED_SHADOW_SCREEN_PX = 3;

type DziTile = {
  key: string;
  level: number;
  bounds: Aabb;
  sprite: Sprite | null;
  // Twin of sprite in the reference underlay (same texture, same rect), null
  // whenever the underlay is off.
  ghost: Sprite | null;
  hydrating: boolean;
  lru: number;
};

// One cell's mask + seam assets, on the LOD_TILE_WORLD grid and the same
// {cellKey, version} facts the wire CellComposite carries (see reportVersion).
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
  // Own layer above the frame and below every piece (see puzzleStage.ts),
  // holding the reference underlay and the locked slab's shadow: both draw
  // under locked content, so neither can live in the container above.
  underlayContainer: Container;
  loadTexture: (url: string) => Promise<Texture | null>;
  dziInfo: DziInfo;
  dziBaseUrl: string;
  // Same cell canvas widening the server bakes with (see cellCompositor.ts),
  // needed to place a cell's mask/seam sprite at its true bleed-inclusive
  // bounds.
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

export type CellCoord = { cx: number; cy: number };

// Every cell a box spans, at the fixed LOD_TILE_WORLD pitch every per-cell
// mask/seam asset is baked at.
export function neededCellAssets(box: Aabb): CellCoord[] {
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
  // The underlay's own two containers, mirroring tileContainer and
  // baseTileContainer one for one so the ghost keeps the same
  // base-under-dynamic draw order the masked tiles already have.
  private readonly ghostContainer: Container;
  private readonly baseGhostContainer: Container;
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

  private readonly ghostFilter: AlphaFilter;

  private underlayEnabled = false;
  private disposed = false;
  private shadowSprite: Sprite | null = null;

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
    this.deps.container.addChild(this.tileContainer);
    this.baseTileContainer = new Container();
    // Bounds this child's contribution to tileContainer's own recursive
    // global bounds (see getFastGlobalBoundsMixin.mjs's _getGlobalBoundsRecursive)
    // to keepRing instead of the whole image baseTileContainer's tiles
    // actually span (see loadBaseLayer: fetched once, kept resident forever,
    // regardless of camera position). boundsArea deliberately lives here, on
    // baseTileContainer, and NOT on tileContainer itself (an earlier version
    // of this fix set it on tileContainer and shipped a regression - see
    // DECISIONS): a container's boundsArea is only read directly into the
    // caller's bounds accumulator when that container has no effects of its
    // own (read directly off getFastGlobalBoundsMixin.mjs and the real
    // effect class, AlphaMask.mjs). tileContainer carries the mask effect
    // (mask = sprite below), which makes _getGlobalBoundsRecursive reassign
    // its own local accumulator to a fresh, still-empty pooled Bounds before
    // reading boundsArea, then run AlphaMask.addBounds (an intersection, via
    // addMaskBounds/addBoundsMask) against that same still-empty accumulator
    // afterward, whether or not boundsArea populated anything: putting
    // boundsArea on tileContainer itself skips the one code path
    // (children-recursion) that would otherwise have seeded that
    // accumulator with real content first, for reasons that trace through
    // several layers of Pixi's own bounds-pooling and don't reduce to one
    // simple statement. baseTileContainer has no effects of its own, so its
    // boundsArea is read directly into tileContainer's real accumulator
    // (populated by normal children-recursion) with none of that machinery
    // involved. Kept in sync with keepRing every reconcile() (see below):
    // nothing outside keepRing is ever meant to be on screen, so clipping
    // this contribution to it costs no visible content, and unlike the
    // async tile hydrates below, this is set synchronously so
    // tileContainer's own accumulator is never contributor-less even on the
    // very first reconcile(), before any texture has loaded.
    this.baseTileContainer.boundsArea = new Rectangle();
    this.tileContainer.addChild(this.baseTileContainer);
    this.seamContainer = new Container();
    this.deps.container.addChild(this.seamContainer);
    this.ghostContainer = new Container();
    // Group opacity, not the container's own alpha: the ghost is built from
    // overlapping layers (the always-resident base tiles under the
    // zoom-level tiles, plus a stale level kept as a fallback across a zoom
    // step), and a container's alpha in Pixi multiplies into each child
    // separately, so N layers over one spot compound to 1-(1-a)^N and the aid
    // would darken and lighten as tiles stream in and out (measured: two
    // layers in steady state, three across a zoom step, turning a nominal
    // 0.28 into 0.48 and then 0.63). One AlphaFilter flattens the container
    // first and blends the result once.
    // Its render target is clamped to the viewport (Filter.clipToViewport),
    // so it costs one screen-sized pass, and antialias is pinned off for the
    // same multisampled-renderbuffer reason the root canvas pins it (see
    // puzzleStage.ts's mount).
    this.ghostFilter = new AlphaFilter({ alpha: UNDERLAY_ALPHA, antialias: "off" });
    this.ghostContainer.filters = [this.ghostFilter];
    this.deps.underlayContainer.addChild(this.ghostContainer);
    this.baseGhostContainer = new Container();
    this.ghostContainer.addChild(this.baseGhostContainer);
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
        // destroy() can land while these are in flight (a rebuild replaces the
        // layer, see puzzleStage.ts's createDziRevealLayer): without this the
        // tiles would be added to containers that are no longer masked, or no
        // longer attached to anything.
        if (!texture || this.disposed) return;
        const sprite = new Sprite(texture);
        sprite.x = t.worldRect.minX;
        sprite.y = t.worldRect.minY;
        sprite.width = t.worldRect.maxX - t.worldRect.minX;
        sprite.height = t.worldRect.maxY - t.worldRect.minY;
        this.baseTileContainer.addChild(sprite);
        this.baseTiles.push(sprite);
        if (this.underlayEnabled) this.mirrorIntoUnderlay(sprite, this.baseGhostContainer);
      }),
    );
  }

  // Records or bumps one cell's known mask/seam version: an upsert-a-fact,
  // let-reconcile-decide-when-to-fetch shape, shared by the region_state
  // batch and the live cell_composite push.
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
    const boundsArea = this.baseTileContainer.boundsArea;
    boundsArea.x = keepRing.minX;
    boundsArea.y = keepRing.minY;
    boundsArea.width = keepRing.maxX - keepRing.minX;
    boundsArea.height = keepRing.maxY - keepRing.minY;
    this.reconcileDziTiles(hydrateRing, keepRing, level);
    this.reconcileCellAssets(hydrateRing, keepRing, tier);
    this.updateCombinedMask(hydrateRing, keepRing, level);
    this.updateLockedShadow(zoom);
  }

  // Toggling the underlay never touches the masked tiles: it only adds or
  // drops their twins (and the locked slab's shadow), so turning it off
  // leaves the board pixel for pixel what it was before the aid existed.
  setUnderlayEnabled(on: boolean): void {
    if (this.underlayEnabled === on) return;
    this.underlayEnabled = on;
    if (!on) {
      this.clearUnderlay();
      return;
    }
    for (const sprite of this.baseTiles) {
      this.mirrorIntoUnderlay(sprite, this.baseGhostContainer);
    }
    for (const tile of this.dziTiles.values()) {
      if (tile.sprite) tile.ghost = this.mirrorIntoUnderlay(tile.sprite, this.ghostContainer);
    }
  }

  private mirrorIntoUnderlay(sprite: Sprite, into: Container): Sprite {
    const ghost = new Sprite(sprite.texture);
    ghost.x = sprite.x;
    ghost.y = sprite.y;
    ghost.width = sprite.width;
    ghost.height = sprite.height;
    into.addChild(ghost);
    return ghost;
  }

  private clearUnderlay(): void {
    for (const tile of this.dziTiles.values()) this.freeGhost(tile);
    for (const ghost of this.baseGhostContainer.removeChildren()) ghost.destroy();
    this.freeLockedShadow();
  }

  private freeGhost(tile: DziTile): void {
    if (!tile.ghost) return;
    this.ghostContainer.removeChild(tile.ghost);
    tile.ghost.destroy();
    tile.ghost = null;
  }

  private freeLockedShadow(): void {
    if (!this.shadowSprite) return;
    this.deps.underlayContainer.removeChild(this.shadowSprite);
    this.shadowSprite.destroy();
    this.shadowSprite = null;
  }

  // The combined mask is already an exact silhouette of everything locked in
  // the ring, so the shadow is that same texture drawn once more, offset and
  // tinted: it shows only where the locked tiles above it fail to cover it,
  // which is the frontier and the holes, and it costs one sprite for the
  // whole board rather than one per piece (a per-piece effect would not
  // survive the zoom-out LOD band, which bakes tiles, see puzzleStage.ts).
  private updateLockedShadow(zoom: number): void {
    const covered = this.maskCoveredRect;
    if (!this.underlayEnabled || !this.maskTexture || !covered) {
      this.freeLockedShadow();
      return;
    }
    if (!this.shadowSprite) {
      const shadow = new Sprite(this.maskTexture);
      shadow.tint = LOCKED_SHADOW_COLOR;
      shadow.alpha = LOCKED_SHADOW_ALPHA;
      this.deps.underlayContainer.addChild(shadow);
      this.shadowSprite = shadow;
    }
    // Reapplied every frame rather than on a rebake only: the offset is a
    // screen-pixel distance, so it moves with zoom even when the mask itself
    // is unchanged, and a resized mask texture needs its size reapplied too.
    const offset = LOCKED_SHADOW_SCREEN_PX / zoom;
    const shadow = this.shadowSprite;
    shadow.x = covered.minX + offset;
    shadow.y = covered.minY + offset;
    shadow.width = covered.maxX - covered.minX;
    shadow.height = covered.maxY - covered.minY;
  }

  private reconcileDziTiles(hydrateRing: Aabb, keepRing: Aabb, level: number): void {
    const needed = dziTilesForRect(this.deps.dziInfo, level, hydrateRing, this.deps.dziBaseUrl);

    const neededSet = new Set(needed.map((t) => `${level}:${t.col}:${t.row}`));
    for (const t of needed) {
      const key = `${level}:${t.col}:${t.row}`;
      let tile = this.dziTiles.get(key);
      if (!tile) {
        tile = {
          key,
          level,
          bounds: t.worldRect,
          sprite: null,
          ghost: null,
          hydrating: false,
          lru: 0,
        };
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
    if (this.underlayEnabled) tile.ghost = this.mirrorIntoUnderlay(sprite, this.ghostContainer);
    tile.lru = ++this.lruClock;
  }

  private freeDziTile(tile: DziTile): void {
    if (!tile.sprite) return;
    this.tileContainer.removeChild(tile.sprite);
    tile.sprite.destroy();
    tile.sprite = null;
    this.freeGhost(tile);
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
    const needed = neededCellAssets(hydrateRing);
    const kept = neededCellAssets(keepRing);
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
      if (tile.maskSprite)
        total += tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite)
        total += tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
      if ((tile.maskSprite || tile.seamSprite) && !neededSet.has(packCell(tile.cx, tile.cy))) {
        candidates.push(tile);
      }
    }
    if (total <= budget) return;
    candidates.sort((a, b) => a.lru - b.lru);
    for (const tile of candidates) {
      if (total <= budget) break;
      if (tile.maskSprite)
        total -= tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite)
        total -= tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
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
      // A Sprite only rebuilds the quad it batches when its texture is
      // reassigned or the texture fires an update event, and a RenderTexture
      // resized in place does neither (a Sprite subscribes to that event only
      // for a texture flagged dynamic, see pixi.js Sprite's texture setter),
      // so a sprite kept across a resize goes on drawing the texture at the
      // previous dimensions. The mask sprite never notices (Pixi's AlphaMask
      // reads its transform, never its batched quad), but the locked shadow
      // draws this same texture for real: it would slide the silhouette off
      // the pieces it belongs to, by more the further the two sizes drift
      // (observed as a whole second, displaced copy of the locked slab).
      // Dropping the sprite here rebuilds it against the new size on this
      // same frame, and a resize only happens on a real ring move.
      this.freeLockedShadow();
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

  // Underlay twins are deliberately absent from this sum: they share their
  // textures with the tiles above, so counting them would double-report VRAM
  // that was only ever allocated once.
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
      if (tile.maskSprite)
        total += tile.maskSprite.texture.width * tile.maskSprite.texture.height * 4;
      if (tile.seamSprite)
        total += tile.seamSprite.texture.width * tile.seamSprite.texture.height * 4;
    }
    if (this.maskTexture) total += this.maskTexture.width * this.maskTexture.height * 4;
    return total;
  }

  budgetBytes(): number {
    return (DZI_VRAM_BUDGET_MB + BASE_LAYER_VRAM_BUDGET_MB + CELL_ASSET_VRAM_BUDGET_MB) * 1e6;
  }

  // Frees everything this layer owns and detaches it from the containers
  // `deps` handed it. There is no lighter "clear but keep it alive" variant:
  // the layer is rebuilt, never reused, and leaving its containers parented
  // is exactly what let a replaced instance go on drawing.
  destroy(): void {
    this.disposed = true;
    for (const tile of this.dziTiles.values()) this.freeDziTile(tile);
    for (const sprite of this.baseTiles) {
      this.baseTileContainer.removeChild(sprite);
      sprite.destroy();
    }
    this.baseTiles.length = 0;
    this.dziTiles.clear();
    for (const tile of this.cellAssets.values()) this.freeCellAsset(tile);
    this.cellAssets.clear();
    this.clearUnderlay();
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
    this.tileContainer.destroy({ children: true });
    this.seamContainer.destroy({ children: true });
    this.ghostContainer.destroy({ children: true });
    this.maskSourceContainer.destroy({ children: true });
    // Container.destroy() drops its filter reference without destroying the
    // filter itself, and this one owns a GPU render target.
    this.ghostFilter.destroy();
  }
}
