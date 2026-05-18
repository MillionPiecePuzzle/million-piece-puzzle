// Per-connection rate limiting and origin allowlisting for the WS server.
// See DECISIONS: backend-realtime WS hardening.

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(n = 1): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = now;
    }
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return ["*"];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["*"];
}

export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 1 && allowed[0] === "*") return true;
  if (!origin) return false;
  return allowed.includes(origin);
}
