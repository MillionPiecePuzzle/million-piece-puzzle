// Shared discovered-hotspot state for one run, referenced by every bot. A
// single process runs every bot on one event loop, so plain reads/writes need
// no locking.
//
// Bots cannot know where pieces are in advance: the scatter layout derives
// from generationSeed, which is server-only (see DECISIONS: anti-programmatic-
// solving). A hotspot is only ever set from what a bot actually observed via
// region_state, the same way a real player finds pieces by looking around.

export type Hotspot = { x: number; y: number };

export class Swarm {
  private hotspot: Hotspot | null = null;

  // Returns true the first time a hotspot is reported, so the caller can log
  // discovery exactly once.
  report(x: number, y: number): boolean {
    const first = this.hotspot === null;
    this.hotspot = { x, y };
    return first;
  }

  get(): Hotspot | null {
    return this.hotspot;
  }
}
