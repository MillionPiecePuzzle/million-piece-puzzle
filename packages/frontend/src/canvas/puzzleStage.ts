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
  generatePuzzle,
  piecePath,
  type GroupRuntime,
  type ImageManifest,
  type PieceGeometry,
  type PieceRuntime,
  type PuzzleGeometry,
} from "@mpp/shared";
import { applyPath } from "./applyPath";
import { Tweener, peak, easeOutCubic } from "./tween";

export type Mode = "spectator" | "contributor";

type PieceNode = {
  id: number;
  container: Container;
  inner: Container;
  flash: Graphics;
  geometry: PieceGeometry;
};

type GroupNode = {
  id: number;
  container: Container;
  pieces: PieceNode[];
  locked: boolean;
  worldX: number;
  worldY: number;
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

const DEFAULT_MANIFEST_URL = "/puzzle/manifest.json";
const HELD_SCALE = 1.02;
const SNAP_BUMP_SCALE = 1.08;
const SNAP_BUMP_MS = 240;
const SNAP_FLASH_ALPHA = 0.55;
const SNAP_FLASH_MS = 260;

const END_PULSE_SCALE = 1.06;
const END_PULSE_MS = 280;
const END_PULSE_SPREAD_MS = 700;
const END_FLASH_MS = 900;
const END_FLASH_ALPHA = 0.35;

export class PuzzleStage {
  private app: Application | null = null;
  private world: Container | null = null;
  private groups = new Map<number, GroupNode>();
  private pieceToGroup = new Map<number, number>();
  private camera = { x: 0, y: 0, zoom: 1 };
  private mode: Mode = "spectator";
  private localUserId: string | null = null;
  private callbacks: StageCallbacks | null = null;

  private held: HeldState | null = null;
  private pan: { active: boolean; lastX: number; lastY: number } = {
    active: false,
    lastX: 0,
    lastY: 0,
  };
  private tweener: Tweener | null = null;

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
      background: 0xefeadd,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(app.canvas);
    const world = new Container();
    world.sortableChildren = true;
    app.stage.addChild(world);

    app.stage.eventMode = "static";
    this.refreshStageHitArea(app);
    app.stage.on("pointerdown", (ev) => this.onStagePointerDown(ev));
    app.stage.on("globalpointermove", (ev) => this.onPointerMove(ev));
    app.stage.on("pointerup", (ev) => this.onPointerUp(ev));
    app.stage.on("pointerupoutside", (ev) => this.onPointerUp(ev));
    app.renderer.on("resize", () => this.refreshStageHitArea(app));

    this.app = app;
    this.world = world;
    this.tweener = new Tweener(app.ticker);
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
  ): Promise<void> {
    if (!this.app || !this.world) throw new Error("stage not mounted");
    const geom = generatePuzzle({
      seed: manifest.seed,
      rows: manifest.rows,
      cols: manifest.cols,
      pieceSize: manifest.pieceSize,
    });
    const geomById = new Map<number, PieceGeometry>(geom.pieces.map((p) => [p.id, p]));

    const manifestUrl = import.meta.env.VITE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
    const base = manifestBaseUrl(manifestUrl);
    const textures = await loadTextures(manifest, base);

    const frame = new Graphics();
    frame
      .rect(0, 0, geom.cols * geom.pieceSize, geom.rows * geom.pieceSize)
      .stroke({ color: 0x1a1a1a, width: 4 });
    this.world.addChildAt(frame, 0);

    for (const group of initialGroups) {
      const gc = new Container();
      gc.x = group.worldX;
      gc.y = group.worldY;
      const node: GroupNode = {
        id: group.id,
        container: gc,
        pieces: [],
        locked: group.locked,
        worldX: group.worldX,
        worldY: group.worldY,
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

    for (const node of this.groups.values()) {
      this.applyGroupInteractivity(node);
    }

    this.fitTo(geom);
  }

  destroy(): void {
    this.tweener?.destroy();
    this.tweener = null;
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.world = null;
    this.groups.clear();
    this.pieceToGroup.clear();
    this.held = null;
  }

  // ----- incoming server messages -----

  applyGrabOk(groupId: number, userId: string): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    if (userId === this.localUserId && this.held && this.held.groupId === groupId) {
      this.held.confirmed = true;
      return;
    }
    // Remote grab: keep group visible on top while held by someone else.
    node.container.zIndex = 10;
  }

  applyGrabDenied(groupId: number): void {
    if (!this.held || this.held.groupId !== groupId) return;
    const node = this.groups.get(groupId);
    if (node) {
      this.moveGroup(node, this.held.originX, this.held.originY);
      this.setGroupHeldVisual(node, false);
    }
    this.held = null;
  }

  applyRemoteDrag(groupId: number, userId: string, worldX: number, worldY: number): void {
    if (userId === this.localUserId) return;
    const node = this.groups.get(groupId);
    if (!node) return;
    this.moveGroup(node, worldX, worldY);
  }

  applyRemoteDrop(groupId: number, userId: string, worldX: number, worldY: number): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    this.moveGroup(node, worldX, worldY);
    if (userId !== this.localUserId) {
      node.container.zIndex = 0;
    }
  }

  applyRollback(groupId: number, worldX: number, worldY: number): void {
    const node = this.groups.get(groupId);
    if (!node) return;
    this.moveGroup(node, worldX, worldY);
    if (this.held && this.held.groupId === groupId) {
      this.setGroupHeldVisual(node, false);
      this.held = null;
    }
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

    this.moveGroup(host, worldX, worldY);
    host.locked = host.locked || anchored;
    this.setGroupHeldVisual(host, false);

    for (const gid of sourceGroupIds) {
      const dead = this.groups.get(gid);
      if (!dead) continue;
      dead.container.destroy({ children: true });
      this.groups.delete(gid);
    }

    this.applyGroupInteractivity(host);

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
    if (this.held) {
      const node = this.groups.get(this.held.groupId);
      if (!node || !this.callbacks) return;
      const world = this.screenToWorld(ev.global.x, ev.global.y);
      const nx = world.x - this.held.pointerDx;
      const ny = world.y - this.held.pointerDy;
      this.moveGroup(node, nx, ny);
      this.callbacks.onDrag(node.id, nx, ny);
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
        const nx = world.x - this.held.pointerDx;
        const ny = world.y - this.held.pointerDy;
        this.moveGroup(node, nx, ny);
        this.setGroupHeldVisual(node, false);
        this.callbacks.onDrop(node.id, nx, ny);
      }
      this.held = null;
    }
    this.pan.active = false;
  }

  private setGroupHeldVisual(node: GroupNode, held: boolean): void {
    node.container.scale.set(held ? HELD_SCALE : 1);
    node.container.zIndex = held ? 100 : 0;
  }

  private moveGroup(node: GroupNode, worldX: number, worldY: number): void {
    node.worldX = worldX;
    node.worldY = worldY;
    node.container.position.set(worldX, worldY);
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.camera.x) / this.camera.zoom,
      y: (sy - this.camera.y) / this.camera.zoom,
    };
  }

  private fitTo(geom: PuzzleGeometry): void {
    if (!this.app || !this.world) return;
    const worldW = geom.cols * geom.pieceSize;
    const worldH = geom.rows * geom.pieceSize;
    const fitW = worldW * 3;
    const fitH = worldH * 3;
    const screen = this.app.renderer.screen;
    const zoom = Math.min(screen.width / fitW, screen.height / fitH);
    const cx = worldW * 0.5;
    const cy = worldH * 0.5;
    this.camera.zoom = zoom;
    this.camera.x = screen.width * 0.5 - cx * zoom;
    this.camera.y = screen.height * 0.5 - cy * zoom;
    this.applyCamera();
  }

  private applyCamera(): void {
    if (!this.world) return;
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(this.camera.x, this.camera.y);
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
        const next = clamp(this.camera.zoom * factor, 0.05, 8);
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

  return { id: geometry.id, container, inner, flash, geometry };
}

async function loadTextures(
  manifest: ImageManifest,
  base: string,
): Promise<Map<number, Texture>> {
  const out = new Map<number, Texture>();
  const entries = await Promise.all(
    manifest.pieces.map(async (p) => {
      const url = joinUrl(base, p.file);
      try {
        const tex = (await Assets.load(url)) as Texture;
        return [p.id, tex] as const;
      } catch (e) {
        console.warn("[stage] failed to load", url, e);
        return null;
      }
    }),
  );
  for (const e of entries) if (e) out.set(e[0], e[1]);
  return out;
}

function manifestBaseUrl(url: string): string {
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(0, i + 1) : "/";
}

function joinUrl(base: string, rel: string): string {
  if (/^https?:\/\//.test(rel) || rel.startsWith("/")) return rel;
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
