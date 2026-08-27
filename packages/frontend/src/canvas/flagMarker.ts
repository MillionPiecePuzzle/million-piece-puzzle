import { FLAG_COLORS, type BoardFlag } from "../data/boardFlags";

// Personal flags on the minimap views. The overview painter redraws its whole
// canvas every frame from a stage snapshot, so a marker is a handful of 2D path
// ops on top rather than a sprite: a pennant on a pole, its foot at the marked
// world point, sized in device pixels so it reads the same on the small panel
// and in the enlarged modal.
const POLE_HEIGHT = 11;
const PENNANT_WIDTH = 7;
const PENNANT_HEIGHT = 5;

export function drawFlagMarkers(
  ctx: CanvasRenderingContext2D,
  flags: readonly BoardFlag[],
  toX: (worldX: number) => number,
  toY: (worldY: number) => number,
  dpr: number,
): void {
  const pole = POLE_HEIGHT * dpr;
  const w = PENNANT_WIDTH * dpr;
  const h = PENNANT_HEIGHT * dpr;
  for (const flag of flags) {
    const x = toX(flag.worldX);
    const y = toY(flag.worldY);
    const color = FLAG_COLORS[flag.color] ?? FLAG_COLORS[0];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - pole);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, 2.4 * dpr);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = "#2a2620";
    ctx.lineWidth = Math.max(1, 1.1 * dpr);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - pole);
    ctx.lineTo(x + w, y - pole + h * 0.5);
    ctx.lineTo(x, y - pole + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#2a2620";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.stroke();
  }
}
