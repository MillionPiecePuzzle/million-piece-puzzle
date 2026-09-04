import type { MessageSchema } from "./en";

const es: MessageSchema = {
  common: {
    save: "Guardar",
    saving: "Guardando...",
    close: "Cerrar",
    cancel: "Cancelar",
    skip: "Omitir",
    saveError: "No se pudo guardar, inténtalo de nuevo.",
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
    pctComplete: "{p} completado",
    completed: "COMPLETADO",
    solvedIn: "resuelto en {duration}",
    liveActivity: "Actividad en directo",
    noStandingsFinal: "No se registró ninguna contribución.",
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
    signedInAs: "Conectado como {pseudo}",
    options: "Ajustes",
    optionsNew: "Ajustes, nuevas notas de actualización",
  },
  perfNotice: {
    label: "Rendimiento",
    message: "El tablero va muy lento en este dispositivo.",
    showTips: "¿Qué hacer?",
    hideTips: "Ocultar",
    tipAcceleration:
      "Prueba a activar o desactivar la aceleración por hardware en los ajustes de tu navegador y reinícialo.",
    tipTabs: "Cierra otras pestañas y aplicaciones que estén usando la tarjeta gráfica.",
    dismiss: "Ocultar este aviso",
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
    aim: "Hacer clic en la foto para llevar el tablero ahí (o Ctrl-clic en cualquier momento)",
    credits: "Ver los créditos de la imagen",
  },
  overview: {
    title: "Vista general",
    online: "{n} en línea",
    enlarge: "Ampliar la vista general",
    coordinates: "Coordenadas",
    coordinatesHint: "Tu posición en el tablero, en piezas desde su centro",
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
    support: "Apoyar el proyecto ❤️",
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
        contributors: "Colaboradores",
        overview: "Vista general",
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
    overview: "Haz clic en cualquier punto de la vista general para mover la vista allí.",
    reference:
      "Abre la imagen de referencia y amplíala para encontrar dónde va una pieza, luego haz Ctrl-clic en ella para llevar el tablero ahí.",
    bookmarks:
      "Usa los marcadores para guardar los lugares del puzle que te importan: el botón de marcadores de la barra superior abre tu cuaderno, y un clic te lleva de vuelta allí.",
    multiCarry:
      "Con una pieza en mano, haz Ctrl-clic en otras piezas para llevar hasta 10 a la vez y luego doble clic en el tablero para dejarlas todas una al lado de otra.",
  },
  updates: {
    title: "Notas de actualización",
    v140: {
      bookmarks:
        "Marcadores: guarda en un cuaderno los lugares del tablero que te importan, que se abre desde el botón de la barra superior. Apunta al tablero para crear uno, ponle nombre, archívalo bajo tus propias palabras, marca con una estrella aquellos a los que vuelves siempre, y un clic te lleva de vuelta.",
      share:
        "Envía un marcador a alguien: el enlace abre el tablero exactamente en ese punto y le ofrece el mismo marcador para guardarlo.",
      multiCarry:
        "Con una pieza en mano, haz Ctrl-clic en otras piezas para llevar hasta 10 a la vez y luego doble clic en el tablero para dejarlas todas una al lado de otra.",
      coordinates: "Se ha añadido un sistema de coordenadas.",
      performance:
        "Llegar a una zona cargada del tablero carga primero lo que tienes delante, desde el centro de la pantalla hacia los bordes.",
      support:
        "El menú de ajustes incluye un enlace para apoyar el proyecto: ayuda a pagar el servidor, el almacenamiento y el nombre de dominio.",
    },
    v130: {
      jump: "La vista ampliada de la vista general y la foto de referencia ampliada ahora mueven el tablero: haz clic en el mapa para ir allí, y en la foto usa el botón de mira, o Ctrl-clic, para llevar el tablero a lo que estás mirando.",
      contributors:
        "El panel que lista a los jugadores se llama ahora Colaboradores, y las formulaciones a su alrededor han seguido el mismo camino.",
      countries:
        "Cada bandera nombra ahora su país en tu idioma, en la lista de colaboradores, en la barra superior y en el selector de país.",
      home: "Las cifras de la página de inicio se mueven ahora solas: las piezas colocadas, los colaboradores y la actividad reciente se actualizan mientras la página sigue abierta.",
      fixes:
        "Correcciones de errores: la foto de referencia ya no impide que el tablero cargue la zona que acabas de mirar, un clic con el zoom muy alejado desplaza la vista en lugar de agarrar una pieza, el borde del tablero detiene la cámara donde se vuelve visible, y la barra superior en móvil muestra tu pseudónimo y el recuento completo.",
    },
    v120: {
      panels:
        "Cada panel tiene ahora su propio interruptor en la sección Visualización de este menú.",
      overview:
        "La vista ampliada de la vista general se ha rediseñado: ahora abre el mismo mapa, en grande.",
      notes:
        "Un punto en el botón de ajustes te avisa cuando hay notas de actualización que no has leído.",
      fixes:
        "Correcciones de errores: una pieza soltada sobre una bandera de una zona que no has visitado durante esta sesión ya no se amontona sobre la bandera, además de las piezas bloqueadas a caballo entre dos casillas y el progreso que muestra la página de inicio.",
    },
    v111: {
      fixes:
        "Correcciones de errores y mejoras de rendimiento, en torno al zoom, los cursores de los demás jugadores, las banderas y la imagen de referencia.",
    },
    v110: {
      flags:
        "Banderas personales: coloca hasta 8 marcadores en el tablero y salta de uno a otro con un clic o con las teclas 1 a 8.",
      flagDrop:
        "Envía una pieza al otro extremo del tablero soltándola sobre una bandera de la barra inferior, sin dejar el punto en el que trabajas.",
      underlay:
        "Muestra la imagen original con transparencia bajo el tablero, desde la sección Visualización de este menú.",
      standings:
        "La lista de colaboradores se mueve con cada encaje, y ya no solo cuando un grupo se bloquea en el marco. Tu fila siempre está visible.",
      account:
        "Iniciar sesión con Google convierte tu cuenta de invitado en una cuenta permanente, que puedes recuperar desde otro navegador.",
      maintenance:
        "Un reinicio del servidor muestra una pantalla de mantenimiento en lugar de un error de conexión, y vuelve solo en cuanto el puzle está de nuevo disponible.",
      mobile:
        "En el móvil la interfaz solo conserva la referencia y la vista general, y deja la pantalla al tablero.",
      help: "Este menú incluye consejos, y el panel de colaboradores explica cómo se cuentan las piezas.",
    },
    v100: {
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
      "Elige un nuevo país. Su bandera se muestra junto a tu pseudónimo en la lista de colaboradores.",
    ledeNew:
      "Elige tu país. Su bandera se muestra junto a tu pseudónimo en la lista de colaboradores.",
    selectLabel: "País",
    selectPlaceholder: "Selecciona tu país...",
    international: "Internacional",
    noCountry: "ningún país seleccionado",
    cooldownHint: "Puedes cambiar tu país una vez cada {hours} horas.",
    cooldown: "Ya cambiaste tu país hace poco. Vuelve a intentarlo en {hours} h.",
  },
  contributors: {
    title: "Colaboradores",
    empty: "Aún no hay contribuciones.",
    full: "lista completa",
    all: "Todos los colaboradores",
    viewMode: "Modo de visualización",
    people: "Personas",
    countries: "Países",
    prev: "ant.",
    next: "sig.",
    pcs: "pzs",
    you: "tú",
    online: "en línea",
  },
  scoring: {
    open: "Cómo se cuentan las piezas",
    title: "Cómo se cuentan las piezas",
    lede: "Cada pieza del tablero se cuenta una sola vez, para la primera persona que la encaja.",
    snapTwo:
      "Encajas dos piezas sueltas: cuenta una pieza, no dos. La otra queda reservada para quien bloquee ese grupo en el tablero.",
    snapCluster:
      "Arrastras un grupo de 30 piezas sobre otro: las 29 ya contadas no cuentan dos veces, así que obtienes la que nadie había encajado nunca.",
    mismatchTitle: "Por qué no cuadra con la barra de progreso",
    mismatchBody:
      "La lista de colaboradores cuenta una pieza en cuanto encaja, esté donde esté en el tablero. La barra de progreso solo cuenta las piezas bloqueadas en su sitio definitivo: los dos números no tienen por qué coincidir.",
    fairTitle: "Las cuentas cuadran",
    fairBody:
      "Este sistema garantiza que cada pieza se cuente exactamente una vez. También hace que, una vez colocada la última pieza, sume exactamente {total} piezas.",
  },
  activity: {
    title: "Actividad",
    empty: "Aún no hay actividad.",
    placedLine: "colocó {object}",
    connectedLine: "conectó {object}",
    you: "Tú",
    youPlacedLine: "colocaste {object}",
    youConnectedLine: "conectaste {object}",
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
    topContributors: "Colaboradores",
    summary: "Resumen",
    hideSummary: "Ocultar el resumen",
    showSummary: "Mostrar el resumen",
  },
  toast: {
    tileFull: "Demasiadas piezas en esta casilla.",
    snapCovered: "Esa pieza está enterrada: aparta primero las que tiene encima.",
    carryFull: "No puedes llevar más de {n} piezas a la vez.",
  },
  carry: {
    hint: "Pieza en mano. Haz doble clic o doble toque para soltarla, Esc para devolverla. | {n} piezas en mano de {max}. Haz doble clic para soltarlas todas, Esc para devolverlas.",
  },
  bookmarks: {
    title: "Marcadores",
    newTitle: "Nuevo marcador",
    count: "{n} marcador | {n} marcadores",
    filter: "Filtrar por nombre",
    empty: "Todavía no hay marcadores.",
    noMatch: "Ningún marcador tiene ese nombre.",
    add: "Añadir un marcador",
    import: "Pegar un enlace",
    importTitle: "Pegar un enlace de marcador",
    importLede: "Pega el enlace de marcador que te han enviado y guárdalo en tu cuaderno.",
    importLabel: "Enlace de marcador",
    importPlaceholder: "pega el enlace aquí",
    importAction: "Abrir",
    importBad: "Ese enlace no lleva ningún marcador. Copia la línea entera que te enviaron.",
    full: "Tu cuaderno está lleno con {max} marcadores. Elimina uno para añadir otro.",
    pickSpot:
      "Haz clic en el tablero donde quieres el marcador. El fragmento de la imagen bajo el cursor será su miniatura.",
    pickPiece: "Pulsa una pieza del tablero. Esa pieza representará el marcador.",
    nameSpot: "Ponle nombre a este marcador.",
    sharedTitle: "Un marcador que te han enviado",
    sharedLede: "Guarda este marcador en tu cuaderno, con este nombre o con el tuyo.",
    badgeKind: "Miniatura",
    badgeKindArea: "Un fragmento",
    badgeKindPiece: "Una pieza",
    badgeSize: "Tamaño",
    badgeSizePieces: "{n} pieza | {n} piezas",
    badgeSizeWheel: "Usa la rueda sobre el tablero para cambiar el tamaño del cuadrado.",
    nothingHere: "Aquí no hay imagen. Apunta dentro de la imagen.",
    noPieceHere: "Aquí no hay ninguna pieza. Pulsa una que el tablero dibuje, o toma un fragmento.",
    nameLabel: "Nombre del marcador",
    namePlaceholder: "nombra este marcador",
    needName: "Ponle nombre a este marcador antes de guardarlo.",
    needBadge: "Elige una miniatura antes de guardar.",
    goTo: "Ir a {name}",
    favorite: "Añadir {name} a tus favoritos",
    unfavorite: "Quitar {name} de tus favoritos",
    copyLink: "Copiar un enlace a {name}",
    copied: "Enlace copiado",
    copyFailed: "Tu navegador no ha permitido copiar el enlace.",
    delete: "Eliminar {name}",
    tag: "Etiqueta",
    tags: "Etiquetas",
    tagAll: "Todos",
    tagUntagged: "Sin etiqueta",
    viewEmpty: "Aquí no hay ningún marcador.",
    tagsTitle: "Etiquetas",
    tagsLede: "Elige las etiquetas de {name}.",
    tagsDraftLede: "Elige las etiquetas de este marcador.",
    tagsPick: "Elegir etiquetas",
    tagsNoneYet: "ninguna todavía",
    tagsNone: "Todavía no hay etiquetas. Escribe una palabra y créala.",
    tagNoMatch: "Ninguna etiqueta coincide.",
    tagPlaceholder: "buscar o crear una etiqueta",
    tagNew: "Nombre de la etiqueta",
    tagCreate: "Crear",
    tagNeedName: "Ponle nombre a la etiqueta antes de crearla.",
    tagWorn: "Este marcador ya tiene esa etiqueta.",
    tagsFull: "Un marcador lleva {max} etiquetas. Quita una para añadir otra.",
    tagsOf: "Etiquetas de {name}",
    backToList: "Volver a la lista",
    backToEntry: "Volver al marcador",
    hintFavorite: "Añadir a favoritos",
    hintUnfavorite: "Quitar de favoritos",
    hintTags: "Etiquetas",
    hintCopyLink: "Copiar un enlace",
    hintDelete: "Eliminar",
    prev: "ant.",
    next: "sig.",
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
      "Unirse al tablero crea una cuenta de invitado: un identificador de usuario único, el pseudónimo que eliges y el país que seleccionas durante el registro, sin necesidad de correo electrónico. Si inicias sesión con Google para conservar tus contribuciones bajo una sola identidad, también se almacenan tu dirección de correo electrónico y tu nombre de Google. Tus contribuciones (qué piezas colocaste y cuándo) se registran y se muestran públicamente para la actividad y la lista de colaboradores. Los registros técnicos (dirección IP, navegador) los procesa el proveedor de alojamiento por motivos de seguridad y fiabilidad.",
    purposesHead: "Finalidades",
    purposesBody:
      "Los datos se usan únicamente para que el juego funcione: autenticarte, guardar tu progreso, atribuir las piezas colocadas y mostrar la lista de colaboradores. Ningún dato se vende ni se usa con fines publicitarios.",
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
