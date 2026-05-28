// Spawns N bots, owns the shared metrics they update, prints a periodic
// progress line, and emits a final report.

import { Bot } from "./bot.js";
import { Counter, Histogram } from "./metrics.js";

export type Metrics = {
  grabSent: Counter;
  grabOk: Counter;
  grabDenied: Counter;
  grabRaceLost: Counter;
  grabTimeouts: Counter;
  dragsSent: Counter;
  dropsSent: Counter;
  serverErrors: Counter;
  wsErrors: Counter;
  wsCloses: Counter;
  backpressureCloses: Counter;
  grabLatency: Histogram;
};

function newMetrics(): Metrics {
  return {
    grabSent: new Counter(),
    grabOk: new Counter(),
    grabDenied: new Counter(),
    grabRaceLost: new Counter(),
    grabTimeouts: new Counter(),
    dragsSent: new Counter(),
    dropsSent: new Counter(),
    serverErrors: new Counter(),
    wsErrors: new Counter(),
    wsCloses: new Counter(),
    backpressureCloses: new Counter(),
    grabLatency: new Histogram(),
  };
}

// Tiny LCG so seeded runs are reproducible per bot; pass Math.random for an
// unseeded run.
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export type RunnerConfig = {
  url: string;
  puzzleId: string;
  origin: string;
  bots: number;
  durationMs: number;
  spawnIntervalMs: number;
  seed: number;
  verbose: boolean;
};

export class Runner {
  readonly metrics = newMetrics();
  private readonly bots: Bot[] = [];
  private progressTimer: NodeJS.Timeout | null = null;
  private lastSnapshot = { drags: 0, grabs: 0, drops: 0, ts: Date.now() };

  constructor(private readonly cfg: RunnerConfig) {}

  async run(): Promise<void> {
    console.log(
      `[runner] target=${this.cfg.url} puzzle=${this.cfg.puzzleId} bots=${this.cfg.bots} duration=${this.cfg.durationMs}ms`,
    );
    for (let i = 0; i < this.cfg.bots; i++) {
      const bot = new Bot({
        id: i,
        url: this.cfg.url,
        puzzleId: this.cfg.puzzleId,
        origin: this.cfg.origin,
        metrics: this.metrics,
        rng: makeRng(this.cfg.seed + i * 1000003),
        verbose: this.cfg.verbose,
      });
      this.bots.push(bot);
      bot.start();
      if (i < this.cfg.bots - 1) {
        await new Promise((r) => setTimeout(r, this.cfg.spawnIntervalMs));
      }
    }

    this.progressTimer = setInterval(() => this.printProgress(), 5000);

    await new Promise((r) => setTimeout(r, this.cfg.durationMs));

    if (this.progressTimer) clearInterval(this.progressTimer);
    console.log("[runner] stopping bots...");
    for (const b of this.bots) b.stop();
    await new Promise((r) => setTimeout(r, 500));
    this.printFinal();
  }

  private printProgress(): void {
    const now = Date.now();
    const dtSec = (now - this.lastSnapshot.ts) / 1000;
    const m = this.metrics;
    const drags = m.dragsSent.get();
    const grabs = m.grabSent.get();
    const drops = m.dropsSent.get();
    const dragRate = (drags - this.lastSnapshot.drags) / dtSec;
    const grabRate = (grabs - this.lastSnapshot.grabs) / dtSec;
    const dropRate = (drops - this.lastSnapshot.drops) / dtSec;
    const lat = m.grabLatency.summary();
    console.log(
      `[progress] drag/s=${dragRate.toFixed(0)} grab/s=${grabRate.toFixed(1)} drop/s=${dropRate.toFixed(1)} grab.p95=${lat.p95}ms grab.p99=${lat.p99}ms denied=${m.grabDenied.get()} srvErr=${m.serverErrors.get()} wsErr=${m.wsErrors.get()} 1013=${m.backpressureCloses.get()}`,
    );
    this.lastSnapshot = { drags, grabs, drops, ts: now };
  }

  private printFinal(): void {
    const m = this.metrics;
    const lat = m.grabLatency.summary();
    console.log("");
    console.log("=== load test result ===");
    console.log(`bots=${this.cfg.bots} duration=${this.cfg.durationMs}ms`);
    console.log(
      `grabs sent=${m.grabSent.get()} ok=${m.grabOk.get()} denied=${m.grabDenied.get()} raceLost=${m.grabRaceLost.get()} timeouts=${m.grabTimeouts.get()}`,
    );
    console.log(`drags sent=${m.dragsSent.get()} drops sent=${m.dropsSent.get()}`);
    console.log(
      `grab latency (ms): count=${lat.count} p50=${lat.p50} p95=${lat.p95} p99=${lat.p99} max=${lat.max}`,
    );
    console.log(
      `server errors=${m.serverErrors.get()} ws errors=${m.wsErrors.get()} ws closes=${m.wsCloses.get()} backpressure(1013)=${m.backpressureCloses.get()}`,
    );
    const verdict =
      m.backpressureCloses.get() === 0 &&
      m.wsErrors.get() === 0 &&
      m.serverErrors.get() < Math.max(1, m.grabSent.get() * 0.05);
    console.log(
      `verdict: ${verdict ? "PASS" : "FAIL"} (no backpressure closes, no ws errors, <5% server errors)`,
    );
  }
}
