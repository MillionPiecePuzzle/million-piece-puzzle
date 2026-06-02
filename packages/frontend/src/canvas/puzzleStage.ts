import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  type FederatedPointerEvent,
  type Texture,
} from "pixi.js";
import {
  GRID_WORLD_CELL,
  generatePuzzle,
  piecePath,
  type GroupRuntime,
  type ImageManifest,
  type PieceGeometry,
  type PieceRuntime,
  type PlayZone,
} from "@mpp/shared";
import { applyPath } from "./applyPath";
import { Tweener, peak, easeOutCubic } from "./tween";
import { PeerCursorLayer } from "./peerCursors";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import { boundsVisible, pieceLocalBounds, unionBounds, type Aabb, type Viewport } from "./cull";
import { GroupGrid, LOD_TILE_WORLD, type CellKey } from "./groupGrid";
import { LodTileLayer } from "./lodTiles";

export type Mode = "spectator" | "contributor";

// Visible world rectangle, reported to the server so it can scope drag and
// drop broadcasts to this client. Also drives client-side frustum culling.
export type ViewportRect = Viewport;

// One piece reduced to a point for the minimap: its world center and whether
// its cluster is locked to the frame.
export type MinimapPiece = { x: number; y: number; locked: boolean };

// Everything the minimap needs to draw, pulled from the stage on demand.
export type MinimapSnapshot = {
  playZone: PlayZone;
  frame: { w: number; h: number };
  pieces: MinimapPiece[];
  viewport: Viewport | null;
};

type PieceNode = {
  id: number;
  container: Container;
  inner: Container;
  flash: Graphics;
  geometry: PieceGeometry;
  localBounds: Aabb;
};

type GroupNode = {
  id: number;
  container: Container;
  pieces: PieceNode[];
  locked: boolean;
  worldX: number;
  worldY: number;
  localBounds: Aabb;
};

type HeldState = {
  groupId: number;
  pointerDx: number;
  pointerDy: number;
  originX: number;
  originY: number;
  confirmed: boolean;
};

export type StageCallbacks = {
  onGrab: (groupId: number) => void;
  onDrag: (groupId: number, worldX: number, worldY: number) => void;
  onDrop: (groupId: number, worldX: number, worldY: number) => void;
};

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;
const HELD_SCALE = 1.02;

// The camera may travel one padding ring past the play zone; pieces stay
// strictly inside it.
const PLAY_ZONE_PADDING_FRACTION = 0.04;
const BACKDROP_COLOR = 0x15140f;
const BACKDROP_ALPHA = 0.3;
// Coarse checkerboard painted over the out-of-bounds fill, a deliberately
// different motif from the fine hairline grid inside the zone.
const BACKDROP_CHECKER_CELLS = 8;
const BACKDROP_CHECKER_ALPHA = 0.14;

// Group stacking order. Locked clusters form the solved base layer; loose
// clusters always sit above them so they stay grabbable. Held clusters lift
// further still. The backdrop and frame sit below every cluster.
const Z_BACKDROP = -2;
const Z_FRAME = -1;
const Z_LOCKED = 0;
const Z_UNLOCKED = 1;
// The zoom-out LOD tiles sit above the resting clusters they replace and the
// frame, but below held clusters so a piece in hand keeps rendering live on top.
const Z_LOD = 5;
const Z_REMOTE_HELD = 10;
const Z_LOCAL_HELD = 100;

// Zoom-out level of detail, in three bands. At or above LOD_WARM_ZOOM the live
// pieces render and the tile layer is idle. In the warm band
// (LOD_ENTER_ZOOM .. LOD_WARM_ZOOM) the live pieces still render while the bake
// queue fills the visible tiles in the background, so they are ready by the time
// the camera reaches LOD_ENTER_ZOOM. Below LOD_ENTER_ZOOM the baked tiles show
// (with LOD_EXIT_ZOOM hysteresis so a zoom hovering at the threshold does not
// thrash). The bake queue drains a few tiles per frame so a progressive zoom-out
// never hitches; a direct jump below LOD_ENTER_ZOOM (cold start, fit, double-click,
// keyboard) skips the warm band, so its screen-cover tiles are baked in one burst
// on entry (see setLodActive) instead.
const LOD_ENTER_ZOOM = 0.3;
const LOD_EXIT_ZOOM = 0.35;
const LOD_WARM_ZOOM = 0.5;
const LOD_BAKE_PER_FRAME = 2;
const SNAP_BUMP_SCALE = 1.08;
const SNAP_BUMP_MS = 240;
const SNAP_FLASH_ALPHA = 0.55;
const SNAP_FLASH_MS = 260;

const END_PULSE_SCALE = 1.06;
const END_PULSE_MS = 280;
const END_PULSE_SPREAD_MS = 700;
const END_FLASH_MS = 900;
const END_FLASH_ALPHA = 0.35;

const CONFETTI_COLORS = [0xff5d73, 0xffd166, 0x06d6a0, 0x118ab2, 0xef476f, 0x8338ec, 0xfb5607];
const CONFETTI_SPAWN_PER_SEC = 60;
const CONFETTI_MAX = 240;
const CONFETTI_GRAVITY = 420;
const CONFETTI_SIZE_MIN = 6;
const CONFETTI_SIZE_MAX = 12;

type ConfettiParticle = {
  gfx: Graphics;
  vx: number;
  vy: number;
  rot: number;
  rotSpeed: number;
  wobble: number;
  wobbleSpeed: number;
};

export class PuzzleStage {
  private app: Application | null = null;
  private world: Container | null = null;
  private groups = new Map<number, GroupNode>();
  private pieceToGroup = new Map<number, number>();
  private camera = { x: 0, y: 0, zoom: 1 };
  private worldSize: { w: number; h: number } | null = null;
  // Hard-limit rectangle, received from the server in build() so every client
  // of a puzzle enforces the exact same bound.
  private playZone: PlayZone | null = null;
  // Puzzle border rectangle. Kept as a field so the LOD bake can hide it while
  // capturing pieces, then restore it (the frame stays a crisp live overlay at
  // every zoom rather than blurring into the low-res texture).
  private frame: Graphics | null = null;
  // World-space dark fill covering everything outside the play zone.
  private backdrop: Graphics | null = null;
  // Cached visible world rectangle, recomputed on every camera change and
  // resize; null until the first camera update. Drives frustum culling.
  private viewport: Viewport | null = null;
  private mode: Mode = "spectator";
  private localUserId: string | null = null;
  private callbacks: StageCallbacks | null = null;
  onCameraChange: ((camera: { x: number; y: number; zoom: number }) => void) | null = null;
  onViewportChange: ((viewport: ViewportRect) => void) | null = null;
  onCursorMove: ((worldX: number, worldY: number) => void) | null = null;

