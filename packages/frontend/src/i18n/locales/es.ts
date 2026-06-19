import type { MessageSchema } from "./en";

const es: MessageSchema = {
  units: { d: "d", h: "h", m: "min" },
  langSwitcher: { label: "Elegir idioma" },
  landing: {
    tagline: "Un millón de piezas en un único lienzo compartido.",
    enterCanvas: "Entrar al lienzo",
    interested: "Me interesa",
    onTheList: "Estás en la lista",
    beFirst: "Sé el primero en seguir la aventura",
    interestCount: "{n} persona interesada | {n} personas interesadas",
    piecesLockedSuffix: "/ {n} piezas fijadas",
    pctComplete: "{p}% completado",
    completed: "COMPLETADO",
    solvedIn: "resuelto en {duration}",
    liveActivity: "Actividad en directo",
    leaderboard: "Clasificación",
    noActivity: "Aún no hay actividad.",
    noStandings: "Aún no hay clasificación.",
    noStandingsFinal: "No se registró ninguna clasificación.",
    someone: "Alguien",
    placed: "colocó {pieces}",
    connected: "conectó {pieces}",
    pieces: "una pieza | {n} piezas",
    justNow: "ahora mismo",
    minutesAgo: "hace {n} min",
    hoursAgo: "hace {n} h",
    daysAgo: "hace {n} d",
  },
  countdown: {
    untilOpen: "Hasta la apertura del lienzo",
    launchingSoon: "Lanzamiento inminente",
  },
  footer: {
    privacy: "Privacidad",
    legal: "Aviso legal",
  },
};

export default es;
