// Per-cell "still loading" badge over the play zone. The stage decides which
// cells are loading each frame (content known but not yet displayed: a tile not
// baked at a zoom-out, or a group whose textures are still fetching at a zoom-in);
// this layer owns the badge sprites, their pulse, and add/remove as cells enter
// and leave the loading set. Cell geometry mirrors the LOD tile grid, so a badge
// sits exactly over the tile that will replace it.

import { Container, Graphics } from "pixi.js";
import { LOD_TILE_WORLD, unpackCell, type CellKey } from "./groupGrid";

// Proportional so the badge reads the same at every zoom: a gutter between
// neighbouring loading cells, a rounded corner, and a hairline border.
const INSET_FRAC = 0.015;
const CORNER_FRAC = 0.03;
const BORDER_FRAC = 0.004;
const FILL_COLOR = 0xf4ecd8;
const FILL_ALPHA = 0.1;
const BORDER_COLOR = 0xf4ecd8;
const BORDER_ALPHA = 0.3;
// Breathing pulse on the whole layer's alpha, so a loading region softly throbs.
const PULSE_PERIOD_MS = 1200;
const PULSE_MIN = 0.45;
const PULSE_MAX = 1;

export class LoadingOverlay {
  readonly container: Container;
  private readonly badges = new Map<CellKey, Graphics>();

  constructor() {
    this.container = new Container();
    this.container.eventMode = "none";
  }

  // Syncs the visible badges to `loading` (adding entrants, removing leavers) and
  // throbs the layer. Idempotent per frame: an unchanged set only re-pulses.
  update(loading: ReadonlySet<CellKey>, tMs: number): void {
    for (const [key, g] of this.badges) {
      if (loading.has(key)) continue;
      g.destroy();
      this.badges.delete(key);
    }
    for (const key of loading) {
      if (!this.badges.has(key)) this.badges.set(key, this.createBadge(key));
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
      .fill({ color: FILL_COLOR, alpha: FILL_ALPHA })
      .stroke({ color: BORDER_COLOR, alpha: BORDER_ALPHA, width: LOD_TILE_WORLD * BORDER_FRAC });
    this.container.addChild(g);
    return g;
  }
}