  private peerCursors: PeerCursorLayer | null = null;
  private readonly tickPeerCursors = (ticker: { deltaMS: number }): void => {
    this.peerCursors?.update(ticker.deltaMS, this.camera);
  };

  private held: HeldState | null = null;
  // Last drag origin produced this frame while a cluster is held. moveGroup has
  // already applied it locally; this only defers the broadcast so tickDragFlush
  // emits at most one drag per frame. Null on frames with no movement, so idle
  // frames broadcast nothing.
  private pendingDrag: { worldX: number; worldY: number } | null = null;
  private readonly tickDragFlush = (): void => {
    if (!this.pendingDrag || !this.held || !this.callbacks) return;
    const { worldX, worldY } = this.pendingDrag;
    this.pendingDrag = null;
    this.callbacks.onDrag(this.held.groupId, worldX, worldY);
  };
  private pan: { active: boolean; lastX: number; lastY: number } = {
    active: false,
    lastX: 0,
    lastY: 0,
  };
  private tweener: Tweener | null = null;

  // Spatial index over the LOD tile grid, keyed by tile cell. Bounds both the
  // live cull (visible candidates) and the per-tile bake (a cell's groups) so
  // neither is O(board). Upkeep is O(cells per group) per move, off the dirty
  // path. lastVisible is the previous cull candidate set, so a group leaving the
  // query region can be culled without rescanning the board. lodHidden is the
  // groups currently hidden by an active LOD (covered by a ready tile), kept so
  // exiting LOD restores exactly them.
  private groupGrid = new GroupGrid(LOD_TILE_WORLD);
  private lastVisible = new Set<number>();
  private lodHidden = new Set<number>();

  // Zoom-out LOD tile cache. lodActive means baked tiles are shown; lodWarm means
  // the bake queue is filling tiles in the background (warm band or active).
  // heldGroupIds is every cluster a human is dragging right now (local or
  // remote): excluded from bakes and drawn live on top so a piece in hand never
  // freezes into a tile.
  private lodLayer: LodTileLayer | null = null;
  private lodActive = false;
  private lodWarm = false;
  private heldGroupIds = new Set<number>();
  private readonly tickLod = (): void => {
    this.tickLodFrame();
  };

  private confetti: {
    layer: Container;
    particles: ConfettiParticle[];
    spawnAcc: number;
    tick: (ticker: { deltaMS: number }) => void;
  } | null = null;

  setMode(mode: Mode): void {
    this.mode = mode;
    for (const node of this.groups.values()) {
      this.applyGroupInteractivity(node);
    }
  }

  setLocalUserId(userId: string | null): void {
    this.localUserId = userId;
  }

  setCallbacks(cb: StageCallbacks): void {
    this.callbacks = cb;
  }

  async mount(host: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(app.canvas);
    const world = new Container();
    world.sortableChildren = true;
    app.stage.addChild(world);

    const peerCursors = new PeerCursorLayer();
    app.stage.addChild(peerCursors.container);
    this.peerCursors = peerCursors;

    app.stage.eventMode = "static";
    this.refreshStageHitArea(app);
    app.stage.on("pointerdown", (ev) => this.onStagePointerDown(ev));
    app.stage.on("globalpointermove", (ev) => this.onPointerMove(ev));
    app.stage.on("pointerup", (ev) => this.onPointerUp(ev));
    app.stage.on("pointerupoutside", (ev) => this.onPointerUp(ev));
    app.renderer.on("resize", () => {
      this.refreshStageHitArea(app);
      this.redrawBackdrop();
      this.configureLodLayer();
      this.applyCamera();
    });

    this.app = app;
    this.world = world;
    this.tweener = new Tweener(app.ticker);
    app.ticker.add(this.tickPeerCursors);
    app.ticker.add(this.tickDragFlush);
    app.ticker.add(this.tickLod);
    this.attachWheelZoom(app.canvas);
  }

  private refreshStageHitArea(app: Application): void {
    const s = app.renderer.screen;
    app.stage.hitArea = new Rectangle(0, 0, s.width, s.height);
  }

  async build(
    manifest: ImageManifest,
    initialPieces: PieceRuntime[],
    initialGroups: GroupRuntime[],
    playZone: PlayZone,
    onTextureProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    if (!this.app || !this.world) throw new Error("stage not mounted");
    const geom = generatePuzzle({
      seed: manifest.seed,
      rows: manifest.rows,
      cols: manifest.cols,
      pieceSize: manifest.pieceSize,
    });
    const geomById = new Map<number, PieceGeometry>(geom.pieces.map((p) => [p.id, p]));

    const base = manifestBaseUrl(manifestUrlFor(manifest.puzzleId));
    const textures = await loadTextures(manifest, base, onTextureProgress);

    this.worldSize = {
      w: geom.cols * geom.pieceSize,
      h: geom.rows * geom.pieceSize,
    };

    const frame = new Graphics();
    frame.rect(0, 0, this.worldSize.w, this.worldSize.h).stroke({ color: 0x1a1a1a, width: 4 });
    frame.zIndex = Z_FRAME;
    this.world.addChild(frame);
    this.frame = frame;

    for (const group of initialGroups) {
      const gc = new Container();
      gc.x = group.worldX;
      gc.y = group.worldY;
      gc.zIndex = group.locked ? Z_LOCKED : Z_UNLOCKED;
      const node: GroupNode = {
        id: group.id,
        container: gc,
        pieces: [],
        locked: group.locked,
        worldX: group.worldX,
        worldY: group.worldY,
        localBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      };
      this.world.addChild(gc);
      this.groups.set(group.id, node);
    }

    for (const piece of initialPieces) {
      const geometry = geomById.get(piece.id);
      const texture = textures.get(piece.id);
      const groupNode = this.groups.get(piece.groupId);
      if (!geometry || !texture || !groupNode) continue;
      const node = buildPieceNode(geometry, texture, manifest);
      groupNode.container.addChild(node.container);
      groupNode.pieces.push(node);
      this.pieceToGroup.set(piece.id, piece.groupId);
    }

    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    for (const node of this.groups.values()) {
      node.localBounds = unionBounds(node.pieces.map((p) => p.localBounds));
      this.groupGrid.upsert(node.id, this.worldAabb(node));
      this.applyGroupInteractivity(node);
    }

    this.playZone = playZone;
    this.createBackdrop();
    this.createLodLayer();
    this.fitView();
  }

  private playZonePadding(): number {
    if (!this.playZone) return 0;
    const w = this.playZone.maxX - this.playZone.minX;
    const h = this.playZone.maxY - this.playZone.minY;
    return Math.max(w, h) * PLAY_ZONE_PADDING_FRACTION;
  }

  private createBackdrop(): void {
    if (!this.world) return;
    const g = new Graphics();
    g.zIndex = Z_BACKDROP;
    g.eventMode = "none";
    this.world.addChild(g);
    this.backdrop = g;
    this.redrawBackdrop();
  }

