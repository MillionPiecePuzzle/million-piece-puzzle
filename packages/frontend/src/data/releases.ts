// Newest version first. Each line is its own message key rather than a locale
// array so a line left untranslated fails the type check instead of the page.
export const RELEASES = [
  {
    version: "1.4.0",
    at: Date.UTC(2026, 8, 4),
    lines: [
      "updates.v140.bookmarks",
      "updates.v140.share",
      "updates.v140.multiCarry",
      "updates.v140.coordinates",
      "updates.v140.contributors",
      "updates.v140.performance",
      "updates.v140.support",
      "updates.v140.fixes",
    ],
  },
  {
    version: "1.3.0",
    at: Date.UTC(2026, 7, 30),
    lines: [
      "updates.v130.jump",
      "updates.v130.contributors",
      "updates.v130.countries",
      "updates.v130.home",
      "updates.v130.fixes",
    ],
  },
  {
    version: "1.2.0",
    at: Date.UTC(2026, 7, 27),
    lines: [
      "updates.v120.panels",
      "updates.v120.overview",
      "updates.v120.notes",
      "updates.v120.fixes",
    ],
  },
  {
    version: "1.1.1",
    at: Date.UTC(2026, 7, 25),
    lines: ["updates.v111.fixes"],
  },
  {
    version: "1.1.0",
    at: Date.UTC(2026, 7, 24),
    lines: [
      "updates.v110.flags",
      "updates.v110.flagDrop",
      "updates.v110.underlay",
      "updates.v110.standings",
      "updates.v110.account",
      "updates.v110.maintenance",
      "updates.v110.mobile",
      "updates.v110.help",
    ],
  },
  {
    version: "1.0.0",
    at: Date.UTC(2026, 7, 22),
    lines: ["updates.v100.launch"],
  },
] as const;

export const LATEST_VERSION: string = RELEASES[0].version;
