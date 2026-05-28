// Lightweight metrics: a counter and a streaming-ish histogram for latency.
// The histogram stores every sample in an array, which is fine at load-test
// scale (a few hundred thousand samples over a five-minute run).

export class Counter {
  private value = 0;
  inc(by = 1): void {
    this.value += by;
  }
  get(): number {
    return this.value;
  }
}

export class Histogram {
  private samples: number[] = [];

  observe(value: number): void {
    this.samples.push(value);
  }

  count(): number {
    return this.samples.length;
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? 0;
  }

  summary(): { count: number; p50: number; p95: number; p99: number; max: number } {
    const max = this.samples.length === 0 ? 0 : this.samples.reduce((m, v) => (v > m ? v : m), 0);
    return {
      count: this.count(),
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max,
    };
  }
}
