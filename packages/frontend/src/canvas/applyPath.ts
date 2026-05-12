import type { Graphics } from "pixi.js";
import type { PathCommand } from "@mpp/shared";

export function applyPath(g: Graphics, commands: PathCommand[]): void {
  for (const c of commands) {
    if (c.t === "M") g.moveTo(c.x, c.y);
    else if (c.t === "L") g.lineTo(c.x, c.y);
    else if (c.t === "C") g.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, c.x, c.y);
    else if (c.t === "Z") g.closePath();
  }
}
