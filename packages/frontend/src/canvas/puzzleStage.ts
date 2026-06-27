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
  compareSpectatorSeq,
  type GroupRuntime,
  type ImageManifest,
  type MinimapGrid,
  type PieceRuntime,
  type PlayZone,
  type RegionGroup,
  type SpectatorEvent,
  type SpectatorKeyframe,
  type SpectatorSnapEvent,
  type WirePiece,
} from "@mpp/shared";
import { Tweener, peak, easeOutCubic } from "./tween";
import { PeerCursorLayer } from "./peerCursors";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import { boundsVisible, pieceLocalBounds, unionBounds, type Aabb, type Viewport } from "./cull";
import { GroupGrid, LOD_TILE_WORLD, cellKeysForRect, unpackCell, type CellKey } from "./groupGrid";
import { LodTileLayer } from "./lodTiles";
import { LoadingOverlay } from "./loadingOverlay";
import { resyncShouldApply } from "./resync";
import { resolveSnap } from "./membership";
import { cellContentPending, coalesceDirtyCells, residencyDecision } from "./reconcile";

export type Mode = "spectator" | "contributor";

// Visible world rectangle, reported to the server so it can scope drag and
// drop broadcasts to this client. Also drives client-side frustum culling.
export type ViewportRect = Viewport;

// One piece reduced to a point for the minimap: its world center and whether
// its cluster is locked to the frame.
export type MinimapPiece = { x: number; y: number; locked: boolean };

// Everything the minimap needs to draw, pulled from the stage on demand. `grid`
// is the server-computed global density overview (decoupled from the now-partial
// local board); `pieces` is the live overlay of the locally known groups (the
// visited regions the client has fresh positions for), drawn on top to refine the
// coarse grid. Null grid degrades to the overlay alone until one arrives.
export type MinimapSnapshot = {
  playZone: PlayZone;
  frame: { w: number; h: number };
  grid: MinimapGrid | null;
  pieces: MinimapPiece[];
  viewport: Viewport | null;
};

// Grid-unit offset of a piece from its group anchor, server-provided so the
// client never derives a solved-space coordinate. A piece's local container
// position is (dx * pieceSize, dy * pieceSize).
type PieceOffset = { dx: number; dy: number };

type PieceNode = {
  id: number;
  container: Container;
  inner: Container;
  flash: Graphics;
  localBounds: Aabb;
};

type GroupNode = {
  id: number;
  container: Container;
  // Membership: the piece ids this group owns, each mapped to its (dx, dy) offset
  // from the group anchor. Maintained independently of whether textures and nodes
  // are built, so the group is fully described while dehydrated: the offsets drive
  // localBounds, container placement, and the minimap with no geometry or seed.
  members: Map<number, PieceOffset>;
  // Built piece nodes, present only for pieces currently hydrated. A dehydrated
  // group has an empty array and an empty container.
  pieces: PieceNode[];
  hydrated: boolean;
  hydrating: boolean;
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
  // Sticky "carry" mode (double-click a piece to attach its cluster to the
  // cursor). The cluster follows the pointer with no button held, and a button
  // release no longer drops it. Cleared on the drop double-click, Escape, or the
  // idle timeout.
  carry: boolean;
};

export type StageCallbacks = {
  onGrab: (groupId: number) => void;
  onDrag: (groupId: number, worldX: number, worldY: number) => void;
  onDrop: (groupId: number, worldX: number, worldY: number) => void;
};

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;
const HELD_SCALE = 1.02;

// In sticky carry the cluster floats to the upper-right of the cursor, its
// nearest (bottom-left) bounding-box corner held this many screen pixels clear
// of the pointer, so the whole cluster stays off the cursor whatever piece was
// grabbed and whatever the zoom. Constant in screen space (converted through the
// current zoom), so the gap feels identical at every zoom. Press-drag is
// unaffected (piece under the cursor); a carry drop lands the cluster at the
// cursor.
const HELD_CARRY_GAP = 40;

// Sticky carry mode (double-click a piece to stick its cluster to the cursor). A
// highlighted outline marks the carried cluster, and an idle timeout drops it so
// a player cannot park a cluster with its server-side lock held indefinitely.
const CARRY_HIGHLIGHT_COLOR = 0xffce47;
const CARRY_IDLE_TIMEOUT_MS = 30000;

// Edge-pan: when the pointer rests within this many screen pixels of a canvas
// edge, the camera scrolls toward that edge. Speed ramps quadratically from 0 at
// the inner band to EDGE_PAN_MAX_SPEED (screen px per second) at the very rim, so
// the pan is gentle on entry and fast at the edge. Screen-space speed keeps the
// feel constant across zoom levels; the play-zone clamp stops it at the bounds.
const EDGE_PAN_MARGIN = 56;
const EDGE_PAN_MAX_SPEED = 1100;

// The camera may travel one padding ring past the play zone; pieces stay
// strictly inside it.
const PLAY_ZONE_PADDING_FRACTION = 0.04;
const BACKDROP_COLOR = 0x15140f;
const BACKDROP_ALPHA = 0.3;
// Coarse checkerboard painted over the out-of-bounds fill, a deliberately
// different motif from the fine hairline grid inside the zone.
const BACKDROP_CHECKER_CELLS = 8;
const BACKDROP_CHECKER_ALPHA = 0.14;

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

// Shared empty set passed to the loading overlay when badges are suppressed (a
// zoom-out), so existing badges still age out via LINGER without a per-frame alloc.
const NO_LOADING_CELLS: ReadonlySet<CellKey> = new Set();

// A tile cell is "hot" for this long after its last real change (a drop, snap,
// rollback, grab, or a snapshot diff). A non-held cluster all of whose tiles are
// baked and cold ("covered-cold") renders entirely from its baked tiles, so its
// per-piece nodes add nothing on screen and become eligible for eviction. They are
// not freed eagerly: the budget evictor frees the coldest covered-cold clusters
// (LRU) only when resident nodes exceed RESIDENT_PIECE_BUDGET, so a zoom in/out
// under the budget keeps every node and never re-fetches, while a 1M deep zoom-out
// converges on the budget. Hotness keeps a recently-changed region hydrated so its
// tile can re-bake without a blank. The evictor runs every Nth frame: it scans the
// resident set it shrinks, so it self-limits and need not run every frame.
const LOD_HOT_TTL_MS = 9000;
const LOD_COLD_SWEEP_FRAMES = 6;

// Hydrated per-piece nodes kept resident before the budget evictor frees the
// coldest covered clusters (LRU). Sized above both the alpha board and a deep
// zoom-out window, so below it nothing is ever evicted (a zoom in/out re-uses the
// resident nodes with no re-fetch) and only a 1M deep zoom-out, whose window
// exceeds it, converges on it. The baked tiles keep drawing an evicted cluster, so
// freeing one is invisible; a later change to its cell re-hydrates it. VRAM is this
// count times one per-piece texture, the knob to tune against device VRAM.
const RESIDENT_PIECE_BUDGET = 24000;

// Viewport-driven texture streaming. Per-piece AVIF textures and their nodes are
// built on demand for groups within the hydrate ring around the viewport and
// freed when they leave the (wider) keep ring or become covered by a ready LOD
// tile. This bounds resident textures to the visible window instead of the whole
// board: entering the canvas never fetches every piece, and panning pages pieces
// in and out. Rings are fractions of the viewport size; the keep ring is wider
// than the hydrate ring so a piece hovering at the boundary does not thrash
// load/unload. HYDRATE_MAX_INFLIGHT bounds concurrent group loads so a deep
// zoom-out enqueues many groups without firing all their fetches at once.
const HYDRATE_MARGIN_FRAC = 0.3;
const DEHYDRATE_MARGIN_FRAC = 0.9;
const HYDRATE_MAX_INFLIGHT = 128;

