// Newest version first. Each line is its own message key rather than a locale
// array so a line left untranslated fails the type check instead of the page.
export const RELEASES = [
  {
    version: "1.2.0",
    at: Date.UTC(2026, 7, 27),
    lines: [
      "updates.v120.panels",
      "updates.v120.minimap",
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
