import type { MessageSchema } from "./en";

const es: MessageSchema = {
  common: {
    save: "Guardar",
    saving: "Guardando...",
    close: "Cerrar",
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
    playTime: "Tiempo de juego",
    puzzleProgress: "Progreso del puzle",
    nationalityTitle: "Nacionalidad: {code}",
    signedInAs: "Conectado como {pseudo}",
    options: "Opciones de la cuenta",
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
  },
  minimap: {
    overview: "Vista general",
    label: "Minimapa",
  },
  auth: {
    title: "Sincroniza tu cuenta",
    lede: "Inicia sesión con Google para guardar tus contribuciones de forma permanente y reunirlas en una sola cuenta.",
    continueGoogle: "Continuar con Google",
  },
  options: {
    title: "Cuenta",
    sync: "Sincronizar cuenta",
    syncHint: "Inicia sesión con Google para guardar tus contribuciones de forma permanente.",
    changePseudo: "Cambiar pseudónimo",
    changeCountry: "Cambiar país",
    signOut: "Cerrar sesión",
  },
  pseudo: {
    titleEdit: "Cambiar tu pseudónimo",
    titleNew: "Elige tu pseudónimo",
    ledeEdit:
      "Elige un nuevo pseudónimo. Se muestra a otros jugadores junto a las piezas que colocas.",
    ledeNew: "Elige un pseudónimo antes de empezar a colocar piezas. Se muestra a otros jugadores.",
    placeholder: "tu pseudónimo",
    fieldLabel: "Pseudónimo",
    hint: "De {min} a {max} caracteres: letras, dígitos, espacios, guiones y guiones bajos.",
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
    stepConnect: "Conectar",
    stepManifest: "Manifiesto",
    stepBuild: "Construcción",
    stepTextures: "Texturas",
    stepReady: "Listo",
    headConnect: "Conectando al servidor",
    headManifest: "Cargando datos del puzle",
    headBuild: "Construyendo el tablero",
    headTextures: "Cargando texturas",
    headReady: "Listo",
    tip: "Consejo: haz doble clic en una pieza para pegarla al cursor y haz doble clic de nuevo para soltarla.",
  },
  queue: {
    kicker: "Casi dentro",
    heading: "Estás en la cola",
    position: "Posición {n} en la cola",
    waiting: "Esperando un hueco libre",
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
    hint: "Pieza en mano. Haz doble clic para soltarla, Esc para devolverla.",
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
      "Million Piece Puzzle es un proyecto colaborativo y sin ánimo de lucro iniciado por un equipo independiente. Esta página explica qué datos se recopilan, por qué y cómo ejercer tus derechos.",
    controllerHead: "Responsable del tratamiento",
    controllerBody:
      "El servicio lo gestiona un equipo independiente, localizable en nuestro {discord}.",
    discord: "servidor de Discord",
    collectedHead: "Datos recopilados",
    collectedBody:
      "Entrar en el lienzo crea una cuenta de invitado: un identificador de usuario único, el pseudónimo que eliges y el país que seleccionas durante el registro, sin necesidad de correo electrónico. Si inicias sesión con Google para conservar tus contribuciones bajo una sola identidad, también se almacenan tu dirección de correo electrónico y tu nombre de Google. Tus contribuciones (qué piezas colocaste y cuándo) se registran y se muestran públicamente para la actividad y la clasificación. Los registros técnicos (dirección IP, navegador) los procesa el proveedor de alojamiento por motivos de seguridad y fiabilidad.",
    purposesHead: "Finalidades",
    purposesBody:
      "Los datos se usan únicamente para que el juego funcione: autenticarte, guardar tu progreso, atribuir las piezas colocadas y mostrar la clasificación. Ningún dato se vende ni se usa con fines publicitarios.",
    processorsHead: "Encargados del tratamiento",
    processorsBody:
      "El servicio se apoya en Google (inicio de sesión), Cloudflare (alojamiento del frontend, almacenamiento y entrega de recursos, y analítica web respetuosa con la privacidad y sin cookies) y OVH (el servidor que aloja el backend del juego). Estos proveedores pueden tratar datos fuera de la Unión Europea, bajo sus propios marcos de protección. No se utiliza ningún otro servicio externo de seguimiento o analítica.",
    retentionHead: "Conservación y tus derechos",
    retentionBody:
      "Tus datos se conservan mientras exista tu cuenta. En virtud del RGPD, tienes derecho de acceso, rectificación, supresión y portabilidad de tus datos, así como derecho de oposición. Para ejercerlos, o para solicitar la eliminación en cualquier momento, contacta con el operador mediante los datos indicados arriba.",
    cookiesHead: "Cookies",
    cookiesBody:
      "El sitio solo usa las cookies y el almacenamiento local necesarios para el inicio de sesión y tus preferencias. No se instalan cookies publicitarias ni de medición de audiencia; la analítica web utilizada es sin cookies.",
  },
  legalPage: {
    title: "Aviso legal",
    publisherHead: "Editor",
    publisherBody:
      "Este sitio es un proyecto colaborativo iniciado por un equipo independiente. Contacto: nuestro {discord}.",
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
