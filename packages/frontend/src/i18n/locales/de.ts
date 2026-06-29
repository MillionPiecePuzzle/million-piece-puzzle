import type { MessageSchema } from "./en";

const de: MessageSchema = {
  common: {
    save: "Speichern",
    saving: "Speichern...",
    close: "Schließen",
    leaderboard: "Rangliste",
    activity: "Aktivität",
    noActivity: "Noch keine Aktivität.",
    noStandings: "Noch keine Platzierungen.",
    saveError: "Speichern fehlgeschlagen, bitte erneut versuchen.",
    fullBoard: "ganze Tabelle",
  },
  time: {
    justNow: "gerade eben",
    secondsAgo: "vor {n} Sek.",
    minutesAgo: "vor {n} Min.",
    hoursAgo: "vor {n} Std.",
    daysAgo: "vor {n} T",
  },
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
    noStandingsFinal: "Keine Platzierungen erfasst.",
    someone: "Jemand",
    placed: "hat {pieces} platziert",
    connected: "hat {pieces} verbunden",
    pieces: "ein Teil | {n} Teile",
  },
  countdown: {
    untilOpen: "Bis die Leinwand öffnet",
    launchingSoon: "Start in Kürze",
  },
  footer: {
    privacy: "Datenschutz",
    legal: "Impressum",
  },
  play: {
    stage: "Puzzle-Fläche",
  },
  topbar: {
    playTime: "Spielzeit",
    puzzleProgress: "Puzzle-Fortschritt",
    connected: "Verbunden",
    nationalityTitle: "Nationalität: {code}. Zum Ändern klicken.",
    signedInAs: "Angemeldet als {pseudo}. Zum Ändern klicken.",
  },
  contribute: {
    spectatorMode: "Zuschauermodus",
    status: "Du bist derzeit im Zuschauermodus",
    prompt: "Mitwirkender werden",
    cta: "Mitwirken",
  },
  zoom: {
    in: "Vergrößern",
    out: "Verkleinern",
    center: "Auf Puzzle zentrieren",
    fit: "Puzzle an Ansicht anpassen",
  },
  reference: {
    title: "Referenz",
    openEnlarged: "Vergrößerte Referenz öffnen",
    image: "Referenzbild",
    fitToView: "An Ansicht anpassen",
  },
  minimap: {
    overview: "Übersicht",
    label: "Minikarte",
  },
  auth: {
    title: "Mitwirkender werden",
    lede: "Melde dich an, um unter deinem Pseudonym Teile auf der Leinwand zu platzieren. Der Zuschauermodus bleibt für alle offen.",
    continueGoogle: "Mit Google fortfahren",
  },
  pseudo: {
    titleEdit: "Pseudonym ändern",
    titleNew: "Wähle dein Pseudonym",
    ledeEdit:
      "Wähle ein neues Pseudonym. Es wird anderen Mitwirkenden neben den von dir platzierten Teilen angezeigt.",
    ledeNew:
      "Wähle ein Pseudonym, bevor du Teile platzierst. Es wird anderen Mitwirkenden angezeigt.",
    placeholder: "dein Pseudonym",
    fieldLabel: "Pseudonym",
    hint: "{min} bis {max} Zeichen: Buchstaben, Ziffern, Leerzeichen, Bindestriche und Unterstriche.",
    taken: "Dieses Pseudonym ist bereits vergeben.",
  },
  nationality: {
    titleEdit: "Nationalität ändern",
    titleNew: "Wähle deine Nationalität",
    ledeEdit:
      "Wähle ein neues Land. Seine Flagge wird in der Rangliste neben deinem Pseudonym angezeigt.",
    ledeNew:
      "Wähle dein Land. Seine Flagge wird in der Rangliste neben deinem Pseudonym angezeigt.",
    selectLabel: "Land",
    selectPlaceholder: "Wähle dein Land...",
    noCountry: "kein Land ausgewählt",
  },
  leaderboardModal: {
    label: "Vollständige Rangliste",
    rankingMode: "Ranglistenmodus",
    people: "Personen",
    countries: "Länder",
    prev: "zurück",
    next: "weiter",
  },
  activityPanel: {
    placedLine: "hat {object} platziert",
    connectedLine: "hat {object} verbunden",
    piece: "ein Teil",
    twoPieces: "zwei Teile",
    cluster: "ein Cluster aus {n} Teilen",
  },
  loading: {
    error: "Fehler",
    loading: "Wird geladen",
    couldNotLoad: "Das Puzzle konnte nicht geladen werden",
    stepConnect: "Verbinden",
    stepManifest: "Manifest",
    stepBuild: "Aufbau",
    stepTextures: "Texturen",
    stepReady: "Bereit",
    headConnect: "Verbindung zum Server",
    headManifest: "Puzzle-Daten werden geladen",
    headBuild: "Spielfeld wird aufgebaut",
    headTextures: "Texturen werden geladen",
    headReady: "Bereit",
    tip: "Tipp: Doppelklicke auf ein Teil, um es an den Cursor zu heften, und doppelklicke erneut, um es abzulegen.",
  },
  completion: {
    complete: "Fertig",
    assembled: "Puzzle zusammengesetzt.",
    piecesPlaced: "{n} Teil platziert. | {n} Teile platziert.",
    topContributors: "Top-Mitwirkende",
    summary: "Zusammenfassung",
    hideSummary: "Zusammenfassung ausblenden",
    showSummary: "Zusammenfassung anzeigen",
  },
  toast: {
    tileFull: "Zu viele Teile auf diesem Feld.",
  },
  carry: {
    hint: "Teil in der Hand. Doppelklicke zum Ablegen, Esc zum Zurücklegen.",
  },
  row: {
    pcs: "Tle",
    you: "du",
    online: "online",
  },
  legalDoc: {
    back: "Zurück zur Startseite",
    updated: "Zuletzt aktualisiert: {date}",
  },
  privacyPage: {
    title: "Datenschutzerklärung",
    intro:
      "Million Piece Puzzle ist ein kollaboratives, nicht kommerzielles Projekt eines unabhängigen Teams. Diese Seite erklärt, welche Daten erfasst werden, warum, und wie du deine Rechte ausüben kannst.",
    controllerHead: "Verantwortlicher",
    controllerBody:
      "Der Dienst wird von einem unabhängigen Team betrieben, erreichbar über unseren {discord}.",
    discord: "Discord-Server",
    collectedHead: "Erfasste Daten",
    collectedBody:
      "Zuschauer betrachten die Leinwand anonym, und es wird kein Konto für sie angelegt. Wenn du dich anmeldest, um mitzuwirken, wird Folgendes gespeichert: eine eindeutige Benutzerkennung, das von dir gewählte Pseudonym und das beim Onboarding ausgewählte Land. Da die Anmeldung über Google erfolgt, werden auch deine E-Mail-Adresse und dein Name von Google gespeichert. Deine Beiträge (welche Teile du platziert hast und wann) werden erfasst und für den Aktivitäts-Feed und die Rangliste öffentlich angezeigt. Technische Protokolle (IP-Adresse, Browser) werden vom Hoster aus Gründen der Sicherheit und Zuverlässigkeit verarbeitet.",
    purposesHead: "Zwecke",
    purposesBody:
      "Die Daten werden ausschließlich zum Betrieb des Spiels verwendet: um dich zu authentifizieren, deinen Fortschritt zu speichern, platzierte Teile zuzuordnen und die Rangliste anzuzeigen. Es werden keine Daten verkauft oder für Werbung verwendet.",
    processorsHead: "Auftragsverarbeiter",
    processorsBody:
      "Der Dienst nutzt Google (Anmeldung), Cloudflare (Frontend-Hosting, Speicherung und Auslieferung der Assets sowie cookielose, datenschutzfreundliche Web-Analyse) und OVH (den Server, der das Spiel-Backend hostet). Diese Anbieter können Daten außerhalb der Europäischen Union im Rahmen ihrer eigenen Schutzmechanismen verarbeiten. Es wird kein weiterer Drittanbieter-Dienst für Tracking oder Analyse eingesetzt.",
    retentionHead: "Speicherung und deine Rechte",
    retentionBody:
      "Deine Daten werden so lange gespeichert, wie dein Konto besteht. Nach der DSGVO hast du ein Recht auf Auskunft, Berichtigung, Löschung und Übertragbarkeit deiner Daten sowie ein Widerspruchsrecht. Um sie auszuüben oder jederzeit eine Löschung zu verlangen, kontaktiere den Betreiber über die oben genannten Angaben.",
    cookiesHead: "Cookies",
    cookiesBody:
      "Die Website verwendet nur die für die Anmeldung und deine Einstellungen notwendigen Cookies und den lokalen Speicher. Es werden keine Werbe- oder Reichweitenmessungs-Cookies gesetzt; die verwendete Web-Analyse ist cookielos.",
  },
  legalPage: {
    title: "Impressum",
    publisherHead: "Herausgeber",
    publisherBody:
      "Diese Website ist ein kollaboratives Projekt eines unabhängigen Teams. Kontakt: unser {discord}.",
    discord: "Discord-Server",
    hostHead: "Hosting",
    hostBody:
      "Das Frontend wird von Cloudflare, Inc. (101 Townsend Street, San Francisco, CA 94107, USA) auf Cloudflare Pages gehostet. Das Spiel-Backend wird auf einem Server der OVH SAS (2 rue Kellermann, 59100 Roubaix, Frankreich) gehostet.",
    natureHead: "Art des Projekts",
    natureBody:
      "Million Piece Puzzle ist ein nicht kommerzielles Projekt. Es erwirtschaftet keine Einnahmen, enthält keine Werbung und bietet keine kostenpflichtigen Inhalte.",
    ipHead: "Geistiges Eigentum",
    ipBody:
      "Million Piece Puzzle ist quelloffen. Der Quellcode wird unter der MIT-Lizenz veröffentlicht und ist im {repo} verfügbar. Die Puzzle-Grafik und sonstige Visuals gehören ihren jeweiligen Urhebern und werden, soweit zutreffend, genannt.",
    repo: "Projekt-Repository",
    liabilityHead: "Haftung",
    liabilityBody:
      "Million Piece Puzzle wird „wie besehen“ und ohne jegliche Gewährleistung bereitgestellt. Der Herausgeber haftet nicht für Dienstunterbrechungen, Datenverluste oder sonstige Schäden, die aus der Nutzung der Website entstehen.",
    licensesHead: "Open-Source-Lizenzen",
    licensesBody:
      "Die Website nutzt Open-Source-Bibliotheken, die Eigentum ihrer jeweiligen Urheber bleiben und hier unter ihren Lizenzen verwendet werden: Vue und Vue Router (MIT), PixiJS (MIT) und OpenSeadragon (BSD-3-Clause). Der vollständige Abhängigkeitsbaum und der vollständige Lizenztext sind im {sourceRepo} verfügbar.",
    sourceRepo: "Quell-Repository",
  },
};

export default de;
