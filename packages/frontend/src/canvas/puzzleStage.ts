import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
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

type PieceNode = {
  container: Container;
  geometry: PieceGeometry;
};

type GroupNode = {
  id: number;
  container: Container;
  pieces: PieceNode[];
};

const DEFAULT_MANIFEST_URL = "/puzzle/manifest.json";

export class PuzzleStage {
  private app: Application | null = null;
  private world: Container | null = null;
  private groupNodes = new Map<number, GroupNode>();
  private camera = { x: 0, y: 0, zoom: 1 };

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
    app.stage.addChild(world);
    this.app = app;
    this.world = world;
    this.attachCameraControls(app.canvas);
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
      this.world.addChild(gc);
      this.groupNodes.set(group.id, { id: group.id, container: gc, pieces: [] });
    }

    for (const piece of initialPieces) {
      const geometry = geomById.get(piece.id);
      const texture = textures.get(piece.id);
      const groupNode = this.groupNodes.get(piece.groupId);
      if (!geometry || !texture || !groupNode) continue;
      const node = buildPieceNode(geometry, texture, manifest);
      groupNode.container.addChild(node.container);
      groupNode.pieces.push(node);
    }

    this.fitTo(geom);
  }

  destroy(): void {
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.world = null;
    this.groupNodes.clear();
  }

  private fitTo(geom: PuzzleGeometry): void {
    if (!this.app || !this.world) return;
    const worldW = geom.cols * geom.pieceSize;
    const worldH = geom.rows * geom.pieceSize;
    // Scatter fills a 2x world box centered on origin (see server init.ts).
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

  private attachCameraControls(canvas: HTMLCanvasElement): void {
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

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (ev) => {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      this.camera.x += ev.clientX - lastX;
      this.camera.y += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      this.applyCamera();
    });
    const endDrag = (ev: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture?.(ev.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
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

  return { container, geometry };
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
