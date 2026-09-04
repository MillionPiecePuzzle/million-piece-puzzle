import type { MessageSchema } from "./en";

const de: MessageSchema = {
  common: {
    save: "Speichern",
    saving: "Speichern...",
    close: "Schließen",
    cancel: "Abbrechen",
    skip: "Überspringen",
    saveError: "Speichern fehlgeschlagen, bitte erneut versuchen.",
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
    pctComplete: "{p} fertig",
    completed: "ABGESCHLOSSEN",
    solvedIn: "gelöst in {duration}",
    liveActivity: "Live-Aktivität",
    noStandingsFinal: "Keine Beiträge erfasst.",
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
    signedInAs: "Angemeldet als {pseudo}",
    options: "Einstellungen",
    optionsNew: "Einstellungen, neue Versionshinweise",
  },
  perfNotice: {
    label: "Leistung",
    message: "Das Spielfeld läuft auf diesem Gerät sehr langsam.",
    showTips: "Was tun?",
    hideTips: "Ausblenden",
    tipAcceleration:
      "Schalte die Hardwarebeschleunigung in den Einstellungen deines Browsers ein oder aus und starte ihn neu.",
    tipTabs: "Schließe andere Tabs und Programme, die die Grafikkarte belegen.",
    dismiss: "Hinweis ausblenden",
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
    aim: "Auf das Foto klicken, um das Spielfeld dorthin zu bewegen (oder jederzeit Strg-Klick)",
    credits: "Bildnachweise anzeigen",
  },
  overview: {
    title: "Übersicht",
    online: "{n} online",
    enlarge: "Übersicht vergrößern",
    coordinates: "Koordinaten",
    coordinatesHint: "Deine Position auf dem Spielfeld, in Teilen ab der Mitte",
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
    support: "Das Projekt unterstützen ❤️",
    sync: "Konto synchronisieren",
    syncHint: "Melde dich mit Google an, um deine Beiträge dauerhaft zu sichern.",
    synced: "Konto mit Google synchronisiert",
    changePseudo: "Pseudonym ändern",
    changeCountry: "Land ändern",
    discord: "Discord-Server beitreten",
    updates: "Versionshinweise",
    updatesNew: "Versionshinweise, neu",
    display: {
      title: "Anzeige",
      underlay: "Referenzbild im Hintergrund",
      underlayHint: "Zeigt das Referenzbild schwach unter dem Spielfeld.",
      panel: {
        reference: "Referenz",
        zoom: "Zoom",
        activity: "Aktivität",
        contributors: "Mitwirkende",
        overview: "Übersicht",
        flags: "Fahnen",
      },
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
    overview: "Klicke irgendwo auf die Übersicht, um die Ansicht dorthin zu bewegen.",
    reference:
      "Öffne das Referenzbild und zoome hinein, um zu finden, wohin ein Teil gehört, und bring das Board dann mit Strg-Klick dorthin.",
    bookmarks:
      "Nutze Lesezeichen, um dir die Stellen im Puzzle zu merken, die dir wichtig sind: Der Lesezeichen-Knopf in der oberen Leiste öffnet dein Notizbuch, und ein Klick bringt dich direkt dorthin zurück.",
    multiCarry:
      "Mit einem Teil in der Hand kannst du weitere Teile mit Strg-Klick aufnehmen, bis zu 10 auf einmal, und sie dann per Doppelklick aufs Board alle nebeneinander ablegen.",
  },
  updates: {
    title: "Versionshinweise",
    v140: {
      bookmarks:
        "Lesezeichen: Merk dir die Stellen auf dem Board, die dir wichtig sind, in einem Notizbuch, das der Knopf in der oberen Leiste öffnet. Ziel auf das Board, um eines anzulegen, benenne es, sortiere es unter deine eigenen Wörter, gib den Stellen einen Stern, zu denen du immer wieder zurückkehrst, und ein Klick bringt dich dorthin.",
      share:
        "Schick jemandem ein Lesezeichen: Der Link öffnet das Board genau an dieser Stelle und bietet das gleiche Lesezeichen zum Behalten an.",
      multiCarry:
        "Mit einem Teil in der Hand kannst du weitere Teile mit Strg-Klick aufnehmen, bis zu 10 auf einmal, und sie dann per Doppelklick aufs Board alle nebeneinander ablegen.",
      coordinates:
        "Das Übersichts-Panel zeigt jetzt deine Position auf dem Board an, in Teilen ab seiner Mitte.",
      contributors:
        "Das Panel der Mitwirkenden zeigt jetzt die beiden Spieler um dich herum, den direkt über dir und den direkt unter dir, neben deiner eigenen Zeile.",
      performance:
        "Wer auf einem dicht belegten Teil des Boards ankommt, sieht zuerst das, was direkt vor ihm liegt, von der Bildschirmmitte nach außen. Und ein Gerät, das das Board nicht schnell genug zeichnen kann, sagt das jetzt, mit ein paar Dingen zum Ausprobieren.",
      support:
        "Das Einstellungsmenü hat einen Link, um das Projekt zu unterstützen, für alle, die bei den Kosten des Boards mithelfen wollen.",
      fixes:
        "Fehlerbehebungen: Der Aktivitätsverlauf spricht dich in deiner eigenen Sprache an, und der Teile-Zähler auf der Startseite geht nie mehr zurück, während die Aktivitätsliste die Karte füllt, in der sie steht.",
    },
    v130: {
      jump: "Die vergrößerte Übersicht und das vergrößerte Referenzfoto bewegen jetzt das Board: Klick auf die Karte, um dorthin zu springen, und auf dem Foto bringt der Fadenkreuz-Knopf, oder Strg-Klick, das Board zu dem, was du gerade ansiehst.",
      contributors:
        "Das Panel mit den Spielern heißt jetzt Mitwirkende, und die Formulierungen drumherum sind mitgezogen.",
      countries:
        "Jede Fahne nennt jetzt ihr Land in deiner Sprache, in der Liste der Mitwirkenden, in der oberen Leiste und in der Länderauswahl.",
      home: "Die Zahlen auf der Startseite bewegen sich jetzt von selbst: gesetzte Teile, Mitwirkende und die letzten Aktivitäten aktualisieren sich, während die Seite offen bleibt.",
      fixes:
        "Fehlerbehebungen: Das Referenzfoto hindert das Board nicht mehr daran, den gerade angesehenen Bereich zu laden, ein Klick bei weit herausgezoomter Ansicht verschiebt die Ansicht statt ein Teil zu greifen, der Rand des Boards stoppt die Kamera dort, wo er sichtbar wird, und die obere Leiste auf dem Handy zeigt dein Pseudonym und den vollständigen Zählerstand.",
    },
    v120: {
      panels: "Jedes Panel hat jetzt seinen eigenen Schalter im Bereich Anzeige in diesem Menü.",
      overview:
        "Die vergrößerte Ansicht der Übersicht wurde überarbeitet: Sie öffnet jetzt dieselbe Karte, einfach größer.",
      notes:
        "Ein Punkt am Einstellungen-Knopf zeigt dir, dass Versionshinweise da sind, die du noch nicht gelesen hast.",
      fixes:
        "Fehlerbehebungen: Ein Teil, das du auf eine Fahne in einem Bereich ziehst, den du in dieser Sitzung nicht besucht hast, stapelt sich nicht mehr auf der Fahne, dazu festgesetzte Teile auf einer Kachelgrenze und der Fortschritt auf der Startseite.",
    },
    v111: {
      fixes:
        "Fehlerbehebungen und Performance-Verbesserungen, rund um Zoom, die Cursor der anderen Spieler, die Fahnen und das Referenzbild.",
    },
    v110: {
      flags:
        "Persönliche Fahnen: Setze bis zu 8 Marker auf das Board und springe per Klick oder mit den Tasten 1 bis 8 zwischen ihnen.",
      flagDrop:
        "Schick ein Teil quer über das Board, indem du es auf eine Fahne in der unteren Leiste ziehst, ohne die Stelle zu verlassen, an der du arbeitest.",
      underlay:
        "Zeig das Originalfoto schwach unter dem Board an, über den Bereich Anzeige in diesem Menü.",
      standings:
        "Die Liste der Mitwirkenden bewegt sich bei jedem Zusammenfügen, nicht mehr nur beim Einrasten am Rahmen. Deine eigene Zeile ist immer sichtbar.",
      account:
        "Die Anmeldung mit Google macht aus deinem Gastkonto ein dauerhaftes Konto, das du auch von einem anderen Browser aus wieder erreichst.",
      maintenance:
        "Ein Neustart des Servers zeigt einen Wartungshinweis statt eines Verbindungsfehlers und kommt von selbst zurück, sobald das Puzzle wieder da ist.",
      mobile:
        "Auf dem Handy behält die Oberfläche nur die Referenz und die Übersicht und überlässt dem Board den Bildschirm.",
      help: "Dieses Menü enthält Tipps, und die Liste der Mitwirkenden erklärt, wie Teile gezählt werden.",
    },
    v100: {
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
      "Wähle ein neues Land. Seine Flagge wird in der Liste der Mitwirkenden neben deinem Pseudonym angezeigt.",
    ledeNew:
      "Wähle dein Land. Seine Flagge wird in der Liste der Mitwirkenden neben deinem Pseudonym angezeigt.",
    selectLabel: "Land",
    selectPlaceholder: "Wähle dein Land...",
    international: "International",
    noCountry: "kein Land ausgewählt",
    cooldownHint: "Du kannst dein Land nur alle {hours} Stunden ändern.",
    cooldown: "Du hast dein Land bereits vor Kurzem geändert. Versuch es in {hours} Std. erneut.",
  },
  contributors: {
    title: "Mitwirkende",
    empty: "Noch keine Beiträge.",
    full: "ganze Liste",
    all: "Alle Mitwirkenden",
    viewMode: "Ansichtsmodus",
    people: "Personen",
    countries: "Länder",
    prev: "zurück",
    next: "weiter",
    pcs: "Tle",
    you: "du",
    online: "online",
  },
  scoring: {
    open: "Wie Teile gezählt werden",
    title: "Wie Teile gezählt werden",
    lede: "Jedes Teil auf dem Brett wird einmal gezählt, für die erste Person, die es einrastet.",
    snapTwo:
      "Du rastest zwei lose Teile zusammen: das zählt ein Teil, nicht zwei. Das andere bleibt für die Person zurückgelegt, die diesen Verbund im Brett verriegelt.",
    snapCluster:
      "Du ziehst einen 30-Teile-Verbund auf einen anderen: die 29 bereits gezählten zählen nicht doppelt, du bekommst das eine, das noch nie jemand eingerastet hat.",
    mismatchTitle: "Warum das nicht zum Fortschrittsbalken passt",
    mismatchBody:
      "Die Liste der Mitwirkenden zählt ein Teil in dem Moment, in dem es einrastet, egal wo auf dem Brett. Der Fortschrittsbalken zählt nur die Teile, die an ihrem endgültigen Platz verriegelt sind: die beiden Zahlen sollen gar nicht gleich sein.",
    fairTitle: "Am Ende geht es auf",
    fairBody:
      "Dieses System sorgt dafür, dass jedes Teil genau einmal gezählt wird. Und dafür, dass die Zählungen genau {total} Teile ergeben, sobald das letzte Teil gesetzt ist.",
  },
  activity: {
    title: "Aktivität",
    empty: "Noch keine Aktivität.",
    placedLine: "hat {object} platziert",
    connectedLine: "hat {object} verbunden",
    you: "Du",
    youPlacedLine: "hast {object} platziert",
    youConnectedLine: "hast {object} verbunden",
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
    topContributors: "Mitwirkende",
    summary: "Zusammenfassung",
    hideSummary: "Zusammenfassung ausblenden",
    showSummary: "Zusammenfassung anzeigen",
  },
  toast: {
    tileFull: "Zu viele Teile auf diesem Feld.",
    snapCovered: "Dieses Teil ist verdeckt: Räume zuerst die Teile darüber weg.",
    carryFull: "Du kannst nicht mehr als {n} Teile auf einmal halten.",
  },
  carry: {
    hint: "Teil in der Hand. Doppelklicke oder tippe zweimal zum Ablegen, Esc zum Zurücklegen. | {n} von {max} Teilen in der Hand. Doppelklicke, um alle abzulegen, Esc zum Zurücklegen.",
  },
  bookmarks: {
    title: "Lesezeichen",
    newTitle: "Neues Lesezeichen",
    count: "{n} Lesezeichen | {n} Lesezeichen",
    filter: "Nach Name filtern",
    empty: "Noch keine Lesezeichen.",
    noMatch: "Kein Lesezeichen mit diesem Namen.",
    add: "Lesezeichen anlegen",
    import: "Link einfügen",
    importTitle: "Lesezeichen-Link einfügen",
    importLede:
      "Füge den Lesezeichen-Link ein, den dir jemand geschickt hat, und behalte es in deinem Notizbuch.",
    importLabel: "Lesezeichen-Link",
    importPlaceholder: "Link hier einfügen",
    importAction: "Öffnen",
    importBad: "Dieser Link trägt kein Lesezeichen. Kopiere die ganze Zeile, die du bekommen hast.",
    full: "Dein Notizbuch ist mit {max} Lesezeichen voll. Lösche eines, um ein neues anzulegen.",
    pickSpot:
      "Klicke auf dem Spielfeld dorthin, wo das Lesezeichen sein soll. Der Bildausschnitt unter dem Zeiger wird sein Bildchen.",
    pickPiece: "Klicke ein Teil auf dem Spielfeld an. Dieses Teil steht dann für das Lesezeichen.",
    nameSpot: "Benenne dieses Lesezeichen.",
    sharedTitle: "Ein Lesezeichen, das dir jemand geschickt hat",
    sharedLede:
      "Behalte dieses Lesezeichen in deinem Notizbuch, unter diesem Namen oder deinem eigenen.",
    badgeKind: "Bildchen",
    badgeKindArea: "Ein Ausschnitt",
    badgeKindPiece: "Ein Teil",
    badgeSize: "Größe",
    badgeSizePieces: "{n} Teil | {n} Teile",
    badgeSizeWheel: "Mit dem Mausrad über dem Brett änderst du die Größe des Quadrats.",
    nothingHere: "Hier ist kein Bild. Ziele ins Bild hinein.",
    noPieceHere:
      "Hier ist kein Teil. Klicke eines an, das das Spielfeld zeigt, oder nimm einen Ausschnitt.",
    nameLabel: "Name des Lesezeichens",
    namePlaceholder: "dieses Lesezeichen benennen",
    needName: "Benenne dieses Lesezeichen, bevor du es speicherst.",
    needBadge: "Wähle ein Bildchen, bevor du speicherst.",
    goTo: "Zu {name}",
    favorite: "{name} zu deinen Favoriten hinzufügen",
    unfavorite: "{name} aus deinen Favoriten entfernen",
    copyLink: "Link zu {name} kopieren",
    copied: "Link kopiert",
    copyFailed: "Dein Browser hat das Kopieren des Links nicht zugelassen.",
    delete: "{name} löschen",
    tag: "Tag",
    tags: "Tags",
    tagAll: "Alle",
    tagUntagged: "Ohne Tag",
    viewEmpty: "Hier ist kein Lesezeichen.",
    tagsTitle: "Tags",
    tagsLede: "Wähl die Tags für {name}.",
    tagsDraftLede: "Wähl die Tags für dieses Lesezeichen.",
    tagsPick: "Tags wählen",
    tagsNoneYet: "noch keine",
    tagsNone: "Noch keine Tags. Tipp ein Wort und leg es an.",
    tagNoMatch: "Kein Tag passt dazu.",
    tagPlaceholder: "Tag suchen oder anlegen",
    tagNew: "Name des Tags",
    tagCreate: "Anlegen",
    tagNeedName: "Benenne den Tag, bevor du ihn anlegst.",
    tagWorn: "Dieses Lesezeichen hat diesen Tag schon.",
    tagsFull: "Ein Lesezeichen trägt {max} Tags. Nimm einen weg, um einen neuen zu setzen.",
    tagsOf: "Tags von {name}",
    backToList: "Zurück zur Liste",
    backToEntry: "Zurück zum Lesezeichen",
    hintFavorite: "Zu Favoriten hinzufügen",
    hintUnfavorite: "Aus Favoriten entfernen",
    hintTags: "Tags",
    hintCopyLink: "Link kopieren",
    hintDelete: "Löschen",
    prev: "zurück",
    next: "weiter",
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
      "Der Eintritt ins Spielfeld legt ein Gastkonto an: eine eindeutige Benutzerkennung, das von dir gewählte Pseudonym und das beim Onboarding ausgewählte Land, ohne dass eine E-Mail-Adresse erforderlich ist. Wenn du dich mit Google anmeldest, um deine Beiträge unter einer einzigen Identität zu behalten, werden auch deine E-Mail-Adresse und dein Name von Google gespeichert. Deine Beiträge (welche Teile du platziert hast und wann) werden erfasst und für den Aktivitäts-Feed und die Liste der Mitwirkenden öffentlich angezeigt. Technische Protokolle (IP-Adresse, Browser) werden vom Hoster aus Gründen der Sicherheit und Zuverlässigkeit verarbeitet.",
    purposesHead: "Zwecke",
    purposesBody:
      "Die Daten werden ausschließlich zum Betrieb des Spiels verwendet: um dich zu authentifizieren, deinen Fortschritt zu speichern, platzierte Teile zuzuordnen und die Liste der Mitwirkenden anzuzeigen. Es werden keine Daten verkauft oder für Werbung verwendet.",
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
