const en = {
  common: {
    save: "Save",
    saving: "Saving...",
    close: "Close",
    skip: "Skip",
    leaderboard: "Leaderboard",
    activity: "Activity",
    noActivity: "No activity yet.",
    noStandings: "No standings yet.",
    saveError: "Could not save, try again.",
    fullBoard: "full board",
  },
  time: {
    justNow: "just now",
    secondsAgo: "{n}s ago",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
  },
  units: { d: "d", h: "h", m: "m" },
  langSwitcher: { label: "Choose language" },
  landing: {
    tagline: "One million pieces on a single shared board.",
    enterBoard: "Join the board",
    interested: "I'm interested",
    beFirst: "Be the first to follow along",
    interestCount: "{n} person interested | {n} people interested",
    piecesLockedSuffix: "/ {n} pieces locked",
    pctComplete: "{p}% complete",
    completed: "COMPLETED",
    solvedIn: "solved in {duration}",
    liveActivity: "Live activity",
    noStandingsFinal: "No standings recorded.",
    someone: "Someone",
    placed: "placed {pieces}",
    connected: "connected {pieces}",
    pieces: "a piece | {n} pieces",
  },
  countdown: {
    launchingSoon: "Launching soon",
    days: "Days",
    hours: "Hours",
    minutes: "Minutes",
    seconds: "Seconds",
  },
  footer: {
    privacy: "Privacy",
    legal: "Legal notice",
  },
  play: {
    stage: "Puzzle stage",
  },
  topbar: {
    puzzleProgress: "Puzzle progress",
    nationalityTitle: "Nationality: {code}",
    signedInAs: "Signed in as {pseudo}",
    options: "Settings",
  },
  zoom: {
    in: "Zoom in",
    out: "Zoom out",
    center: "Center on puzzle",
    fit: "Fit puzzle to view",
  },
  reference: {
    title: "Reference",
    openEnlarged: "Open enlarged reference",
    image: "Reference image",
    fitToView: "Fit to view",
    credits: "View image credits",
  },
  minimap: {
    overview: "Overview",
    online: "{n} online",
    label: "Minimap",
    openDetail: "Open tile detail view",
    detailTitle: "Tile load detail",
    legendLoaded: "Loaded",
    legendLoading: "Loading",
    legendNotLoaded: "Not loaded",
    tilesLoaded: "{loaded} / {total} tiles loaded",
    memoryUsage: "{used} / {budget}",
  },
  auth: {
    title: "Sync your account",
    lede: "Sign in with Google to save your contributions permanently and keep them under one account.",
    continueGoogle: "Continue with Google",
    switchTitle: "This Google account has a profile",
    switchLede:
      "It already belongs to another builder profile. Recover it, and the pieces you placed here come with you.",
    switchAction: "Recover my account",
    signInFailed: "Sign-in did not go through. Try again.",
  },
  options: {
    title: "Settings",
    account: "Account",
    sync: "Sync account",
    syncHint: "Sign in with Google to save your contributions permanently.",
    synced: "Synced with Google",
    changePseudo: "Change pseudo",
    changeCountry: "Change country",
    discord: "Join the Discord server",
    updates: "Update notes",
    display: {
      title: "Display",
      underlay: "Reference underlay",
      underlayHint: "Show the reference image faintly under the board.",
      panel: {
        reference: "Reference",
        zoom: "Zoom",
        activity: "Activity",
        leaderboard: "Leaderboard",
        minimap: "Minimap",
        flags: "Flags",
      },
    },
    signOut: "Sign out",
  },
  tips: {
    title: "Tips",
    prev: "Previous tip",
    next: "Next tip",
    carry: "Double-click a piece to stick it to your cursor, double-click again to drop it.",
    flags: "Use flags to easily move around the canvas.",
    flagDrop: "Drag a piece onto a flag in the bar to send it over there.",
    minimap: "Click anywhere on the minimap to move the view there.",
    reference: "Open the reference image and zoom in to find where a piece belongs.",
  },
  updates: {
    title: "Update notes",
    v111: {
      fixes:
        "Bug fixes and performance improvements, around zoom, other players' cursors, flags and the reference photo.",
    },
    v11: {
      flags:
        "Personal flags: drop up to 8 markers on the board and jump between them with a click or the 1 to 8 keys.",
      flagDrop:
        "Send a piece across the board by dropping it onto a flag in the bottom bar, without leaving the spot you are working on.",
      underlay:
        "Show the source photo faintly under the board, from the Display section of this menu.",
      standings:
        "The standings move on every snap, not only when a cluster locks onto the frame, and your own row is always shown.",
      account:
        "Signing in with Google turns your guest into a permanent account, and you can sign back into it from another browser.",
      maintenance:
        "A server restart shows a maintenance screen instead of a connection error, and comes back on its own once the puzzle is up again.",
      mobile:
        "On a phone the interface keeps only the reference and the minimap, and leaves the screen to the board.",
      help: "This menu carries tips, and the leaderboard explains how points are counted.",
    },
    v10: {
      launch:
        "Public launch: 1,000,000 unique pieces on a single shared board, playable as a guest with no sign-up, in English, French, Spanish and German.",
    },
  },
  pseudo: {
    haveAccount: "Already have an account? Sign in",
    titleEdit: "Change your pseudo",
    titleNew: "Choose your pseudo",
    ledeEdit: "Pick a new pseudo. It is shown to other builders next to the pieces you place.",
    ledeNew: "Pick a pseudo before you start placing pieces. It is shown to other builders.",
    placeholder: "your pseudo",
    fieldLabel: "Pseudo",
    hint: "{min} to {max} characters: letters, digits, spaces, hyphens, underscores and #.",
    taken: "That pseudo is already taken.",
    cooldownHint: "You can change your pseudo once every {hours} hours.",
    cooldown: "You already changed your pseudo recently. Try again in {hours}h.",
  },
  nationality: {
    titleEdit: "Change your nationality",
    titleNew: "Choose your nationality",
    ledeEdit: "Pick a new country. Its flag is shown next to your pseudo in the leaderboard.",
    ledeNew: "Pick your country. Its flag is shown next to your pseudo in the leaderboard.",
    selectLabel: "Country",
    selectPlaceholder: "Select your country...",
    international: "International",
    noCountry: "no country selected",
    cooldownHint: "You can change your country once every {hours} hours.",
    cooldown: "You already changed your country recently. Try again in {hours}h.",
  },
  leaderboardModal: {
    label: "Full leaderboard",
    rankingMode: "Ranking mode",
    people: "People",
    countries: "Countries",
    prev: "prev",
    next: "next",
  },
  scoring: {
    open: "How pieces are counted",
    title: "How pieces are counted",
    lede: "Every piece on the board is worth one point. It is credited once, to the first player who snaps it into place.",
    snapTwo:
      "You snap two loose pieces together: one point, not two. The other piece's point is set aside for whoever locks that cluster into the board.",
    snapCluster:
      "You drag a 30-piece cluster onto another one: the 29 already credited do not count twice, so you take the one nobody had ever snapped.",
    mismatchTitle: "Why it does not match the progress bar",
    mismatchBody:
      "The leaderboard credits a piece the moment it snaps, anywhere on the board. The progress bar counts only the pieces locked into their final place: the two numbers are not meant to be equal.",
    fairTitle: "It adds up",
    fairBody:
      "This is what keeps the standings fair. It also means that, once the last piece is placed, they add up to exactly {total} pieces.",
  },
  activityPanel: {
    placedLine: "placed {object}",
    connectedLine: "connected {object}",
    piece: "a piece",
    twoPieces: "two pieces together",
    cluster: "{article} {n}-piece cluster",
  },
  loading: {
    error: "Error",
    loading: "Loading",
    couldNotLoad: "Could not load the puzzle",
    errorProtocol: "This page is running an old version. Reload it to continue.",
    errorManifest: "Could not load the puzzle data. Check your connection and reload.",
    errorQueue: "Could not join the queue. Check your connection and try again.",
    errorConnection: "Connection lost. Reload the page to rejoin.",
    stepConnect: "Connect",
    stepBuild: "Build",
    stepTextures: "Textures",
    stepReady: "Ready",
    headConnect: "Connecting to server",
    headBuild: "Building the board",
    headTextures: "Loading textures",
    headReady: "Ready",
    tip: "Tip: double-click or double-tap a piece to stick it to your cursor, then do it again to drop it.",
  },
  queue: {
    kicker: "Almost in",
    heading: "You're in line",
    position: "Position {n} in line",
    waiting: "Waiting for an open slot",
  },
  maintenance: {
    kicker: "Maintenance",
    heading: "The puzzle is unavailable",
    body: "The board is not reachable right now. It should be back in a few minutes.",
  },
  completion: {
    complete: "Complete",
    assembled: "Puzzle assembled.",
    piecesPlaced: "{n} piece placed. | {n} pieces placed.",
    topContributors: "Top contributors",
    summary: "Summary",
    hideSummary: "Hide summary",
    showSummary: "Show summary",
  },
  toast: {
    tileFull: "Too many pieces on this tile.",
  },
  carry: {
    hint: "Holding a piece. Double-click or double-tap to drop it, Esc to put it back.",
  },
  flags: {
    bar: "Personal flags",
    add: "Add a flag at the center of the view",
    goTo: "Go to flag {n} (key {n})",
    options: "Flag {n} options",
    delete: "Delete",
    colors: {
      red: "Red",
      orange: "Orange",
      green: "Green",
      blue: "Blue",
      purple: "Purple",
      pink: "Pink",
      white: "White",
      black: "Black",
    },
  },
  row: {
    pcs: "pcs",
    you: "you",
    online: "online",
  },
  legalDoc: {
    back: "Back to home",
    updated: "Last updated: {date}",
  },
  privacyPage: {
    title: "Privacy Policy",
    intro:
      "Million Piece Puzzle is a collaborative, non-commercial project initiated by an independent developer. This page explains what data is collected, why, and how to exercise your rights.",
    controllerHead: "Data controller",
    controllerBody:
      "The service is operated by an independent developer, reachable on our {discord}.",
    discord: "Discord server",
    collectedHead: "Data collected",
    collectedBody:
      "Joining the board creates a guest account: a unique user identifier, the pseudo you choose, and the country you select during onboarding, no email required. If you sign in with Google to keep your contributions under one identity, your email address and your name from Google are also stored. Your contributions (which pieces you placed and when) are recorded and shown publicly for the activity feed and the leaderboard. Technical logs (IP address, browser) are processed by the host for security and reliability.",
    purposesHead: "Purposes",
    purposesBody:
      "Data is used only to run the game: to authenticate you, save your progress, attribute placed pieces, and display the leaderboard. No data is sold or used for advertising.",
    processorsHead: "Sub-processors",
    processorsBody:
      "The service relies on Google (sign-in), Cloudflare (frontend hosting, asset storage and delivery) and OVH (the server hosting the game backend, including its self-hosted analytics). These providers may process data outside the European Union under their own protection frameworks. No third-party tracking or analytics service is used.",
    retentionHead: "Retention and your rights",
    retentionBody:
      "Your data is kept for as long as your account exists. Under the GDPR you have a right of access, rectification, erasure and portability of your data, as well as a right to object. To exercise them, or to request deletion at any time, contact the operator using the details above.",
    cookiesHead: "Cookies and analytics",
    cookiesBody:
      "The site only uses the cookies and local storage necessary for sign-in and for your preferences; no advertising or audience-measurement cookies are set. Traffic on the puzzle canvas is measured with Umami, a self-hosted analytics tool running on our own server: it sets no cookies and never stores your IP address, identifying a visit only through a hash of your IP, browser, and this site that is re-salted every month so it cannot be linked back to you or tracked across other sites.",
  },
  legalPage: {
    title: "Legal Notice",
    publisherHead: "Publisher",
    publisherBody:
      "This site is a collaborative project initiated by an independent developer. Contact: our {discord}.",
    discord: "Discord server",
    hostHead: "Host",
    hostBody:
      "The frontend is hosted by Cloudflare, Inc. (101 Townsend Street, San Francisco, CA 94107, USA) on Cloudflare Pages. The game backend is hosted on a server provided by OVH SAS (2 rue Kellermann, 59100 Roubaix, France).",
    natureHead: "Nature of the project",
    natureBody:
      "Million Piece Puzzle is a non-commercial project. It generates no revenue, contains no advertising and offers no paid content.",
    ipHead: "Intellectual property",
    ipBody:
      "Million Piece Puzzle is open source. The source code is published under the MIT license and available on the {repo}. The puzzle artwork and other visuals belong to their respective authors and are credited where applicable.",
    repo: "project repository",
    creditsHead: "Image credits",
    creditsBody:
      "Every photo comes from {unsplash}, photography, not AI-generated. The mosaic algorithm is inspired by the open-source {photomosaic} project.",
    unsplash: "Unsplash",
    photomosaic: "photomosaic",
    liabilityHead: "Liability",
    liabilityBody:
      'Million Piece Puzzle is provided "as is", without any warranty. The publisher cannot be held responsible for service interruptions, data loss or any damage resulting from use of the site.',
    licensesHead: "Open-source licenses",
    licensesBody:
      "The site is built with open-source libraries that remain the property of their respective authors, used here under their licenses: Vue and Vue Router (MIT), PixiJS (MIT) and OpenSeadragon (BSD-3-Clause). The complete dependency tree and the full text of each license are available in the {sourceRepo}.",
    sourceRepo: "source repository",
  },
};

export default en;
export type MessageSchema = typeof en;
