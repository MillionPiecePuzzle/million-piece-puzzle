import type { MessageSchema } from "./en";

const de: MessageSchema = {
  common: {
    save: "Speichern",
    saving: "Speichern...",
    close: "Schließen",
    skip: "Überspringen",
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
    tagline: "Eine Million Teile auf einem einzigen geteilten Spielfeld.",
    enterBoard: "Zum Spielfeld",
    interested: "Ich bin interessiert",
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
    launchingSoon: "Start in Kürze",
    days: "Tage",
    hours: "Stunden",
    minutes: "Minuten",
    seconds: "Sekunden",
  },
  footer: {
    privacy: "Datenschutz",
    legal: "Impressum",
  },
  play: {
    stage: "Puzzle-Fläche",
  },
  topbar: {
    puzzleProgress: "Puzzle-Fortschritt",
    nationalityTitle: "Nationalität: {code}",
    signedInAs: "Angemeldet als {pseudo}",
    options: "Einstellungen",
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
    credits: "Bildnachweise anzeigen",
  },
  minimap: {
    overview: "Übersicht",
    online: "{n} online",
    label: "Minikarte",
    openDetail: "Detailansicht der Felder öffnen",
    detailTitle: "Ladedetails der Felder",
    legendLoaded: "Geladen",
    legendLoading: "Wird geladen",
    legendNotLoaded: "Nicht geladen",
    tilesLoaded: "{loaded} / {total} Felder geladen",
    memoryUsage: "{used} / {budget}",
  },
  auth: {
    title: "Konto synchronisieren",
    lede: "Melde dich mit Google an, um deine Beiträge dauerhaft zu sichern und unter einem Konto zu vereinen.",
    continueGoogle: "Mit Google fortfahren",
    switchTitle: "Dieses Google-Konto hat schon ein Profil",
    switchLede:
      "Es gehört bereits zu einem anderen Profil im Puzzle. Hol es zurück, die hier gesetzten Teile kommen mit.",
    switchAction: "Mein Konto zurückholen",
    signInFailed: "Die Anmeldung wurde nicht abgeschlossen. Versuch es erneut.",
  },
  options: {
    title: "Einstellungen",
    account: "Konto",
    sync: "Konto synchronisieren",
    syncHint: "Melde dich mit Google an, um deine Beiträge dauerhaft zu sichern.",
    synced: "Konto mit Google synchronisiert",
    changePseudo: "Pseudonym ändern",
    changeCountry: "Land ändern",
    discord: "Discord-Server beitreten",
    updates: "Versionshinweise",
    display: {
      title: "Anzeige",
      underlay: "Referenzbild im Hintergrund",
      underlayHint: "Zeigt das Referenzbild schwach unter dem Spielfeld.",
    },
    signOut: "Abmelden",
  },
  tips: {
    title: "Tipps",
    prev: "Vorheriger Tipp",
    next: "Nächster Tipp",
    carry:
      "Doppelklicke auf ein Teil, um es an den Cursor zu heften, und noch einmal, um es abzulegen.",
    flags: "Nutze Fahnen, um dich einfach auf dem Board zu bewegen.",
    flagDrop: "Zieh ein Teil auf eine Fahne in der Leiste, um es dorthin zu schicken.",
    minimap: "Klicke irgendwo auf die Mini-Karte, um die Ansicht dorthin zu bewegen.",
    reference: "Öffne das Referenzbild und zoome hinein, um zu finden, wohin ein Teil gehört.",
  },
  updates: {
    title: "Versionshinweise",
    v11: {
      flags:
        "Persönliche Fahnen: Setze bis zu 8 Marker auf das Board und springe per Klick oder mit den Tasten 1 bis 8 zwischen ihnen.",
      flagDrop:
        "Schick ein Teil quer über das Board, indem du es auf eine Fahne in der unteren Leiste ziehst, ohne die Stelle zu verlassen, an der du arbeitest.",
      underlay:
        "Zeig das Originalfoto schwach unter dem Board an, über den Bereich Anzeige in diesem Menü.",
      standings:
        "Die Rangliste bewegt sich bei jedem Zusammenfügen, nicht mehr nur beim Einrasten am Rahmen. Deine eigene Zeile ist immer sichtbar.",
      account:
        "Die Anmeldung mit Google macht aus deinem Gastkonto ein dauerhaftes Konto, das du auch von einem anderen Browser aus wieder erreichst.",
      maintenance:
        "Ein Neustart des Servers zeigt einen Wartungshinweis statt eines Verbindungsfehlers und kommt von selbst zurück, sobald das Puzzle wieder da ist.",
      mobile:
        "Auf dem Handy behält die Oberfläche nur die Referenz und die Mini-Karte und überlässt dem Board den Bildschirm.",
      help: "Dieses Menü enthält Tipps, und die Rangliste erklärt, wie Punkte gezählt werden.",
    },
    v10: {
      launch:
        "Öffentlicher Start: 1.000.000 einzigartige Teile auf einem einzigen gemeinsamen Board, ohne Anmeldung als Gast spielbar, auf Englisch, Französisch, Spanisch und Deutsch.",
    },
  },
  pseudo: {
    haveAccount: "Du hast schon ein Konto? Anmelden",
    titleEdit: "Pseudonym ändern",
    titleNew: "Wähle dein Pseudonym",
    ledeEdit:
      "Wähle ein neues Pseudonym. Es wird anderen Mitwirkenden neben den von dir platzierten Teilen angezeigt.",
    ledeNew:
      "Wähle ein Pseudonym, bevor du Teile platzierst. Es wird anderen Mitwirkenden angezeigt.",
    placeholder: "dein Pseudonym",
    fieldLabel: "Pseudonym",
    hint: "{min} bis {max} Zeichen: Buchstaben, Ziffern, Leerzeichen, Bindestriche, Unterstriche und #.",
    taken: "Dieses Pseudonym ist bereits vergeben.",
    cooldownHint: "Du kannst dein Pseudonym nur alle {hours} Stunden ändern.",
    cooldown:
      "Du hast dein Pseudonym bereits vor Kurzem geändert. Versuch es in {hours} Std. erneut.",
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
    international: "International",
    noCountry: "kein Land ausgewählt",
    cooldownHint: "Du kannst dein Land nur alle {hours} Stunden ändern.",
    cooldown: "Du hast dein Land bereits vor Kurzem geändert. Versuch es in {hours} Std. erneut.",
  },
  leaderboardModal: {
    label: "Vollständige Rangliste",
    rankingMode: "Ranglistenmodus",
    people: "Personen",
    countries: "Länder",
    prev: "zurück",
    next: "weiter",
  },
  scoring: {
    open: "Wie Teile gezählt werden",
    title: "Wie Teile gezählt werden",
    lede: "Jedes Teil auf dem Brett ist einen Punkt wert. Er wird einmal gutgeschrieben, an den ersten Spieler, der es einrastet.",
    snapTwo:
      "Du rastest zwei lose Teile zusammen: ein Punkt, nicht zwei. Der Punkt des anderen Teils bleibt für den zurückgelegt, der diesen Verbund im Brett verriegelt.",
    snapCluster:
      "Du ziehst einen 30-Teile-Verbund auf einen anderen: die 29 bereits gutgeschriebenen zählen nicht doppelt, du bekommst das eine, das noch nie jemand eingerastet hat.",
    mismatchTitle: "Warum das nicht zum Fortschrittsbalken passt",
    mismatchBody:
      "Die Rangliste schreibt ein Teil in dem Moment gut, in dem es einrastet, egal wo auf dem Brett. Der Fortschrittsbalken zählt nur die Teile, die an ihrem endgültigen Platz verriegelt sind: die beiden Zahlen sollen gar nicht gleich sein.",
    fairTitle: "Am Ende geht es auf",
    fairBody:
      "Dieses System hält die Rangliste fair. Und es sorgt dafür, dass sie genau {total} Teile ergibt, sobald das letzte Teil gesetzt ist.",
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
    errorProtocol: "Diese Seite läuft in einer alten Version. Lade sie neu, um fortzufahren.",
    errorManifest:
      "Die Puzzledaten konnten nicht geladen werden. Prüfe deine Verbindung und lade neu.",
    errorQueue:
      "Die Warteschlange konnte nicht betreten werden. Prüfe deine Verbindung und versuche es erneut.",
    errorConnection: "Verbindung verloren. Lade die Seite neu, um wieder mitzuspielen.",
    stepConnect: "Verbinden",
    stepBuild: "Aufbau",
    stepTextures: "Texturen",
    stepReady: "Bereit",
    headConnect: "Verbindung zum Server",
    headBuild: "Spielfeld wird aufgebaut",
    headTextures: "Texturen werden geladen",
    headReady: "Bereit",
    tip: "Tipp: Doppelklicke oder tippe zweimal auf ein Teil, um es an den Cursor zu heften, und wiederhole das, um es abzulegen.",
  },
  queue: {
    kicker: "Gleich geht's",
    heading: "Du bist in der Warteschlange",
    position: "Position {n} in der Warteschlange",
    waiting: "Warten auf einen freien Platz",
  },
  maintenance: {
    kicker: "Wartung",
    heading: "Das Puzzle ist nicht verfügbar",
    body: "Das Spielfeld ist gerade nicht erreichbar. Es sollte in ein paar Minuten zurück sein.",
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
    hint: "Teil in der Hand. Doppelklicke oder tippe zweimal zum Ablegen, Esc zum Zurücklegen.",
  },
  flags: {
    bar: "Persönliche Fahnen",
    add: "Fahne in der Bildmitte setzen",
    goTo: "Zu Fahne {n} (Taste {n})",
    options: "Optionen für Fahne {n}",
    delete: "Löschen",
    colors: {
      red: "Rot",
      orange: "Orange",
      green: "Grün",
      blue: "Blau",
      purple: "Lila",
      pink: "Rosa",
      white: "Weiß",
      black: "Schwarz",
    },
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
      "Million Piece Puzzle ist ein kollaboratives, nicht kommerzielles Projekt eines unabhängigen Entwicklers. Diese Seite erklärt, welche Daten erfasst werden, warum, und wie du deine Rechte ausüben kannst.",
    controllerHead: "Verantwortlicher",
    controllerBody:
      "Der Dienst wird von einem unabhängigen Entwickler betrieben, erreichbar über unseren {discord}.",
    discord: "Discord-Server",
    collectedHead: "Erfasste Daten",
    collectedBody:
      "Der Eintritt ins Spielfeld legt ein Gastkonto an: eine eindeutige Benutzerkennung, das von dir gewählte Pseudonym und das beim Onboarding ausgewählte Land, ohne dass eine E-Mail-Adresse erforderlich ist. Wenn du dich mit Google anmeldest, um deine Beiträge unter einer einzigen Identität zu behalten, werden auch deine E-Mail-Adresse und dein Name von Google gespeichert. Deine Beiträge (welche Teile du platziert hast und wann) werden erfasst und für den Aktivitäts-Feed und die Rangliste öffentlich angezeigt. Technische Protokolle (IP-Adresse, Browser) werden vom Hoster aus Gründen der Sicherheit und Zuverlässigkeit verarbeitet.",
    purposesHead: "Zwecke",
    purposesBody:
      "Die Daten werden ausschließlich zum Betrieb des Spiels verwendet: um dich zu authentifizieren, deinen Fortschritt zu speichern, platzierte Teile zuzuordnen und die Rangliste anzuzeigen. Es werden keine Daten verkauft oder für Werbung verwendet.",
    processorsHead: "Auftragsverarbeiter",
    processorsBody:
      "Der Dienst nutzt Google (Anmeldung), Cloudflare (Frontend-Hosting, Speicherung und Auslieferung der Assets) und OVH (den Server, der das Spiel-Backend hostet, einschließlich seiner selbst gehosteten Analyse). Diese Anbieter können Daten außerhalb der Europäischen Union im Rahmen ihrer eigenen Schutzmechanismen verarbeiten. Es wird kein Drittanbieter-Dienst für Tracking oder Analyse eingesetzt.",
    retentionHead: "Speicherung und deine Rechte",
    retentionBody:
      "Deine Daten werden so lange gespeichert, wie dein Konto besteht. Nach der DSGVO hast du ein Recht auf Auskunft, Berichtigung, Löschung und Übertragbarkeit deiner Daten sowie ein Widerspruchsrecht. Um sie auszuüben oder jederzeit eine Löschung zu verlangen, kontaktiere den Betreiber über die oben genannten Angaben.",
    cookiesHead: "Cookies und Analyse",
    cookiesBody:
      "Die Website verwendet nur die für die Anmeldung und deine Einstellungen notwendigen Cookies und den lokalen Speicher; es werden keine Werbe- oder Reichweitenmessungs-Cookies gesetzt. Der Traffic auf dem Puzzle-Spielfeld wird mit Umami gemessen, einem selbst gehosteten Analysetool auf unserem eigenen Server: Es setzt keine Cookies und speichert nie deine IP-Adresse, sondern erkennt einen Besuch nur anhand eines Hashes aus deiner IP-Adresse, deinem Browser und dieser Website, dessen Salt monatlich erneuert wird, sodass er weder dir zugeordnet noch zur seitenübergreifenden Verfolgung genutzt werden kann.",
  },
  legalPage: {
    title: "Impressum",
    publisherHead: "Herausgeber",
    publisherBody:
      "Diese Website ist ein kollaboratives Projekt eines unabhängigen Entwicklers. Kontakt: unser {discord}.",
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
    creditsHead: "Bildnachweise",
    creditsBody:
      "Alle Fotos stammen von {unsplash}, Fotografien, nicht KI-generiert. Der Mosaik-Algorithmus ist vom Open-Source-Projekt {photomosaic} inspiriert.",
    unsplash: "Unsplash",
    photomosaic: "photomosaic",
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
