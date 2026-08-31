import type { MessageSchema } from "./en";

const fr: MessageSchema = {
  common: {
    save: "Enregistrer",
    saving: "Enregistrement...",
    close: "Fermer",
    skip: "Passer",
    saveError: "Impossible d'enregistrer, réessayez.",
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
    pctComplete: "{p} terminé",
    completed: "TERMINÉ",
    solvedIn: "résolu en {duration}",
    liveActivity: "Activité en direct",
    noStandingsFinal: "Aucune contribution enregistrée.",
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
    signedInAs: "Connecté en tant que {pseudo}",
    options: "Paramètres",
    optionsNew: "Paramètres, nouvelles notes de mises à jour",
  },
  perfNotice: {
    label: "Performance",
    message: "Le plateau tourne au ralenti sur cet appareil.",
    showTips: "Que faire ?",
    hideTips: "Masquer",
    tipAcceleration:
      "Essayez d'activer ou de désactiver l'accélération matérielle dans les réglages de votre navigateur, puis redémarrez-le.",
    tipTabs: "Fermez les autres onglets et applications qui utilisent la carte graphique.",
    dismiss: "Masquer ce message",
  },
  zoom: {
    in: "Zoom avant",
    out: "Zoom arrière",
    center: "Centrer sur le puzzle",
    fit: "Ajuster le puzzle à la vue",
    position: "Votre position sur le plateau, en pièces depuis son centre",
  },
  reference: {
    title: "Référence",
    openEnlarged: "Ouvrir la référence agrandie",
    image: "Image de référence",
    fitToView: "Ajuster à la vue",
    aim: "Cliquer sur la photo pour y amener le plateau (ou Ctrl-clic à tout moment)",
    credits: "Voir les crédits de l'image",
  },
  overview: {
    title: "Aperçu",
    online: "{n} en ligne",
    enlarge: "Agrandir l'aperçu",
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
    support: "Soutenir le projet ❤️",
    sync: "Synchroniser le compte",
    syncHint: "Connectez-vous avec Google pour conserver vos contributions de façon permanente.",
    synced: "Compte synchronisé avec Google",
    changePseudo: "Changer de pseudo",
    changeCountry: "Changer de pays",
    discord: "Rejoindre le serveur Discord",
    updates: "Notes de mises à jour",
    updatesNew: "Notes de mises à jour, nouveau",
    display: {
      title: "Affichage",
      underlay: "Image de référence en fond",
      underlayHint: "Affiche l'image de référence en transparence sous le plateau.",
      panel: {
        reference: "Référence",
        zoom: "Zoom",
        activity: "Activité",
        contributors: "Contributeurs",
        overview: "Aperçu",
        flags: "Drapeaux",
      },
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
    flagDrop: "Faites glisser une pièce sur un drapeau de la barre pour l'envoyer là-bas.",
    overview: "Cliquez n'importe où sur l'aperçu pour y déplacer la vue.",
    reference:
      "Ouvrez l'image de référence et zoomez pour trouver où va une pièce, puis Ctrl-cliquez dessus pour y amener le plateau.",
  },
  updates: {
    title: "Notes de mises à jour",
    v130: {
      jump: "La vue agrandie de l'aperçu et la photo de référence agrandie déplacent maintenant le plateau : cliquez sur la carte pour vous y rendre, et sur la photo utilisez le bouton en forme de viseur, ou Ctrl-clic, pour amener le plateau sur ce que vous regardez.",
      contributors:
        "Le panneau qui liste les joueurs s'appelle désormais Contributeurs, et les formulations autour ont suivi.",
      countries:
        "Chaque drapeau nomme désormais son pays dans votre langue, dans la liste des contributeurs, dans la barre du haut et dans le sélecteur de pays.",
      home: "Les chiffres de la page d'accueil bougent maintenant tout seuls : les pièces posées, les contributeurs et l'activité récente se mettent à jour pendant que la page reste ouverte.",
      fixes:
        "Corrections de bugs : la photo de référence n'empêche plus le plateau de charger la zone que vous venez de regarder, un clic en zoom très large déplace la vue au lieu d'attraper une pièce, le bord du plateau arrête la caméra là où il devient visible, et la barre du haut sur téléphone affiche votre pseudo et le compte complet.",
    },
    v120: {
      panels:
        "Chaque panneau a désormais son propre interrupteur dans la section Affichage de ce menu.",
      overview:
        "La vue agrandie de l'aperçu a été retravaillée : elle ouvre maintenant la même carte, en plus grand.",
      notes:
        "Une pastille sur le bouton des réglages signale les notes de mise à jour que vous n'avez pas encore lues.",
      fixes:
        "Corrections de bugs : une pièce déposée sur un drapeau d'une zone que vous n'avez pas visitée pendant cette session ne s'empile plus sur le drapeau, ainsi que les pièces verrouillées à cheval sur une tuile et la progression affichée sur la page d'accueil.",
    },
    v111: {
      fixes:
        "Corrections de bugs et améliorations de performances, autour du zoom, des curseurs des autres joueurs, des drapeaux et de l'image de référence.",
    },
    v110: {
      flags:
        "Drapeaux personnels : posez jusqu'à 8 repères sur le plateau et passez de l'un à l'autre d'un clic ou avec les touches 1 à 8.",
      flagDrop:
        "Envoyez une pièce à l'autre bout du plateau en la déposant sur un drapeau de la barre du bas, sans quitter l'endroit où vous travaillez.",
      underlay:
        "Affichez l'image source en transparence sous le plateau, depuis la section Affichage de ce menu.",
      standings:
        "La liste des contributeurs bouge à chaque assemblage, et plus seulement quand un groupe se verrouille sur le cadre. Votre ligne y est toujours visible.",
      account:
        "Se connecter avec Google transforme votre compte invité en compte permanent, que vous pouvez retrouver depuis un autre navigateur.",
      maintenance:
        "Un redémarrage du serveur affiche un écran de maintenance au lieu d'une erreur de connexion, et revient tout seul dès que le puzzle est de retour.",
      mobile:
        "Sur téléphone, l'interface ne garde que la référence et l'aperçu, et laisse l'écran au plateau.",
      help: "Ce menu propose des astuces, et le panneau des contributeurs explique comment les pièces sont comptées.",
    },
    v100: {
      launch:
        "Lancement public : 1 000 000 de pièces uniques sur un seul plateau partagé, jouable en invité sans inscription, en anglais, français, espagnol et allemand.",
    },
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
      "Choisissez un nouveau pays. Son drapeau est affiché à côté de votre pseudo dans la liste des contributeurs.",
    ledeNew:
      "Choisissez votre pays. Son drapeau est affiché à côté de votre pseudo dans la liste des contributeurs.",
    selectLabel: "Pays",
    selectPlaceholder: "Sélectionnez votre pays...",
    international: "International",
    noCountry: "aucun pays sélectionné",
    cooldownHint: "Vous pouvez changer de pays une fois toutes les {hours} heures.",
    cooldown: "Vous avez déjà changé de pays récemment. Réessayez dans {hours} h.",
  },
  contributors: {
    title: "Contributeurs",
    empty: "Aucune contribution pour l'instant.",
    full: "liste complète",
    all: "Tous les contributeurs",
    viewMode: "Mode d'affichage",
    people: "Personnes",
    countries: "Pays",
    prev: "préc.",
    next: "suiv.",
    pcs: "pcs",
    you: "vous",
    online: "en ligne",
  },
  scoring: {
    open: "Comment les pièces sont comptées",
    title: "Comment les pièces sont comptées",
    lede: "Chaque pièce du plateau est comptée une seule fois, pour la première personne qui l'emboîte.",
    snapTwo:
      "Vous emboîtez deux pièces libres : cela compte une pièce, pas deux. L'autre est mise de côté pour la personne qui verrouillera ce groupe dans le plateau.",
    snapCluster:
      "Vous glissez un groupe de 30 pièces sur un autre : les 29 déjà comptées ne comptent pas deux fois, vous obtenez celle que personne n'avait jamais emboîtée.",
    mismatchTitle: "Pourquoi le total ne colle pas à la barre de progression",
    mismatchBody:
      "La liste des contributeurs compte une pièce dès qu'elle s'emboîte, où qu'elle soit sur le plateau. La barre de progression ne compte que les pièces verrouillées à leur place définitive : les deux nombres n'ont pas vocation à être égaux.",
    fairTitle: "Le compte tombe juste",
    fairBody:
      "Ce système garantit que chaque pièce est comptée exactement une fois. Il permettra aussi, quand la dernière pièce sera posée, de comptabiliser exactement {total} pièces.",
  },
  activity: {
    title: "Activité",
    empty: "Aucune activité pour l'instant.",
    placedLine: "a placé {object}",
    connectedLine: "a relié {object}",
    you: "Vous",
    youPlacedLine: "avez placé {object}",
    youConnectedLine: "avez relié {object}",
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
    topContributors: "Contributeurs",
    summary: "Récapitulatif",
    hideSummary: "Masquer le récapitulatif",
    showSummary: "Afficher le récapitulatif",
  },
  toast: {
    tileFull: "Trop de pièces sur cette case.",
    snapCovered: "Cette pièce est enfouie : dégagez d'abord celles posées dessus.",
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
      "Rejoindre le plateau crée un compte invité : un identifiant utilisateur unique, le pseudo que vous choisissez et le pays que vous sélectionnez lors de l'inscription, sans adresse e-mail requise. Si vous vous connectez avec Google pour conserver vos contributions sous une seule identité, votre adresse e-mail et votre nom Google sont également enregistrés. Vos contributions (les pièces que vous avez placées et à quel moment) sont enregistrées et affichées publiquement dans le fil d'activité et la liste des contributeurs. Les journaux techniques (adresse IP, navigateur) sont traités par l'hébergeur à des fins de sécurité et de fiabilité.",
    purposesHead: "Finalités",
    purposesBody:
      "Les données ne servent qu'à faire fonctionner le jeu : vous authentifier, sauvegarder votre progression, attribuer les pièces placées et afficher la liste des contributeurs. Aucune donnée n'est vendue ni utilisée à des fins publicitaires.",
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
