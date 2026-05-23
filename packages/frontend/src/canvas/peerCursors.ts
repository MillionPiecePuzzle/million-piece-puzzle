import { Container, Graphics, Text } from "pixi.js";

// Camera transform shared with the stage: world maps to screen as
// `screen = world * zoom + offset`. The cursor layer lives in screen space so
// pointers keep a constant size regardless of zoom.
export type CameraTransform = { x: number; y: number; zoom: number };

// A peer is registered on `join` but drawn only after its first cursor
// position. Spectators never emit a cursor, so they stay invisible without any
// mode knowledge on this side.
const SMOOTH_MS = 110;
const IDLE_AFTER_MS = 1200;
const BOB_RAMP_MS = 400;
const BOB_AMPLITUDE = 3;
const BOB_PERIOD_MS = 1500;

const OUTLINE = 0x222222;
const TAG_PAD_X = 6;
const TAG_PAD_Y = 3;

type Peer = {
  userId: string;
  pseudo: string | null;
  color: number;
  targetX: number;
  targetY: number;
  renderX: number;
  renderY: number;
  hasPosition: boolean;
  lastMoveMs: number;
  held: boolean;
  container: Container;
  arrow: Graphics;
  grab: Graphics;
  badge: Graphics;
  tag: Container;
  tagBg: Graphics;
  tagText: Text;
};

// Screen-space layer of collaborator cursors, one per connected peer. The stage
// owns the instance, adds `container` above the world, and drives `update` from
// the Pixi ticker.
export class PeerCursorLayer {
  readonly container: Container;
  private readonly peers = new Map<string, Peer>();

  constructor() {
    this.container = new Container();
    this.container.eventMode = "none";
  }

  upsertPeer(userId: string, pseudo: string | null): void {
    const existing = this.peers.get(userId);
    if (existing) {
      existing.pseudo = pseudo;
      this.refreshTag(existing);
      return;
    }
    this.peers.set(userId, this.createPeer(userId, pseudo));
  }

  removePeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.container.destroy({ children: true });
    this.peers.delete(userId);
  }

  setCursor(userId: string, worldX: number, worldY: number): void {
    let peer = this.peers.get(userId);
    if (!peer) {
      // Cursor before join (unexpected ordering): keep the pointer, no tag.
      peer = this.createPeer(userId, null);
      this.peers.set(userId, peer);
    }
    peer.targetX = worldX;
    peer.targetY = worldY;
    if (!peer.hasPosition) {
      peer.renderX = worldX;
      peer.renderY = worldY;
      peer.hasPosition = true;
    }
    peer.lastMoveMs = performance.now();
  }

  setHeld(userId: string, held: boolean): void {
    const peer = this.peers.get(userId);
    if (!peer || peer.held === held) return;
    peer.held = held;
    peer.arrow.visible = !held;
    peer.grab.visible = held;
    peer.badge.visible = held;
  }

  // Puzzle reset: connections persist so peers stay, but nobody holds a
  // cluster on a fresh board.
  clearHeld(): void {
    for (const peer of this.peers.values()) this.setHeld(peer.userId, false);
  }

  update(dtMs: number, camera: CameraTransform): void {
    const now = performance.now();
    const smooth = Math.min(1, dtMs / SMOOTH_MS);
    for (const peer of this.peers.values()) {
      if (!peer.hasPosition) {
        peer.container.visible = false;
        continue;
      }
      peer.container.visible = true;
      peer.renderX += (peer.targetX - peer.renderX) * smooth;
      peer.renderY += (peer.targetY - peer.renderY) * smooth;
      const sx = peer.renderX * camera.zoom + camera.x;
      let sy = peer.renderY * camera.zoom + camera.y;
      const idleFor = now - peer.lastMoveMs;
      if (idleFor > IDLE_AFTER_MS) {
        const ramp = Math.min(1, (idleFor - IDLE_AFTER_MS) / BOB_RAMP_MS);
        sy += BOB_AMPLITUDE * ramp * Math.sin((idleFor / BOB_PERIOD_MS) * Math.PI * 2);
      }
      peer.container.position.set(sx, sy);
    }
  }

  destroy(): void {
    for (const peer of this.peers.values()) peer.container.destroy({ children: true });
    this.peers.clear();
    this.container.destroy({ children: true });
  }

  private createPeer(userId: string, pseudo: string | null): Peer {
    const color = peerColor(userId);
    const container = new Container();
    container.visible = false;

    const arrow = buildArrow(color);
    const grab = buildGrab(color);
    grab.visible = false;
    const badge = buildBadge(color);
    badge.visible = false;

    const tagText = new Text({
      text: pseudo ?? "",
      style: { fontFamily: "ui-monospace, monospace", fontSize: 11, fill: readableText(color) },
    });
    tagText.position.set(TAG_PAD_X, TAG_PAD_Y);
    const tagBg = new Graphics();
    const tag = new Container();
    tag.addChild(tagBg, tagText);
    tag.position.set(15, 17);

    container.addChild(arrow, grab, badge, tag);

    const peer: Peer = {
      userId,
      pseudo,
      color,
      targetX: 0,
      targetY: 0,
      renderX: 0,
      renderY: 0,
      hasPosition: false,
      lastMoveMs: performance.now(),
      held: false,
      container,
      arrow,
      grab,
      badge,
      tag,
      tagBg,
      tagText,
    };
    this.refreshTag(peer);
    this.container.addChild(container);
    return peer;
  }

  private refreshTag(peer: Peer): void {
    const label = peer.pseudo ?? "";
    peer.tagText.text = label;
    peer.tag.visible = label.length > 0;
    if (label.length === 0) return;
    const w = peer.tagText.width + TAG_PAD_X * 2;
    const h = peer.tagText.height + TAG_PAD_Y * 2;
    peer.tagBg.clear();
    peer.tagBg.roundRect(0, 0, w, h, 4).fill({ color: peer.color });
  }
}

// Classic arrow pointer, hot point at the local origin.
function buildArrow(color: number): Graphics {
  const g = new Graphics();
  g.poly([0, 0, 0, 18, 4.2, 13.8, 7, 20.5, 9.8, 19.3, 7, 12.6, 12.2, 12.6])
    .fill({ color })
    .stroke({ color: OUTLINE, width: 1.25, join: "round" });
  return g;
}

// Closed-hand glyph shown while the peer holds a cluster.
function buildGrab(color: number): Graphics {
  const g = new Graphics();
  g.roundRect(0, 2, 13, 12, 4);
  g.roundRect(-2.5, 6.5, 5, 6.5, 2.5);
  g.fill({ color }).stroke({ color: OUTLINE, width: 1.25, join: "round" });
  return g;
}

// Small piece-shaped pastille, sits above the pointer while a cluster is held.
function buildBadge(color: number): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, 9, 9, 2).fill({ color }).stroke({ color: 0xffffff, width: 1.4 });
  g.position.set(12, -10);
  return g;
}

// Deterministic per-peer hue so the same userId always gets the same color.
function peerColor(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return hslToHex(hue / 360, 0.65, 0.5);
}

function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (channel(0) << 16) | (channel(8) << 8) | channel(4);
}

// Pick black or white tag text so the pseudo stays legible on any peer hue.
function readableText(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 150 ? 0x1a1a1a : 0xffffff;
}
