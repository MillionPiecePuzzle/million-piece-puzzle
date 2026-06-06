// Real leaderboard data: server LeaderboardEntry values (userId + piece count)
// turned into the display rows consumed by LeaderboardRow.vue and the panels.

import type { LeaderboardEntry } from "@mpp/shared";

export type LeaderboardRow = {
  rank: number;
  name: string;
  initials: string;
  color: string;
  // ISO 3166-1 alpha-2 code, rendered as a round flag avatar. Null falls back to
  // the colored initials circle (backfilled rows, users without a country).
  country: string | null;
  pieces: number;
  online: boolean;
  you?: boolean;
};

const palette = [
  "var(--c1)",
  "var(--c2)",
  "var(--c3)",
  "var(--c4)",
  "var(--c5)",
  "#7d7468",
  "#9a8f7e",
  "#8a7d6a",
];

// An entry's display name is the contributor's pseudo. It falls back to a short
// prefix of the user id when the pseudo is unset (a contributor who placed
// pieces before choosing one cannot occur, but backfilled rows stay robust).
function displayName(entry: LeaderboardEntry): string {
  return entry.pseudo ?? entry.userId.slice(0, 8);
}

function initials(name: string): string {
  return (name.slice(0, 2) || "??").toUpperCase();
}

export function toLeaderboardRows(
  entries: LeaderboardEntry[],
  myUserId: string | null,
): LeaderboardRow[] {
  return entries.map((entry, i) => {
    const you = entry.userId === myUserId;
    const name = displayName(entry);
    return {
      rank: i + 1,
      name,
      initials: initials(name),
      color: you ? "var(--accent)" : palette[i % palette.length]!,
      country: entry.country ?? null,
      pieces: entry.pieces,
      online: false,
      you,
    };
  });
}
