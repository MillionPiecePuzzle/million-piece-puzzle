// Real leaderboard data: server LeaderboardEntry values (userId + piece count)
// turned into the display rows consumed by LeaderboardRow.vue and the panels.

import { LEADERBOARD_LIMIT, compareStandings, type LeaderboardEntry } from "@mpp/shared";

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
function displayName(entry: { userId: string; pseudo?: string | null }): string {
  return entry.pseudo ?? entry.userId.slice(0, 8);
}

function initials(name: string): string {
  return (name.slice(0, 2) || "??").toUpperCase();
}

// Fold a standings delta into the list held since the welcome: a delta entry
// replaces the row with the same userId or joins the list, then the whole list
// re-sorts the server's way and truncates back to the server's own bound, so an
// entry climbing into the top N pushes the last one out. Truncating is what
// keeps the list a true top N rather than a growing pile: the server only ever
// deltas entries that are inside it.
export function mergeLeaderboardDelta(
  current: LeaderboardEntry[],
  delta: LeaderboardEntry[],
): LeaderboardEntry[] {
  if (delta.length === 0) return current;
  const byUser = new Map(current.map((entry) => [entry.userId, entry]));
  for (const entry of delta) byUser.set(entry.userId, entry);
  return [...byUser.values()].sort(compareStandings).slice(0, LEADERBOARD_LIMIT);
}

// The local contributor's own row while they rank outside the standings list
// (see the `standing` message): same rendering as any other row, built from the
// rank and tally the server sends plus the profile the session already knows.
export function toPersonalRow(
  standing: { pieces: number; rank: number },
  profile: { userId: string; pseudo: string | null; country: string | null },
): LeaderboardRow {
  const name = displayName({ userId: profile.userId, pseudo: profile.pseudo });
  return {
    rank: standing.rank,
    name,
    initials: initials(name),
    color: "var(--accent)",
    country: profile.country,
    pieces: standing.pieces,
    online: false,
    you: true,
  };
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

// Fold the per-person standings into a per-country ranking: every contributor
// with a country adds their pieces to that country's total, ranked by pieces.
// Entries without a country are omitted (no flag, no bucket). The local user's
// country is flagged so the modal can highlight it like their own row. The
// label comes from the caller (i18n/countryNames) so the ranking reads in the
// active UI locale; ties still break on the code, which no locale reorders.
export function toCountryRows(
  entries: LeaderboardEntry[],
  myUserId: string | null,
  countryName: (code: string) => string,
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
      name: countryName(code),
      initials: code.toUpperCase(),
      color: palette[i % palette.length]!,
      country: code,
      pieces,
      online: false,
      you: code === myCountry,
    }));
}
