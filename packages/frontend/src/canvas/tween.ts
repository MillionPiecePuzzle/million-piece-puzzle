import type { Ticker } from "pixi.js";

export type EasingFn = (t: number) => number;

export const easeOutCubic: EasingFn = (t) => 1 - Math.pow(1 - t, 3);

export const easeOutBack: EasingFn = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Triangular ease that peaks at midway. Maps t in [0,1] to a value that
 * climbs 0 -> 1 over the first half (ease-out-back) and falls 1 -> 0 over
 * the second half (ease-out). Used for bump-then-settle animations.
 */
export const peak: EasingFn = (t) => {
  if (t <= 0.5) return easeOutBack(t / 0.5);
  return 1 - easeOutCubic((t - 0.5) / 0.5);
};

type Tween = {
  duration: number;
  elapsed: number;
  delay: number;
  easing: EasingFn;
  onUpdate: (eased: number, raw: number) => void;
  onDone?: () => void;
};

export class Tweener {
  private tweens: Tween[] = [];
  private ticker: Ticker;
  private tickHandler: () => void;

  constructor(ticker: Ticker) {
    this.ticker = ticker;
    this.tickHandler = () => this.tick();
    ticker.add(this.tickHandler);
  }

  add(opts: {
    duration: number;
    delay?: number;
    easing?: EasingFn;
    onUpdate: (eased: number, raw: number) => void;
    onDone?: () => void;
  }): void {
    const tw: Tween = {
      duration: Math.max(1, opts.duration),
      elapsed: 0,
      delay: Math.max(0, opts.delay ?? 0),
      easing: opts.easing ?? easeOutCubic,
      onUpdate: opts.onUpdate,
    };
    if (opts.onDone) tw.onDone = opts.onDone;
    this.tweens.push(tw);
  }

  destroy(): void {
    this.ticker.remove(this.tickHandler);
    this.tweens = [];
  }

  private tick(): void {
    const dtMs = this.ticker.deltaMS;
    const next: Tween[] = [];
    for (const tw of this.tweens) {
      if (tw.delay > 0) {
        tw.delay -= dtMs;
        if (tw.delay > 0) {
          next.push(tw);
          continue;
        }
      }
      tw.elapsed += dtMs;
      const raw = Math.min(1, tw.elapsed / tw.duration);
      tw.onUpdate(tw.easing(raw), raw);
      if (raw >= 1) {
        tw.onDone?.();
      } else {
        next.push(tw);
      }
    }
    this.tweens = next;
  }
}
