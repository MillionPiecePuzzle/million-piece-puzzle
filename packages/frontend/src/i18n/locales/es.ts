import type { MessageSchema } from "./en";

const es: MessageSchema = {
  common: {
    save: "Guardar",
    saving: "Guardando...",
    close: "Cerrar",
    skip: "Omitir",
    leaderboard: "Clasificación",
    activity: "Actividad",
    noActivity: "Aún no hay actividad.",
    noStandings: "Aún no hay clasificación.",
    saveError: "No se pudo guardar, inténtalo de nuevo.",
    fullBoard: "tabla completa",
  },
  time: {
    justNow: "ahora mismo",
    secondsAgo: "hace {n} s",
    minutesAgo: "hace {n} min",
    hoursAgo: "hace {n} h",
    daysAgo: "hace {n} d",
  },
  units: { d: "d", h: "h", m: "min" },
  langSwitcher: { label: "Elegir idioma" },
  landing: {
    tagline: "Un millón de piezas en un único tablero compartido.",
    enterBoard: "Unirse al tablero",
    interested: "Me interesa",
    beFirst: "Sé el primero en seguir la aventura",
    interestCount: "{n} persona interesada | {n} personas interesadas",
    piecesLockedSuffix: "/ {n} piezas fijadas",
    pctComplete: "{p}% completado",
    completed: "COMPLETADO",
    solvedIn: "resuelto en {duration}",
    liveActivity: "Actividad en directo",
    noStandingsFinal: "No se registró ninguna clasificación.",
    someone: "Alguien",
    placed: "colocó {pieces}",
    connected: "conectó {pieces}",
    pieces: "una pieza | {n} piezas",
  },
  countdown: {
    launchingSoon: "Lanzamiento inminente",
    days: "Días",
    hours: "Horas",
    minutes: "Minutos",
    seconds: "Segundos",
  },
  footer: {
    privacy: "Privacidad",
    legal: "Aviso legal",
  },
  play: {
    stage: "Tablero del puzle",
  },
  topbar: {
    puzzleProgress: "Progreso del puzle",
    nationalityTitle: "Nacionalidad: {code}",
    signedInAs: "Conectado como {pseudo}",
    options: "Ajustes",
    optionsNew: "Ajustes, nuevas notas de actualización",
  },
  zoom: {
    in: "Acercar",
    out: "Alejar",
    center: "Centrar en el puzle",
    fit: "Ajustar el puzle a la vista",
  },
  reference: {
    title: "Referencia",
    openEnlarged: "Abrir la referencia ampliada",
    image: "Imagen de referencia",
    fitToView: "Ajustar a la vista",
    credits: "Ver los créditos de la imagen",
  },
  minimap: {
    overview: "Vista general",
    online: "{n} en línea",
    label: "Minimapa",
    openDetail: "Abrir la vista detallada de las casillas",
    detailTitle: "Detalle de carga de las casillas",
    legendLoaded: "Cargada",
    legendLoading: "Cargando",
    legendNotLoaded: "No cargada",
    tilesLoaded: "{loaded} / {total} casillas cargadas",
    memoryUsage: "{used} / {budget}",
  },
  auth: {
    title: "Sincroniza tu cuenta",
    lede: "Inicia sesión con Google para guardar tus contribuciones de forma permanente y reunirlas en una sola cuenta.",
    continueGoogle: "Continuar con Google",
    switchTitle: "Esta cuenta de Google ya tiene un perfil",
    switchLede:
      "Ya pertenece a otro perfil del puzle. Recupérala y las piezas que has colocado aquí te acompañan.",
    switchAction: "Recuperar mi cuenta",
    signInFailed: "El inicio de sesión no se completó. Inténtalo de nuevo.",
  },
  options: {
    title: "Ajustes",
    account: "Cuenta",
    sync: "Sincronizar cuenta",
    syncHint: "Inicia sesión con Google para guardar tus contribuciones de forma permanente.",
    synced: "Cuenta sincronizada con Google",
    changePseudo: "Cambiar pseudónimo",
    changeCountry: "Cambiar país",
    discord: "Unirse al servidor de Discord",
    updates: "Notas de actualización",
    updatesNew: "Notas de actualización, novedades",
    display: {
      title: "Visualización",
      underlay: "Imagen de referencia de fondo",
      underlayHint: "Muestra la imagen de referencia con transparencia bajo el tablero.",
      panel: {
        reference: "Referencia",
        zoom: "Zoom",
        activity: "Actividad",
        leaderboard: "Clasificación",
        minimap: "Minimapa",
        flags: "Banderas",
      },
    },
    signOut: "Cerrar sesión",
  },
  tips: {
    title: "Consejos",
    prev: "Consejo anterior",
    next: "Consejo siguiente",
    carry:
      "Haz doble clic en una pieza para pegarla al cursor y doble clic otra vez para soltarla.",
    flags: "Usa las banderas para moverte fácilmente por el lienzo.",
    flagDrop: "Arrastra una pieza hasta una bandera de la barra para enviársela.",
    minimap: "Haz clic en cualquier punto del minimapa para mover la vista allí.",
    reference: "Abre la imagen de referencia y amplíala para encontrar dónde va una pieza.",
  },
  updates: {
    title: "Notas de actualización",
    v111: {
      fixes:
        "Correcciones de errores y mejoras de rendimiento, en torno al zoom, los cursores de los demás jugadores, las banderas y la imagen de referencia.",
    },
    v11: {
      flags:
        "Banderas personales: coloca hasta 8 marcadores en el tablero y salta de uno a otro con un clic o con las teclas 1 a 8.",
      flagDrop:
        "Envía una pieza al otro extremo del tablero soltándola sobre una bandera de la barra inferior, sin dejar el punto en el que trabajas.",
      underlay:
        "Muestra la imagen original con transparencia bajo el tablero, desde la sección Visualización de este menú.",
      standings:
        "La clasificación se mueve con cada encaje, y ya no solo cuando un grupo se bloquea en el marco. Tu fila siempre está visible.",
      account:
        "Iniciar sesión con Google convierte tu cuenta de invitado en una cuenta permanente, que puedes recuperar desde otro navegador.",
      maintenance:
        "Un reinicio del servidor muestra una pantalla de mantenimiento en lugar de un error de conexión, y vuelve solo en cuanto el puzle está de nuevo disponible.",
      mobile:
        "En el móvil la interfaz solo conserva la referencia y el minimapa, y deja la pantalla al tablero.",
      help: "Este menú incluye consejos, y la clasificación explica cómo se cuentan los puntos.",
    },
    v10: {
      launch:
        "Lanzamiento público: 1.000.000 de piezas únicas en un solo tablero compartido, jugable como invitado sin registro, en inglés, francés, español y alemán.",
    },
  },
  pseudo: {
    haveAccount: "¿Ya tienes una cuenta? Inicia sesión",
    titleEdit: "Cambiar tu pseudónimo",
    titleNew: "Elige tu pseudónimo",
    ledeEdit:
      "Elige un nuevo pseudónimo. Se muestra a otros jugadores junto a las piezas que colocas.",
    ledeNew: "Elige un pseudónimo antes de empezar a colocar piezas. Se muestra a otros jugadores.",
    placeholder: "tu pseudónimo",
    fieldLabel: "Pseudónimo",
    hint: "De {min} a {max} caracteres: letras, dígitos, espacios, guiones, guiones bajos y #.",
    taken: "Ese pseudónimo ya está en uso.",
    cooldownHint: "Puedes cambiar tu pseudónimo una vez cada {hours} horas.",
    cooldown: "Ya cambiaste tu pseudónimo hace poco. Vuelve a intentarlo en {hours} h.",
  },
  nationality: {
    titleEdit: "Cambiar tu nacionalidad",
    titleNew: "Elige tu nacionalidad",
    ledeEdit:
      "Elige un nuevo país. Su bandera se muestra junto a tu pseudónimo en la clasificación.",
    ledeNew: "Elige tu país. Su bandera se muestra junto a tu pseudónimo en la clasificación.",
    selectLabel: "País",
    selectPlaceholder: "Selecciona tu país...",
    international: "Internacional",
    noCountry: "ningún país seleccionado",
    cooldownHint: "Puedes cambiar tu país una vez cada {hours} horas.",
    cooldown: "Ya cambiaste tu país hace poco. Vuelve a intentarlo en {hours} h.",
  },
  leaderboardModal: {
    label: "Clasificación completa",
    rankingMode: "Modo de clasificación",
    people: "Personas",
    countries: "Países",
    prev: "ant.",
    next: "sig.",
  },
  scoring: {
    open: "Cómo se cuentan las piezas",
    title: "Cómo se cuentan las piezas",
    lede: "Cada pieza del tablero vale un punto. Se acredita una sola vez, al primer jugador que la encaja.",
    snapTwo:
      "Encajas dos piezas sueltas: un punto, no dos. El punto de la otra pieza queda reservado para quien bloquee ese grupo en el tablero.",
    snapCluster:
      "Arrastras un grupo de 30 piezas sobre otro: las 29 ya acreditadas no cuentan dos veces, así que te llevas la que nadie había encajado nunca.",
    mismatchTitle: "Por qué no cuadra con la barra de progreso",
    mismatchBody:
      "La clasificación acredita una pieza en cuanto encaja, esté donde esté en el tablero. La barra de progreso solo cuenta las piezas bloqueadas en su sitio definitivo: los dos números no tienen por qué coincidir.",
    fairTitle: "Las cuentas cuadran",
    fairBody:
      "Este sistema es lo que mantiene justa la clasificación. También hace que, una vez colocada la última pieza, sume exactamente {total} piezas.",
  },
  activityPanel: {
    placedLine: "colocó {object}",
    connectedLine: "conectó {object}",
    piece: "una pieza",
    twoPieces: "dos piezas juntas",
    cluster: "un grupo de {n} piezas",
  },
  loading: {
    error: "Error",
    loading: "Cargando",
    couldNotLoad: "No se pudo cargar el puzle",
    errorProtocol: "Esta página usa una versión antigua. Recárgala para continuar.",
    errorManifest:
      "No se pudieron cargar los datos del puzle. Comprueba tu conexión y recarga la página.",
    errorQueue: "No se pudo entrar en la cola. Comprueba tu conexión e inténtalo de nuevo.",
    errorConnection: "Conexión perdida. Recarga la página para volver a entrar.",
    stepConnect: "Conectar",
    stepBuild: "Construcción",
    stepTextures: "Texturas",
    stepReady: "Listo",
    headConnect: "Conectando al servidor",
    headBuild: "Construyendo el tablero",
    headTextures: "Cargando texturas",
    headReady: "Listo",
    tip: "Consejo: haz doble clic o doble toque en una pieza para pegarla al cursor y repite para soltarla.",
  },
  queue: {
    kicker: "Casi dentro",
    heading: "Estás en la cola",
    position: "Posición {n} en la cola",
    waiting: "Esperando un hueco libre",
  },
  maintenance: {
    kicker: "Mantenimiento",
    heading: "El puzle no está disponible",
    body: "El tablero no está accesible ahora mismo. Debería volver en unos minutos.",
  },
  completion: {
    complete: "Completado",
    assembled: "Puzle ensamblado.",
    piecesPlaced: "{n} pieza colocada. | {n} piezas colocadas.",
    topContributors: "Mejores colaboradores",
    summary: "Resumen",
    hideSummary: "Ocultar el resumen",
    showSummary: "Mostrar el resumen",
  },
  toast: {
    tileFull: "Demasiadas piezas en esta casilla.",
  },
  carry: {
    hint: "Pieza en mano. Haz doble clic o doble toque para soltarla, Esc para devolverla.",
  },
  flags: {
    bar: "Banderas personales",
    add: "Añadir una bandera en el centro de la vista",
    goTo: "Ir a la bandera {n} (tecla {n})",
    options: "Opciones de la bandera {n}",
    delete: "Eliminar",
    colors: {
      red: "Rojo",
      orange: "Naranja",
      green: "Verde",
      blue: "Azul",
      purple: "Morado",
      pink: "Rosa",
      white: "Blanco",
      black: "Negro",
    },
  },
  row: {
    pcs: "pzs",
    you: "tú",
    online: "en línea",
  },
  legalDoc: {
    back: "Volver al inicio",
    updated: "Última actualización: {date}",
  },
  privacyPage: {
    title: "Política de privacidad",
    intro:
      "Million Piece Puzzle es un proyecto colaborativo y sin ánimo de lucro iniciado por un desarrollador independiente. Esta página explica qué datos se recopilan, por qué y cómo ejercer tus derechos.",
    controllerHead: "Responsable del tratamiento",
    controllerBody:
      "El servicio lo gestiona un desarrollador independiente, localizable en nuestro {discord}.",
    discord: "servidor de Discord",
    collectedHead: "Datos recopilados",
    collectedBody:
      "Unirse al tablero crea una cuenta de invitado: un identificador de usuario único, el pseudónimo que eliges y el país que seleccionas durante el registro, sin necesidad de correo electrónico. Si inicias sesión con Google para conservar tus contribuciones bajo una sola identidad, también se almacenan tu dirección de correo electrónico y tu nombre de Google. Tus contribuciones (qué piezas colocaste y cuándo) se registran y se muestran públicamente para la actividad y la clasificación. Los registros técnicos (dirección IP, navegador) los procesa el proveedor de alojamiento por motivos de seguridad y fiabilidad.",
    purposesHead: "Finalidades",
    purposesBody:
      "Los datos se usan únicamente para que el juego funcione: autenticarte, guardar tu progreso, atribuir las piezas colocadas y mostrar la clasificación. Ningún dato se vende ni se usa con fines publicitarios.",
    processorsHead: "Encargados del tratamiento",
    processorsBody:
      "El servicio se apoya en Google (inicio de sesión), Cloudflare (alojamiento del frontend, almacenamiento y entrega de recursos) y OVH (el servidor que aloja el backend del juego, incluida su analítica autoalojada). Estos proveedores pueden tratar datos fuera de la Unión Europea, bajo sus propios marcos de protección. No se utiliza ningún servicio externo de seguimiento o analítica.",
    retentionHead: "Conservación y tus derechos",
    retentionBody:
      "Tus datos se conservan mientras exista tu cuenta. En virtud del RGPD, tienes derecho de acceso, rectificación, supresión y portabilidad de tus datos, así como derecho de oposición. Para ejercerlos, o para solicitar la eliminación en cualquier momento, contacta con el operador mediante los datos indicados arriba.",
    cookiesHead: "Cookies y analítica",
    cookiesBody:
      "El sitio solo usa las cookies y el almacenamiento local necesarios para el inicio de sesión y tus preferencias; no se instalan cookies publicitarias ni de medición de audiencia. El tráfico en el tablero del puzle se mide con Umami, una herramienta de analítica autoalojada en nuestro propio servidor: no instala cookies y nunca almacena tu dirección IP, identificando una visita solo mediante un hash de tu IP, tu navegador y este sitio, que se renueva cada mes para que no pueda asociarse contigo ni usarse para rastrearte en otros sitios.",
  },
  legalPage: {
    title: "Aviso legal",
    publisherHead: "Editor",
    publisherBody:
      "Este sitio es un proyecto colaborativo iniciado por un desarrollador independiente. Contacto: nuestro {discord}.",
    discord: "servidor de Discord",
    hostHead: "Alojamiento",
    hostBody:
      "El frontend está alojado por Cloudflare, Inc. (101 Townsend Street, San Francisco, CA 94107, EE. UU.) en Cloudflare Pages. El backend del juego está alojado en un servidor proporcionado por OVH SAS (2 rue Kellermann, 59100 Roubaix, Francia).",
    natureHead: "Naturaleza del proyecto",
    natureBody:
      "Million Piece Puzzle es un proyecto sin ánimo de lucro. No genera ingresos, no contiene publicidad y no ofrece contenido de pago.",
    ipHead: "Propiedad intelectual",
    ipBody:
      "Million Piece Puzzle es de código abierto. El código fuente se publica bajo la licencia MIT y está disponible en el {repo}. Las ilustraciones del puzle y los demás elementos visuales pertenecen a sus respectivos autores y se acreditan cuando corresponde.",
    repo: "repositorio del proyecto",
    creditsHead: "Créditos de imagen",
    creditsBody:
      "Todas las fotos proceden de {unsplash}: fotografías, no generadas por IA. El algoritmo del mosaico está inspirado en el proyecto de código abierto {photomosaic}.",
    unsplash: "Unsplash",
    photomosaic: "photomosaic",
    liabilityHead: "Responsabilidad",
    liabilityBody:
      "Million Piece Puzzle se ofrece «tal cual», sin garantía alguna. El editor no se hace responsable de las interrupciones del servicio, la pérdida de datos ni de cualquier daño derivado del uso del sitio.",
    licensesHead: "Licencias de código abierto",
    licensesBody:
      "El sitio está construido con bibliotecas de código abierto que siguen siendo propiedad de sus respectivos autores, utilizadas aquí bajo sus licencias: Vue y Vue Router (MIT), PixiJS (MIT) y OpenSeadragon (BSD-3-Clause). El árbol completo de dependencias y el texto íntegro de cada licencia están disponibles en el {sourceRepo}.",
    sourceRepo: "repositorio fuente",
  },
};

export default es;
