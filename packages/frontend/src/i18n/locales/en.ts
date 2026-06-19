const en = {
  units: { d: "d", h: "h", m: "m" },
  langSwitcher: { label: "Choose language" },
  landing: {
    tagline: "One million pieces on a single shared canvas.",
    enterCanvas: "Enter the canvas",
    interested: "I'm interested",
    onTheList: "You're on the list",
    beFirst: "Be the first to follow along",
    interestCount: "{n} person interested | {n} people interested",
    piecesLockedSuffix: "/ {n} pieces locked",
    pctComplete: "{p}% complete",
    completed: "COMPLETED",
    solvedIn: "solved in {duration}",
    liveActivity: "Live activity",
    leaderboard: "Leaderboard",
    noActivity: "No activity yet.",
    noStandings: "No standings yet.",
    noStandingsFinal: "No standings recorded.",
    someone: "Someone",
    placed: "placed {pieces}",
    connected: "connected {pieces}",
    pieces: "a piece | {n} pieces",
    justNow: "just now",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
  },
  countdown: {
    untilOpen: "Until the canvas opens",
    launchingSoon: "Launching soon",
  },
  footer: {
    privacy: "Privacy",
    legal: "Legal notice",
  },
};

export default en;
export type MessageSchema = typeof en;
