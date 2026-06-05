import type { Redis } from "ioredis";
import type { SpectatorDropEvent, SpectatorEvent, SpectatorSnapEvent } from "@mpp/shared";
import * as keys from "./redis/keys.js";

// Field holding the event JSON in each stream entry. The stream id carries the
// time and order; the body is a single opaque field.
const FIELD = "e";

// A thin wrapper over a Redis stream that is the spectator stream's source of
// truth for drops and snaps (see DECISIONS: spectator keyframe + event log). The
// stream survives a server restart and is keyed per puzzle, ready for a future
// reader-split. The auto-assigned entry id (`<ms>-<n>`) is the event `seq`:
// monotonic, unique, and its ms component is the wall-clock window key the
// spectator reads windows by. Recording runs on the per-group dispatch queue at
// the authoritative emission points, so XADD order follows handler order.
export class EventLog {
  constructor(
    private readonly r: Redis,
    private readonly puzzleId: string,
    // Injectable for tests; production uses wall-clock time. Drives the drop
    // `at` and the trim horizon so they share one clock.
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(): string {
    return keys.events(this.puzzleId);
  }

  async recordDrop(e: { groupId: number; worldX: number; worldY: number }): Promise<void> {
    const payload: Omit<SpectatorDropEvent, "seq"> = {
      k: "drop",
      at: this.now(),
      groupId: e.groupId,
      worldX: e.worldX,
      worldY: e.worldY,
    };
    await this.r.xadd(this.key(), "*", FIELD, JSON.stringify(payload));
  }

  async recordSnap(e: Omit<SpectatorSnapEvent, "seq" | "k">): Promise<void> {
    const payload: Omit<SpectatorSnapEvent, "seq"> = { k: "snap", ...e };
    await this.r.xadd(this.key(), "*", FIELD, JSON.stringify(payload));
  }

  // Last stream id, the keyframe cursor (clients skip events with id <= it).
  // "0-0" when the stream is empty: lower than any real id, so nothing is skipped.
  async head(): Promise<string> {
    const rows = (await this.r.xrevrange(this.key(), "+", "-", "COUNT", 1)) as [string, string[]][];
    return rows.length > 0 ? rows[0]![0] : "0-0";
  }

  // Events in the wall-clock window [t0, t0+w), ordered. Redis treats an
  // incomplete id (ms only) as `-0` for the range start and `-<max>` for the end,
  // so [t0, t0+w-1] inclusive of ms == the window. The event `seq` is filled from
  // the entry id (it is not stored in the body, since the id is unknown at XADD).
  async readWindow(t0: number, w: number): Promise<SpectatorEvent[]> {
    const rows = (await this.r.xrange(this.key(), `${t0}`, `${t0 + w - 1}`)) as [
      string,
      string[],
    ][];
    const out: SpectatorEvent[] = [];
    for (const [id, fields] of rows) {
      const json = fieldValue(fields, FIELD);
      if (json === null) continue;
      try {
        const e = JSON.parse(json) as SpectatorEvent;
        e.seq = id;
        out.push(e);
      } catch {
        // Skip a malformed entry rather than failing the whole window read.
      }
    }
    return out;
  }

  // Drop entries older than the retention horizon. Retention must exceed the
  // keyframe interval + interpolation delay + a margin so a client can always
  // replay from any keyframe it loads. MINID trims by the id's ms component.
  async trim(retentionMs: number): Promise<void> {
    const minId = `${Math.max(0, this.now() - retentionMs)}`;
    await this.r.xtrim(this.key(), "MINID", minId);
  }

  // Drop the whole log. Called on dev_reset so the fresh board starts empty.
  async clear(): Promise<void> {
    await this.r.del(this.key());
  }
}

function fieldValue(fields: string[], name: string): string | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) return fields[i + 1] ?? null;
  }
  return null;
}