// A piece texture is a few KB, so any load this slow is a stalled connection,
// not a slow one. Without a deadline a hung fetch pins its in-flight hydrate
// slot forever; enough of them saturate HYDRATE_MAX_INFLIGHT and the whole
// loader wedges. A timed-out or failed load is retried a bounded number of
// times, then skipped so the group still completes and the slot frees.
const TEXTURE_LOAD_TIMEOUT_MS = 10000;
const TEXTURE_LOAD_RETRIES = 1;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`load timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Post-download construction (the map/group/index passes in build()) runs in
// bursts of at most this many milliseconds, yielding to the event loop between
// bursts, so building up to 1M group nodes never freezes the main thread and the
// loading cover can paint determinate "build" progress.
const BUILD_CHUNK_BUDGET_MS = 8;

// Spectator stream interpolation. A non-merging drop is the end of an unseen
// drag, so the spectator eases the cluster from its previous resting position to
// the dropped position over this long instead of teleporting (snaps keep their
// instant lock + bump). Short enough to read as a settle.
const SPECTATOR_GLIDE_MS = 450;

// Caps how many event windows a single catch-up burst requests. A normal join
// replays from a keyframe up to the keyframe interval old (~100 windows at a 300s
// interval and 3s windows), so the cap sits comfortably above that and below the
// 900s retention: a real join replays fully, and only a pathological anchor (a
// tab backgrounded for many minutes, where the render clock and the keyframe
// refetch both stalled) is bounded, its gap healed by the next keyframe re-base.
const SPECTATOR_MAX_CATCHUP_WINDOWS = 256;

const SNAP_BUMP_SCALE = 1.08;
const SNAP_BUMP_MS = 240;
const SNAP_FLASH_ALPHA = 0.55;
const SNAP_FLASH_MS = 260;

// Small spark burst radiating from a piece the instant it locks. Anchored to the
// piece (world space, child of inner) so it scales with zoom. Capped per snap so
// a large cluster anchoring (which lights up every member) cannot spawn an
// unbounded number of particles.
const SNAP_BURST_COUNT = 7;
const SNAP_BURST_MS = 480;
const SNAP_BURST_MAX_PIECES = 6;
const SNAP_BURST_COLORS = [0xffffff, 0xffe9a8, 0xffd166];

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
  // Fixed z-order layers under world. Stacking is the child order of world
  // (locked < unlocked < lod < remote-held < local-held), so a group's depth is
  // which layer holds it, not a per-container zIndex. This keeps world free of
  // sortableChildren, whose sort would be O(N log N) over the whole board.
  private lockedLayer: Container | null = null;
  private unlockedLayer: Container | null = null;
  private remoteHeldLayer: Container | null = null;
  private localHeldLayer: Container | null = null;
  // Cached visible world rectangle, recomputed on every camera change and
  // resize; null until the first camera update. Drives frustum culling.
  private viewport: Viewport | null = null;
  private mode: Mode = "spectator";
  private localUserId: string | null = null;
  private callbacks: StageCallbacks | null = null;
  onCameraChange: ((camera: { x: number; y: number; zoom: number }) => void) | null = null;
  onViewportChange: ((viewport: ViewportRect) => void) | null = null;
  onCursorMove: ((worldX: number, worldY: number) => void) | null = null;
  // A user-facing notice the canvas cannot render itself (a DOM toast). Currently
  // only "tile_full": a drop the server rejected for exceeding the per-tile cap.
  onNotice: ((kind: "tile_full") => void) | null = null;
  // Fired when the local sticky-carry state changes, so the shell can show or hide
  // the carry hint. Contributor mode only.
  onCarryChange: ((carrying: boolean) => void) | null = null;

  private peerCursors: PeerCursorLayer | null = null;
  private readonly tickPeerCursors = (ticker: { deltaMS: number }): void => {
    this.peerCursors?.update(ticker.deltaMS, this.camera);
  };

  private held: HeldState | null = null;
  // The group under the last pointerdown (null when it hit empty stage), so the
  // DOM double-click can resolve which cluster to pick up for sticky carry: the
  // DOM event carries no Pixi target.
  private lastPointerDownGroupId: number | null = null;
  // Outline over the cluster currently carried, and the idle timer that drops it.
  // Only one cluster is ever carried at a time.
  private carryHighlight: Graphics | null = null;
  private carryIdleTimer: ReturnType<typeof setTimeout> | null = null;
  // Escape returns a carried cluster to where it was picked up. Window-level so it
  // fires without the canvas being focused; bound once for add/remove symmetry.
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && this.held?.carry) {
      ev.preventDefault();
      this.cancelCarry();
    }
  };
  // Groups this client dropped locally but for which the server's authoritative
  // drop/snap has not yet arrived. A pan resync carries the server's last
  // committed resting position, which is older than this in-flight drop, so it
  // must not rewind these (the ordering guard). Cleared when the drop/snap/
  // rollback for the group lands. See resyncShouldApply.
  private pendingDrops = new Set<number>();
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
  // Latest pointer position in screen space (renderer.screen coords, matching
  // ev.global), updated on every move and cleared when the pointer leaves the
  // canvas. Drives edge-pan, which reads it from the ticker so a pointer resting
  // in the edge band keeps scrolling without further move events.
  private pointerScreen: { x: number; y: number } | null = null;
  private readonly tickEdgePan = (ticker: { deltaMS: number }): void => {
    this.tickEdgePanFrame(ticker.deltaMS);
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
  // Per-cell loading badges, drawn over viewport cells whose known content is not
  // yet displayed (a tile not baked, or a group still hydrating).
  private loadingOverlay: LoadingOverlay | null = null;
  // Cells whose region_state has streamed in (their area was acked by the server's
  // coverage rect), so a viewport cell that is in the play zone but absent here has
  // not loaded yet. coverageSeen flips on the first ack: a viewport-streamed
  // contributor gets one, a full-board spectator never does, so the not-yet-loaded
  // badge applies only where the board streams in.
  private knownCells = new Set<CellKey>();
  private coverageSeen = false;
  // Server's viewport scoping bound (welcome.broadcastMaxCells), mirrored so the
  // client can tell a scoped viewport (streams region_state, whose coverage the
  // initial cover waits for) from a global-subscriber one (too large to scope, so
  // no region_state arrives and there is nothing to wait for). Infinity until a
  // contributor welcome sets it; a spectator never reads it.
  private broadcastMaxCells = Number.POSITIVE_INFINITY;
  private lodActive = false;
  private lodWarm = false;
  private heldGroupIds = new Set<number>();
  // Clusters mid-glide in the spectator stream. Like held clusters they are kept
  // live (drawn on top, excluded from bakes) for the slide, so their per-frame move
  // records no dirty; the glide records its start and settle tiles once instead.
  private glidingGroupIds = new Set<number>();
  // Frame-local dirty accumulator. Event handlers record world rects here via
  // markDirty; the per-frame reconcile (flushDirty) turns them into per-cell tile
  // invalidations and clears it. Pull-based, so several same-frame events on one
  // cell coalesce into a single re-bake.
  private dirtyRects: Aabb[] = [];
  // Per-cell last-change timestamp (performance.now), stamped by flushDirty for
  // every cell a frame dirtied (drop/snap/rollback/grab/glide and the snapshot
  // diff). Drives cell/group hotness for the cold-residents sweep; bounded by the
  // board's cell count and pruned of stale entries.
  private cellDirtyMs = new Map<CellKey, number>();
  private coldSweepFrame = 0;
  private readonly tickLod = (): void => {
    this.tickLodFrame();
  };

  // Texture streaming state. The manifest, geometry cache and per-piece texture
  // URLs are kept so a group can be hydrated (textures fetched, nodes built) and
  // dehydrated (nodes destroyed, textures unloaded) at any time after build().
  // resident is every group hydrated or in flight; hydrateQueue/hydrateQueued is
  // the pending load queue drained a bounded few per frame; inFlight counts
  // running group loads. initialFill resolves build()'s promise once the first
  // viewport is covered (tiles ready or window pieces built), keeping the loading
  // cover up over the progressive fill instead of an eager whole-board fetch.
  private manifest: ImageManifest | null = null;
  private textureBase = "";
  // Latest server-computed minimap density grid (contributor: the periodic WS
  // `minimap` message and one on join; spectator: the keyframe's grid). The
  // minimap renders this global overview plus a live overlay of the locally known
  // groups, so it stays complete while the local board is partial.
  private minimapGrid: MinimapGrid | null = null;
  // Incremented at the start of build(), and in clearWorld()/destroy(). Each
  // build()'s chunked passes capture it and bail when it changes, so a teardown
  // or rebuild mid-construction stops the in-flight passes.
  private buildToken = 0;
  private fileById = new Map<number, string>();
  // Resident groups (hydrated or loading), each mapped to an LRU stamp bumped while
  // the group is active (live, zoomed-in visible, or still feeding an unbaked tile)
  // and left untouched once it is covered-cold, so evictResidentsOverBudget frees the
  // coldest covered clusters first. The value orders eviction; the keys are the
  // resident set.
  private resident = new Map<number, number>();
  private residentLru = 0;
  private hydrateQueue: number[] = [];
  private hydrateQueued = new Set<number>();
  private inFlight = 0;
  private initialFill: {
    resolve: () => void;
    progress: ((loaded: number, total: number) => void) | undefined;
  } | null = null;

  private confetti: {
    layer: Container;
    particles: ConfettiParticle[];
    spawnAcc: number;
    tick: (ticker: { deltaMS: number }) => void;
  } | null = null;

  // Spectator stream driver (keyframe + event-log diffs). Active only in
  // spectator mode after startSpectatorStream. tickSpectator advances renderClock
  // to delayMs behind live each frame, applies due buffered events in seq order
  // (snaps animate, drops glide), re-bases onto a freshly fetched keyframe at the
  // render time it represents, and asks for the next sealed window via
  // onNeedWindow. renderClock, appliedCursor and the event times are all in the
  // server's ms epoch, which assumes the client clock roughly agrees (the delay
  // budget absorbs normal skew); a grossly wrong client clock degrades to a
  // lagged or fast-forwarded view, self-healed by the next keyframe re-base.
  private specActive = false;
  private specTailing = false;
  private renderClock = 0;
  private specWindowMs = 3000;
  private specDelayMs = 6000;
  private appliedCursor = "0-0";
  private pendingEvents: SpectatorEvent[] = [];
  private pendingKeyframe: SpectatorKeyframe | null = null;
  private specInterp = new Map<
    number,
    { fromX: number; fromY: number; toX: number; toY: number; startAt: number }
  >();
  private nextWindowT0 = 0;
  onNeedWindow: ((t0: number) => void) | null = null;
  onSpectatorSnap: ((e: SpectatorSnapEvent) => void) | null = null;
  private readonly tickSpectatorBound = (): void => this.tickSpectator();

  setMode(mode: Mode): void {
    this.mode = mode;
    for (const node of this.groups.values()) {
      this.applyGroupInteractivity(node);
    }
  }

  setLocalUserId(userId: string | null): void {
    this.localUserId = userId;
  }

  // The server's broadcast scoping bound, from the contributor welcome. Lets the
  // initial-fill gate mirror the server's scoped-vs-global viewport decision.
  setBroadcastMaxCells(maxCells: number): void {
    this.broadcastMaxCells = maxCells;
  }

  // Store the latest server minimap grid (WS `minimap` for a contributor, the
  // keyframe grid for a spectator). The minimap panel reads it via the next
  // getMinimapSnapshot.
  setMinimapGrid(grid: MinimapGrid): void {
    this.minimapGrid = grid;
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
    // Off-canvas: stop edge-pan (no pointer to read a band from).
    app.canvas.addEventListener("pointerleave", () => {
      this.pointerScreen = null;
    });
    app.renderer.on("resize", () => {
      this.refreshStageHitArea(app);
      this.redrawBackdrop();
      this.configureLodLayer();
      this.applyCamera();
    });

    this.app = app;
    this.world = world;
    this.tweener = new Tweener(app.ticker);
    // tickLod runs reconcile, the per-frame view authority, so it is added last:
    // it sees the model mutations the other tickers (edge-pan camera, spectator
    // stream) made this frame and reconciles them in the same frame.
    app.ticker.add(this.tickPeerCursors);
    app.ticker.add(this.tickDragFlush);
    app.ticker.add(this.tickEdgePan);
    app.ticker.add(this.tickSpectatorBound);
    app.ticker.add(this.tickLod);
    app.canvas.addEventListener("dblclick", (ev) => this.onCanvasDoubleClick(ev));
    window.addEventListener("keydown", this.onKeyDown);
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
    onProgress?: (p: { phase: "build" | "textures"; loaded: number; total: number }) => void,
  ): Promise<void> {
    if (!this.app || !this.world) throw new Error("stage not mounted");
    const world = this.world;
    const token = ++this.buildToken;

    this.manifest = manifest;
    this.textureBase = manifestBaseUrl(manifestUrlFor(manifest.puzzleId));

    this.worldSize = {
      w: manifest.cols * manifest.pieceSize,
      h: manifest.rows * manifest.pieceSize,
    };

    // The construction passes append many containers in bursts. Keep the world
    // non-renderable across them so Pixi does not traverse the partially built
    // subtree each frame between yields; renderable is restored before fitView.
    world.renderable = false;

    // Fixed z-order layers, created in stacking order (first child renders at the
    // bottom): backdrop, frame, locked, unlocked, then the held layers. The LOD
    // tile container is inserted into the slot before the held layers by
    // createLodLayer once the play zone is known. Depth is layer membership, so
    // the world needs no sortableChildren and pays no sort over the whole board.
    const backdrop = new Graphics();
    backdrop.eventMode = "none";
    world.addChild(backdrop);
    this.backdrop = backdrop;

    const frame = new Graphics();
    frame.rect(0, 0, this.worldSize.w, this.worldSize.h).stroke({ color: 0x1a1a1a, width: 4 });
    world.addChild(frame);
    this.frame = frame;

    this.lockedLayer = new Container();
    this.unlockedLayer = new Container();
    this.remoteHeldLayer = new Container();
    this.localHeldLayer = new Container();
    world.addChild(this.lockedLayer, this.unlockedLayer, this.remoteHeldLayer, this.localHeldLayer);

    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    this.cellDirtyMs.clear();
    this.knownCells.clear();
    this.coverageSeen = false;
    this.coldSweepFrame = 0;

    // Cumulative "build" progress across the three passes over a combined total,
    // so the loading cover walks a single determinate bar from 0 to 100 before
    // the texture phase takes over.
    const buildTotal = manifest.pieces.length + initialPieces.length + initialGroups.length;
    let buildBase = 0;
    const reportBuild = (done: number) =>
      onProgress?.({ phase: "build", loaded: buildBase + done, total: buildTotal });

    // Pass A: piece id -> texture file path.
    this.fileById = new Map<number, string>();
    if (
      !(await this.chunkedPass(
        token,
        manifest.pieces.length,
        (i) => {
          const p = manifest.pieces[i]!;
          this.fileById.set(p.id, p.file);
        },
        reportBuild,
      ))
    )
      return;
    buildBase += manifest.pieces.length;

    // Pass B: group -> member pieces (id + anchor offset). The piece -> group map
    // is set per group by constructGroup in Pass C, so this only buckets the wire
    // pieces by group.
    const piecesByGroup = new Map<number, WirePiece[]>();
    if (
      !(await this.chunkedPass(
        token,
        initialPieces.length,
        (i) => {
          const piece = initialPieces[i]!;
          let members = piecesByGroup.get(piece.groupId);
          if (!members) {
            members = [];
            piecesByGroup.set(piece.groupId, members);
          }
          members.push({ id: piece.id, dx: piece.dx, dy: piece.dy });
        },
        reportBuild,
      ))
    )
      return;
    buildBase += initialPieces.length;

    // Pass C: one dehydrated container per group (empty container, no textures
    // fetched) plus its spatial-index entry, via the shared constructGroup. The
    // spectator passes the full keyframe board here; a contributor passes empty
    // arrays (protocol v4), so this loop is a no-op and groups stream in later via
    // applyRegionState, which reuses the same constructGroup.
    if (
      !(await this.chunkedPass(
        token,
        initialGroups.length,
        (i) => {
          const group = initialGroups[i]!;
          this.constructGroup({
            groupId: group.id,
            worldX: group.worldX,
            worldY: group.worldY,
            locked: group.locked,
            pieces: piecesByGroup.get(group.id) ?? [],
          });
        },
        reportBuild,
      ))
    )
      return;

    this.playZone = playZone;
    world.renderable = true;
    this.redrawBackdrop();
    this.createLodLayer();
    this.createLoadingOverlay();
    this.fitView();

    // Stream the first viewport in (and bake its tiles when zoomed out) before
    // resolving, so the loading cover stays up until the board is actually on
    // screen rather than over an eager whole-board fetch.
    await this.awaitInitialCoverage((loaded, total) =>
      onProgress?.({ phase: "textures", loaded, total }),
    );
  }

  // Runs step(0..count-1) in bursts capped at BUILD_CHUNK_BUDGET_MS, yielding to
  // the event loop between bursts and reporting cumulative progress, so a large
  // pass never blocks the main thread. Returns false (and stops) if buildToken
  // changed since the pass started, i.e. a teardown or rebuild superseded it.
  private async chunkedPass(
    token: number,
    count: number,
    step: (i: number) => void,
    report: (done: number) => void,
  ): Promise<boolean> {
    let i = 0;
    while (i < count) {
      const start = performance.now();
      while (i < count && performance.now() - start < BUILD_CHUNK_BUDGET_MS) {
        step(i);
        i++;
      }
      report(i);
      if (i < count) {
        await yieldToEventLoop();
        if (this.buildToken !== token) return false;
      }
    }
    return true;
  }

  // Local AABB of a group from its members' anchor offsets (offset plus one margin
  // per piece), so a group's bounds are known without building any node and
  // without any geometry. A piece sits at (dx * pieceSize, dy * pieceSize) in the
  // group container.
  private boundsForMembers(members: ReadonlyMap<number, PieceOffset>): Aabb {
    if (!this.manifest || members.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const { pieceSize, margin } = this.manifest;
    const boxes: Aabb[] = [];
    for (const off of members.values()) {
      boxes.push(pieceLocalBounds(off.dx * pieceSize, off.dy * pieceSize, pieceSize, margin));
    }
    return unionBounds(boxes);
  }

  // Build one dehydrated group node from construction data: an empty container at
  // the group ORIGIN (pieces render at their canonical offset inside it), its
  // membership and geometry-derived bounds, the locked/unlocked layer, the
  // spatial-index entry, interactivity, and the piece -> group map. No textures
  // are fetched; the streaming engine hydrates the pieces when in view. Shared by
  // build() (the spectator's whole-board pass and a contributor's empty no-op) and
  // applyRegionState (each unknown group in a viewport-scoped construction stream).
  private constructGroup(spec: {
    groupId: number;
    worldX: number;
    worldY: number;
    locked: boolean;
    pieces: readonly WirePiece[];
  }): GroupNode {
    const gc = new Container();
    gc.x = spec.worldX;
    gc.y = spec.worldY;
    const members = new Map<number, PieceOffset>();
    for (const p of spec.pieces) members.set(p.id, { dx: p.dx, dy: p.dy });
    const node: GroupNode = {
      id: spec.groupId,
      container: gc,
      members,
      pieces: [],
      hydrated: false,
      hydrating: false,
      locked: spec.locked,
      worldX: spec.worldX,
      worldY: spec.worldY,
      localBounds: this.boundsForMembers(members),
    };
    (spec.locked ? this.lockedLayer! : this.unlockedLayer!).addChild(gc);
    this.groups.set(spec.groupId, node);
    for (const pieceId of members.keys()) this.pieceToGroup.set(pieceId, spec.groupId);
    this.groupGrid.upsert(node.id, this.worldAabb(node));
    this.applyGroupInteractivity(node);
    return node;
  }

  // Move one piece's membership to a host group, placing it at its new anchor
  // offset: update the piece -> group map and the host's member map unconditionally
  // (authoritative even when the source group was never built on a partial board),
  // then reparent the built node only when the source group and the piece node both
  // exist. Shared by applySnap and the additive reconcile in applyRegionState.
  private movePieceMembership(pieceId: number, offset: PieceOffset, host: GroupNode): void {
    const fromGid = this.pieceToGroup.get(pieceId);
    if (fromGid === host.id) return;
    this.pieceToGroup.set(pieceId, host.id);
    host.members.set(pieceId, offset);
    if (fromGid === undefined) return;
    const from = this.groups.get(fromGid);
    if (!from) return;
    from.members.delete(pieceId);
    const piece = from.pieces.find((p) => p.id === pieceId);
    if (!piece) return;
    from.container.removeChild(piece.container);
    from.pieces = from.pieces.filter((p) => p.id !== pieceId);
    this.placePieceInContainer(piece, offset);
    host.container.addChild(piece.container);
    host.pieces.push(piece);
  }

  // Position a built piece node at its anchor offset inside its group container.
  private placePieceInContainer(piece: PieceNode, offset: PieceOffset): void {
    const pieceSize = this.manifest?.pieceSize ?? 0;
    piece.container.x = offset.dx * pieceSize;
    piece.container.y = offset.dy * pieceSize;
  }

  private playZonePadding(): number {
    if (!this.playZone) return 0;
    const w = this.playZone.maxX - this.playZone.minX;
    const h = this.playZone.maxY - this.playZone.minY;
    return Math.max(w, h) * PLAY_ZONE_PADDING_FRACTION;
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
    this.buildToken++;
    this.stopConfetti();
    this.clearCarryIdle();
    window.removeEventListener("keydown", this.onKeyDown);
    this.tweener?.destroy();
    this.tweener = null;
    this.app?.ticker.remove(this.tickPeerCursors);
    this.app?.ticker.remove(this.tickDragFlush);
    this.app?.ticker.remove(this.tickEdgePan);
    this.app?.ticker.remove(this.tickLod);
    this.app?.ticker.remove(this.tickSpectatorBound);
    this.resetSpectatorStream();
    this.onNeedWindow = null;
    this.onSpectatorSnap = null;
    this.peerCursors?.destroy();
    this.peerCursors = null;
    this.lodLayer?.destroy();
    this.lodLayer = null;
    this.loadingOverlay?.destroy();
    this.loadingOverlay = null;
    this.releaseAllTextures();
    this.resetStreaming();
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.world = null;
    this.lockedLayer = null;
    this.unlockedLayer = null;
    this.remoteHeldLayer = null;
    this.localHeldLayer = null;
    this.groups.clear();
    this.pieceToGroup.clear();
    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    this.heldGroupIds.clear();
    this.glidingGroupIds.clear();
    this.cellDirtyMs.clear();
    this.knownCells.clear();
    this.coverageSeen = false;
    this.coldSweepFrame = 0;
    this.fileById = new Map();
    this.manifest = null;
    this.textureBase = "";
    this.minimapGrid = null;
    this.held = null;
    this.carryHighlight = null;
    this.lastPointerDownGroupId = null;
    this.pendingDrag = null;
    this.pointerScreen = null;
    this.pendingDrops.clear();
    this.dirtyRects = [];
  }

  // Unloads every resident piece texture from the Assets cache. Sprites are freed
  // by the container teardown; this releases the shared textures the cache still
  // holds so a rebuild or unmount does not leak them.
  private releaseAllTextures(): void {
    for (const node of this.groups.values()) {
      for (const piece of node.pieces) {
        const url = this.pieceUrl(piece.id);
        if (url) void Assets.unload(url);
      }
    }
  }

  // Clears the streaming queues and resolves any pending build() promise so a
  // teardown mid-fill does not leave build() awaiting forever.
  private resetStreaming(): void {
    this.resident.clear();
    this.hydrateQueue = [];
    this.hydrateQueued.clear();
    this.inFlight = 0;
    if (this.initialFill) {
      const fill = this.initialFill;
      this.initialFill = null;
      fill.resolve();
    }
  }

  // Wipe all piece/group state without tearing down the Pixi app, so a fresh
  // build() can run on the same stage (server-driven reset).
  clearWorld(): void {
    this.buildToken++;
    this.stopConfetti();
    this.releaseAllTextures();
    this.resetStreaming();
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
    this.resetSpectatorStream();
    this.lodLayer?.destroy();
    this.lodLayer = null;
    // The overlay's container and badges were already freed by removeChildren
    // above (context:true), so just drop the reference for the rebuild.
    this.loadingOverlay = null;
    this.lodActive = false;
    this.lodWarm = false;
    this.heldGroupIds.clear();
    this.glidingGroupIds.clear();
    this.cellDirtyMs.clear();
    this.knownCells.clear();
    this.coverageSeen = false;
    this.coldSweepFrame = 0;
    this.groupGrid.clear();
    this.lastVisible.clear();
    this.lodHidden.clear();
    this.groups.clear();
    this.pieceToGroup.clear();
    // A carry in progress is dropped by the rebuild: the highlight was already
    // freed with the world above, so just clear the carry state and hide the hint.
    this.clearCarryIdle();
    this.carryHighlight = null;
    this.lastPointerDownGroupId = null;
    this.onCarryChange?.(false);
    this.held = null;
    this.pendingDrag = null;
    this.peerCursors?.clearHeld();
    this.fileById = new Map();
    this.manifest = null;
    this.textureBase = "";
    this.pendingDrops.clear();
    this.dirtyRects = [];
    this.worldSize = null;
    this.playZone = null;
    this.frame = null;
    this.backdrop = null;
    this.lockedLayer = null;
    this.unlockedLayer = null;
    this.remoteHeldLayer = null;
    this.localHeldLayer = null;
    this.viewport = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.onCameraChange?.(this.camera);
  }

  // Apply a fresh full-board state (same puzzleId) without rebuilding the stage:
  // update group positions and locked state in place, fold any merged groups into
  // the surviving host (their pieces reparent), and drop groups that no longer
  // exist. Used by the spectator keyframe re-base. A held local cluster is skipped
  // so an active drag is not yanked (no held clusters in spectator mode).
  applySnapshot(pieces: PieceRuntime[], groups: GroupRuntime[]): void {
    if (!this.world) return;
    const snapGroupIds = new Set<number>();
    for (const g of groups) snapGroupIds.add(g.id);

    const targetByPiece = new Map<number, { groupId: number; dx: number; dy: number }>();
    for (const p of pieces) targetByPiece.set(p.id, { groupId: p.groupId, dx: p.dx, dy: p.dy });

    // Targeted dirtying: only clusters that actually change (membership,
    // position, or locked) invalidate tiles, so a snapshot where nothing moved
    // re-bakes and re-fetches nothing. changed collects those clusters; their
    // pre-change world AABB is captured on first touch (before any update), so
    // both the rect a cluster leaves and the one it lands in are dirtied once the
    // updates apply. Dirtying the whole resident set every poll instead would
    // keep a deep zoom-out window fully hydrated, defeating cold-cluster freeing.
    const changed = new Set<number>();
    const oldRects: Aabb[] = [];
    const markChanged = (node: GroupNode): void => {
      if (changed.has(node.id)) return;
      changed.add(node.id);
      oldRects.push(this.worldAabb(node));
    };

    for (const [pieceId, currentGid] of this.pieceToGroup) {
      const target = targetByPiece.get(pieceId);
      if (target === undefined || target.groupId === currentGid) continue;
      const host = this.groups.get(target.groupId);
      const from = this.groups.get(currentGid);
      if (!host || !from) continue;
      markChanged(host);
      markChanged(from);
      const offset: PieceOffset = { dx: target.dx, dy: target.dy };
      this.pieceToGroup.set(pieceId, target.groupId);
      from.members.delete(pieceId);
      host.members.set(pieceId, offset);
      const piece = from.pieces.find((n) => n.id === pieceId);
      if (!piece) continue;
      from.container.removeChild(piece.container);
      from.pieces = from.pieces.filter((n) => n.id !== pieceId);
      this.placePieceInContainer(piece, offset);
      host.container.addChild(piece.container);
      host.pieces.push(piece);
    }

    for (const [gid, node] of this.groups) {
      if (snapGroupIds.has(gid)) continue;
      markChanged(node);
      this.forgetGroup(gid);
      node.container.destroy({ children: true });
      this.groups.delete(gid);
    }

    for (const g of groups) {
      const node = this.groups.get(g.id);
      if (!node) continue;
      if (this.held && this.held.groupId === g.id) continue;
      const moved = node.worldX !== g.worldX || node.worldY !== g.worldY;
      const becameLocked = !node.locked && g.locked;
      if (moved || node.locked !== g.locked) markChanged(node);
      node.localBounds = this.boundsForMembers(node.members);
      node.hydrated = node.pieces.length >= node.members.size;
      node.locked = g.locked;
      this.moveGroup(node, g.worldX, g.worldY);
      if (becameLocked) {
        this.placeGroupInLayer(node, this.lockedLayer);
        this.applyGroupInteractivity(node);
      }
    }

    // Record the tiles each changed cluster left and the tiles it now occupies as
    // dirty. The next reconcile invalidates them and (while the LOD is active) flips
    // the covered clusters back to live so nothing blanks before the bake catches
    // up, and pages textures in and out for the new layout. Unchanged clusters
    // record nothing, so an idle poll re-bakes nothing.
    for (const rect of oldRects) this.markDirty(rect);
    for (const gid of changed) {
      const node = this.groups.get(gid);
      if (node) this.markDirty(this.worldAabb(node));
    }
  }

  // ----- spectator stream (keyframe + event-log diffs) -----

  // Begin driving the read-only view from a keyframe. The board has already been
  // built from the same keyframe (the session synthesizes welcome + state), so
  // this only initializes the render clock delayMs behind live, the dedup cursor,
  // and the window anchor. Window tailing then fills the gap from the keyframe to
  // now: ingestEvents applies past events instantly and buffers the rest.
  startSpectatorStream(keyframe: SpectatorKeyframe): void {
    this.specWindowMs = keyframe.windowMs > 0 ? keyframe.windowMs : this.specWindowMs;
    this.specDelayMs = keyframe.delayMs >= 0 ? keyframe.delayMs : this.specDelayMs;
    this.renderClock = Date.now() - this.specDelayMs;
    this.appliedCursor = keyframe.cursor;
    this.pendingEvents = [];
    this.pendingKeyframe = null;
    this.specInterp.clear();
    this.glidingGroupIds.clear();
    this.anchorWindows(keyframe);
    this.specActive = true;
  }

  // Controls whether the tick requests event windows. The session gates this on
  // the event being live (started, not completed); while not tailing the board is
  // the frozen keyframe and no windows are fetched.
  setSpectatorTailing(tailing: boolean): void {
    this.specTailing = tailing;
  }

  // Hold a freshly fetched keyframe for re-base. The tick applies it once the
  // render clock reaches its logical time, so there is no visual jump. The session
  // version-checks before calling, so a held keyframe is always the current format.
  ingestKeyframe(keyframe: SpectatorKeyframe): void {
    if (!this.specActive) return;
    if (this.pendingKeyframe && keyframe.generatedAt <= this.pendingKeyframe.generatedAt) return;
    this.pendingKeyframe = keyframe;
  }

  // Fold a fetched window's events into the stream: skip anything already applied
  // (seq <= cursor), apply events already in the past instantly (no animation,
  // drops jump), and buffer the rest in seq order for the tick to play in time.
  ingestEvents(events: readonly SpectatorEvent[]): void {
    if (!this.specActive) return;
    for (const e of events) {
      if (compareSpectatorSeq(e.seq, this.appliedCursor) <= 0) continue;
      if (e.at <= this.renderClock) this.applySpectatorEvent(e, false);
      else this.insertPending(e);
    }
  }

  private tickSpectator(): void {
    if (!this.specActive) return;
    this.renderClock = Date.now() - this.specDelayMs;

    // Re-base: apply the held keyframe at exactly the render time it represents,
    // then drop buffered events it already folded in and re-anchor the window
    // cursor. This heals a restart gap, drift, or missed windows with no jump.
    if (this.pendingKeyframe && this.renderClock >= this.pendingKeyframe.generatedAt) {
      const kf = this.pendingKeyframe;
      this.pendingKeyframe = null;
      this.endAllGlides();
      this.applySnapshot(kf.pieces, kf.groups);
      this.appliedCursor = kf.cursor;
      this.pendingEvents = this.pendingEvents.filter(
        (e) => compareSpectatorSeq(e.seq, kf.cursor) > 0,
      );
      this.specInterp.clear();
      this.anchorWindows(kf, true);
    }

    while (this.pendingEvents.length > 0) {
      const e = this.pendingEvents[0]!;
      if (e.at > this.renderClock) break;
      this.pendingEvents.shift();
      if (compareSpectatorSeq(e.seq, this.appliedCursor) <= 0) continue;
      this.applySpectatorEvent(e, true);
    }

    for (const [gid, it] of this.specInterp) {
      const node = this.groups.get(gid);
      if (!node) {
        this.specInterp.delete(gid);
        this.endGlide(gid);
        continue;
      }
      const span = this.renderClock - it.startAt;
      const t = span <= 0 ? 0 : span >= SPECTATOR_GLIDE_MS ? 1 : span / SPECTATOR_GLIDE_MS;
      this.setSpectatorGroupPos(
        node,
        it.fromX + (it.toX - it.fromX) * t,
        it.fromY + (it.toY - it.fromY) * t,
      );
      if (t >= 1) {
        this.specInterp.delete(gid);
        this.endGlide(gid);
      }
    }

    this.requestNeededWindows();
  }

  // Apply one spectator event. A snap reuses applySnap (the same path as the WS
  // snap) and notifies the session for the locked count, activity ticker and
  // completion. A drop glides to its target when animated (live tail) or jumps to
  // it when not (join catch-up / events already in the past).
  private applySpectatorEvent(e: SpectatorEvent, animate: boolean): void {
    if (e.k === "drop") {
      const node = this.groups.get(e.groupId);
      if (node) {
        if (animate) {
          this.specInterp.set(e.groupId, {
            fromX: node.worldX,
            fromY: node.worldY,
            toX: e.worldX,
            toY: e.worldY,
            startAt: this.renderClock,
          });
          this.beginGlide(node);
        } else {
          this.specInterp.delete(e.groupId);
          this.endGlide(e.groupId);
          this.setSpectatorGroupPos(node, e.worldX, e.worldY);
        }
      }
    } else {
      this.applySnap(e.newGroupId, e.addedPieceIds, e.worldX, e.worldY, e.anchored, animate);
      this.specInterp.delete(e.newGroupId);
      this.endGlide(e.newGroupId);
      this.onSpectatorSnap?.(e);
    }
    this.advanceAppliedCursor(e.seq);
  }

  // Move a gliding cluster. The cluster is kept live for the slide (see beginGlide),
  // so moveGroup leaves its tiles alone here: beginGlide and endGlide record the
  // start and settle tiles once each, instead of re-baking every cell it crosses
  // every frame.
  private setSpectatorGroupPos(node: GroupNode, x: number, y: number): void {
    this.moveGroup(node, x, y);
  }

  // Start a spectator glide: mark the cluster live (excluded from bakes, drawn on
  // top) and record its current tiles dirty once so they re-bake without it. The
  // next reconcile hydrates it (it is no longer covered-cold) and draws it live.
  private beginGlide(node: GroupNode): void {
    if (this.glidingGroupIds.has(node.id)) return;
    this.glidingGroupIds.add(node.id);
    this.markDirty(this.worldAabb(node));
  }

  // End one glide: fold the cluster back into its resting tiles by recording its
  // current tiles dirty once, so they re-bake with it and the bake then hides it.
  private endGlide(gid: number): void {
    if (!this.glidingGroupIds.delete(gid)) return;
    const node = this.groups.get(gid);
    if (node) this.markDirty(this.worldAabb(node));
  }

  // End every in-progress glide, used on a keyframe re-base where specInterp is
  // cleared wholesale so the re-base's applySnapshot sees settled clusters.
  private endAllGlides(): void {
    for (const gid of this.glidingGroupIds) {
      const node = this.groups.get(gid);
      if (node) this.markDirty(this.worldAabb(node));
    }
    this.glidingGroupIds.clear();
  }

  private advanceAppliedCursor(seq: string): void {
    if (compareSpectatorSeq(seq, this.appliedCursor) > 0) this.appliedCursor = seq;
  }

  // Set the next window to request from a keyframe's cursor (or its generatedAt
  // when the log is empty). On re-base the anchor only moves forward.
  private anchorWindows(keyframe: SpectatorKeyframe, forward = false): void {
    const cm = seqMs(keyframe.cursor);
    const startMs = cm > 0 ? cm : keyframe.generatedAt;
    const w0 = Math.floor(startMs / this.specWindowMs) * this.specWindowMs;
    this.nextWindowT0 = forward ? Math.max(this.nextWindowT0, w0) : w0;
  }

  // Request every sealed window from the anchor up to delayMs behind live, in
  // order. A stale anchor (long idle, a gap) jumps forward to the catch-up cap so
  // a few keyframe re-bases heal the gap rather than replaying hundreds of windows.
  private requestNeededWindows(): void {
    if (!this.specTailing || !this.onNeedWindow) return;
    const W = this.specWindowMs;
    const upTo = Math.floor((Date.now() - this.specDelayMs) / W) * W;
    const floorT0 = upTo - SPECTATOR_MAX_CATCHUP_WINDOWS * W;
    if (this.nextWindowT0 < floorT0) this.nextWindowT0 = floorT0;
    while (this.nextWindowT0 <= upTo) {
      this.onNeedWindow(this.nextWindowT0);
      this.nextWindowT0 += W;
    }
  }

  // Insert into the seq-sorted pending buffer, skipping a duplicate (windows are
  // immutable and fetched once, but a re-base could re-deliver one).
  private insertPending(e: SpectatorEvent): void {
    let lo = 0;
    let hi = this.pendingEvents.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const c = compareSpectatorSeq(this.pendingEvents[mid]!.seq, e.seq);
      if (c === 0) return;
      if (c < 0) lo = mid + 1;
      else hi = mid;
    }
    this.pendingEvents.splice(lo, 0, e);
  }

  private resetSpectatorStream(): void {
    this.specActive = false;
    this.specTailing = false;
    this.pendingEvents = [];
    this.pendingKeyframe = null;
    this.specInterp.clear();
    this.glidingGroupIds.clear();
    this.appliedCursor = "0-0";
    this.nextWindowT0 = 0;
  }

  // ----- incoming server messages -----

  applyGrabOk(groupId: number, userId: string): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    if (userId === this.localUserId) {
      // Our own grab. If we still hold it, confirm. If we already released it
      // before the ack arrived (grab->release faster than the RTT), the release
      // flow has parked it at rest; falling through to the remote-grab branch
      // would strand it in remoteHeldLayer (one layer too high, forced live off
      // the LOD) until the next event happened to touch it.
      if (this.held && this.held.groupId === groupId) this.held.confirmed = true;
      return;
    }
    // Remote grab: keep group visible on top while held by someone else, and
    // mark it live so the LOD bake leaves it out and draws it on top.
    this.placeGroupInLayer(node, this.remoteHeldLayer);
    this.markGroupHeld(node);
  }

  applyGrabDenied(groupId: number): void {
    // A denied grab means an optimistic drop that followed it will be rejected by
    // the server, so lift the in-flight guard rather than leaving it stuck.
    this.pendingDrops.delete(groupId);
    if (!this.held || this.held.groupId !== groupId) return;
    const node = this.groups.get(groupId);
    if (node) {
      this.markDirty(this.worldAabb(node));
      this.moveGroup(node, this.held.originX, this.held.originY);
      this.setGroupHeldVisual(node, false);
    }
    this.releaseGroupHeld(groupId);
    if (this.held.carry) this.endCarry();
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
    // Authoritative drop: confirms our own optimistic drop (no `except` on the
    // server's drop broadcast) or relays a peer's, so the in-flight guard lifts.
    this.pendingDrops.delete(groupId);
    const node = this.groups.get(groupId);
    if (!node) return;
    // The drop can relocate a cluster that was never locally held (joined mid-drag,
    // or a drop with no prior drag frame): moveGroup records the old and new tiles
    // for a non-held move, so the old position cannot keep a ghost. A held cluster
    // was never baked there, so only its new resting tile (releaseGroupHeld) dirties.
    this.moveGroup(node, worldX, worldY);
    if (userId !== this.localUserId) {
      this.placeGroupInLayer(node, this.restingLayer(node));
    }
    this.releaseGroupHeld(groupId);
  }

  applyRollback(groupId: number, worldX: number, worldY: number, reason?: "tile_full"): void {
    this.pendingDrops.delete(groupId);
    const node = this.groups.get(groupId);
    if (!node) return;
    // The cluster still sits at the rejected drop point here (the local client
    // placed it there optimistically), so flash that tile before bouncing it back.
    if (reason === "tile_full") {
      this.flashRejectedTile(this.worldAabb(node));
      this.onNotice?.("tile_full");
    }
    // A rolled-back cluster was released on its drop (not held now), so moveGroup
    // records the tiles it leaves and re-enters.
    this.moveGroup(node, worldX, worldY);
    if (this.held && this.held.groupId === groupId) {
      this.setGroupHeldVisual(node, false);
      if (this.held.carry) this.endCarry();
      this.held = null;
    }
    this.releaseGroupHeld(groupId);
  }

  // Brief red outline over the tile a drop was rejected on (its piece cap would be
  // exceeded), keyed by the cluster's body-min cell so it lands on the tile the
  // server checked. Fades out and self-destructs via the tweener.
  private flashRejectedTile(box: Aabb): void {
    if (!this.world || !this.tweener) return;
    const key = cellKeysForRect(box, LOD_TILE_WORLD)[0];
    if (key === undefined) return;
    const { cx, cy } = unpackCell(key);
    const inset = LOD_TILE_WORLD * 0.02;
    const g = new Graphics();
    g.eventMode = "none";
    g.roundRect(
      cx * LOD_TILE_WORLD + inset,
      cy * LOD_TILE_WORLD + inset,
      LOD_TILE_WORLD - 2 * inset,
      LOD_TILE_WORLD - 2 * inset,
      LOD_TILE_WORLD * 0.03,
    )
      .fill({ color: 0xff4d4d, alpha: 0.12 })
      .stroke({ color: 0xff4d4d, alpha: 0.9, width: LOD_TILE_WORLD * 0.01 });
    this.world.addChild(g);
    this.tweener.add({
      duration: 900,
      easing: easeOutCubic,
      onUpdate: (eased) => {
        g.alpha = 1 - eased;
      },
      onDone: () => g.destroy(),
    });
  }

  // Apply a viewport-scoped region_state (protocol v3): an upsert over the
  // construction entries for the groups in the client's newly entered cells.
  // Unknown group: build it wholesale (the join/pan stream for a partial board).
  // Known group: apply the origin only when this client is not the live authority
  // for it (the ordering guard, so a stale resync never rewinds a newer local
  // update), and always additively reconcile membership and locked state, the
  // heal channel a partial board needs (a snap that arrived while the host was
  // unknown, or membership the client under-counts).
  applyRegionState(entries: readonly RegionGroup[], coverage?: Aabb): void {
    if (!this.world) return;
    // The acked rect covers a region whose groups have all streamed in, so every
    // cell it spans is now "known": a cell in the play zone but not yet known has
    // not loaded. Marked even when entries is empty (an acked but empty region).
    if (coverage) {
      this.coverageSeen = true;
      for (const key of cellKeysForRect(coverage, LOD_TILE_WORLD)) this.knownCells.add(key);
    }
    const localHeldId = this.held?.groupId ?? null;
    for (const e of entries) {
      const node = this.groups.get(e.groupId);
      if (!node) {
        const built = this.constructGroup({
          groupId: e.groupId,
          worldX: e.worldX,
          worldY: e.worldY,
          locked: e.locked,
          pieces: e.pieces,
        });
        // Record the new group's tiles dirty: a cell entered at a deep zoom-out is
        // baked (empty) before its region_state arrives, so the group would hide
        // behind a blank ready tile. The next reconcile invalidates that tile, culls
        // and hydrates the group, and flips it live until the bake refreshes it.
        this.markDirty(this.worldAabb(built));
        continue;
      }
      if (
        resyncShouldApply(e.groupId, localHeldId, this.heldGroupIds, this.pendingDrops) &&
        (node.worldX !== e.worldX || node.worldY !== e.worldY)
      ) {
        this.moveGroup(node, e.worldX, e.worldY);
      }
      let membershipChanged = false;
      for (const wp of e.pieces) {
        if (this.pieceToGroup.get(wp.id) === e.groupId) continue;
        this.movePieceMembership(wp.id, { dx: wp.dx, dy: wp.dy }, node);
        membershipChanged = true;
      }
      if (e.locked !== node.locked) {
        node.locked = e.locked;
        this.placeGroupInLayer(node, this.restingLayer(node));
        this.applyGroupInteractivity(node);
        membershipChanged = true;
      }
      if (membershipChanged) {
        node.localBounds = this.boundsForMembers(node.members);
        node.hydrated = node.pieces.length >= node.members.size;
        this.markDirty(this.worldAabb(node));
        this.groupGrid.upsert(node.id, this.worldAabb(node));
      }
    }
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
    addedPieceIds: WirePiece[],
    worldX: number,
    worldY: number,
    anchored: boolean,
    // The spectator join fast-forward applies catch-up snaps with animate=false
    // so the board lands in its current state without a burst of bump/flash
    // animations; live snaps (WS and tailing) animate.
    animate = true,
  ): void {
    // Partial-board-safe: under protocol v4 a contributor only builds visited
    // regions, so a remote merge can straddle the boundary. resolveSnap classifies
    // the host (known/unknown) and the KNOWN source groups to remove, from the
    // current membership.
    const plan = resolveSnap(newGroupId, addedPieceIds, this.groups, this.pieceToGroup);
    const host = this.groups.get(newGroupId);

    if (!host) {
      // Host unknown (its cell was never visited): the merged cluster is built
      // wholesale by the next region_state for its cell. Do not build it from a
      // snap (its full membership is unknown). Just keep the model consistent:
      // reassign the added pieces to the host id, and remove every KNOWN source
      // group so no phantom (a group the server merged away) survives.
      for (const wp of addedPieceIds) this.pieceToGroup.set(wp.id, newGroupId);
      for (const gid of plan.removeGroups) this.destroyGroup(gid);
      this.heldGroupIds.delete(newGroupId);
      this.pendingDrops.delete(newGroupId);
      for (const gid of plan.removeGroups) this.pendingDrops.delete(gid);
      if (
        this.held &&
        (this.held.groupId === newGroupId || plan.removeGroups.includes(this.held.groupId))
      ) {
        this.held = null;
      }
      return;
    }

    const sourceGroupIds = plan.removeGroups;
    const hostOldRect = this.worldAabb(host);
    const preLockedPieceIds = new Set<number>();
    if (host.locked) for (const p of host.pieces) preLockedPieceIds.add(p.id);
    for (const gid of sourceGroupIds) {
      const src = this.groups.get(gid);
      if (src?.locked) for (const p of src.pieces) preLockedPieceIds.add(p.id);
    }
    const addedSet = new Set(addedPieceIds.map((p) => p.id));

    // Reparent each added piece into the host at its anchor offset. Membership
    // (members, pieceToGroup) moves unconditionally even when the source group was
    // never visited, so a KNOWN host ends up with complete membership and correct
    // localBounds; the built node moves only when the source piece is hydrated. The
    // host is moved to (worldX, worldY) below.
    for (const wp of addedPieceIds) this.movePieceMembership(wp.id, { dx: wp.dx, dy: wp.dy }, host);

    host.localBounds = this.boundsForMembers(host.members);
    host.hydrated = host.pieces.length >= host.members.size;
    this.markDirty(hostOldRect);
    this.moveGroup(host, worldX, worldY);
    host.locked = host.locked || anchored;
    this.setGroupHeldVisual(host, false);
    this.markDirty(this.worldAabb(host));

    for (const gid of sourceGroupIds) this.destroyGroup(gid);

    this.applyGroupInteractivity(host);

    this.heldGroupIds.delete(newGroupId);
    // The merge confirms whichever side this client dropped, so lift the
    // in-flight guard for the host and every group folded into it.
    this.pendingDrops.delete(newGroupId);
    for (const gid of sourceGroupIds) this.pendingDrops.delete(gid);

    if (
      this.held &&
      (this.held.groupId === newGroupId || sourceGroupIds.includes(this.held.groupId))
    ) {
      this.held = null;
    }

    if (animate) {
      let bursts = 0;
      for (const piece of host.pieces) {
        if (preLockedPieceIds.has(piece.id)) continue;
        if (addedSet.has(piece.id) || host.locked) {
          this.playSnapAnimation(piece);
          if (bursts < SNAP_BURST_MAX_PIECES) {
            this.playSnapBurst(piece);
            bursts++;
          }
        }
      }
    }
  }

  // Frees and forgets a group entirely: dirties its tiles, dehydrates its
  // textures, drops it from every index, destroys its container, and removes it
  // from the group map. Used wherever a merge removes a source group.
  private destroyGroup(gid: number): void {
    const dead = this.groups.get(gid);
    if (!dead) return;
    this.markDirty(this.worldAabb(dead));
    this.dehydrateGroup(dead);
    this.forgetGroup(gid);
    dead.container.destroy({ children: true });
    this.groups.delete(gid);
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

  private playSnapBurst(piece: PieceNode): void {
    if (!this.tweener || !this.manifest) return;
    const pieceSize = this.manifest.pieceSize;
    const burst = new Container();
    burst.eventMode = "none";
    burst.position.set(pieceSize / 2, pieceSize / 2);
    piece.inner.addChild(burst);

    const sparks: { gfx: Graphics; angle: number; dist: number }[] = [];
    for (let i = 0; i < SNAP_BURST_COUNT; i++) {
      const gfx = new Graphics();
      const radius = pieceSize * (0.03 + Math.random() * 0.03);
      const color = SNAP_BURST_COLORS[Math.floor(Math.random() * SNAP_BURST_COLORS.length)]!;
      gfx.circle(0, 0, radius).fill({ color });
      burst.addChild(gfx);
      const angle = (i / SNAP_BURST_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      const dist = pieceSize * (0.45 + Math.random() * 0.35);
      sparks.push({ gfx, angle, dist });
    }

    this.tweener.add({
      duration: SNAP_BURST_MS,
      easing: easeOutCubic,
      onUpdate: (eased, raw) => {
        if (burst.destroyed) return;
        for (const s of sparks) {
          const d = s.dist * eased;
          s.gfx.position.set(Math.cos(s.angle) * d, Math.sin(s.angle) * d);
          s.gfx.alpha = 1 - raw;
          s.gfx.scale.set(1 - 0.5 * raw);
        }
      },
      onDone: () => {
        if (!burst.destroyed) burst.destroy({ children: true });
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
    this.lastPointerDownGroupId = node.id;
    // While a cluster is carried, presses are reserved for the drop double-click;
    // do not start a competing press-drag grab on it.
    if (this.held?.carry) return;
    // Re-grabbing supersedes any in-flight drop of the same group; the held-skip
    // now guards it, so drop the pending entry.
    this.pendingDrops.delete(node.id);
    const world = this.screenToWorld(ev.global.x, ev.global.y);
    this.held = {
      groupId: node.id,
      pointerDx: world.x - node.worldX,
      pointerDy: world.y - node.worldY,
      originX: node.worldX,
      originY: node.worldY,
      confirmed: false,
      carry: false,
    };
    this.markGroupHeld(node);
    this.setGroupHeldVisual(node, true);
    this.callbacks.onGrab(node.id);
  }

  private onStagePointerDown(ev: FederatedPointerEvent): void {
    this.lastPointerDownGroupId = null;
    // A press-drag owns the button, so a background pan must not compete with it.
    // Sticky carry holds no button, so it behaves like an empty hand: pressing
    // empty stage starts a pan (the carried cluster stays glued to the cursor as
    // the world scrolls beneath it).
    if (this.held && !this.held.carry) return;
    this.pan.active = true;
    this.pan.lastX = ev.global.x;
    this.pan.lastY = ev.global.y;
  }

  private onPointerMove(ev: FederatedPointerEvent): void {
    this.pointerScreen = { x: ev.global.x, y: ev.global.y };
    // Only contributors broadcast a cursor; spectators stay invisible to peers.
    if (this.mode === "contributor" && this.onCursorMove) {
      const cursor = this.screenToWorld(ev.global.x, ev.global.y);
      this.onCursorMove(cursor.x, cursor.y);
    }
    // A background pan can run alongside a sticky carry: scroll the world first,
    // then re-glue the carried cluster to the cursor under the new camera. A
    // press-drag never starts a pan (onStagePointerDown), so pan.active here is
    // only ever an empty-hand or carry pan.
    if (this.pan.active) {
      this.camera.x += ev.global.x - this.pan.lastX;
      this.camera.y += ev.global.y - this.pan.lastY;
      this.pan.lastX = ev.global.x;
      this.pan.lastY = ev.global.y;
      this.applyCamera();
    }
    if (this.held) {
      this.dragHeldTo(ev.global.x, ev.global.y);
      // A real pointer move resets the carry idle timer; an edge-pan re-place
      // (no move event) deliberately does not, so a pointer truly at rest still
      // times out.
      if (this.held.carry) this.armCarryIdle();
    }
  }

  // World-space origin that puts the held cluster's grabbed point under the given
  // screen position, clamped into the play zone. Used by press-drag move and drop,
  // which keep the grabbed point under the cursor.
  private heldGroupOrigin(
    node: GroupNode,
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const world = this.screenToWorld(screenX, screenY);
    return this.clampGroupOrigin(
      node,
      world.x - (this.held?.pointerDx ?? 0),
      world.y - (this.held?.pointerDy ?? 0),
    );
  }

  // World-space origin that floats the carried cluster to the upper-right of the
  // cursor: its bottom-left bounding-box corner (minX, maxY) is held HELD_CARRY_GAP
  // screen px to the right of and above the pointer, so the whole cluster clears
  // the cursor whatever piece was grabbed and whatever the zoom. Clamped into the
  // play zone.
  private carryGroupOrigin(
    node: GroupNode,
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const world = this.screenToWorld(screenX, screenY);
    const gap = HELD_CARRY_GAP / this.camera.zoom;
    const b = node.localBounds;
    return this.clampGroupOrigin(node, world.x + gap - b.minX, world.y - gap - b.maxY);
  }

  // World-space origin that lands the carried cluster centered on the cursor: its
  // bounding-box center sits at the pointer's world position (the symmetric tab
  // margin keeps that center on the cluster's grid footprint center). Clamped into
  // the play zone. Used by the carry drop, where the grab point is irrelevant since
  // the cluster floats off the cursor while carried.
  private carryDropOrigin(
    node: GroupNode,
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const world = this.screenToWorld(screenX, screenY);
    const b = node.localBounds;
    const centerX = (b.minX + b.maxX) / 2;
    const centerY = (b.minY + b.maxY) / 2;
    return this.clampGroupOrigin(node, world.x - centerX, world.y - centerY);
  }

  // Move the held cluster under the given screen position, clamped into the play
  // zone, and stage the resulting drag for the next per-frame broadcast. Sticky
  // carry floats the cluster to the upper-right of the cursor; a press-drag keeps
  // the piece under the cursor. Shared by pointer moves and edge-pan, which
  // carries the cluster across the board while the pointer rests at the edge.
  private dragHeldTo(screenX: number, screenY: number): void {
    if (!this.held) return;
    const node = this.groups.get(this.held.groupId);
    if (!node || !this.callbacks) return;
    const { x: nx, y: ny } = this.held.carry
      ? this.carryGroupOrigin(node, screenX, screenY)
      : this.heldGroupOrigin(node, screenX, screenY);
    this.moveGroup(node, nx, ny);
    this.pendingDrag = { worldX: nx, worldY: ny };
  }

  // Per-frame edge-pan: during a press-drag, when the pointer sits in an edge
  // band, scroll the camera toward that edge (speed ramps to the rim, see
  // EDGE_PAN_*) and re-place the dragged cluster under the now-stationary cursor
  // as the world scrolls beneath it. Gated on a button-held drag so neither a
  // bare pointer nor a sticky carry near the edge scrolls the view. Suppressed
  // during a manual background pan-drag, which already owns the camera.
  private tickEdgePanFrame(deltaMS: number): void {
    if (!this.app || !this.playZone || !this.pointerScreen || this.pan.active) return;
    if (!this.held || this.held.carry) return;
    const screen = this.app.renderer.screen;
    const vx = edgePanAxis(this.pointerScreen.x, screen.width);
    const vy = edgePanAxis(this.pointerScreen.y, screen.height);
    if (vx === 0 && vy === 0) return;
    const step = (EDGE_PAN_MAX_SPEED / 1000) * deltaMS;
    this.camera.x += vx * step;
    this.camera.y += vy * step;
    this.applyCamera();
    this.dragHeldTo(this.pointerScreen.x, this.pointerScreen.y);
  }

  private onPointerUp(ev: FederatedPointerEvent): void {
    // Sticky carry ignores the button release: the cluster stays in hand until a
    // double-click drops it, Escape returns it, or it times out.
    if (this.held?.carry) {
      this.pan.active = false;
      return;
    }
    if (this.held) {
      const node = this.groups.get(this.held.groupId);
      if (node && this.callbacks) {
        const { x: nx, y: ny } = this.heldGroupOrigin(node, ev.global.x, ev.global.y);
        this.moveGroup(node, nx, ny);
        this.setGroupHeldVisual(node, false);
        // The server's authoritative drop/snap has not landed yet, so guard the
        // group against a resync rewinding it to its pre-drop position until it
        // does (cleared in applyRemoteDrop/applySnap/applyRollback).
        this.pendingDrops.add(node.id);
        this.callbacks.onDrop(node.id, nx, ny);
        this.releaseGroupHeld(node.id);
      }
      this.held = null;
    }
    this.pan.active = false;
  }

  // ----- sticky carry (double-click to stick a cluster to the cursor) -----

  // A DOM double-click toggles carry. With a cluster carried it drops it;
  // otherwise it picks up the cluster under the last pointerdown and sticks it to
  // the cursor. Resolved off lastPointerDownGroupId (set by the federated pointer
  // handlers) since the DOM event carries no Pixi target.
  private onCanvasDoubleClick(ev: MouseEvent): void {
    ev.preventDefault();
    if (this.mode !== "contributor") return;
    if (this.held?.carry) {
      this.dropCarried();
      return;
    }
    // A press-drag is in flight (button held): ignore, the release will drop it.
    if (this.held) return;
    if (this.lastPointerDownGroupId === null) return;
    const node = this.groups.get(this.lastPointerDownGroupId);
    if (!node || node.locked) return;
    this.beginCarry(node);
  }

  // Pick a cluster up into sticky carry: grab it (acquiring the server lock), keep
  // it under the cursor, mark it with the carry outline, and arm the idle timeout.
  private beginCarry(node: GroupNode): void {
    if (!this.callbacks || !this.pointerScreen) return;
    const pointer = this.pointerScreen;
    this.pendingDrops.delete(node.id);
    const world = this.screenToWorld(pointer.x, pointer.y);
    this.held = {
      groupId: node.id,
      pointerDx: world.x - node.worldX,
      pointerDy: world.y - node.worldY,
      originX: node.worldX,
      originY: node.worldY,
      confirmed: false,
      carry: true,
    };
    this.markGroupHeld(node);
    this.setGroupHeldVisual(node, true);
    this.addCarryHighlight(node);
    this.callbacks.onGrab(node.id);
    this.onCarryChange?.(true);
    // Float the cluster off to the upper-right of the cursor the instant it is
    // grabbed, not on the first move, so it never starts under the pointer.
    this.dragHeldTo(pointer.x, pointer.y);
    this.armCarryIdle();
  }

  // Put the carried cluster down centered on the cursor (the drop double-click or
  // the idle timeout), committing the move and releasing the server lock. It lands
  // centered on the pointer rather than by its grab point: the carry floats it off
  // the cursor, so the grab point is irrelevant on drop. Falls back to its current
  // resting spot if the pointer has left the canvas (a timeout after the cursor
  // left).
  private dropCarried(): void {
    if (!this.held?.carry) return;
    const node = this.groups.get(this.held.groupId);
    if (node && this.callbacks) {
      const { x, y } = this.pointerScreen
        ? this.carryDropOrigin(node, this.pointerScreen.x, this.pointerScreen.y)
        : { x: node.worldX, y: node.worldY };
      this.moveGroup(node, x, y);
      this.setGroupHeldVisual(node, false);
      this.pendingDrops.add(node.id);
      this.callbacks.onDrop(node.id, x, y);
      this.releaseGroupHeld(node.id);
    }
    this.held = null;
    this.endCarry();
  }

  // Return the carried cluster to where it was picked up (Escape), releasing the
  // lock by dropping it back at its origin.
  private cancelCarry(): void {
    if (!this.held?.carry) return;
    const node = this.groups.get(this.held.groupId);
    if (node && this.callbacks) {
      this.markDirty(this.worldAabb(node));
      this.moveGroup(node, this.held.originX, this.held.originY);
      this.setGroupHeldVisual(node, false);
      this.pendingDrops.add(node.id);
      this.callbacks.onDrop(node.id, this.held.originX, this.held.originY);
      this.releaseGroupHeld(node.id);
    }
    this.held = null;
    this.endCarry();
  }

  // Clear the carry visuals and idle timer and notify the shell. Leaves this.held
  // to the caller, so the denied/rollback paths can reuse it.
  private endCarry(): void {
    this.clearCarryIdle();
    this.removeCarryHighlight();
    this.onCarryChange?.(false);
  }

  private armCarryIdle(): void {
    this.clearCarryIdle();
    this.carryIdleTimer = setTimeout(() => {
      this.carryIdleTimer = null;
      this.dropCarried();
    }, CARRY_IDLE_TIMEOUT_MS);
  }

  private clearCarryIdle(): void {
    if (this.carryIdleTimer === null) return;
    clearTimeout(this.carryIdleTimer);
    this.carryIdleTimer = null;
  }

  // Outline over the carried cluster: a soft glow plus a crisp stroke around its
  // bounds, so a sticky-carried piece reads as in-hand with no button held.
  private addCarryHighlight(node: GroupNode): void {
    this.removeCarryHighlight();
    const pieceSize = this.manifest?.pieceSize ?? 0;
    if (pieceSize === 0) return;
    const b = node.localBounds;
    const pad = pieceSize * 0.12;
    const x = b.minX - pad;
    const y = b.minY - pad;
    const w = b.maxX - b.minX + pad * 2;
    const h = b.maxY - b.minY + pad * 2;
    const radius = pieceSize * 0.25;
    const g = new Graphics();
    g.eventMode = "none";
    g.roundRect(x, y, w, h, radius).stroke({
      color: CARRY_HIGHLIGHT_COLOR,
      width: pieceSize * 0.18,
      alpha: 0.22,
    });
    g.roundRect(x, y, w, h, radius).stroke({
      color: CARRY_HIGHLIGHT_COLOR,
      width: pieceSize * 0.05,
      alpha: 0.95,
    });
    node.container.addChild(g);
    this.carryHighlight = g;
  }

  private removeCarryHighlight(): void {
    const g = this.carryHighlight;
    this.carryHighlight = null;
    if (!g) return;
    g.parent?.removeChild(g);
    if (!g.destroyed) g.destroy({ context: true });
  }

  private setGroupHeldVisual(node: GroupNode, held: boolean): void {
    // Lift the cluster as one unit: a uniform scale about the cluster center,
    // realized per piece so the group container transform (and thus moveGroup)
    // stays untouched. Each inner pivots on its own center, so the lift is the
    // piece's own bump plus a shift that carries its center along the cluster's
    // uniform scaling. Scaling each piece about its own center in isolation
    // would pull the interlocking knobs and blanks out of register (the cluster
    // visibly seams apart); scaling about the shared center keeps every piece
    // aligned while still feeling lifted off the board. The container origin is
    // the puzzle's canonical origin, far from the cluster, so scaling the
    // container directly would fling the cluster away from the cursor instead.
    const scale = held ? HELD_SCALE : 1;
    const half = (this.manifest?.pieceSize ?? 0) / 2;
    const b = node.localBounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    for (const piece of node.pieces) {
      piece.inner.scale.set(scale);
      const pieceCx = piece.container.x + half;
      const pieceCy = piece.container.y + half;
      piece.inner.position.set(
        half + (scale - 1) * (pieceCx - cx),
        half + (scale - 1) * (pieceCy - cy),
      );
    }
    this.placeGroupInLayer(node, held ? this.localHeldLayer : this.restingLayer(node));
  }

  // Layer a group returns to when it is not held: locked clusters drop to the
  // base layer, loose clusters stay above them.
  private restingLayer(node: GroupNode): Container | null {
    return node.locked ? this.lockedLayer : this.unlockedLayer;
  }

  // Reparents a group's container into a z-order layer. A no-op when the group
  // is already in that layer, so an unchanged depth never pays the reparent.
  private placeGroupInLayer(node: GroupNode, layer: Container | null): void {
    if (!layer || node.container.parent === layer) return;
    layer.addChild(node.container);
  }

  // Updates a group's position and re-indexes it, recording the tiles it leaves and
  // enters as dirty so callers no longer bracket the move with manual dirty calls.
  // A held cluster is drawn live and excluded from bakes, so its per-frame drag
  // stays off the dirty path; an unchanged position records nothing, so an idle
  // snapshot poll re-bakes nothing. Culling is the next reconcile's job.
  private moveGroup(node: GroupNode, worldX: number, worldY: number): void {
    const dirty = !this.isLive(node.id) && (node.worldX !== worldX || node.worldY !== worldY);
    if (dirty) this.markDirty(this.worldAabb(node));
    node.worldX = worldX;
    node.worldY = worldY;
    node.container.position.set(worldX, worldY);
    this.groupGrid.upsert(node.id, this.worldAabb(node));
    if (dirty) this.markDirty(this.worldAabb(node));
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

  // Minimap navigation: center the camera on a world point picked from the
  // overview. The shared clamp pulls an out-of-bounds pick back to the nearest
  // in-bounds framing.
  centerOnWorld(worldX: number, worldY: number): void {
    this.centerOn(worldX, worldY);
  }

  zoomIn(): void {
    this.zoomBy(1.25);
  }

  zoomOut(): void {
    this.zoomBy(1 / 1.25);
  }

  getMinimapSnapshot(): MinimapSnapshot | null {
    if (!this.playZone || !this.worldSize || !this.manifest) return null;
    // The global overview is the server `grid`; on top, an overlay of the locally
    // known groups (the visited regions, bounded by the partial board, not the
    // whole 1M board) refines it with the client's fresher live positions. Dots
    // come from group membership and anchor offsets, not built nodes, so the
    // overlay stays correct while most pieces are dehydrated (textures unloaded).
    const { pieceSize } = this.manifest;
    const half = pieceSize / 2;
    const pieces: MinimapPiece[] = [];
    for (const group of this.groups.values()) {
      for (const off of group.members.values()) {
        pieces.push({
          x: group.worldX + off.dx * pieceSize + half,
          y: group.worldY + off.dy * pieceSize + half,
          locked: group.locked,
        });
      }
    }
    return {
      playZone: this.playZone,
      frame: { w: this.worldSize.w, h: this.worldSize.h },
      grid: this.minimapGrid,
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
    this.reconcile();
  }

  // Records a world rect to invalidate on the next reconcile. Pure model-side: it
  // touches neither the tile layer, hotness, nor visibility (flushDirty does, once
  // per touched cell).
  private markDirty(box: Aabb): void {
    this.dirtyRects.push(box);
  }

  // Single per-frame authority over the view. Event handlers only mutate the model
  // (group positions, membership, locked, held, pendingDrops) and record dirty rects
  // via markDirty; reconcile turns that recorded intent into tile invalidations,
  // culling, residency, LOD tile visibility, baking and the loading overlay. Called
  // at the end of every camera change and once per frame from the LOD ticker;
  // idempotent, so running it twice in a frame (camera moved + tick) settles to the
  // same state with no extra bakes.
  private reconcile(): void {
    if (!this.app || !this.world) return;

    // Flush recorded dirty rects to per-cell tile invalidations and hotness stamps.
    const hadDirty = this.flushDirty();

    // Recompute the viewport; report it to the server only when it actually moved,
    // so the per-frame tick on a still camera does not spam viewport messages.
    const screen = this.app.renderer.screen;
    const topLeft = this.screenToWorld(0, 0);
    const view: Viewport = {
      worldX: topLeft.x,
      worldY: topLeft.y,
      worldW: screen.width / this.camera.zoom,
      worldH: screen.height / this.camera.zoom,
    };
    const moved =
      !this.viewport ||
      this.viewport.worldX !== view.worldX ||
      this.viewport.worldY !== view.worldY ||
      this.viewport.worldW !== view.worldW ||
      this.viewport.worldH !== view.worldH;
    this.viewport = view;
    if (moved) this.notifyViewport();

    // Cross the LOD bands first (a direct entry bakes the screen cover
    // synchronously), so the candidate pass below sees the correct lodActive: a
    // zoom-in re-hydrates the now-uncovered clusters this same frame instead of
    // running residency against the stale (still-active) LOD state and leaving them
    // un-hydrated until the next camera move.
    const lodChanged = this.evaluateLod();

    // Candidate pass (cull + residency + LOD visibility) when the view moved, a cell
    // was dirtied, or the LOD band just flipped; an idle, settled frame skips it.
    if (moved || hadDirty || lodChanged) this.reconcileGroups();

    // Drain hydration and the bake budget, then trim the resident tile set.
    this.pumpHydration();
    if (this.lodLayer && (this.lodWarm || this.lodActive)) {
      if (this.initialFill && this.lodActive) {
        // Under the loading cover, bake the whole viewport cover each frame (bounded
        // by the screen, the burst hidden behind the cover) so it drops the instant
        // the board is painted; tiles whose groups are still hydrating defer.
        this.bakeViewportCover();
      } else {
        // Steady state: drain a bounded few per frame so a progressive zoom never
        // hitches.
        const needed = this.lodLayer.neededTiles(view);
        let baked = 0;
        for (const key of needed) {
          if (baked >= LOD_BAKE_PER_FRAME) break;
          if (this.lodLayer.isReady(key)) continue;
          if (this.bakeTile(key)) baked++;
        }
      }
      this.lodLayer.cull(view);
    }

    // Loading cells: the cover gate consumes the full set; the per-cell badges are a
    // zoomed-in affordance, suppressed while the LOD is active and during the cover.
    const loadingCells = this.computeLoadingCells();
    const badgeCells = this.lodActive ? NO_LOADING_CELLS : loadingCells;
    if (!this.initialFill) this.loadingOverlay?.update(badgeCells, performance.now());
    this.evictResidentsOverBudget();
    this.tickInitialFill(loadingCells);
  }

  // Turns the frame's recorded dirty rects into per-cell tile invalidations and
  // hotness stamps, then clears the accumulator. Returns whether anything was
  // dirtied, so reconcile runs the candidate pass (which flips a dirtied cell's
  // clusters live until the bake catches up, gapless fill) only when needed.
  private flushDirty(): boolean {
    if (this.dirtyRects.length === 0) return false;
    const rects = this.dirtyRects;
    this.dirtyRects = [];
    if (this.lodLayer) {
      const now = performance.now();
      for (const key of coalesceDirtyCells(rects, LOD_TILE_WORLD)) {
        this.lodLayer.markDirtyCell(key);
        this.cellDirtyMs.set(key, now);
      }
    }
    return true;
  }

  // The candidate pass: over the keep-ring groups (the widest residency ring, a
  // superset of the cull and hydrate sets), cull each, decide its residency, and,
  // while the LOD is active, apply its tile visibility, collapsing the former
  // separate cull/hydrate/keep queries into one. Then cull the groups that left the
  // ring since last frame (restoring any the LOD had hidden) and free residents that
  // left it (hysteresis). O(visible), not O(board), via the spatial index.
  private reconcileGroups(): void {
    const keepRing = this.viewportRing(DEHYDRATE_MARGIN_FRAC);
    if (!keepRing) return;
    const now = performance.now();
    const candidates = this.groupGrid.queryRect(keepRing);
    for (const gid of candidates) {
      const node = this.groups.get(gid);
      if (!node) continue;
      this.cullGroup(node);
      this.reconcileGroupResidency(node, now);
      if (this.lodActive) this.applyGroupLodVisibility(node);
    }
    for (const gid of this.lastVisible) {
      if (candidates.has(gid)) continue;
      const node = this.groups.get(gid);
      if (!node) continue;
      node.container.culled = true;
      if (this.lodHidden.delete(gid)) node.container.visible = true;
    }
    this.lastVisible = candidates;
    for (const gid of [...this.resident.keys(), ...this.hydrateQueued]) {
      if (candidates.has(gid)) continue;
      const node = this.groups.get(gid);
      if (!node) {
        this.resident.delete(gid);
        this.hydrateQueued.delete(gid);
        continue;
      }
      this.dehydrateGroup(node);
    }
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
    this.glidingGroupIds.delete(gid);
    this.resident.delete(gid);
    this.hydrateQueued.delete(gid);
  }

  // ----- texture streaming -----

  // Per-piece texture URL from the manifest's bucketed path, resolved against the
  // assets base. Null for an unknown piece id.
  private pieceUrl(pieceId: number): string | null {
    const file = this.fileById.get(pieceId);
    if (file === undefined) return null;
    return joinUrl(this.textureBase, file);
  }

  // Loads one piece texture with a deadline so a stalled CDN connection cannot
  // pin its hydrate slot forever. Retries a bounded number of times, then
  // returns null: the caller skips the piece and the group still completes.
  private async loadPieceTexture(url: string): Promise<Texture | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await withTimeout(Assets.load(url), TEXTURE_LOAD_TIMEOUT_MS)) as Texture;
      } catch (e) {
        if (attempt >= TEXTURE_LOAD_RETRIES) {
          console.warn("[stage] texture load failed", url, e);
          return null;
        }
      }
    }
  }

  // Viewport rectangle grown by a fraction of its size on every side. The hydrate
  // ring decides what to load ahead of the camera; the wider keep ring decides
  // what to retain (hysteresis), so a piece at the edge does not thrash.
  private viewportRing(frac: number): Aabb | null {
    const v = this.viewport;
    if (!v) return null;
    const mx = v.worldW * frac;
    const my = v.worldH * frac;
    return {
      minX: v.worldX - mx,
      minY: v.worldY - my,
      maxX: v.worldX + v.worldW + mx,
      maxY: v.worldY + v.worldH + my,
    };
  }

  private groupInRing(node: GroupNode, frac: number): boolean {
    const ring = this.viewportRing(frac);
    if (!ring) return false;
    const b = node.localBounds;
    return (
      node.worldX + b.maxX >= ring.minX &&
      node.worldX + b.minX <= ring.maxX &&
      node.worldY + b.maxY >= ring.minY &&
      node.worldY + b.minY <= ring.maxY
    );
  }

  // Dedup is on hydrated/hydrating/queued, not on resident: a resident group can
  // be left unhydrated when a merge or membership reconcile resets `hydrated`
  // (added piece ids whose source node was cold-swept and never built locally).
  // Guarding on resident.has would refuse to re-enqueue it, so it would never
  // rebuild the missing nodes and its tile would defer its bake forever (the cell
  // stays blank at a deep zoom-out). The hydrated/hydrating guards still keep a
  // healthy already-resident group from re-loading.
  private enqueueHydrate(gid: number): void {
    if (this.hydrateQueued.has(gid)) return;
    const node = this.groups.get(gid);
    if (!node || node.hydrated || node.hydrating) return;
    this.hydrateQueued.add(gid);
    this.hydrateQueue.push(gid);
  }

  // Starts queued group loads up to the in-flight cap. Drained once per frame, so
  // a deep zoom-out that enqueues thousands of groups fetches them progressively
  // instead of firing every request at once.
  private pumpHydration(): void {
    while (this.inFlight < HYDRATE_MAX_INFLIGHT && this.hydrateQueue.length > 0) {
      const gid = this.hydrateQueue.shift();
      if (gid === undefined) break;
      if (!this.hydrateQueued.has(gid)) continue;
      this.hydrateQueued.delete(gid);
      const node = this.groups.get(gid);
      if (!node || node.hydrated || node.hydrating) continue;
      this.inFlight++;
      void this.hydrateGroup(node).finally(() => {
        this.inFlight--;
      });
    }
  }

  // Fetches every piece texture of a group and builds its nodes. Tolerant of a
  // group being dehydrated, merged away, or the world cleared mid-fetch: a piece
  // whose group is no longer resident (or no longer owns it) is unloaded instead
  // of attached. A piece that fails to load is skipped; the group still completes
  // so streaming never stalls on a missing tile.
  private async hydrateGroup(node: GroupNode): Promise<void> {
    if (node.hydrated || node.hydrating) return;
    node.hydrating = true;
    this.resident.set(node.id, ++this.residentLru);
    await Promise.all(
      [...node.members.keys()].map(async (pieceId) => {
        if (node.pieces.some((p) => p.id === pieceId)) return;
        const url = this.pieceUrl(pieceId);
        if (!url) return;
        const texture = await this.loadPieceTexture(url);
        if (!texture) return;
        const offset = node.members.get(pieceId);
        const stillMine =
          offset !== undefined &&
          this.resident.has(node.id) &&
          this.groups.get(node.id) === node &&
          this.pieceToGroup.get(pieceId) === node.id;
        if (!stillMine || node.pieces.some((p) => p.id === pieceId)) {
          void Assets.unload(url);
          return;
        }
        if (!this.manifest) return;
        const built = buildPieceNode(pieceId, offset, texture, this.manifest);
        node.container.addChild(built.container);
        node.pieces.push(built);
      }),
    );
    node.hydrating = false;
    if (!this.resident.has(node.id) || this.groups.get(node.id) !== node) {
      this.destroyPieceNodes(node);
      return;
    }
    node.hydrated = true;
    this.applyGroupInteractivity(node);
    this.cullGroup(node);
    if (this.lodActive) this.applyGroupLodVisibility(node);
  }

  // Frees a group's textures and nodes. A group whose load is still in flight is
  // dropped from resident here; the load's completion sees it is no longer
  // resident and cleans up whatever it built.
  private dehydrateGroup(node: GroupNode): void {
    this.resident.delete(node.id);
    this.hydrateQueued.delete(node.id);
    if (node.hydrating) return;
    if (!node.hydrated && node.pieces.length === 0) return;
    this.destroyPieceNodes(node);
  }

  private destroyPieceNodes(node: GroupNode): void {
    for (const piece of node.pieces) {
      const url = this.pieceUrl(piece.id);
      node.container.removeChild(piece.container);
      piece.container.destroy({ children: true });
      if (url) void Assets.unload(url);
    }
    node.pieces = [];
    node.hydrated = false;
  }

  private isCellHot(key: CellKey, now: number): boolean {
    const t = this.cellDirtyMs.get(key);
    return t !== undefined && now - t < LOD_HOT_TTL_MS;
  }

  // A group is hot if any tile it occupies is hot. Every cluster touching a hot
  // cell must stay resident: that cell's tile will re-bake, and a bake needs all
  // the cell's non-held clusters hydrated, so per-cell (not per-group) hotness is
  // what keeps the bake inputs available.
  private isGroupHot(gid: number, now: number): boolean {
    for (const key of this.groupGrid.cellsOf(gid)) {
      if (this.isCellHot(key, now)) return true;
    }
    return false;
  }

  // A covered, idle cluster: the LOD is active, it is not held, every tile it
  // occupies is baked (the tiles draw it), and none of those tiles changed within
  // the hot window. Such a cluster adds nothing on screen, so it is eligible for
  // eviction (evictResidentsOverBudget frees the coldest under budget pressure); the
  // first later change to one of its tiles marks the cell hot, which keeps it
  // resident and re-bakes the tile from live pieces. Suppressed until the initial
  // fill resolves: that gate counts hydrated groups, and at a cold start every cell
  // is cold (no change yet), so making covered clusters evictable mid-fill would
  // stall the loading cover. Once resolved, the idle window can be evicted.
  private isCoveredCold(node: GroupNode, now: number): boolean {
    return (
      this.initialFill === null &&
      this.lodActive &&
      !this.isLive(node.id) &&
      this.allCellsReady(node.id) &&
      !this.isGroupHot(node.id, now)
    );
  }

  // Residency for one near-viewport group. Inside the hydrate ring a non-covered
  // cluster is hydrated and marked recently used; a covered-cold one (drawn by its
  // baked tiles) is retained, left resident but not bumped, so it ages toward
  // eviction and is freed only when evictResidentsOverBudget needs the room. With the
  // LOD inactive (zoomed in) nothing is covered, so the whole window hydrates and
  // renders live. Called per candidate from reconcileGroups; the keep-ring retention
  // lives there.
  private reconcileGroupResidency(node: GroupNode, now: number): void {
    const inRing = this.groupInRing(node, HYDRATE_MARGIN_FRAC);
    if (residencyDecision(inRing, inRing && this.isCoveredCold(node, now)) !== "hydrate") return;
    this.enqueueHydrate(node.id);
    this.touchResident(node.id);
  }

  // Bump a resident group's LRU stamp: it is active this frame (live, zoomed-in
  // visible, or still feeding an unbaked tile), so the budget evictor should free it
  // last. A no-op when the group is not resident yet (the hydrate sets its stamp).
  private touchResident(gid: number): void {
    if (this.resident.has(gid)) this.resident.set(gid, ++this.residentLru);
  }

  // Resolves build()'s promise once the first viewport is painted: every group in
  // the hydrate ring hydrated and, while the board shows as baked tiles (zoomed
  // out), every viewport LOD tile baked too (tickInitialFill's gate). Holding the
  // cover over the tile bake means the board appears complete, not mid-bake, when
  // it drops. The per-frame driver (tickLodFrame) checks completion and passes it
  // the frame's loading-cell set.
  private awaitInitialCoverage(progress?: (loaded: number, total: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.initialFill = { resolve, progress };
    });
  }

  // Hydration progress of the first viewport, driving the loading cover's progress
  // bar. tickInitialFill folds in tile readiness for the done decision.
  private initialCoverage(): { loaded: number; total: number } {
    const ring = this.viewportRing(HYDRATE_MARGIN_FRAC);
    if (!ring) return { loaded: 0, total: 0 };
    let total = 0;
    let loaded = 0;
    // queryRect is cell-coarse: it returns every group whose grid cell overlaps
    // the ring, including ones whose actual bounds fall outside it. Hydration only
    // enqueues groups passing the precise groupInRing test (see
    // reconcileGroupResidency), so count over that same predicate. Counting the
    // coarse candidates would inflate total with groups that are never hydrated,
    // leaving loaded < total forever and wedging the loading cover at a cold start.
    for (const gid of this.groupGrid.queryRect(ring)) {
      const node = this.groups.get(gid);
      if (!node || !this.groupInRing(node, HYDRATE_MARGIN_FRAC)) continue;
      total++;
      if (node.hydrated) loaded++;
    }
    return { loaded, total };
  }

  private tickInitialFill(loadingCells: ReadonlySet<CellKey>): void {
    if (!this.initialFill) return;
    const { loaded, total } = this.initialCoverage();
    this.initialFill.progress?.(loaded, total);
    // Hold the cover until the first viewport is fully painted: every in-ring
    // group hydrated, and (when the board shows as baked tiles) no viewport tile
    // still loading. While the LOD is active computeLoadingCells reports exactly
    // the viewport cells whose tile is not ready, so gating on it empty keeps the
    // cover up until the last tile bakes; the per-cell badges then only ever show
    // for later pans, never over the board's first paint. Zoomed in there are no
    // tiles, so only the hydration gate applies.
    const tilesPending = this.lodActive && loadingCells.size > 0;
    // Also hold until the first viewport's region has actually streamed in (a
    // contributor's region_state), so the cover never drops onto a board still
    // streaming. Without it the cold-start frame (no groups yet, so loaded/total
    // are 0 and no tile is pending) resolves at once and the per-cell badges paint
    // as the region arrives. See viewportStreamSettled.
    if (loaded < total || tilesPending || !this.viewportStreamSettled()) return;
    const fill = this.initialFill;
    this.initialFill = null;
    fill.resolve();
  }

  // ----- zoom-out level of detail -----

  // Builds the tile layer over the play zone and sizes it for the current
  // screen. The container is inserted into world just below the held layers, so
  // tiles sit above the resting clusters they replace and below a piece in hand;
  // the camera transforms it like any other content.
  private createLodLayer(): void {
    if (!this.world || !this.app || !this.playZone || !this.remoteHeldLayer) return;
    const layer = new LodTileLayer(this.playZone, this.app.renderer.resolution);
    this.world.addChildAt(layer.container, this.world.getChildIndex(this.remoteHeldLayer));
    this.lodLayer = layer;
    this.configureLodLayer();
  }

  private configureLodLayer(): void {
    if (!this.lodLayer || !this.app) return;
    const screen = this.app.renderer.screen;
    this.lodLayer.configure(screen.width, screen.height, MIN_ZOOM);
  }

  // Inserts the loading overlay just above the LOD tiles and below the held
  // layers, so a badge covers the resting clusters or baked tile it stands in for
  // while a piece in hand still draws on top.
  private createLoadingOverlay(): void {
    if (!this.world || !this.remoteHeldLayer) return;
    const overlay = new LoadingOverlay();
    this.world.addChildAt(overlay.container, this.world.getChildIndex(this.remoteHeldLayer));
    this.loadingOverlay = overlay;
  }

  // Viewport cells (within the play zone) whose content should be visible but is not
  // yet. Drives both the loading-cover gate (every viewport tile baked before the
  // cover drops) and, while zoomed in, the per-cell badges. The three zoom-band cases
  // live in the pure cellContentPending; this gathers each cell's facts off the same
  // residency/visibility truth reconcile already maintains.
  private computeLoadingCells(): Set<CellKey> {
    const out = new Set<CellKey>();
    const v = this.viewport;
    if (!v || !this.playZone) return out;
    const box: Aabb = {
      minX: v.worldX,
      minY: v.worldY,
      maxX: v.worldX + v.worldW,
      maxY: v.worldY + v.worldH,
    };
    for (const key of cellKeysForRect(box, LOD_TILE_WORLD)) {
      if (!this.cellOverlapsPlayZone(key)) continue;
      const groups = this.groupGrid.cellGroups(key);
      const known = this.knownCells.has(key);
      // The group scan is the only costly fact, so compute it only in the case that
      // reads it (zoomed in, region already streamed): the zoom-out and not-streamed
      // cases never touch the cell's groups.
      const needsGroupScan = !this.lodActive && !(this.coverageSeen && !known);
      const pending = cellContentPending({
        lodActive: this.lodActive,
        hasGroups: groups !== undefined && groups.size > 0,
        tileReady: this.lodLayer?.isReady(key) ?? false,
        coverageSeen: this.coverageSeen,
        known,
        hasUnhydratedInRingGroup: needsGroupScan && this.cellHasUnhydratedInRingGroup(groups),
      });
      if (pending) out.add(key);
    }
    return out;
  }

  // Whether a cell holds a group still hydrating inside the hydrate ring, the
  // zoomed-in "textures loading" loading-cell case.
  private cellHasUnhydratedInRingGroup(groups: ReadonlySet<number> | undefined): boolean {
    if (!groups) return false;
    for (const gid of groups) {
      const node = this.groups.get(gid);
      if (node && !node.hydrated && this.groupInRing(node, HYDRATE_MARGIN_FRAC)) return true;
    }
    return false;
  }

  private cellOverlapsPlayZone(key: CellKey): boolean {
    if (!this.playZone) return false;
    const { cx, cy } = unpackCell(key);
    const minX = cx * LOD_TILE_WORLD;
    const minY = cy * LOD_TILE_WORLD;
    return (
      minX < this.playZone.maxX &&
      minX + LOD_TILE_WORLD > this.playZone.minX &&
      minY < this.playZone.maxY &&
      minY + LOD_TILE_WORLD > this.playZone.minY
    );
  }

  // Whether the first viewport's content has arrived, so dropping the loading
  // cover will not reveal a region still streaming in. A spectator builds the
  // whole board from the keyframe, so it is always settled. A contributor streams
  // its viewport via region_state: a scoped viewport waits for the coverage ack
  // and for every in-zone cell to be acked known; a global-subscriber viewport
  // (too large to scope) receives no region_state by design, so there is nothing
  // to wait for (the minimap carries its overview).
  private viewportStreamSettled(): boolean {
    if (this.mode !== "contributor") return true;
    if (this.viewportIsGlobalSubscriber()) return true;
    if (!this.coverageSeen) return false;
    const v = this.viewport;
    if (!v || !this.playZone) return false;
    const box: Aabb = {
      minX: v.worldX,
      minY: v.worldY,
      maxX: v.worldX + v.worldW,
      maxY: v.worldY + v.worldH,
    };
    for (const key of cellKeysForRect(box, LOD_TILE_WORLD)) {
      if (this.cellOverlapsPlayZone(key) && !this.knownCells.has(key)) return false;
    }
    return true;
  }

  // Mirrors the server's cellsForRect decision (worldGrid.ts): a viewport
  // overlapping more than broadcastMaxCells world-tile cells is a global
  // subscriber the server streams no region_state to. LOD_TILE_WORLD is the same
  // WORLD_TILE_SIZE the server scopes on, so the cell count matches exactly.
  private viewportIsGlobalSubscriber(): boolean {
    const v = this.viewport;
    if (!v) return false;
    const cxMin = Math.floor(v.worldX / LOD_TILE_WORLD);
    const cxMax = Math.floor((v.worldX + v.worldW) / LOD_TILE_WORLD);
    const cyMin = Math.floor(v.worldY / LOD_TILE_WORLD);
    const cyMax = Math.floor((v.worldY + v.worldH) / LOD_TILE_WORLD);
    return (cxMax - cxMin + 1) * (cyMax - cyMin + 1) > this.broadcastMaxCells;
  }

  // Crosses the three zoom bands and returns whether the active band flipped this
  // frame, so reconcile re-runs the residency pass against the new state. The bake
  // queue (drained in tickLodFrame) fills tiles in the background while warm, so
  // reaching the active band does not hitch; LOD_EXIT_ZOOM gives the active band
  // hysteresis.
  private evaluateLod(): boolean {
    if (!this.lodLayer) return false;
    const zoom = this.camera.zoom;
    this.lodWarm = zoom < LOD_WARM_ZOOM;
    const active = this.lodActive ? zoom < LOD_EXIT_ZOOM : zoom < LOD_ENTER_ZOOM;
    if (active === this.lodActive) return false;
    this.setLodActive(active);
    return true;
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
    const live = this.isLive(node.id) || !this.allCellsReady(node.id);
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

  // A cluster is live (drawn on top, excluded from tile bakes) while a human holds
  // it or while it glides in the spectator stream. A live cluster is never baked
  // into a tile, so its per-frame movement needs no tile invalidation.
  private isLive(gid: number): boolean {
    return this.heldGroupIds.has(gid) || this.glidingGroupIds.has(gid);
  }

  // A grabbed cluster is excluded from future bakes though its position has not
  // changed, so its resting tile is now stale (a ghost). Dirty it on the grab
  // transition only; per-frame drag moves of an already-held cluster stay off
  // the dirty path (held = drawn live, excluded from bakes).
  private markGroupHeld(node: GroupNode): void {
    const wasHeld = this.heldGroupIds.has(node.id);
    this.heldGroupIds.add(node.id);
    if (this.lodActive) node.container.visible = true;
    // A held cluster always renders live, so make sure it is loaded (it may have
    // been covered by a tile, or be a remote grab on an off-screen cluster).
    if (this.groupInRing(node, HYDRATE_MARGIN_FRAC)) this.enqueueHydrate(node.id);
    if (!wasHeld) this.markDirty(this.worldAabb(node));
  }

  // The released cluster's new resting tile must fold it back in. It stays live
  // until that tile re-bakes (gapless), then the bake hides it.
  private releaseGroupHeld(groupId: number): void {
    this.heldGroupIds.delete(groupId);
    const node = this.groups.get(groupId);
    if (node) this.markDirty(this.worldAabb(node));
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

  // Per-frame LOD driver: reconcile is the sole authority, so the tick just runs it
  // every frame. This guarantees a flush + bake even when the camera is still (a
  // WS-driven dirty, a hydration completing, the initial-fill cover bake); a camera
  // move runs reconcile again from applyCamera.
  private tickLodFrame(): void {
    this.reconcile();
  }

  // Frees the per-piece nodes of the coldest covered-cold clusters when resident
  // nodes exceed RESIDENT_PIECE_BUDGET, bounding resident VRAM at a deep zoom-out
  // without freeing eagerly on every zoom: under the budget a covered cluster stays
  // resident, so a zoom in/out re-uses its nodes with no re-fetch (the alpha board,
  // under the budget, never evicts). Only covered-cold clusters are evictable (their
  // baked tiles keep drawing them) and only while the LOD is active; zoomed in
  // nothing is covered, so the whole window stays resident. Throttled to one pass
  // every LOD_COLD_SWEEP_FRAMES; the scan is bounded by the resident set. Also prunes
  // hotness entries past the hot window so the cell map stays the size of the hot set.
  private evictResidentsOverBudget(): void {
    if (!this.lodActive || this.initialFill) return;
    if (++this.coldSweepFrame < LOD_COLD_SWEEP_FRAMES) return;
    this.coldSweepFrame = 0;
    const now = performance.now();
    let totalNodes = 0;
    const evictable: number[] = [];
    for (const gid of this.resident.keys()) {
      const node = this.groups.get(gid);
      if (!node) continue;
      totalNodes += node.pieces.length;
      if (this.isCoveredCold(node, now)) evictable.push(gid);
    }
    if (totalNodes > RESIDENT_PIECE_BUDGET && evictable.length > 0) {
      // Coldest first: a covered-cold cluster stops bumping its LRU stamp, so the
      // lowest stamp is the one longest off-screen-useful.
      evictable.sort((a, b) => (this.resident.get(a) ?? 0) - (this.resident.get(b) ?? 0));
      for (const gid of evictable) {
        if (totalNodes <= RESIDENT_PIECE_BUDGET) break;
        const node = this.groups.get(gid);
        if (!node) continue;
        totalNodes -= node.pieces.length;
        this.dehydrateGroup(node);
      }
    }
    for (const [key, t] of this.cellDirtyMs) {
      if (now - t >= LOD_HOT_TTL_MS) this.cellDirtyMs.delete(key);
    }
  }

  // Renders one tile's clusters into its texture with the tile matrix as the root
  // transform (bypassing the camera). Live clusters (held or gliding), the frame,
  // the backdrop, the loading overlay and the tile layer are excluded; non-tile
  // clusters clip out of the texture, so only this tile's clusters contribute. The
  // loading badge is a transient hint composited live above the tiles, so baking it
  // in would freeze a stale badge into the cell until its next re-bake. After baking,
  // the tile's clusters are re-culled and (if active) hidden now that the tile covers
  // them.
  private bakeTile(key: CellKey): boolean {
    if (!this.app || !this.world || !this.lodLayer) return false;
    const groupIds = this.groupGrid.cellGroups(key);
    // Defer until every non-live cluster in the cell is hydrated: baking from
    // missing textures would mark the tile ready with blank pieces. Enqueue the
    // missing ones so a later frame can complete the bake.
    if (groupIds) {
      let pending = false;
      for (const gid of groupIds) {
        if (this.isLive(gid)) continue;
        const node = this.groups.get(gid);
        if (node && !node.hydrated) {
          this.enqueueHydrate(gid);
          pending = true;
        }
      }
      if (pending) return false;
    }
    const target = this.lodLayer.prepareBake(key);
    if (!target) return false;
    const r = this.lodLayer.cellRect(key);
    const tileView: Viewport = {
      worldX: r.minX,
      worldY: r.minY,
      worldW: r.maxX - r.minX,
      worldH: r.maxY - r.minY,
    };

    if (this.frame) this.frame.visible = false;
    if (this.backdrop) this.backdrop.visible = false;
    if (this.loadingOverlay) this.loadingOverlay.container.visible = false;
    this.lodLayer.setVisible(false);
    const liveHidden: GroupNode[] = [];
    const forced: GroupNode[] = [];
    if (groupIds) {
      for (const gid of groupIds) {
        const node = this.groups.get(gid);
        if (!node) continue;
        if (this.isLive(gid)) {
          node.container.visible = false;
          liveHidden.push(node);
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
    if (this.loadingOverlay) this.loadingOverlay.container.visible = true;
    this.lodLayer.setVisible(this.lodActive);
    this.lodLayer.markBaked(key);
    for (const node of liveHidden) node.container.visible = true;
    for (const node of forced) {
      this.cullGroup(node);
      if (this.lodActive) this.applyGroupLodVisibility(node);
      else node.container.visible = true;
    }
    return true;
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
        // A carried cluster is offset from the cursor in screen space, so a zoom
        // shifts it off the pointer; re-glue it. A press-drag piece sits under
        // the cursor and zoom-to-cursor already holds it there, so skip it.
        if (this.held?.carry) this.dragHeldTo(px, py);
      },
      { passive: false },
    );
  }
}

function buildPieceNode(
  pieceId: number,
  offset: PieceOffset,
  texture: Texture,
  manifest: ImageManifest,
): PieceNode {
  const offsetX = offset.dx * manifest.pieceSize;
  const offsetY = offset.dy * manifest.pieceSize;
  const container = new Container();
  container.x = offsetX;
  container.y = offsetY;

  // Inner container holds the visuals and pivots around the piece visual
  // center so scale animations (held bump, snap bump) feel centered on the
  // piece rather than skewed toward the top-left.
  const pieceSize = manifest.pieceSize;
  const half = pieceSize / 2;
  const inner = new Container();
  inner.pivot.set(half, half);
  inner.position.set(half, half);

  // The tile ships pre-masked (silhouette cut into the alpha) and pre-bordered
  // (outline baked in), so the sprite renders as-is: no render-time mask or
  // stroke, and the client needs no piece geometry.
  const sprite = new Sprite(texture);
  sprite.width = manifest.tileSize;
  sprite.height = manifest.tileSize;
  sprite.x = -manifest.margin;
  sprite.y = -manifest.margin;

  // Geometry-free snap flash: a rounded tile-shaped glow over the piece body. The
  // exact silhouette outline is already baked into the tile, so only the flash
  // shape degrades (a minor, accepted visual change).
  const flash = new Graphics();
  flash.roundRect(0, 0, pieceSize, pieceSize, pieceSize * 0.18).fill({ color: 0xffffff });
  flash.alpha = 0;

  inner.addChild(sprite);
  inner.addChild(flash);

  container.addChild(inner);

  return {
    id: pieceId,
    container,
    inner,
    flash,
    localBounds: pieceLocalBounds(offsetX, offsetY, pieceSize, manifest.margin),
  };
}

// Yields to the macrotask queue so the browser can paint the loading cover and
// handle input between construction bursts. A macrotask (setTimeout), not a
// microtask, so the frame actually renders between chunks.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function joinUrl(base: string, rel: string): string {
  if (/^https?:\/\//.test(rel) || rel.startsWith("/")) return rel;
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}

// Milliseconds component of a Redis stream id ("<ms>-<n>"), the window key the
// spectator stream anchors its event-window requests on. 0 for the empty-log
// sentinel "0-0".
function seqMs(seq: string): number {
  const dash = seq.indexOf("-");
  return dash < 0 ? Number(seq) : Number(seq.slice(0, dash));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Edge-pan velocity component for one axis: 0 outside the band, ramping
// quadratically to +-1 at the very edge. Positive near the low edge (so the
// camera reveals content on that side), negative near the high edge.
function edgePanAxis(pos: number, size: number): number {
  if (pos < EDGE_PAN_MARGIN) {
    const t = clamp((EDGE_PAN_MARGIN - pos) / EDGE_PAN_MARGIN, 0, 1);
    return t * t;
  }
  const hi = size - EDGE_PAN_MARGIN;
  if (pos > hi) {
    const t = clamp((pos - hi) / EDGE_PAN_MARGIN, 0, 1);
    return -(t * t);
  }
  return 0;
}

// Positions a window of `size` within [lo, hi]: clamps it inside when it fits,
// centers it when the window is larger than the range.
function fitOrClamp(v: number, lo: number, hi: number, size: number): number {
  if (size >= hi - lo) return (lo + hi - size) / 2;
  return clamp(v, lo, hi - size);
}
