import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import { worldToScreen, type CameraTransform } from "./camera";
import { FLAG_COLORS, type BoardFlag } from "../data/boardFlags";

// The flag layer lives in screen space rather than under the world's camera
// transform, so it draws over the zoom-out LOD bands (which replace the live
// world with baked tiles) instead of being baked into them. It still reads as
// part of the board: update() scales every glyph by the camera, so a flag keeps
// a constant size relative to the pieces, not to the screen.

// Glyph height in board terms: a flag stands one and a half pieces tall.
const FLAG_PIECE_HEIGHTS = 1.5;

// Same pennant the HUD button and the minimap markers draw. These are design
// units, scaled to the board by update().
const POLE_HEIGHT = 26;
const POLE_WIDTH = 2;
const PENNANT_WIDTH = 15.2;
const PENNANT_HEIGHT = 12;
const PENNANT_NOTCH = 4;
const OUTLINE = 0x2a2620;
const HALO = 0xfffdf7;
const HALO_WIDTH = 2;
const BASE_RADIUS = 2;
// Drawn extent, top of the pole's rounded cap to the bottom of the foot dot.
// This, not the pole alone, is what FLAG_PIECE_HEIGHTS sizes against.
const GLYPH_HEIGHT = POLE_HEIGHT + (POLE_WIDTH + HALO_WIDTH) / 2 + BASE_RADIUS + HALO_WIDTH / 4;
// Hit box around the whole glyph, kept tight: a flag sits over the board and any
// pixel it claims is a piece underneath that can no longer be grabbed.
const HIT_PADDING = 5;
const HIT_WIDTH = PENNANT_WIDTH + 2;
// A flag whose anchor sits this far outside the viewport, in multiples of its
// own drawn height, is hidden rather than drawn off-screen.
const OFFSCREEN_MARGIN_FACTOR = 1.5;

type FlagNode = {
  flag: BoardFlag;
  container: Container;
  glyph: Graphics;
  halo: Graphics;
};

export class FlagLayer {
  readonly container: Container;
  private readonly nodes = new Map<string, FlagNode>();
  private selectedId: string | null = null;
  private interactive = true;
  onPress: ((id: string, ev: FederatedPointerEvent) => void) | null = null;

  constructor() {
    this.container = new Container();
  }

  setFlags(next: readonly BoardFlag[]): void {
    const seen = new Set<string>();
    for (const flag of next) {
      seen.add(flag.id);
      const node = this.nodes.get(flag.id);
      if (!node) {
        this.nodes.set(flag.id, this.createNode(flag));
        continue;
      }
      if (node.flag.color !== flag.color) {
        node.glyph.clear();
        drawFlagGlyph(node.glyph, FLAG_COLORS[flag.color] ?? FLAG_COLORS[0]);
      }
      node.flag = flag;
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.container.destroy({ children: true });
      this.nodes.delete(id);
    }
  }

  // Live position while the player drags a flag: the committed list only takes it
  // on release, so the layer holds the in-flight position by itself.
  moveFlag(id: string, worldX: number, worldY: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.flag = { ...node.flag, worldX, worldY };
  }

  flagAt(id: string): BoardFlag | null {
    return this.nodes.get(id)?.flag ?? null;
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    for (const [nodeId, node] of this.nodes) node.halo.visible = nodeId === id;
  }

  // Presses are refused while a cluster is in hand: that press belongs to the
  // sticky-carry drop, which needs it to reach the stage.
  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    for (const node of this.nodes.values()) this.applyInteractivity(node);
  }

  update(camera: CameraTransform, screenW: number, screenH: number, pieceSize: number): void {
    const scale = pieceSize > 0 ? (pieceSize * FLAG_PIECE_HEIGHTS * camera.zoom) / GLYPH_HEIGHT : 1;
    const margin = GLYPH_HEIGHT * scale * OFFSCREEN_MARGIN_FACTOR;
    for (const node of this.nodes.values()) {
      const p = worldToScreen(node.flag.worldX, node.flag.worldY, camera);
      const onScreen =
        p.x >= -margin && p.y >= -margin && p.x <= screenW + margin && p.y <= screenH + margin;
      node.container.visible = onScreen;
      node.container.position.set(p.x, p.y);
      node.container.scale.set(scale);
    }
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.container.destroy({ children: true });
    this.nodes.clear();
    this.container.destroy({ children: true });
  }

  private createNode(flag: BoardFlag): FlagNode {
    const container = new Container();
    const halo = new Graphics();
    halo.circle(0, 0, BASE_RADIUS + 4).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    halo.circle(0, 0, BASE_RADIUS + 4).stroke({ color: OUTLINE, width: 1, alpha: 0.55 });
    halo.visible = flag.id === this.selectedId;
    const glyph = new Graphics();
    drawFlagGlyph(glyph, FLAG_COLORS[flag.color] ?? FLAG_COLORS[0]);
    container.addChild(halo, glyph);
    container.hitArea = new Rectangle(
      -HIT_PADDING,
      -POLE_HEIGHT - HIT_PADDING,
      HIT_WIDTH + HIT_PADDING,
      POLE_HEIGHT + HIT_PADDING * 2,
    );
    const node: FlagNode = { flag, container, glyph, halo };
    container.on("pointerdown", (ev: FederatedPointerEvent) => this.onPress?.(node.flag.id, ev));
    this.applyInteractivity(node);
    this.container.addChild(container);
    return node;
  }

  private applyInteractivity(node: FlagNode): void {
    node.container.eventMode = this.interactive ? "static" : "none";
    node.container.cursor = this.interactive ? "pointer" : "default";
  }
}

// Pennant on a pole, hot point at the pole's foot: that foot is the world point
// the flag marks, so the glyph reads as planted there rather than centered on it.
// Every part is drawn over a pale under-stroke first, so the outline survives on
// top of a dark photo piece as well as on the paper backdrop.
function drawFlagGlyph(g: Graphics, color: string): void {
  const top = -POLE_HEIGHT;
  const pennant = (): Graphics =>
    g
      .moveTo(0, top + 0.6)
      .lineTo(PENNANT_WIDTH, top + 0.6)
      .lineTo(PENNANT_WIDTH - PENNANT_NOTCH, top + 0.6 + PENNANT_HEIGHT / 2)
      .lineTo(PENNANT_WIDTH, top + 0.6 + PENNANT_HEIGHT)
      .lineTo(0, top + 0.6 + PENNANT_HEIGHT)
      .closePath();
  const pole = (): Graphics => g.moveTo(0, top).lineTo(0, 0);
  pole().stroke({ color: HALO, width: POLE_WIDTH + HALO_WIDTH, cap: "round" });
  pennant().stroke({ color: HALO, width: HALO_WIDTH + 1, join: "round" });
  pennant().fill({ color }).stroke({ color: OUTLINE, width: 1.1, join: "round" });
  pole().stroke({ color: OUTLINE, width: POLE_WIDTH, cap: "round" });
  g.circle(0, 0, BASE_RADIUS)
    .fill({ color: OUTLINE })
    .stroke({ color: HALO, width: HALO_WIDTH / 2 });
}
