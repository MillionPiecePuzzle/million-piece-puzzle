import type { Context } from "./handlers.js";
import type { Client, Hub } from "./hub.js";
import type { StoredGroup } from "./state.js";
import { worldAabbFor } from "./worldGrid.js";
import { toWireId, anchorWorldX, anchorWorldY } from "./wire.js";

// Release one held group and broadcast the resulting drop at its last known
// (pre-hold) position, since drag never persists a live position to rewind to.
// Shared by the disconnect cleanup and the stale-hold sweep below; the caller
// re-checks `g.heldBy` under the group's queue before calling this, so it never
// fires on a group whose hold already ended some other way.
async function forceReleaseGroup(
  ctx: Context,
  hub: Hub,
  id: number,
  g: StoredGroup,
): Promise<void> {
  const userId = g.heldBy;
  await ctx.state.releaseGroup(id);
  // Encode the held group's grid id + internal origin to the wire (permuted id
  // + anchor world position) for the broadcast.
  const wireId = toWireId(ctx.wire, id);
  const wireX = anchorWorldX(ctx.wire, id, g.worldX);
  const wireY = anchorWorldY(ctx.wire, id, g.worldY);
  hub.broadcastOverlapping(
    { t: "drop", groupId: wireId, worldX: wireX, worldY: wireY, userId: userId ?? "" },
    worldAabbFor(g.localAabb, g.worldX, g.worldY),
  );
}

// Release every group a departing client still held. The connection tracks its
// held group ids (see Client.held), so the cleanup is O(held), not a board scan,
// and a client that never grabbed anything does nothing. The release runs on
// those groups' queues: no other client can take a hold this user already owns,
// and a stale id (the group merged away or anchored between the drop and the
// disconnect) is re-checked under the lock before release, so the cleanup never
// fights a concurrent merge on those groups.
export async function releaseHeldGroups(ctx: Context, client: Client, hub: Hub): Promise<void> {
  const heldIds = [...client.held];
  if (heldIds.length === 0) return;
  const userId = client.userId;
  await ctx.queue.run("release", heldIds, async () => {
    for (const id of heldIds) {
      const g = await ctx.state.readGroup(id);
      if (!g || g.heldBy !== userId) continue;
      await forceReleaseGroup(ctx, hub, id, g);
    }
  });
}

// Defense in depth beneath releaseHeldGroups: reclaims a hold whose age in the
// tracking ZSet exceeds `staleMs`, regardless of why its owner never released it
// (a race the synchronous grab reservation already closes, but also a server
// crash or a redeploy while a group was held, which no per-connection cleanup
// can see since the holder's Client no longer exists in the new process). Runs
// on the same per-group queues as every other handler, so it never fights a
// concurrent drop or merge on the groups it reclaims.
export async function sweepStaleHolds(ctx: Context, hub: Hub, staleMs: number): Promise<void> {
  const staleIds = await ctx.state.staleHeldGroups(Date.now() - staleMs);
  if (staleIds.length === 0) return;
  await ctx.queue.run("stale-hold-sweep", staleIds, async () => {
    for (const id of staleIds) {
      const g = await ctx.state.readGroup(id);
      if (!g || g.heldBy === null) {
        // Already released or merged away through a path that forgot to untrack
        // it; just drop the leftover tracking entry.
        await ctx.state.forgetHeldGroup(id);
        continue;
      }
      console.warn(`[stale-hold] reclaiming group ${id} held by ${g.heldBy} past ${staleMs}ms`);
      await forceReleaseGroup(ctx, hub, id, g);
    }
  });
}
