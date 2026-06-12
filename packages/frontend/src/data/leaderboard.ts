// Real leaderboard data: server LeaderboardEntry values (userId + piece count)
// turned into the display rows consumed by LeaderboardRow.vue and the panels.

import { COUNTRIES, type LeaderboardEntry } from "@mpp/shared";

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

const countryNames = new Map(COUNTRIES.map((c) => [c.code, c.name]));

// Fold the per-person standings into a per-country ranking: every contributor
// with a country adds their pieces to that country's total, ranked by pieces.
// Entries without a country are omitted (no flag, no bucket). The local user's
// country is flagged so the modal can highlight it like their own row.
export function toCountryRows(
  entries: LeaderboardEntry[],
  myUserId: string | null,
): LeaderboardRow[] {
  const myCountry = entries.find((e) => e.userId === myUserId)?.country ?? null;
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.country) continue;
    totals.set(entry.country, (totals.get(entry.country) ?? 0) + entry.pieces);
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, pieces], i) => ({
      rank: i + 1,
      name: countryNames.get(code) ?? code.toUpperCase(),
      initials: code.toUpperCase(),
      color: palette[i % palette.length]!,
      country: code,
      pieces,
      online: false,
      you: code === myCountry,
    }));
}
