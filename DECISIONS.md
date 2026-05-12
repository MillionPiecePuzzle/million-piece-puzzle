# Decisions

Running log of non-obvious development choices. Each entry: the choice, the rationale, and (when relevant) the scale at which it must be revisited.

Entries are append-only. When a decision is superseded, add a new entry that references and overrides the old one rather than editing history.

## Format

```
### YYYY-MM-DD, track, short title
Choice: what was decided.
Why: the reason.
Revisit when: trigger that should force a rethink (optional).
```

---

## Revisit-later index

Quick scan of choices that knowingly do not scale to Phase 2 (1M pieces, public). Each links to the full entry below.

- [State sync sends full pieces + groups arrays on join](#2026-05-12-shared-protocol-full-state-on-join) -> shard by viewport in Phase 1+.
- [Absolute world coordinates on every drag frame](#2026-05-12-shared-protocol-absolute-coords-on-drag) -> consider deltas or quantization if bandwidth becomes a constraint.
- [Drop implicitly releases the held cluster, no explicit release message](#2026-05-12-shared-protocol-drop-implies-release) -> may need an explicit release if disconnect handling diverges from drop semantics.

---

## Log

### 2026-05-12, shared-protocol, full state on join
Choice: `SState` carries the complete `pieces` and `groups` arrays in a single message on connect.
Why: trivial to implement, fine at Phase 0 scale (N up to a few thousand pieces, single user).
Revisit when: Phase 1 (10k pieces, 20 clients) and Phase 2 (1M pieces). Replace with viewport-scoped initial state plus incremental subscriptions.

### 2026-05-12, shared-protocol, absolute coords on drag
Choice: `CDrag` and `SDrag` carry absolute `worldX, worldY` instead of deltas.
Why: robust to packet loss and reorderings, simpler client reconciliation, no integration of deltas. Cost is a few extra bytes per frame.
Revisit when: drag broadcast bandwidth shows up in profiling, or when we add per-frame rotation. Quantize to integer pixels or switch to int16 deltas if needed.

### 2026-05-12, shared-protocol, drop implies release
Choice: no explicit `release` message. `CDrop` finalizes the position and releases the cluster lock atomically.
Why: one round trip instead of two, one less message type, matches mouse-up semantics.
Revisit when: we need to distinguish "user let go" from "client disconnected mid-drag". Today both are handled by drop + connection close; if the snap/anchor logic later cares about that distinction, add an explicit release.

### 2026-05-12, shared-protocol, PROTOCOL_VERSION bump
Choice: bumped `PROTOCOL_VERSION` from 0 to 1.
Why: first non-empty protocol surface. Version field is asserted in `welcome` so a mismatched client gets `protocol_mismatch` rather than malformed-message errors.
Revisit when: any breaking wire change. Phase 1 freezes presence messages; Phase 2 freezes v1.

### 2026-05-12, shared-protocol, piece geometry not on the wire
Choice: piece silhouettes and canonical offsets are recomputed from `generationSeed` on both sides, never serialized.
Why: at 1M pieces, geometry would dominate payload size. Seed-based determinism keeps state minimal and timelapse replay tractable.
Revisit when: never expected. If the generator becomes non-deterministic across platforms (FP drift), pin to a fixed integer-math implementation rather than start shipping geometry.
