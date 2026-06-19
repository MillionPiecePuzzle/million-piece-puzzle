// Pure state-corruption invariants for a puzzle's authoritative state.
//
// Given a snapshot of Redis live state (groups, the piece->group reverse index,
// group-piece membership sets, the locked counter) plus the Mongo cluster-merge
// log, assert the invariants a correct run must hold at rest. No IO lives here so
// the checks are unit-tested directly; validate-state.ts reads the live stores
// and feeds this module.
//
// The strongest check is Mongo<->Redis: replaying every merge by `at` rebuilds
// the exact cluster partition (non-merging drops are not logged but never change
// grouping), so the replayed partition must match the Redis partition piece for
// piece. A mismatch means a merge hit one store but not the other, or a set lost
// a member: corruption.

export type GroupState = {
  id: number;
  size: number;
  locked: boolean;
  heldBy: string | null;
};

export type MergeRecord = {
  addedPieceIds: number[];
  targetAnchorPieceId: number;
  anchored: boolean;
  lockedDelta: number;
  at: number;
};

export type StateSnapshot = {
  totalPieces: number;
  groups: GroupState[];
  // pieceId -> groupId, from each piece hash's groupId field.
  pieceGroup: Map<number, number>;
  // groupId -> its member piece ids, from the group-pieces sets.
  groupPieces: Map<number, Set<number>>;
  lockedCount: number;
};

export type Check = { name: string; ok: boolean; detail: string };

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root]!;
    // Path compression keeps repeated finds near-constant on a long merge log.
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]!;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export type Replay = {
  // Resolved partition root for every piece id in [0, totalPieces).
  root: number[];
  // Roots of the components that any anchored merge locked.
  lockedRoots: Set<number>;
  lockedDeltaSum: number;
};

// Rebuild the cluster partition by replaying the merge log in `at` order. Each
// merge folds its added pieces into the host (identified by targetAnchorPieceId);
// an anchored merge locks the host's resulting component. A pure function of the
// log, so it can be compared against the independently-read Redis partition.
export function replayMerges(totalPieces: number, merges: MergeRecord[]): Replay {
  const uf = new UnionFind(totalPieces);
  const anchoredReps: number[] = [];
  let lockedDeltaSum = 0;
  const ordered = [...merges].sort((a, b) => a.at - b.at);
  for (const m of ordered) {
    for (const p of m.addedPieceIds) uf.union(m.targetAnchorPieceId, p);
    if (m.anchored) anchoredReps.push(m.targetAnchorPieceId);
    lockedDeltaSum += m.lockedDelta;
  }
  const root = new Array<number>(totalPieces);
  for (let i = 0; i < totalPieces; i++) root[i] = uf.find(i);
  const lockedRoots = new Set<number>(anchoredReps.map((r) => uf.find(r)));
  return { root, lockedRoots, lockedDeltaSum };
}

// Every piece in [0, totalPieces) belongs to exactly one group-pieces set, and
// the piece hash's groupId agrees with the set it lives in. Catches lost,
// duplicated, or mis-parented pieces.
export function checkPartition(snap: StateSnapshot): Check[] {
  const owner = new Map<number, number>();
  let duplicate: { piece: number; a: number; b: number } | null = null;
  for (const [gid, members] of snap.groupPieces) {
    for (const pid of members) {
      const prev = owner.get(pid);
      if (prev !== undefined && !duplicate) duplicate = { piece: pid, a: prev, b: gid };
      owner.set(pid, gid);
    }
  }
  const missing: number[] = [];
  for (let pid = 0; pid < snap.totalPieces; pid++) {
    if (!owner.has(pid)) missing.push(pid);
  }
  const coverageOk = missing.length === 0 && duplicate === null;

  let reverseMismatch: { piece: number; pieceHash: number; setOwner: number } | null = null;
  let reverseMissing = 0;
  for (let pid = 0; pid < snap.totalPieces; pid++) {
    const setOwner = owner.get(pid);
    const hashGroup = snap.pieceGroup.get(pid);
    if (hashGroup === undefined) {
      reverseMissing++;
      continue;
    }
    if (setOwner !== undefined && hashGroup !== setOwner && !reverseMismatch) {
      reverseMismatch = { piece: pid, pieceHash: hashGroup, setOwner };
    }
  }

  return [
    {
      name: "partition: every piece in exactly one group set",
      ok: coverageOk,
      detail: coverageOk
        ? `all ${snap.totalPieces} pieces covered once`
        : `missing=${missing.length}${missing.length ? ` (e.g. ${missing[0]})` : ""}` +
          (duplicate
            ? ` duplicate piece ${duplicate.piece} in groups ${duplicate.a} and ${duplicate.b}`
            : ""),
    },
    {
      name: "reverse index: piece.groupId agrees with set membership",
      ok: reverseMismatch === null && reverseMissing === 0,
      detail:
        reverseMismatch === null && reverseMissing === 0
          ? "all piece hashes agree with their set"
          : `missingHash=${reverseMissing}` +
            (reverseMismatch
              ? ` mismatch piece ${reverseMismatch.piece}: hash=${reverseMismatch.pieceHash} set=${reverseMismatch.setOwner}`
              : ""),
    },
  ];
}