  // Dark fill over everything outside the play zone, then a coarse checker on
  // top so the out-of-bounds area reads as a distinct motif from the fine grid
  // inside. The zone interior is left unpainted so the light stage backdrop
  // shows through. The fill reaches far enough to cover the screen even fully
  // zoomed out with the zone smaller than the viewport.
  private redrawBackdrop(): void {
    if (!this.backdrop || !this.playZone || !this.app) return;
    const zone = this.playZone;
    const screen = this.app.renderer.screen;
    const reach = (screen.width + screen.height) / MIN_ZOOM;
    const oMinX = zone.minX - reach;
    const oMinY = zone.minY - reach;
    const oMaxX = zone.maxX + reach;
    const oMaxY = zone.maxY + reach;
    const outer: Aabb[] = [
      { minX: oMinX, minY: oMinY, maxX: oMaxX, maxY: zone.minY },
      { minX: oMinX, minY: zone.maxY, maxX: oMaxX, maxY: oMaxY },
      { minX: oMinX, minY: zone.minY, maxX: zone.minX, maxY: zone.maxY },
      { minX: zone.maxX, minY: zone.minY, maxX: oMaxX, maxY: zone.maxY },
    ];
    const g = this.backdrop;
    g.clear();
    for (const r of outer) g.rect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
    g.fill({ color: BACKDROP_COLOR, alpha: BACKDROP_ALPHA });
    for (const r of outer) this.addBackdropChecker(g, r);
    g.fill({ color: BACKDROP_COLOR, alpha: BACKDROP_CHECKER_ALPHA });
  }

  // Adds the dark checker cells of one outer rectangle to the backdrop path.
  // Cells sit on a coarse multiple of the world grid and are clipped to the
  // rectangle, so the checker tiles seamlessly across the four outer pieces.
  private addBackdropChecker(g: Graphics, r: Aabb): void {
    const cell = GRID_WORLD_CELL * BACKDROP_CHECKER_CELLS;
    const cx0 = Math.floor(r.minX / cell);
    const cx1 = Math.ceil(r.maxX / cell);
    const cy0 = Math.floor(r.minY / cell);
    const cy1 = Math.ceil(r.maxY / cell);
    for (let cy = cy0; cy < cy1; cy++) {
      for (let cx = cx0; cx < cx1; cx++) {
        if (((cx + cy) & 1) === 0) continue;
        const x = Math.max(cx * cell, r.minX);
        const y = Math.max(cy * cell, r.minY);
        const x2 = Math.min((cx + 1) * cell, r.maxX);
        const y2 = Math.min((cy + 1) * cell, r.maxY);
        if (x2 > x && y2 > y) g.rect(x, y, x2 - x, y2 - y);
      }
    }
  }

  destroy(): void {
    this.stopConfetti();
    this.tweener?.destroy();
    this.tweener = null;
    this.app?.ticker.remove(this.tickPeerCursors);
    this.app?.ticker.remove(this.tickDragFlush);
    this.app?.ticker.remove(this.tickLod);
    this.peerCursors?.destroy();
    this.peerCursors = null;
    this.lodLayer?.destroy();
    this.lodLayer = null;
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.world = null;
    this.groups.clear();
    this.pieceToGroup.clear();
    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    this.heldGroupIds.clear();
    this.held = null;
    this.pendingDrag = null;
  }

  // Wipe all piece/group state without tearing down the Pixi app, so a fresh
  // build() can run on the same stage (server-driven reset).
  clearWorld(): void {
    this.stopConfetti();
    if (this.world) {
      // removeChildren() only detaches. context:true is required to free each
      // Graphics' GraphicsContext (mask, flash, frame, backdrop geometry);
      // children:true alone destroys the nodes but leaks their geometry.
      for (const child of this.world.removeChildren()) {
        child.destroy({ children: true, context: true });
      }
      this.world.x = 0;
      this.world.y = 0;
      this.world.scale.set(1);
    }
    this.lodLayer?.destroy();
    this.lodLayer = null;
    this.lodActive = false;
    this.lodWarm = false;
    this.heldGroupIds.clear();
    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    this.groups.clear();
    this.pieceToGroup.clear();
    this.held = null;
    this.pendingDrag = null;
    this.peerCursors?.clearHeld();
    this.worldSize = null;
    this.playZone = null;
    this.frame = null;
    this.backdrop = null;
    this.viewport = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.onCameraChange?.(this.camera);
  }

  // Apply a fresh snapshot (same puzzleId) without rebuilding the stage: update
  // group positions and locked state in place, fold any merged groups into the
  // surviving host (their pieces reparent), and drop groups that no longer
  // exist. Used by spectator mode polling /snapshot. A held local cluster is
  // skipped so an active drag is not yanked by an in-flight snapshot.
  applySnapshot(pieces: PieceRuntime[], groups: GroupRuntime[]): void {
    if (!this.world) return;
    const snapGroupIds = new Set<number>();
    for (const g of groups) snapGroupIds.add(g.id);

    const targetByPiece = new Map<number, number>();
    for (const p of pieces) targetByPiece.set(p.id, p.groupId);

    for (const [pieceId, currentGid] of this.pieceToGroup) {
      const targetGid = targetByPiece.get(pieceId);
      if (targetGid === undefined || targetGid === currentGid) continue;
      const host = this.groups.get(targetGid);
      const from = this.groups.get(currentGid);
      if (!host || !from) continue;
      const piece = from.pieces.find((n) => n.id === pieceId);
      if (!piece) continue;
      from.container.removeChild(piece.container);
      from.pieces = from.pieces.filter((n) => n.id !== pieceId);
      piece.container.x = piece.geometry.canonicalOffset.x;
      piece.container.y = piece.geometry.canonicalOffset.y;
      host.container.addChild(piece.container);
      host.pieces.push(piece);
      this.pieceToGroup.set(pieceId, targetGid);
    }

    for (const [gid, node] of this.groups) {
      if (snapGroupIds.has(gid)) continue;
      this.forgetGroup(gid);
      node.container.destroy({ children: true });
      this.groups.delete(gid);
    }

    // A whole-board snapshot can move any cluster, so every resident tile is
    // stale; re-baking the bounded resident set is cheap. Mark them dirty before
    // refreshing visibility so the covered groups fall back to live (no gap)
    // until the bake queue catches up.
    this.lodLayer?.markAllDirty();

    for (const g of groups) {
      const node = this.groups.get(g.id);
      if (!node) continue;
      if (this.held && this.held.groupId === g.id) continue;
      node.localBounds = unionBounds(node.pieces.map((p) => p.localBounds));
      const becameLocked = !node.locked && g.locked;
      node.locked = g.locked;
      this.moveGroup(node, g.worldX, g.worldY);
      if (becameLocked) {
        node.container.zIndex = Z_LOCKED;
        this.applyGroupInteractivity(node);
      }
    }

    if (this.lodActive) this.refreshLodVisibility();
  }

