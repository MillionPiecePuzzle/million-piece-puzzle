import type { MessageSchema } from "./en";

const fr: MessageSchema = {
  common: {
    save: "Enregistrer",
    saving: "Enregistrement...",
    close: "Fermer",
    leaderboard: "Classement",
    activity: "Activité",
    noActivity: "Aucune activité pour l'instant.",
    noStandings: "Aucun classement pour l'instant.",
    saveError: "Impossible d'enregistrer, réessayez.",
    fullBoard: "tableau complet",
  },
  time: {
    justNow: "à l'instant",
    secondsAgo: "il y a {n} s",
    minutesAgo: "il y a {n} min",
    hoursAgo: "il y a {n} h",
    daysAgo: "il y a {n} j",
  },
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
    noStandingsFinal: "Aucun classement enregistré.",
    someone: "Quelqu'un",
    placed: "a placé {pieces}",
    connected: "a relié {pieces}",
    pieces: "une pièce | {n} pièces",
  },
  countdown: {
    launchingSoon: "Lancement imminent",
    days: "Jours",
    hours: "Heures",
    minutes: "Minutes",
    seconds: "Secondes",
  },
  footer: {
    privacy: "Confidentialité",
    legal: "Mentions légales",
  },
  play: {
    stage: "Plateau du puzzle",
  },
  topbar: {
    playTime: "Temps de jeu",
    puzzleProgress: "Progression du puzzle",
    nationalityTitle: "Nationalité : {code}",
    signedInAs: "Connecté en tant que {pseudo}",
    options: "Options du compte",
  },
  zoom: {
    in: "Zoom avant",
    out: "Zoom arrière",
    center: "Centrer sur le puzzle",
    fit: "Ajuster le puzzle à la vue",
  },
  reference: {
    title: "Référence",
    openEnlarged: "Ouvrir la référence agrandie",
    image: "Image de référence",
    fitToView: "Ajuster à la vue",
  },
  minimap: {
    overview: "Aperçu",
    label: "Mini-carte",
    openDetail: "Ouvrir la vue détaillée des cases",
    detailTitle: "Détail du chargement des cases",
    legendLoaded: "Chargée",
    legendLoading: "En chargement",
    legendNotLoaded: "Non chargée",
    tilesLoaded: "{loaded} / {total} cases chargées",
    memoryUsage: "{used} / {budget}",
    pinnedCount: "{pinned} / {cap} épinglées",
    pinHint: "Cliquez sur une case pour l'épingler. Glissez pour déplacer la vue, molette pour zoomer.",
    unpinAll: "Tout désépingler",
  },
  auth: {
    title: "Synchroniser votre compte",
    lede: "Connectez-vous avec Google pour conserver vos contributions de façon permanente et les réunir sous un seul compte.",
    continueGoogle: "Continuer avec Google",
  },
  options: {
    title: "Compte",
    sync: "Synchroniser le compte",
    syncHint: "Connectez-vous avec Google pour conserver vos contributions de façon permanente.",
    changePseudo: "Changer de pseudo",
    changeCountry: "Changer de pays",
    display: "Affichage",
    dynamicLoading: "Chargement dynamique",
    dynamicLoadingHint:
      "Désactivé, seules les pièces verrouillées et les cases épinglées se chargent. Épinglez une case depuis le canevas pour continuer à la charger.",
    signOut: "Se déconnecter",
  },
  pseudo: {
    titleEdit: "Changer de pseudo",
    titleNew: "Choisissez votre pseudo",
    ledeEdit:
      "Choisissez un nouveau pseudo. Il est affiché aux autres joueurs à côté des pièces que vous placez.",
    ledeNew:
      "Choisissez un pseudo avant de commencer à placer des pièces. Il est affiché aux autres joueurs.",
    placeholder: "votre pseudo",
    fieldLabel: "Pseudo",
    hint: "{min} à {max} caractères : lettres, chiffres, espaces, traits d'union et tirets bas.",
    taken: "Ce pseudo est déjà pris.",
    cooldownHint: "Vous pouvez changer de pseudo une fois toutes les {hours} heures.",
    cooldown: "Vous avez déjà changé de pseudo récemment. Réessayez dans {hours} h.",
  },
  nationality: {
    titleEdit: "Changer de nationalité",
    titleNew: "Choisissez votre nationalité",
    ledeEdit:
      "Choisissez un nouveau pays. Son drapeau est affiché à côté de votre pseudo dans le classement.",
    ledeNew:
      "Choisissez votre pays. Son drapeau est affiché à côté de votre pseudo dans le classement.",
    selectLabel: "Pays",
    selectPlaceholder: "Sélectionnez votre pays...",
    international: "International",
    noCountry: "aucun pays sélectionné",
    cooldownHint: "Vous pouvez changer de pays une fois toutes les {hours} heures.",
    cooldown: "Vous avez déjà changé de pays récemment. Réessayez dans {hours} h.",
  },
  leaderboardModal: {
    label: "Classement complet",
    rankingMode: "Mode de classement",
    people: "Personnes",
    countries: "Pays",
    prev: "préc.",
    next: "suiv.",
  },
  activityPanel: {
    placedLine: "a placé {object}",
    connectedLine: "a relié {object}",
    piece: "une pièce",
    twoPieces: "deux pièces ensemble",
    cluster: "un groupe de {n} pièces",
  },
  loading: {
    error: "Erreur",
    loading: "Chargement",
    couldNotLoad: "Impossible de charger le puzzle",
    stepConnect: "Connexion",
    stepManifest: "Manifeste",
    stepBuild: "Construction",
    stepTextures: "Textures",
    stepReady: "Prêt",
    headConnect: "Connexion au serveur",
    headManifest: "Chargement des données du puzzle",
    headBuild: "Construction du plateau",
    headTextures: "Chargement des textures",
    headReady: "Prêt",
    tip: "Astuce : double-cliquez sur une pièce pour la coller à votre curseur, puis double-cliquez à nouveau pour la déposer.",
  },
  queue: {
    kicker: "Bientôt à vous",
    heading: "Vous êtes dans la file",
    position: "Position {n} dans la file",
    waiting: "En attente d'une place libre",
  },
  completion: {
    complete: "Terminé",
    assembled: "Puzzle assemblé.",
    piecesPlaced: "{n} pièce placée. | {n} pièces placées.",
    topContributors: "Meilleurs contributeurs",
    summary: "Récapitulatif",
    hideSummary: "Masquer le récapitulatif",
    showSummary: "Afficher le récapitulatif",
  },
  toast: {
    tileFull: "Trop de pièces sur cette case.",
    pinLimit: "Nombre maximal de cases épinglées atteint.",
  },
  carry: {
    hint: "Pièce en main. Double-cliquez pour la déposer, Échap pour la remettre.",
  },
  row: {
    pcs: "pcs",
    you: "vous",
    online: "en ligne",
  },
  legalDoc: {
    back: "Retour à l'accueil",
    updated: "Dernière mise à jour : {date}",
  },
  privacyPage: {
    title: "Politique de confidentialité",
    intro:
      "Million Piece Puzzle est un projet collaboratif et non commercial lancé par une équipe indépendante. Cette page explique quelles données sont collectées, pourquoi, et comment exercer vos droits.",
    controllerHead: "Responsable du traitement",
    controllerBody:
      "Le service est exploité par une équipe indépendante, joignable sur notre {discord}.",
    discord: "serveur Discord",
    collectedHead: "Données collectées",
    collectedBody:
      "Entrer sur le canevas crée un compte invité : un identifiant utilisateur unique, le pseudo que vous choisissez et le pays que vous sélectionnez lors de l'inscription, sans adresse e-mail requise. Si vous vous connectez avec Google pour conserver vos contributions sous une seule identité, votre adresse e-mail et votre nom Google sont également enregistrés. Vos contributions (les pièces que vous avez placées et à quel moment) sont enregistrées et affichées publiquement dans le fil d'activité et le classement. Les journaux techniques (adresse IP, navigateur) sont traités par l'hébergeur à des fins de sécurité et de fiabilité.",
    purposesHead: "Finalités",
    purposesBody:
      "Les données ne servent qu'à faire fonctionner le jeu : vous authentifier, sauvegarder votre progression, attribuer les pièces placées et afficher le classement. Aucune donnée n'est vendue ni utilisée à des fins publicitaires.",
    processorsHead: "Sous-traitants",
    processorsBody:
      "Le service s'appuie sur Google (connexion), Cloudflare (hébergement du frontend, stockage et diffusion des ressources, et statistiques web respectueuses de la vie privée et sans cookie) et OVH (le serveur hébergeant le backend du jeu). Ces prestataires peuvent traiter des données en dehors de l'Union européenne, dans le cadre de leurs propres dispositifs de protection. Aucun autre service tiers de suivi ou d'analyse n'est utilisé.",
    retentionHead: "Conservation et vos droits",
    retentionBody:
      "Vos données sont conservées tant que votre compte existe. En vertu du RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données, ainsi que d'un droit d'opposition. Pour les exercer, ou pour demander la suppression à tout moment, contactez l'exploitant aux coordonnées ci-dessus.",
    cookiesHead: "Cookies",
    cookiesBody:
      "Le site n'utilise que les cookies et le stockage local nécessaires à la connexion et à vos préférences. Aucun cookie publicitaire ou de mesure d'audience n'est déposé ; les statistiques web utilisées sont sans cookie.",
  },
  legalPage: {
    title: "Mentions légales",
    publisherHead: "Éditeur",
    publisherBody:
      "Ce site est un projet collaboratif lancé par une équipe indépendante. Contact : notre {discord}.",
    discord: "serveur Discord",
    hostHead: "Hébergeur",
    hostBody:
      "Le frontend est hébergé par Cloudflare, Inc. (101 Townsend Street, San Francisco, CA 94107, États-Unis) sur Cloudflare Pages. Le backend du jeu est hébergé sur un serveur fourni par OVH SAS (2 rue Kellermann, 59100 Roubaix, France).",
    natureHead: "Nature du projet",
    natureBody:
      "Million Piece Puzzle est un projet non commercial. Il ne génère aucun revenu, ne contient aucune publicité et ne propose aucun contenu payant.",
    ipHead: "Propriété intellectuelle",
    ipBody:
      "Million Piece Puzzle est open source. Le code source est publié sous licence MIT et disponible sur le {repo}. Les illustrations du puzzle et les autres visuels appartiennent à leurs auteurs respectifs et sont crédités le cas échéant.",
    repo: "dépôt du projet",
    liabilityHead: "Responsabilité",
    liabilityBody:
      "Million Piece Puzzle est fourni « tel quel », sans aucune garantie. L'éditeur ne saurait être tenu responsable des interruptions de service, des pertes de données ou de tout dommage résultant de l'utilisation du site.",
    licensesHead: "Licences open source",
    licensesBody:
      "Le site est construit avec des bibliothèques open source qui restent la propriété de leurs auteurs respectifs, utilisées ici sous leurs licences : Vue et Vue Router (MIT), PixiJS (MIT) et OpenSeadragon (BSD-3-Clause). L'arborescence complète des dépendances et le texte intégral de chaque licence sont disponibles dans le {sourceRepo}.",
    sourceRepo: "dépôt source",
  },
};

export default fr;
