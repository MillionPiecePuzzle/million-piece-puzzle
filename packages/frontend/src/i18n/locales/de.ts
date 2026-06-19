import type { MessageSchema } from "./en";

const de: MessageSchema = {
  units: { d: "T", h: "Std.", m: "Min." },
  langSwitcher: { label: "Sprache wählen" },
  landing: {
    tagline: "Eine Million Teile auf einer einzigen geteilten Leinwand.",
    enterCanvas: "Zur Leinwand",
    interested: "Ich bin interessiert",
    onTheList: "Du stehst auf der Liste",
    beFirst: "Sei der Erste, der mitverfolgt",
    interestCount: "{n} Person interessiert | {n} Personen interessiert",
    piecesLockedSuffix: "/ {n} Teile fixiert",
    pctComplete: "{p}% fertig",
    completed: "ABGESCHLOSSEN",
    solvedIn: "gelöst in {duration}",
    liveActivity: "Live-Aktivität",
    leaderboard: "Rangliste",
    noActivity: "Noch keine Aktivität.",
    noStandings: "Noch keine Platzierungen.",
    noStandingsFinal: "Keine Platzierungen erfasst.",
    someone: "Jemand",
    placed: "hat {pieces} platziert",
    connected: "hat {pieces} verbunden",
    pieces: "ein Teil | {n} Teile",
    justNow: "gerade eben",
    minutesAgo: "vor {n} Min.",
    hoursAgo: "vor {n} Std.",
    daysAgo: "vor {n} T",
  },
  countdown: {
    untilOpen: "Bis die Leinwand öffnet",
    launchingSoon: "Start in Kürze",
  },
  footer: {
    privacy: "Datenschutz",
    legal: "Impressum",
  },
};

export default de;