  // ----- incoming server messages -----

  applyGrabOk(groupId: number, userId: string): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    if (userId === this.localUserId && this.held && this.held.groupId === groupId) {
      this.held.confirmed = true;
      return;
    }
    // Remote grab: keep group visible on top while held by someone else, and
    // mark it live so the LOD bake leaves it out and draws it on top.
    node.container.zIndex = Z_REMOTE_HELD;
    this.markGroupHeld(node);
  }

  applyGrabDenied(groupId: number): void {
    if (!this.held || this.held.groupId !== groupId) return;
    const node = this.groups.get(groupId);
    if (node) {
      this.markTilesDirty(this.worldAabb(node));
      this.moveGroup(node, this.held.originX, this.held.originY);
      this.setGroupHeldVisual(node, false);
    }
    this.releaseGroupHeld(groupId);
    this.held = null;
  }

  applyRemoteDrag(groupId: number, userId: string, worldX: number, worldY: number): void {
    if (userId === this.localUserId) return;
    const node = this.groups.get(groupId);
    if (!node) return;
    // A drag for a group we never saw grabbed (joined mid-drag) still marks it
    // live, so it renders over the LOD instead of sitting frozen in the texture.
    this.markGroupHeld(node);
    this.moveGroup(node, worldX, worldY);
  }

  applyRemoteDrop(groupId: number, userId: string, worldX: number, worldY: number): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    // The drop can relocate a cluster that was never locally held (joined
    // mid-drag, or a drop with no prior drag frame), so the grab hook never
    // dirtied the old tile. Dirty it here, before the move, or it keeps a ghost.
    this.markTilesDirty(this.worldAabb(node));
    this.moveGroup(node, worldX, worldY);
    if (userId !== this.localUserId) {
      node.container.zIndex = this.restingZ(node);
    }
    this.releaseGroupHeld(groupId);
  }

  applyRollback(groupId: number, worldX: number, worldY: number): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    this.markTilesDirty(this.worldAabb(node));
    this.moveGroup(node, worldX, worldY);
    if (this.held && this.held.groupId === groupId) {
      this.setGroupHeldVisual(node, false);
      this.held = null;
    }
    this.releaseGroupHeld(groupId);
  }

  // ----- collaborator cursors -----

  addPeer(userId: string, pseudo: string | null): void {
    this.peerCursors?.upsertPeer(userId, pseudo);
  }

  removePeer(userId: string): void {
    this.peerCursors?.removePeer(userId);
  }

  setPeerCursor(userId: string, worldX: number, worldY: number): void {
    this.peerCursors?.setCursor(userId, worldX, worldY);
  }

  setPeerHeld(userId: string, held: boolean): void {
    this.peerCursors?.setHeld(userId, held);
  }

  applySnap(
    newGroupId: number,
    addedPieceIds: number[],
    worldX: number,
    worldY: number,
    anchored: boolean,
  ): void {
    const host = this.groups.get(newGroupId);
    if (!host) return;

    const sourceGroupIds = new Set<number>();
    for (const pieceId of addedPieceIds) {
      const gid = this.pieceToGroup.get(pieceId);
      if (gid !== undefined && gid !== newGroupId) sourceGroupIds.add(gid);
    }

    const hostOldRect = this.worldAabb(host);
    const preLockedPieceIds = new Set<number>();
    if (host.locked) for (const p of host.pieces) preLockedPieceIds.add(p.id);
    for (const gid of sourceGroupIds) {
      const src = this.groups.get(gid);
      if (src?.locked) for (const p of src.pieces) preLockedPieceIds.add(p.id);
    }
    const addedSet = new Set(addedPieceIds);

    // Reparent each added piece into the host container, preserving its world
    // position. Canonical offsets are globally consistent so we just set the
    // piece container's local position to its canonical offset; the host will
    // be moved to (worldX, worldY) below.
    for (const pieceId of addedPieceIds) {
      const fromGroupId = this.pieceToGroup.get(pieceId);
      if (fromGroupId === undefined) continue;
      const from = this.groups.get(fromGroupId);
      if (!from) continue;
      const piece = from.pieces.find((p) => p.id === pieceId);
      if (!piece) continue;
      from.container.removeChild(piece.container);
      from.pieces = from.pieces.filter((p) => p.id !== pieceId);
      piece.container.x = piece.geometry.canonicalOffset.x;
      piece.container.y = piece.geometry.canonicalOffset.y;
      host.container.addChild(piece.container);
      host.pieces.push(piece);
      this.pieceToGroup.set(pieceId, newGroupId);
    }

    host.localBounds = unionBounds(host.pieces.map((p) => p.localBounds));
    this.markTilesDirty(hostOldRect);
    this.moveGroup(host, worldX, worldY);
    host.locked = host.locked || anchored;
    this.setGroupHeldVisual(host, false);
    this.markTilesDirty(this.worldAabb(host));

    for (const gid of sourceGroupIds) {
      const dead = this.groups.get(gid);
      if (!dead) continue;
      this.markTilesDirty(this.worldAabb(dead));
      this.forgetGroup(gid);
      dead.container.destroy({ children: true });
      this.groups.delete(gid);
    }

    this.applyGroupInteractivity(host);

    this.heldGroupIds.delete(newGroupId);

    if (this.held && (this.held.groupId === newGroupId || sourceGroupIds.has(this.held.groupId))) {
      this.held = null;
    }

    for (const piece of host.pieces) {
      if (preLockedPieceIds.has(piece.id)) continue;
      if (addedSet.has(piece.id) || host.locked) this.playSnapAnimation(piece);
    }
  }

  playEndOfPuzzle(): void {
    if (!this.tweener || !this.app) return;

    // Per-piece staggered pulse radiating from the puzzle center.
    const allPieces: { piece: PieceNode; worldCx: number; worldCy: number }[] = [];
    for (const group of this.groups.values()) {
      for (const p of group.pieces) {
        const cx = group.worldX + p.container.x + p.inner.position.x;
        const cy = group.worldY + p.container.y + p.inner.position.y;
        allPieces.push({ piece: p, worldCx: cx, worldCy: cy });
      }
    }
    if (allPieces.length === 0) return;

    let cxAvg = 0;
    let cyAvg = 0;
    for (const e of allPieces) {
      cxAvg += e.worldCx;
      cyAvg += e.worldCy;
    }
    cxAvg /= allPieces.length;
    cyAvg /= allPieces.length;

    let maxDist = 0;
    const distances = allPieces.map((e) => {
      const dx = e.worldCx - cxAvg;
      const dy = e.worldCy - cyAvg;
      const d = Math.hypot(dx, dy);
      if (d > maxDist) maxDist = d;
      return d;
    });

    for (let i = 0; i < allPieces.length; i++) {
      const piece = allPieces[i]!.piece;
      const delay = maxDist > 0 ? (distances[i]! / maxDist) * END_PULSE_SPREAD_MS : 0;
      this.tweener.add({
        duration: END_PULSE_MS,
        delay,
        easing: peak,
        onUpdate: (v) => {
          const s = 1 + (END_PULSE_SCALE - 1) * v;
          piece.inner.scale.set(s);
        },
        onDone: () => piece.inner.scale.set(1),
      });
    }

    // Full-screen flash sitting above the world but below any HTML overlay.
    const flash = new Graphics();
    const s = this.app.renderer.screen;
    flash.rect(0, 0, s.width, s.height).fill({ color: 0xffffff });
    flash.alpha = 0;
    this.app.stage.addChild(flash);
    this.tweener.add({
      duration: END_FLASH_MS,
      easing: peak,
      onUpdate: (v) => {
        flash.alpha = END_FLASH_ALPHA * v;
      },
      onDone: () => {
        flash.destroy();
      },
    });
  }

  startConfetti(): void {
    if (!this.app || this.confetti) return;
    const layer = new Container();
    layer.eventMode = "none";
    this.app.stage.addChild(layer);
    const state = {
      layer,
      particles: [] as ConfettiParticle[],
      spawnAcc: 0,
      tick: (ticker: { deltaMS: number }) => this.tickConfetti(ticker.deltaMS),
    };
    this.confetti = state;
    this.app.ticker.add(state.tick);
  }

  stopConfetti(): void {
    if (!this.confetti || !this.app) return;
    this.app.ticker.remove(this.confetti.tick);
    this.confetti.layer.destroy({ children: true });
    this.confetti = null;
  }

  private tickConfetti(dtMs: number): void {
    if (!this.confetti || !this.app) return;
    const dt = dtMs / 1000;
    const screen = this.app.renderer.screen;
    const c = this.confetti;

    c.spawnAcc += CONFETTI_SPAWN_PER_SEC * dt;
    while (c.spawnAcc >= 1 && c.particles.length < CONFETTI_MAX) {
      c.spawnAcc -= 1;
      c.particles.push(this.spawnConfettiParticle(screen.width));
    }
    if (c.spawnAcc > 1) c.spawnAcc = 1;

    const next: ConfettiParticle[] = [];
    for (const p of c.particles) {
      p.vy += CONFETTI_GRAVITY * dt;
      p.wobble += p.wobbleSpeed * dt;
      const x = p.gfx.x + (p.vx + Math.sin(p.wobble) * 40) * dt;
      const y = p.gfx.y + p.vy * dt;
      p.rot += p.rotSpeed * dt;
      p.gfx.position.set(x, y);
      p.gfx.rotation = p.rot;
      if (y > screen.height + 40) {
        p.gfx.destroy();
        continue;
      }
      next.push(p);
    }
    c.particles = next;
  }

  private spawnConfettiParticle(screenWidth: number): ConfettiParticle {
    const w = CONFETTI_SIZE_MIN + Math.random() * (CONFETTI_SIZE_MAX - CONFETTI_SIZE_MIN);
    const h = w * (0.45 + Math.random() * 0.55);
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!;
    const gfx = new Graphics();
    gfx.rect(-w / 2, -h / 2, w, h).fill({ color });
    gfx.position.set(Math.random() * screenWidth, -20 - Math.random() * 60);
    this.confetti!.layer.addChild(gfx);
    return {
      gfx,
      vx: -60 + Math.random() * 120,
      vy: 60 + Math.random() * 140,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: -4 + Math.random() * 8,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 2 + Math.random() * 3,
    };
  }

  private playSnapAnimation(piece: PieceNode): void {
    if (!this.tweener) return;
    const { inner, flash } = piece;
    this.tweener.add({
      duration: SNAP_BUMP_MS,
      easing: peak,
      onUpdate: (v) => {
        const s = 1 + (SNAP_BUMP_SCALE - 1) * v;
        inner.scale.set(s);
      },
      onDone: () => inner.scale.set(1),
    });
    this.tweener.add({
      duration: SNAP_FLASH_MS,
      easing: easeOutCubic,
      onUpdate: (v) => {
        flash.alpha = SNAP_FLASH_ALPHA * (1 - v);
      },
      onDone: () => {
        flash.alpha = 0;
      },
    });
  }

  // ----- internals -----

  private applyGroupInteractivity(node: GroupNode): void {
    const interactive = this.mode === "contributor" && !node.locked;
    node.container.eventMode = interactive ? "static" : "none";
    node.container.cursor = interactive ? "grab" : "default";
    node.container.off("pointerdown");
    if (interactive) {
      node.container.on("pointerdown", (ev) => this.onGroupPointerDown(node, ev));
    }
  }

  private onGroupPointerDown(node: GroupNode, ev: FederatedPointerEvent): void {
    if (!this.callbacks) return;
    if (node.locked) return;
    ev.stopPropagation();
    const world = this.screenToWorld(ev.global.x, ev.global.y);
    this.held = {
      groupId: node.id,
      pointerDx: world.x - node.worldX,
      pointerDy: world.y - node.worldY,
      originX: node.worldX,
      originY: node.worldY,
      confirmed: false,
    };
    this.markGroupHeld(node);
    this.setGroupHeldVisual(node, true);
    this.callbacks.onGrab(node.id);
  }

  private onStagePointerDown(ev: FederatedPointerEvent): void {
    if (this.held) return;
    this.pan.active = true;
    this.pan.lastX = ev.global.x;
    this.pan.lastY = ev.global.y;
  }

  private onPointerMove(ev: FederatedPointerEvent): void {
    // Only contributors broadcast a cursor; spectators stay invisible to peers.
    if (this.mode === "contributor" && this.onCursorMove) {
      const cursor = this.screenToWorld(ev.global.x, ev.global.y);
      this.onCursorMove(cursor.x, cursor.y);
    }
    if (this.held) {
      const node = this.groups.get(this.held.groupId);
      if (!node || !this.callbacks) return;
      const world = this.screenToWorld(ev.global.x, ev.global.y);
      const { x: nx, y: ny } = this.clampGroupOrigin(
        node,
        world.x - this.held.pointerDx,
        world.y - this.held.pointerDy,
      );
      this.moveGroup(node, nx, ny);
      this.pendingDrag = { worldX: nx, worldY: ny };
      return;
    }
    if (this.pan.active) {
      this.camera.x += ev.global.x - this.pan.lastX;
      this.camera.y += ev.global.y - this.pan.lastY;
      this.pan.lastX = ev.global.x;
      this.pan.lastY = ev.global.y;
      this.applyCamera();
    }
  }

  private onPointerUp(ev: FederatedPointerEvent): void {
    if (this.held) {
      const node = this.groups.get(this.held.groupId);
      if (node && this.callbacks) {
        const world = this.screenToWorld(ev.global.x, ev.global.y);
        const { x: nx, y: ny } = this.clampGroupOrigin(
          node,
          world.x - this.held.pointerDx,
          world.y - this.held.pointerDy,
        );
        this.moveGroup(node, nx, ny);
        this.setGroupHeldVisual(node, false);
        this.callbacks.onDrop(node.id, nx, ny);
        this.releaseGroupHeld(node.id);
      }
      this.held = null;
    }
    this.pan.active = false;
  }

  private setGroupHeldVisual(node: GroupNode, held: boolean): void {
    // Scale each piece around its own inner pivot, not the group container:
    // the container origin sits at the puzzle's canonical origin, so scaling
    // it shifts every piece by its canonical offset and makes the cluster
    // jump away from the cursor on grab and drop.
    const scale = held ? HELD_SCALE : 1;
    for (const piece of node.pieces) piece.inner.scale.set(scale);
    node.container.zIndex = held ? Z_LOCAL_HELD : this.restingZ(node);
  }

  // Stacking order a group returns to when it is not held: locked clusters
  // drop to the base layer, loose clusters stay above them.
  private restingZ(node: GroupNode): number {
    return node.locked ? Z_LOCKED : Z_UNLOCKED;
  }

  private moveGroup(node: GroupNode, worldX: number, worldY: number): void {
    node.worldX = worldX;
    node.worldY = worldY;
    node.container.position.set(worldX, worldY);
    this.groupGrid.upsert(node.id, this.worldAabb(node));
    this.cullGroup(node);
  }

  // Constrains a group origin so none of its pieces leaves the play zone.
  // Applied to local drag and drop input; remote positions arrive already
  // clamped by their sender.
  private clampGroupOrigin(node: GroupNode, x: number, y: number): { x: number; y: number } {
    if (!this.playZone) return { x, y };
    const b = node.localBounds;
    return {
      x: clamp(x, this.playZone.minX - b.minX, this.playZone.maxX - b.maxX),
      y: clamp(y, this.playZone.minY - b.minY, this.playZone.maxY - b.maxY),
    };
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.camera.x) / this.camera.zoom,
      y: (sy - this.camera.y) / this.camera.zoom,
    };
  }

  // Fit the whole play zone, plus its padding ring, into the viewport and
  // center on it. Zoom is clamped to MIN_ZOOM, so a large board stays partly
  // off-screen rather than zooming out past the limit.
  fitView(): void {
    if (!this.app || !this.playZone) return;
    const screen = this.app.renderer.screen;
    const pad = this.playZonePadding();
    const w = this.playZone.maxX - this.playZone.minX + pad * 2;
    const h = this.playZone.maxY - this.playZone.minY + pad * 2;
    this.camera.zoom = clamp(Math.min(screen.width / w, screen.height / h), MIN_ZOOM, MAX_ZOOM);
    this.centerOn(
      (this.playZone.minX + this.playZone.maxX) / 2,
      (this.playZone.minY + this.playZone.maxY) / 2,
    );
  }

  centerView(): void {
    if (!this.worldSize) return;
    this.centerOn(this.worldSize.w / 2, this.worldSize.h / 2);
  }

  zoomIn(): void {
    this.zoomBy(1.25);
  }

  zoomOut(): void {
    this.zoomBy(1 / 1.25);
  }

  getMinimapSnapshot(): MinimapSnapshot | null {
    if (!this.playZone || !this.worldSize) return null;
    const pieces: MinimapPiece[] = [];
    for (const group of this.groups.values()) {
      for (const piece of group.pieces) {
        pieces.push({
          x: group.worldX + (piece.localBounds.minX + piece.localBounds.maxX) / 2,
          y: group.worldY + (piece.localBounds.minY + piece.localBounds.maxY) / 2,
          locked: group.locked,
        });
      }
    }
    return {
      playZone: this.playZone,
      frame: { w: this.worldSize.w, h: this.worldSize.h },
      pieces,
      viewport: this.viewport,
    };
  }

  // Places (worldCx, worldCy) at the screen center, then lets applyCamera's
  // clamp pull it back inside the play-zone limit if that overshoots.
  private centerOn(worldCx: number, worldCy: number): void {
    if (!this.app) return;
    const screen = this.app.renderer.screen;
    this.camera.x = screen.width * 0.5 - worldCx * this.camera.zoom;
    this.camera.y = screen.height * 0.5 - worldCy * this.camera.zoom;
    this.applyCamera();
  }

  private zoomBy(factor: number): void {
    if (!this.app) return;
    const screen = this.app.renderer.screen;
    const px = screen.width * 0.5;
    const py = screen.height * 0.5;
    const next = clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = next / this.camera.zoom;
    this.camera.x = px - (px - this.camera.x) * k;
    this.camera.y = py - (py - this.camera.y) * k;
    this.camera.zoom = next;
    this.applyCamera();
  }

  // Keeps the camera within the play zone expanded by one padding ring. When
  // the viewport is larger than that limit on an axis, it centers instead.
  private clampCamera(): void {
    if (!this.app || !this.playZone) return;
    const screen = this.app.renderer.screen;
    const pad = this.playZonePadding();
    const wx = fitOrClamp(
      -this.camera.x / this.camera.zoom,
      this.playZone.minX - pad,
      this.playZone.maxX + pad,
      screen.width / this.camera.zoom,
    );
    const wy = fitOrClamp(
      -this.camera.y / this.camera.zoom,
      this.playZone.minY - pad,
      this.playZone.maxY + pad,
      screen.height / this.camera.zoom,
    );
    this.camera.x = -wx * this.camera.zoom;
    this.camera.y = -wy * this.camera.zoom;
  }

  private applyCamera(): void {
    if (!this.world) return;
    this.clampCamera();
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(this.camera.x, this.camera.y);
    this.onCameraChange?.({ ...this.camera });
    this.cullAll();
    this.notifyViewport();
    this.evaluateLod();
  }

  // Recomputes the visible world rectangle, then re-evaluates only the groups the
  // spatial index reports near the viewport (O(visible), not O(board)). Groups
  // that left the query region since last frame are culled from lastVisible.
  // Runs on every pan, zoom, and resize, whether or not the LOD is active.
  private cullAll(): void {
    if (!this.app) return;
    const screen = this.app.renderer.screen;
    const topLeft = this.screenToWorld(0, 0);
    const view: Viewport = {
      worldX: topLeft.x,
      worldY: topLeft.y,
      worldW: screen.width / this.camera.zoom,
      worldH: screen.height / this.camera.zoom,
    };
    this.viewport = view;
    const candidates = this.groupGrid.queryRect({
      minX: view.worldX,
      minY: view.worldY,
      maxX: view.worldX + view.worldW,
      maxY: view.worldY + view.worldH,
    });
    for (const gid of candidates) {
      const node = this.groups.get(gid);
      if (!node) continue;
      this.cullGroup(node);
      if (this.lodActive) this.applyGroupLodVisibility(node);
    }
    for (const gid of this.lastVisible) {
      if (candidates.has(gid)) continue;
      const node = this.groups.get(gid);
      if (!node) continue;
      node.container.culled = true;
      // It left the candidate path, so if an active LOD had hidden it, restore
      // its live visibility here: nothing else will (keeps lodHidden bounded).
      if (this.lodHidden.delete(gid)) node.container.visible = true;
    }
    this.lastVisible = candidates;
  }

  // Culls one group against the cached viewport. A group whose bounds miss the
  // viewport is culled whole, skipping its pieces; a group that intersects has
  // each piece tested individually, so a large partially-visible cluster only
  // renders the pieces actually on screen.
  private cullGroup(node: GroupNode): void {
    const view = this.viewport;
    if (!view) return;
    if (!boundsVisible(node.localBounds, node.worldX, node.worldY, view)) {
      node.container.culled = true;
      return;
    }
    node.container.culled = false;
    for (const piece of node.pieces) {
      piece.container.culled = !boundsVisible(piece.localBounds, node.worldX, node.worldY, view);
    }
  }

  // Hands the cached viewport to the consumer, which reports it to the server
  // for drag and drop broadcast scoping. Fires on every pan, zoom, and resize.
  private notifyViewport(): void {
    if (!this.viewport || !this.onViewportChange) return;
    this.onViewportChange(this.viewport);
  }

  // World-space AABB of a group, from its origin and analytic local bounds.
  private worldAabb(node: GroupNode): Aabb {
    const b = node.localBounds;
    return {
      minX: node.worldX + b.minX,
      minY: node.worldY + b.minY,
      maxX: node.worldX + b.maxX,
      maxY: node.worldY + b.maxY,
    };
  }

  // Drops a group from every index that tracks it, before it is destroyed
  // (merged away, vanished from a snapshot, or world cleared), so the cull diff
  // and LOD bookkeeping never touch a dead node.
  private forgetGroup(gid: number): void {
    this.groupGrid.remove(gid);
    this.lastVisible.delete(gid);
    this.lodHidden.delete(gid);
    this.heldGroupIds.delete(gid);
  }

  // ----- zoom-out level of detail -----

  // Builds the tile layer over the play zone and sizes it for the current
  // screen. The container is a child of world (zIndex Z_LOD), so the camera
  // transforms the tiles like any other content.
  private createLodLayer(): void {
    if (!this.world || !this.app || !this.playZone) return;
    const layer = new LodTileLayer(this.playZone, this.app.renderer.resolution);
    layer.container.zIndex = Z_LOD;
    this.world.addChild(layer.container);
    this.lodLayer = layer;
    this.configureLodLayer();
  }

  private configureLodLayer(): void {
    if (!this.lodLayer || !this.app) return;
    const screen = this.app.renderer.screen;
    this.lodLayer.configure(screen.width, screen.height, MIN_ZOOM);
  }

  // Crosses the three zoom bands. The bake queue (drained in tickLodFrame) fills
  // tiles in the background while warm, so reaching the active band does not
  // hitch; LOD_EXIT_ZOOM gives the active band hysteresis.
  private evaluateLod(): void {
    if (!this.lodLayer) return;
    const zoom = this.camera.zoom;
    this.lodWarm = zoom < LOD_WARM_ZOOM;
    const active = this.lodActive ? zoom < LOD_EXIT_ZOOM : zoom < LOD_ENTER_ZOOM;
    if (active !== this.lodActive) this.setLodActive(active);
  }

  // Shows or hides the baked tiles. Entering bakes any screen-cover tiles the warm
  // band did not pre-bake (a direct jump below LOD_ENTER_ZOOM has no warm interval)
  // in one burst, then hides the on-screen clusters now covered by a ready tile
  // (held and not-yet-baked ones stay live, gapless); exiting restores exactly the
  // clusters the LOD had hidden.
  private setLodActive(active: boolean): void {
    if (!this.lodLayer) return;
    this.lodActive = active;
    this.lodLayer.setVisible(active);
    if (active) {
      this.bakeViewportCover();
      this.refreshLodVisibility();
    } else {
      for (const gid of this.lodHidden) {
        const node = this.groups.get(gid);
        if (node) node.container.visible = true;
      }
      this.lodHidden.clear();
    }
  }

  // Re-evaluates LOD visibility for the current on-screen candidates. Used on
  // enter and after a snapshot, where many tiles change at once.
  private refreshLodVisibility(): void {
    for (const gid of this.lastVisible) {
      const node = this.groups.get(gid);
      if (node) this.applyGroupLodVisibility(node);
    }
  }

  // Gapless fill: while the LOD is active a non-held cluster renders live until
  // every tile it occupies is baked, then hides (the tiles draw it). Held
  // clusters always render live on top. Hiding a cluster also makes it
  // non-interactive (Pixi skips hit-testing an invisible container), so no grab
  // can start below LOD_ENTER_ZOOM: the active band is overview-only by design
  // (see DECISIONS.md, tiled zoom-out LOD).
  private applyGroupLodVisibility(node: GroupNode): void {
    const live = this.heldGroupIds.has(node.id) || !this.allCellsReady(node.id);
    node.container.visible = live;
    if (live) this.lodHidden.delete(node.id);
    else this.lodHidden.add(node.id);
  }

  private allCellsReady(gid: number): boolean {
    if (!this.lodLayer) return false;
    for (const key of this.groupGrid.cellsOf(gid)) {
      if (!this.lodLayer.isReady(key)) return false;
    }
    return true;
  }

  // A grabbed cluster is excluded from future bakes though its position has not
  // changed, so its resting tile is now stale (a ghost). Dirty it on the grab
  // transition only; per-frame drag moves of an already-held cluster stay off
  // the dirty path (held = drawn live, excluded from bakes).
  private markGroupHeld(node: GroupNode): void {
    const wasHeld = this.heldGroupIds.has(node.id);
    this.heldGroupIds.add(node.id);
    if (this.lodActive) node.container.visible = true;
    if (!wasHeld) this.markTilesDirty(this.worldAabb(node));
  }

  // The released cluster's new resting tile must fold it back in. It stays live
  // until that tile re-bakes (gapless), then the bake hides it.
  private releaseGroupHeld(groupId: number): void {
    this.heldGroupIds.delete(groupId);
    const node = this.groups.get(groupId);
    if (node) this.markTilesDirty(this.worldAabb(node));
  }

  // Marks every resident tile overlapping the box stale, and (while active)
  // flips the box's clusters back to live so nothing disappears in the gap
  // between a tile going stale and the bake queue refreshing it.
  private markTilesDirty(box: Aabb): void {
    if (!this.lodLayer) return;
    this.lodLayer.markDirtyRect(box);
    if (!this.lodActive) return;
    for (const gid of this.groupGrid.queryRect(box)) {
      const node = this.groups.get(gid);
      if (node) this.applyGroupLodVisibility(node);
    }
  }

  // Bakes every screen-cover tile not already ready, synchronously. Called once on
  // the inactive->active transition: a direct jump below LOD_ENTER_ZOOM (cold start,
  // fit, double-click, keyboard) never crossed the warm band, so without this the
  // 2-tiles/frame queue would leave the viewport rendering every cluster live for
  // ~0.3-1s. The set is bounded by the screen (configure sizes the resident cap and
  // VRAM ceiling to hold it), so the burst is one longer frame, not unbounded work.
  // The progressive wheel path enters already warm, so these are mostly ready and
  // this is a near no-op.
  private bakeViewportCover(): void {
    if (!this.lodLayer || !this.viewport) return;
    for (const key of this.lodLayer.neededTiles(this.viewport)) {
      if (this.lodLayer.isReady(key)) continue;
      this.bakeTile(key);
    }
  }

  // Per-frame LOD driver: while warm or active, enqueue the visible-but-not-ready
  // tiles, bake a bounded few of them, and keep the resident set within budget.
  private tickLodFrame(): void {
    if (!this.lodLayer || !this.viewport) return;
    if (!this.lodWarm && !this.lodActive) return;
    const needed = this.lodLayer.neededTiles(this.viewport);
    let baked = 0;
    for (const key of needed) {
      if (baked >= LOD_BAKE_PER_FRAME) break;
      if (this.lodLayer.isReady(key)) continue;
      this.bakeTile(key);
      baked++;
    }
    this.lodLayer.cull(this.viewport);
  }

  // Renders one tile's clusters into its texture with the tile matrix as the root
  // transform (bypassing the camera). Held clusters, the frame, the backdrop and
  // the tile layer are excluded; non-tile clusters clip out of the texture, so
  // only this tile's clusters contribute. After baking, the tile's clusters are
  // re-culled and (if active) hidden now that the tile covers them.
  private bakeTile(key: CellKey): void {
    if (!this.app || !this.world || !this.lodLayer) return;
    const target = this.lodLayer.prepareBake(key);
    if (!target) return;
    const groupIds = this.groupGrid.cellGroups(key);
    const r = this.lodLayer.cellRect(key);
    const tileView: Viewport = {
      worldX: r.minX,
      worldY: r.minY,
      worldW: r.maxX - r.minX,
      worldH: r.maxY - r.minY,
    };

    if (this.frame) this.frame.visible = false;
    if (this.backdrop) this.backdrop.visible = false;
    this.lodLayer.setVisible(false);
    const heldHidden: GroupNode[] = [];
    const forced: GroupNode[] = [];
    if (groupIds) {
      for (const gid of groupIds) {
        const node = this.groups.get(gid);
        if (!node) continue;
        if (this.heldGroupIds.has(gid)) {
          node.container.visible = false;
          heldHidden.push(node);
          continue;
        }
        // Render only the cluster's pieces that fall inside the tile: a large
        // cluster spans many tiles, so unculling all of it would redraw far-off
        // pieces (which clip out anyway) once per tile it touches.
        node.container.visible = true;
        node.container.culled = false;
        for (const piece of node.pieces) {
          piece.container.culled = !boundsVisible(
            piece.localBounds,
            node.worldX,
            node.worldY,
            tileView,
          );
        }
        forced.push(node);
      }
    }

    this.app.renderer.render({
      container: this.world,
      target: target.texture,
      transform: target.matrix,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });

    if (this.frame) this.frame.visible = true;
    if (this.backdrop) this.backdrop.visible = true;
    this.lodLayer.setVisible(this.lodActive);
    this.lodLayer.markBaked(key);
    for (const node of heldHidden) node.container.visible = true;
    for (const node of forced) {
      this.cullGroup(node);
      if (this.lodActive) this.applyGroupLodVisibility(node);
      else node.container.visible = true;
    }
  }

  private attachWheelZoom(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const factor = Math.exp(-ev.deltaY * 0.0015);
        const next = clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const k = next / this.camera.zoom;
        this.camera.x = px - (px - this.camera.x) * k;
        this.camera.y = py - (py - this.camera.y) * k;
        this.camera.zoom = next;
        this.applyCamera();
      },
      { passive: false },
    );
  }
}

