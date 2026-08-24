import type { MessageSchema } from "./en";

const fr: MessageSchema = {
  common: {
    save: "Enregistrer",
    saving: "Enregistrement...",
    close: "Fermer",
    skip: "Passer",
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
    tagline: "Un million de pièces sur un seul plateau partagé.",
    enterBoard: "Rejoindre le plateau",
    interested: "Ça m'intéresse",
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
    puzzleProgress: "Progression du puzzle",
    nationalityTitle: "Nationalité : {code}",
    signedInAs: "Connecté en tant que {pseudo}",
    options: "Paramètres",
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
    credits: "Voir les crédits de l'image",
  },
  minimap: {
    overview: "Aperçu",
    online: "{n} en ligne",
    label: "Mini-carte",
    openDetail: "Ouvrir la vue détaillée des cases",
    detailTitle: "Détail du chargement des cases",
    legendLoaded: "Chargée",
    legendLoading: "En chargement",
    legendNotLoaded: "Non chargée",
    tilesLoaded: "{loaded} / {total} cases chargées",
    memoryUsage: "{used} / {budget}",
  },
  auth: {
    title: "Synchroniser votre compte",
    lede: "Connectez-vous avec Google pour conserver vos contributions de façon permanente et les réunir sous un seul compte.",
    continueGoogle: "Continuer avec Google",
    switchTitle: "Ce compte Google a déjà un profil",
    switchLede:
      "Il appartient déjà à un autre profil du puzzle. Récupérez-le, les pièces posées ici vous suivent.",
    switchAction: "Récupérer mon compte",
    signInFailed: "La connexion n'a pas abouti. Réessayez.",
  },
  options: {
    title: "Paramètres",
    account: "Compte",
    sync: "Synchroniser le compte",
    syncHint: "Connectez-vous avec Google pour conserver vos contributions de façon permanente.",
    synced: "Compte synchronisé avec Google",
    changePseudo: "Changer de pseudo",
    changeCountry: "Changer de pays",
    discord: "Rejoindre le serveur Discord",
    display: {
      title: "Affichage",
      underlay: "Image de référence en fond",
      underlayHint: "Affiche l'image de référence en transparence sous le plateau.",
    },
    signOut: "Se déconnecter",
  },
  tips: {
    title: "Astuces",
    prev: "Astuce précédente",
    next: "Astuce suivante",
    carry:
      "Double-cliquez sur une pièce pour la coller à votre curseur, double-cliquez à nouveau pour la déposer.",
    flags: "Utilisez les drapeaux pour vous déplacer facilement sur le plateau.",
    minimap: "Cliquez n'importe où sur la mini-carte pour y déplacer la vue.",
    reference: "Ouvrez l'image de référence et zoomez pour trouver où va une pièce.",
  },
  pseudo: {
    haveAccount: "Vous avez déjà un compte ? Se connecter",
    titleEdit: "Changer de pseudo",
    titleNew: "Choisissez votre pseudo",
    ledeEdit:
      "Choisissez un nouveau pseudo. Il est affiché aux autres joueurs à côté des pièces que vous placez.",
    ledeNew:
      "Choisissez un pseudo avant de commencer à placer des pièces. Il est affiché aux autres joueurs.",
    placeholder: "votre pseudo",
    fieldLabel: "Pseudo",
    hint: "{min} à {max} caractères : lettres, chiffres, espaces, traits d'union, tirets bas et #.",
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
  scoring: {
    open: "Comment les pièces sont comptées",
    title: "Comment les pièces sont comptées",
    lede: "Chaque pièce du plateau vaut un point. Il est crédité une seule fois, au premier joueur qui l'emboîte.",
    snapTwo:
      "Vous emboîtez deux pièces libres : un point, pas deux. Le point de l'autre pièce est mis de côté pour celui qui verrouillera ce groupe dans le plateau.",
    snapCluster:
      "Vous glissez un groupe de 30 pièces sur un autre : les 29 déjà créditées ne comptent pas deux fois, vous prenez celle que personne n'avait jamais emboîtée.",
    mismatchTitle: "Pourquoi le total ne colle pas à la barre de progression",
    mismatchBody:
      "Le classement crédite une pièce dès qu'elle s'emboîte, où qu'elle soit sur le plateau. La barre de progression ne compte que les pièces verrouillées à leur place définitive : les deux nombres n'ont pas vocation à être égaux.",
    fairTitle: "Le compte tombe juste",
    fairBody:
      "Ce système permet de garder un classement équitable. Il permettra aussi, quand la dernière pièce sera posée, de comptabiliser exactement {total} pièces.",
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
    errorProtocol: "Cette page utilise une ancienne version. Rechargez-la pour continuer.",
    errorManifest:
      "Impossible de charger les données du puzzle. Vérifiez votre connexion et rechargez la page.",
    errorQueue: "Impossible de rejoindre la file d'attente. Vérifiez votre connexion et réessayez.",
    errorConnection: "Connexion perdue. Rechargez la page pour revenir dans la partie.",
    stepConnect: "Connexion",
    stepBuild: "Construction",
    stepTextures: "Textures",
    stepReady: "Prêt",
    headConnect: "Connexion au serveur",
    headBuild: "Construction du plateau",
    headTextures: "Chargement des textures",
    headReady: "Prêt",
    tip: "Astuce : double-cliquez ou tapez deux fois sur une pièce pour la coller à votre curseur, puis recommencez pour la déposer.",
  },
  queue: {
    kicker: "Bientôt à vous",
    heading: "Vous êtes dans la file",
    position: "Position {n} dans la file",
    waiting: "En attente d'une place libre",
  },
  maintenance: {
    kicker: "Maintenance",
    heading: "Le puzzle est indisponible",
    body: "Le plateau n'est pas joignable pour le moment. Il devrait revenir dans quelques minutes.",
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
  },
  carry: {
    hint: "Pièce en main. Double-cliquez ou tapez deux fois pour la déposer, Échap pour la remettre.",
  },
  flags: {
    bar: "Drapeaux personnels",
    add: "Ajouter un drapeau au centre de la vue",
    goTo: "Aller au drapeau {n} (touche {n})",
    options: "Options du drapeau {n}",
    delete: "Supprimer",
    colors: {
      red: "Rouge",
      orange: "Orange",
      green: "Vert",
      blue: "Bleu",
      purple: "Violet",
      pink: "Rose",
      white: "Blanc",
      black: "Noir",
    },
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
      "Million Piece Puzzle est un projet collaboratif et non commercial lancé par un développeur indépendant. Cette page explique quelles données sont collectées, pourquoi, et comment exercer vos droits.",
    controllerHead: "Responsable du traitement",
    controllerBody:
      "Le service est exploité par un développeur indépendant, joignable sur notre {discord}.",
    discord: "serveur Discord",
    collectedHead: "Données collectées",
    collectedBody:
      "Rejoindre le plateau crée un compte invité : un identifiant utilisateur unique, le pseudo que vous choisissez et le pays que vous sélectionnez lors de l'inscription, sans adresse e-mail requise. Si vous vous connectez avec Google pour conserver vos contributions sous une seule identité, votre adresse e-mail et votre nom Google sont également enregistrés. Vos contributions (les pièces que vous avez placées et à quel moment) sont enregistrées et affichées publiquement dans le fil d'activité et le classement. Les journaux techniques (adresse IP, navigateur) sont traités par l'hébergeur à des fins de sécurité et de fiabilité.",
    purposesHead: "Finalités",
    purposesBody:
      "Les données ne servent qu'à faire fonctionner le jeu : vous authentifier, sauvegarder votre progression, attribuer les pièces placées et afficher le classement. Aucune donnée n'est vendue ni utilisée à des fins publicitaires.",
    processorsHead: "Sous-traitants",
    processorsBody:
      "Le service s'appuie sur Google (connexion), Cloudflare (hébergement du frontend, stockage et diffusion des ressources) et OVH (le serveur hébergeant le backend du jeu, y compris ses statistiques auto-hébergées). Ces prestataires peuvent traiter des données en dehors de l'Union européenne, dans le cadre de leurs propres dispositifs de protection. Aucun service tiers de suivi ou d'analyse n'est utilisé.",
    retentionHead: "Conservation et vos droits",
    retentionBody:
      "Vos données sont conservées tant que votre compte existe. En vertu du RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données, ainsi que d'un droit d'opposition. Pour les exercer, ou pour demander la suppression à tout moment, contactez l'exploitant aux coordonnées ci-dessus.",
    cookiesHead: "Cookies et statistiques",
    cookiesBody:
      "Le site n'utilise que les cookies et le stockage local nécessaires à la connexion et à vos préférences ; aucun cookie publicitaire ou de mesure d'audience n'est déposé. Le trafic sur le plateau du puzzle est mesuré avec Umami, un outil de statistiques auto-hébergé sur notre propre serveur : il ne dépose aucun cookie et ne conserve jamais votre adresse IP, identifiant une visite uniquement par un hachage de votre adresse IP, de votre navigateur et de ce site, dont le sel cryptographique est renouvelé chaque mois afin qu'il ne puisse ni vous être associé ni servir à vous suivre sur d'autres sites.",
  },
  legalPage: {
    title: "Mentions légales",
    publisherHead: "Éditeur",
    publisherBody:
      "Ce site est un projet collaboratif lancé par un développeur indépendant. Contact : notre {discord}.",
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
    creditsHead: "Crédits image",
    creditsBody:
      "Les photos utilisées proviennent toutes d'{unsplash}, des photographies non générées par IA. L'algorithme de la mosaïque est inspiré du projet open source {photomosaic}.",
    unsplash: "Unsplash",
    photomosaic: "photomosaic",
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
