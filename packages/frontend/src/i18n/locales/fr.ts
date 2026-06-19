import type { MessageSchema } from "./en";

const fr: MessageSchema = {
  units: { d: "j", h: "h", m: "min" },
  langSwitcher: { label: "Choisir la langue" },
  landing: {
    tagline: "Un million de pièces sur un seul canevas partagé.",
    enterCanvas: "Entrer sur le canevas",
    interested: "Ça m'intéresse",
    onTheList: "Vous êtes inscrit",
    beFirst: "Soyez le premier à suivre l'aventure",
    interestCount: "{n} personne intéressée | {n} personnes intéressées",
    piecesLockedSuffix: "/ {n} pièces verrouillées",
    pctComplete: "{p}% terminé",
    completed: "TERMINÉ",
    solvedIn: "résolu en {duration}",
    liveActivity: "Activité en direct",
    leaderboard: "Classement",
    noActivity: "Aucune activité pour l'instant.",
    noStandings: "Aucun classement pour l'instant.",
    noStandingsFinal: "Aucun classement enregistré.",
    someone: "Quelqu'un",
    placed: "a placé {pieces}",
    connected: "a relié {pieces}",
    pieces: "une pièce | {n} pièces",
    justNow: "à l'instant",
    minutesAgo: "il y a {n} min",
    hoursAgo: "il y a {n} h",
    daysAgo: "il y a {n} j",
  },
  countdown: {
    untilOpen: "Avant l'ouverture du canevas",
    launchingSoon: "Lancement imminent",
  },
  footer: {
    privacy: "Confidentialité",
    legal: "Mentions légales",
  },
};

export default fr;