function buildPieceNode(
  geometry: PieceGeometry,
  texture: Texture,
  manifest: ImageManifest,
): PieceNode {
  const container = new Container();
  container.x = geometry.canonicalOffset.x;
  container.y = geometry.canonicalOffset.y;

  // Inner container holds the visuals and pivots around the piece visual
  // center so scale animations (held bump, snap bump) feel centered on the
  // piece rather than skewed toward the top-left.
  const half = manifest.pieceSize / 2;
  const inner = new Container();
  inner.pivot.set(half, half);
  inner.position.set(half, half);

  const sprite = new Sprite(texture);
  sprite.width = manifest.tileSize;
  sprite.height = manifest.tileSize;
  sprite.x = -manifest.margin;
  sprite.y = -manifest.margin;

  const path = piecePath(geometry, manifest.pieceSize);

  const mask = new Graphics();
  applyPath(mask, path);
  mask.fill({ color: 0xffffff });

  const flash = new Graphics();
  applyPath(flash, path);
  flash.fill({ color: 0xffffff });
  flash.alpha = 0;

  inner.addChild(sprite);
  inner.addChild(mask);
  inner.addChild(flash);
  sprite.mask = mask;

  container.addChild(inner);

  return {
    id: geometry.id,
    container,
    inner,
    flash,
    geometry,
    localBounds: pieceLocalBounds(
      geometry.canonicalOffset.x,
      geometry.canonicalOffset.y,
      manifest.pieceSize,
      manifest.margin,
    ),
  };
}

async function loadTextures(
  manifest: ImageManifest,
  base: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Map<number, Texture>> {
  const out = new Map<number, Texture>();
  const total = manifest.pieces.length;
  let loaded = 0;
  onProgress?.(0, total);
  const entries = await Promise.all(
    manifest.pieces.map(async (p) => {
      const url = joinUrl(base, p.file);
      try {
        const tex = (await Assets.load(url)) as Texture;
        return [p.id, tex] as const;
      } catch (e) {
        console.warn("[stage] failed to load", url, e);
        return null;
      } finally {
        loaded += 1;
        onProgress?.(loaded, total);
      }
    }),
  );
  for (const e of entries) if (e) out.set(e[0], e[1]);
  return out;
}

function joinUrl(base: string, rel: string): string {
  if (/^https?:\/\//.test(rel) || rel.startsWith("/")) return rel;
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Positions a window of `size` within [lo, hi]: clamps it inside when it fits,
// centers it when the window is larger than the range.
function fitOrClamp(v: number, lo: number, hi: number, size: number): number {
  if (size >= hi - lo) return (lo + hi - size) / 2;
  return clamp(v, lo, hi - size);
}
