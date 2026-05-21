// Real leaderboard data: server LeaderboardEntry values (userId + piece count)
// turned into the display rows consumed by LeaderboardRow.vue and the panels.

import type { LeaderboardEntry } from "@mpp/shared";

export type LeaderboardRow = {
  rank: number;
  name: string;
  initials: string;
  color: string;
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

// Pseudos are not persisted server-side, so an entry carries only the ephemeral
// userId. Show a short prefix of it as the display name.
function shortId(userId: string): string {
  return userId.slice(0, 8);
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
    const name = shortId(entry.userId);
    return {
      rank: i + 1,
      name,
      initials: initials(name),
      color: you ? "var(--accent)" : palette[i % palette.length]!,
      pieces: entry.pieces,
      online: false,
      you,
    };
  });
}