// group.size equals its set cardinality, the group set and the group hash refer
// to the same set of group ids, and the sizes sum to totalPieces.
export function checkGroupSizes(snap: StateSnapshot): Check[] {
  const groupIds = new Set(snap.groups.map((g) => g.id));
  let sizeMismatch: { id: number; size: number; members: number } | null = null;
  let total = 0;
  for (const g of snap.groups) {
    const members = snap.groupPieces.get(g.id);
    const count = members ? members.size : 0;
    if (g.size !== count && !sizeMismatch)
      sizeMismatch = { id: g.id, size: g.size, members: count };
    total += g.size;
  }
  const orphanSets: number[] = [];
  for (const gid of snap.groupPieces.keys()) {
    if (!groupIds.has(gid)) orphanSets.push(gid);
  }
  return [
    {
      name: "group size equals set cardinality",
      ok: sizeMismatch === null,
      detail: sizeMismatch
        ? `group ${sizeMismatch.id}: size=${sizeMismatch.size} members=${sizeMismatch.members}`
        : `${snap.groups.length} groups consistent`,
    },
    {
      name: "no group-pieces set without a group hash",
      ok: orphanSets.length === 0,
      detail:
        orphanSets.length === 0
          ? "every set has a group"
          : `orphan sets=${orphanSets.length} (e.g. ${orphanSets[0]})`,
    },
    {
      name: "group sizes sum to totalPieces",
      ok: total === snap.totalPieces,
      detail: `sum=${total} totalPieces=${snap.totalPieces}`,
    },
  ];
}

// The locked counter equals the piece count of all locked groups, and never
// exceeds the total.
export function checkLockedCount(snap: StateSnapshot): Check[] {
  let lockedPieces = 0;
  for (const g of snap.groups) {
    if (g.locked) lockedPieces += g.size;
  }
  return [
    {
      name: "locked-count equals pieces in locked groups",
      ok: snap.lockedCount === lockedPieces && snap.lockedCount <= snap.totalPieces,
      detail: `locked-count=${snap.lockedCount} lockedPieces=${lockedPieces} totalPieces=${snap.totalPieces}`,
    },
  ];
}

// At rest (after every client has disconnected and held groups were released) no
// group is still held. A leftover holder means a release was lost on disconnect.
export function checkNoHeld(snap: StateSnapshot): Check[] {
  const held = snap.groups.filter((g) => g.heldBy !== null);
  return [
    {
      name: "no group held at rest",
      ok: held.length === 0,
      detail:
        held.length === 0
          ? "all groups free"
          : `held=${held.length} (e.g. group ${held[0]!.id} by ${held[0]!.heldBy})`,
    },
  ];
}

// The Redis partition equals the partition rebuilt from the Mongo merge log:
// members of one Redis group share one replay component (consistency), distinct
// Redis groups map to distinct replay components (injectivity), locked state
// agrees, and the summed lockedDelta matches the live counter.
export function checkReplayMatchesRedis(snap: StateSnapshot, replay: Replay): Check[] {
  let consistencyBreak: { group: number; piece: number } | null = null;
  let lockedDisagree: { group: number; redis: boolean; replay: boolean } | null = null;
  const replayRootToGroup = new Map<number, number>();
  let injectivityBreak: { replayRoot: number; a: number; b: number } | null = null;

  for (const g of snap.groups) {
    const members = snap.groupPieces.get(g.id);
    if (!members || members.size === 0) continue;
    let groupRoot: number | null = null;
    for (const pid of members) {
      const r = replay.root[pid];
      if (r === undefined) continue;
      if (groupRoot === null) groupRoot = r;
      else if (r !== groupRoot && !consistencyBreak) {
        consistencyBreak = { group: g.id, piece: pid };
      }
    }
    if (groupRoot === null) continue;
    const prior = replayRootToGroup.get(groupRoot);
    if (prior !== undefined && prior !== g.id && !injectivityBreak) {
      injectivityBreak = { replayRoot: groupRoot, a: prior, b: g.id };
    } else {
      replayRootToGroup.set(groupRoot, g.id);
    }
    const replayLocked = replay.lockedRoots.has(groupRoot);
    if (replayLocked !== g.locked && !lockedDisagree) {
      lockedDisagree = { group: g.id, redis: g.locked, replay: replayLocked };
    }
  }

  const partitionOk = consistencyBreak === null && injectivityBreak === null;
  return [
    {
      name: "Mongo replay partition matches Redis partition",
      ok: partitionOk,
      detail: partitionOk
        ? "partitions identical"
        : (consistencyBreak
            ? `group ${consistencyBreak.group} spans >1 replay component (piece ${consistencyBreak.piece})`
            : "") +
          (injectivityBreak
            ? ` replay component ${injectivityBreak.replayRoot} maps to groups ${injectivityBreak.a} and ${injectivityBreak.b}`
            : ""),
    },
    {
      name: "locked state agrees between Redis and replay",
      ok: lockedDisagree === null,
      detail: lockedDisagree
        ? `group ${lockedDisagree.group}: redis=${lockedDisagree.redis} replay=${lockedDisagree.replay}`
        : "locked groups match",
    },
    {
      name: "summed lockedDelta equals locked-count",
      ok: replay.lockedDeltaSum === snap.lockedCount,
      detail: `Σ lockedDelta=${replay.lockedDeltaSum} locked-count=${snap.lockedCount}`,
    },
  ];
}

export function runInvariants(snap: StateSnapshot, merges: MergeRecord[]): Check[] {
  const replay = replayMerges(snap.totalPieces, merges);
  return [
    ...checkPartition(snap),
    ...checkGroupSizes(snap),
    ...checkLockedCount(snap),
    ...checkNoHeld(snap),
    ...checkReplayMatchesRedis(snap, replay),
  ];
}
