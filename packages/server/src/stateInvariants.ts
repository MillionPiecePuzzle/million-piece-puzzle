// Pure state-corruption invariants for a puzzle's authoritative state.
//
// Given a snapshot of Redis live state (loose groups, the piece->group reverse
// index, group-piece membership sets, the locked counter, the set of
// piece-level locked flags) plus the Mongo cluster-merge log, assert the
// invariants a correct run must hold at rest. No IO lives here so the checks
// are unit-tested directly; validate-state.ts reads the live stores and feeds
// this module.
//
// Two independent Mongo<->Redis cross-checks, split along the same line the
// live model splits on: a loose cluster still lives as a Redis group, so
// replaying every merge by `at` rebuilds the exact loose partition, which must
// match the Redis partition piece for piece. A locked piece has no group (see
// DECISIONS: locked pieces stop being a group), so it cannot be compared by
// partition; instead the flat set of piece ids the replay ever locked must
// equal the flat set of piece ids Redis has flagged locked.

export type GroupState = {
  id: number;
  size: number;
  heldBy: string | null;
};

export type MergeRecord = {
  addedPieceIds: number[];
  targetAnchorPieceId: number;
  anchored: boolean;
  lockedDelta: number;
  lockedPieceIds: number[];
  at: number;
};

export type StateSnapshot = {
  totalPieces: number;
  groups: GroupState[];
  // pieceId -> groupId, from each piece hash's groupId field. Stale (and never
  // read for anything else) once a piece is locked.
  pieceGroup: Map<number, number>;
  // groupId -> its member piece ids, from the group-pieces sets. Only loose
  // groups have an entry: a locked piece's group is deleted on anchor.
  groupPieces: Map<number, Set<number>>;
  lockedCount: number;
  // Every piece id currently flagged locked on its piece hash.
  lockedPieceIds: Set<number>;
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
  // Resolved partition root for every piece id in [0, totalPieces). Only
  // meaningful for pieces that stayed loose; a locked piece's root reflects
  // wherever the merge log last unioned it, which checkReplayMatchesRedis
  // never consults (it only walks live, i.e. loose, Redis groups).
  root: number[];
  // Every piece id any anchored merge ever locked.
  lockedPieceIds: Set<number>;
  lockedDeltaSum: number;
};

// Rebuild the loose cluster partition and the flat locked-piece set by
// replaying the merge log in `at` order. Each merge folds its added pieces
// into the host (identified by targetAnchorPieceId); an anchored merge adds
// its lockedPieceIds to the locked set (addedPieceIds alone would undercount:
// see the field comment on ClusterMerge.lockedPieceIds). A pure function of
// the log, so it can be compared against the independently-read Redis state.
export function replayMerges(totalPieces: number, merges: MergeRecord[]): Replay {
  const uf = new UnionFind(totalPieces);
  const lockedPieceIds = new Set<number>();
  let lockedDeltaSum = 0;
  const ordered = [...merges].sort((a, b) => a.at - b.at);
  for (const m of ordered) {
    for (const p of m.addedPieceIds) uf.union(m.targetAnchorPieceId, p);
    if (m.anchored) {
      for (const p of m.lockedPieceIds) lockedPieceIds.add(p);
    }
    lockedDeltaSum += m.lockedDelta;
  }
  const root = new Array<number>(totalPieces);
  for (let i = 0; i < totalPieces; i++) root[i] = uf.find(i);
  return { root, lockedPieceIds, lockedDeltaSum };
}

// Every piece in [0, totalPieces) belongs to exactly one group-pieces set or is
// locked (never both, checked separately by checkLockedPieces), and the piece
// hash's groupId agrees with the set it lives in. Catches lost, duplicated, or
// mis-parented loose pieces.
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
    if (!owner.has(pid) && !snap.lockedPieceIds.has(pid)) missing.push(pid);
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
      name: "partition: every piece in exactly one group set or locked",
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
// to the same set of group ids, and the sizes plus the locked count sum to
// totalPieces (every group is loose now, so its pieces are exactly the
// still-unlocked ones).
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
  const withLocked = total + snap.lockedPieceIds.size;
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
      name: "loose group sizes plus locked pieces sum to totalPieces",
      ok: withLocked === snap.totalPieces,
      detail: `loose=${total} locked=${snap.lockedPieceIds.size} totalPieces=${snap.totalPieces}`,
    },
  ];
}

// The locked counter equals the number of pieces flagged locked, and never
// exceeds the total.
export function checkLockedCount(snap: StateSnapshot): Check[] {
  return [
    {
      name: "locked-count equals pieces flagged locked",
      ok: snap.lockedCount === snap.lockedPieceIds.size && snap.lockedCount <= snap.totalPieces,
      detail: `locked-count=${snap.lockedCount} lockedPieces=${snap.lockedPieceIds.size} totalPieces=${snap.totalPieces}`,
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

// No locked piece still lingers in a group-pieces set (a leftover from a group
// that should have been deleted on anchor), and the set of piece ids Redis has
// flagged locked exactly matches the set the Mongo replay says was ever locked.
export function checkLockedPieces(
  snap: StateSnapshot,
  replayLockedIds: ReadonlySet<number>,
): Check[] {
  const grouped = new Set<number>();
  for (const members of snap.groupPieces.values()) {
    for (const pid of members) grouped.add(pid);
  }
  let stillGrouped: number | null = null;
  for (const pid of snap.lockedPieceIds) {
    if (grouped.has(pid)) {
      stillGrouped = pid;
      break;
    }
  }

  let missingInRedis: number | null = null;
  let missingCount = 0;
  for (const pid of replayLockedIds) {
    if (!snap.lockedPieceIds.has(pid)) {
      if (missingInRedis === null) missingInRedis = pid;
      missingCount++;
    }
  }
  let extraInRedis: number | null = null;
  let extraCount = 0;
  for (const pid of snap.lockedPieceIds) {
    if (!replayLockedIds.has(pid)) {
      if (extraInRedis === null) extraInRedis = pid;
      extraCount++;
    }
  }
  const idsMatch = missingCount === 0 && extraCount === 0;

  return [
    {
      name: "no locked piece still belongs to a group",
      ok: stillGrouped === null,
      detail:
        stillGrouped === null
          ? "all locked pieces are group-free"
          : `piece ${stillGrouped} is locked but still in a group set`,
    },
    {
      name: "Mongo replay locked ids match Redis locked flags",
      ok: idsMatch,
      detail: idsMatch
        ? `${snap.lockedPieceIds.size} locked pieces agree`
        : `missingInRedis=${missingCount}${missingInRedis !== null ? ` (e.g. ${missingInRedis})` : ""} extraInRedis=${extraCount}${extraInRedis !== null ? ` (e.g. ${extraInRedis})` : ""}`,
    },
  ];
}

// The Redis loose partition equals the partition rebuilt from the Mongo merge
// log: members of one Redis group share one replay component (consistency),
// distinct Redis groups map to distinct replay components (injectivity), and
// the summed lockedDelta matches the live counter. Locked pieces have no group
// to compare here; checkLockedPieces covers them directly.
export function checkReplayMatchesRedis(snap: StateSnapshot, replay: Replay): Check[] {
  let consistencyBreak: { group: number; piece: number } | null = null;
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
  }

  const partitionOk = consistencyBreak === null && injectivityBreak === null;
  return [
    {
      name: "Mongo replay loose partition matches Redis partition",
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
    ...checkLockedPieces(snap, replay.lockedPieceIds),
    ...checkReplayMatchesRedis(snap, replay),
  ];
}
