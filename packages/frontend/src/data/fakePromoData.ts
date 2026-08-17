// Promo screenshot scaffolding: shared fake leaderboard/activity data for the
// in-game HUD (usePuzzleSession.ts) and the landing page's live-progress
// panels (LandingPage.vue). Real puzzle progress (locked count) stays wired
// to the server in both places; only these two social panels are fabricated,
// since the only real progress right now comes from seed-lock-scenario's
// single "seed-script" bot. Remove this file and its two call sites after
// promo screenshots are taken.

import type { ActivityItem, LeaderboardEntry } from "@mpp/shared";

export const FAKE_LEADERBOARD: LeaderboardEntry[] = [
  { userId: "fake-1", pseudo: "Marta", country: "pl", pieces: 9184 },
  { userId: "fake-2", pseudo: "Kenji", country: "jp", pieces: 8420 },
  { userId: "fake-3", pseudo: "Sofia", country: "br", pieces: 7935 },
  { userId: "fake-4", pseudo: "Tom", country: "gb", pieces: 7112 },
  { userId: "fake-5", pseudo: "Anaïs", country: "fr", pieces: 6540 },
  { userId: "fake-6", pseudo: "Diego", country: "ar", pieces: 5890 },
  { userId: "fake-7", pseudo: "Li", country: "cn", pieces: 5210 },
  { userId: "fake-8", pseudo: "Priya", country: "in", pieces: 4675 },
  { userId: "fake-9", pseudo: "Nadia", country: "eg", pieces: 4108 },
  { userId: "fake-10", pseudo: "Oleksiy", country: "ua", pieces: 3652 },
  { userId: "fake-11", pseudo: "Hannah", country: "au", pieces: 3190 },
  { userId: "fake-12", pseudo: "Mateus", country: "pt", pieces: 2744 },
  { userId: "fake-13", pseudo: "Yuki", country: "jp", pieces: 2301 },
  { userId: "fake-14", pseudo: "Carlos", country: "mx", pieces: 1876 },
];

// [pseudo, anchored, count, msAgo]. anchored mirrors the real SSnap/ActivityItem
// split: true is a "place" (droppedSize drives the wording), false is a "snap"
// (mergedSize drives it). msAgo is resolved against Date.now() at call time so
// the feed always reads as recent, however long the promo deploy stays up.
const ACTIVITY_ROWS: ReadonlyArray<readonly [string, boolean, number, number]> = [
  ["Sofia", true, 1, 25_000],
  ["Kenji", false, 4, 95_000],
  ["Tom", true, 2, 180_000],
  ["Diego", false, 2, 360_000],
  ["Priya", true, 1, 540_000],
  ["Marta", false, 7, 840_000],
];

export function buildFakeActivityItems(): ActivityItem[] {
  const now = Date.now();
  return ACTIVITY_ROWS.map(([pseudo, anchored, count, agoMs], i) => ({
    id: `fake-activity-${i}`,
    userId: `fake-activity-user-${i}`,
    pseudo,
    anchored,
    droppedSize: count,
    mergedSize: count,
    at: now - agoMs,
  }));
}
