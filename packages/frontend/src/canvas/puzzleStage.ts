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

export type Mode = "spectator" | "contributor";

type PieceNode = {
  id: number;
  container: Container;
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

  const sprite = new Sprite(texture);
  sprite.width = manifest.tileSize;
  sprite.height = manifest.tileSize;
  sprite.x = -manifest.margin;
  sprite.y = -manifest.margin;

  const mask = new Graphics();
  applyPath(mask, piecePath(geometry, manifest.pieceSize));
  mask.fill({ color: 0xffffff });

  container.addChild(sprite);
  container.addChild(mask);
  sprite.mask = mask;

  return { id: geometry.id, container, geometry };
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
