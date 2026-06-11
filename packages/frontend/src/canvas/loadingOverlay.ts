// Per-cell "still loading" badge over the play zone. The stage decides which
// cells are loading each frame (content known but not yet displayed: a tile not
// baked at a zoom-out, a group still fetching its textures at a zoom-in, or a
// region not yet streamed in); this layer owns the badge sprites, their pulse,
// and add/remove as cells enter and leave the loading set. Cell geometry mirrors
// the LOD tile grid, so a badge sits exactly over the tile that will replace it.

import { Container, Graphics } from "pixi.js";
import { LOD_TILE_WORLD, unpackCell, type CellKey } from "./groupGrid";

// Proportional so the badge reads the same at every zoom: a gutter inside the
// cell, a rounded corner, and the border thickness.
const INSET_FRAC = 0.04;
const CORNER_FRAC = 0.04;
const BORDER_FRAC = 0.011;
// A dark scrim marks the tile as a placeholder; a bright border outlines it.
const SCRIM_COLOR = 0x15140f;
const SCRIM_ALPHA = 0.45;
const BORDER_COLOR = 0xf3e9cf;
const BORDER_ALPHA = 0.85;
// Breathing pulse on the whole layer's alpha so a loading region softly throbs.
const PULSE_PERIOD_MS = 1100;
const PULSE_MIN = 0.5;
const PULSE_MAX = 1;
// A badge lingers this long after its cell stops loading, so a load that resolves
// within a frame or two still shows a perceptible blip rather than never paint.
const LINGER_MS = 350;

type Badge = { g: Graphics; lastActiveMs: number };

export class LoadingOverlay {
  readonly container: Container;
  private readonly badges = new Map<CellKey, Badge>();

  constructor() {
    this.container = new Container();
    this.container.eventMode = "none";
  }

  // Syncs the visible badges to `loading` (adding entrants, keeping recent leavers
  // for LINGER_MS) and throbs the layer. Idempotent per frame.
  update(loading: ReadonlySet<CellKey>, tMs: number): void {
    for (const key of loading) {
      let badge = this.badges.get(key);
      if (!badge) {
        badge = { g: this.createBadge(key), lastActiveMs: tMs };
        this.badges.set(key, badge);
      }
      badge.lastActiveMs = tMs;
    }
    for (const [key, badge] of this.badges) {
      if (loading.has(key) || tMs - badge.lastActiveMs <= LINGER_MS) continue;
      badge.g.destroy();
      this.badges.delete(key);
    }
    const phase = (Math.sin((tMs / PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
    this.container.alpha = PULSE_MIN + (PULSE_MAX - PULSE_MIN) * phase;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.badges.clear();
  }

  private createBadge(key: CellKey): Graphics {
    const { cx, cy } = unpackCell(key);
    const inset = LOD_TILE_WORLD * INSET_FRAC;
    const x = cx * LOD_TILE_WORLD + inset;
    const y = cy * LOD_TILE_WORLD + inset;
    const size = LOD_TILE_WORLD - 2 * inset;
    const g = new Graphics();
    g.eventMode = "none";
    g.roundRect(x, y, size, size, LOD_TILE_WORLD * CORNER_FRAC)
      .fill({ color: SCRIM_COLOR, alpha: SCRIM_ALPHA })
      .stroke({ color: BORDER_COLOR, alpha: BORDER_ALPHA, width: LOD_TILE_WORLD * BORDER_FRAC });
    this.container.addChild(g);
    return g;
  }
}
