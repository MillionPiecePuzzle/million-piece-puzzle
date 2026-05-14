// Mocked leaderboard data. Real per-user snap counts (derived from ClusterMerge)
// land with auth and multi-user in Phase 1.

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

const names = [
  "jin_k",
  "fern.06",
  "marisol_r",
  "tev",
  "quietfox",
  "samo_o",
  "petrichor",
  "harbor_lng",
  "delphine",
  "okra_77",
  "ninstein",
  "cloudbank",
  "rye.fields",
  "you",
  "petitgris",
  "anders_w",
  "marrow",
  "tideline",
  "vesper.k",
  "halcyon",
  "brackish",
  "sandpiper",
  "n0rthward",
  "umbel",
  "lowtide",
  "cinder_o",
  "willow.b",
  "graymatter",
];

function initials(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || "??").toUpperCase();
}

export const leaderboardBoard: LeaderboardRow[] = names.map((name, i) => {
  const rank = i + 1;
  const you = name === "you";
  return {
    rank,
    name,
    initials: initials(name),
    color: you ? "var(--accent)" : palette[i % palette.length]!,
    pieces: Math.round(3300 - rank * 92 - (rank % 3) * 37),
    online: you || rank % 2 === 1 || rank <= 6,
  };
});

// The compact panel shows the leaders plus the "you" row and its neighbour.
export const leaderboardPanelRows: LeaderboardRow[] = (() => {
  const top = leaderboardBoard.slice(0, 6);
  const youIndex = leaderboardBoard.findIndex((r) => r.you);
  const tail = youIndex >= 0 ? leaderboardBoard.slice(youIndex, youIndex + 2) : [];
  return [...top, ...tail];
})();
