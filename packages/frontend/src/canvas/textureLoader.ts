import { ImageSource, Texture } from "pixi.js";

// Piece-texture loader that bypasses PixiJS Assets.load. Pixi routes every image
// load through a WorkerManager pool bounded by navigator.hardwareConcurrency,
// where the worker runs a bare fetch with no timeout or abort. A worker is only
// returned to the pool when it posts a result back, so a single stalled
// connection pins a worker forever; a cold burst of thousands of tiny piece
// fetches stalls enough connections to exhaust the pool, and the loader queue
// then never drains again. A per-load deadline cannot rescue this: it rejects
// the awaiting promise but cannot abort the worker fetch, free the worker, or
// unwedge the queue.
//
// So we own the load: a real fetch with an AbortController deadline (a stalled
// connection is actually cancelled, freeing its slot), bounded by a global
// concurrency limiter over FETCHES (a hydrated cluster fires all its piece loads
// at once, so a group-level cap does not bound real fetch concurrency), and our
// own url-keyed cache so dehydrate/rehydrate can release textures. See
// DECISIONS: own piece-texture loader bypasses Assets.load.

// Concurrent in-flight fetches. Well above Pixi's worker pool for throughput,
// but bounded so the cold whole-window burst does not stall connections or trip
// CDN rate limits.
const MAX_CONCURRENT_FETCHES = 64;

// A piece texture is a couple of KB, so any fetch this slow is a stalled
// connection, not a slow one. The abort cancels it and frees the slot; the piece
// is skipped (rendered blank) and re-streamed on the next residency pass.
const FETCH_TIMEOUT_MS = 10000;
const FETCH_RETRIES = 1;

const cache = new Map<string, Texture>();
const inFlight = new Map<string, Promise<Texture | null>>();

let active = 0;
const waiters: (() => void)[] = [];

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENT_FETCHES) {
      active++;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });
}

function release(): void {
  const next = waiters.shift();
  // Hand the slot straight to the next waiter (active unchanged); only when none
  // is waiting does the count drop.
  if (next) next();
  else active--;
}

async function fetchTexture(url: string): Promise<Texture | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const source = new ImageSource({
        resource: bitmap,
        alphaMode: "premultiply-alpha-on-upload",
        resolution: 1,
      });
      const texture = new Texture({ source, label: url });
      cache.set(url, texture);
      return texture;
    } catch {
      // Aborted (deadline) or network error: fall through to the next attempt.
    } finally {
      clearTimeout(timer);
      release();
    }
  }
  console.warn("[textureLoader] giving up on", url);
  return null;
}

// Loads one piece texture, deduping concurrent requests for the same url and
// serving a cached texture when present. Resolves null when the load fails or
// times out, so the caller can skip the piece and still complete its group.
export function loadPieceTexture(url: string): Promise<Texture | null> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = inFlight.get(url);
  if (existing) return existing;
  const p = fetchTexture(url).finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

// Destroys and forgets a cached piece texture. A no-op for a url never loaded or
// already released, so dehydration and teardown can call it unconditionally.
export function releasePieceTexture(url: string): void {
  const texture = cache.get(url);
  if (!texture) return;
  cache.delete(url);
  texture.destroy(true);
}
