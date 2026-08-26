// Newest version first. Each line is its own message key rather than a locale
// array so a line left untranslated fails the type check instead of the page.
export const RELEASES = [
  {
    version: "1.1.1",
    at: Date.UTC(2026, 7, 25),
    lines: ["updates.v111.fixes"],
  },
  {
    version: "1.1",
    at: Date.UTC(2026, 7, 24),
    lines: [
      "updates.v11.flags",
      "updates.v11.flagDrop",
      "updates.v11.underlay",
      "updates.v11.standings",
      "updates.v11.account",
      "updates.v11.maintenance",
      "updates.v11.mobile",
      "updates.v11.help",
    ],
  },
  {
    version: "1.0",
    at: Date.UTC(2026, 7, 22),
    lines: ["updates.v10.launch"],
  },
] as const;

export const LATEST_VERSION: string = RELEASES[0].version;
