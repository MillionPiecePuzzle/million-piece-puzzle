import type { Router } from "vue-router";

interface RouteMeta {
  title: string;
  description: string;
  robots: "index, follow" | "noindex, follow";
}

const SITE_URL = "https://app.millionpiecepuzzle.com";

// index.html's static tags already carry the landing page's content, the
// correct default for the first paint any non-JS crawler or social unfurler
// sees. This table only corrects title/description/canonical/robots once the
// router settles on a different route, so a static sitewide canonical never
// wrongly marks /privacy or /legal as duplicates of /.
const LANDING_META: RouteMeta = {
  title: "Million Piece Puzzle — Solve 1,000,000 Pieces Together Online",
  description:
    "The world's largest online jigsaw puzzle: 1,000,000 pieces on one shared canvas, solved together in real time, free, with no download or account needed.",
  robots: "index, follow",
};

const ROUTE_META: Record<string, RouteMeta> = {
  landing: LANDING_META,
  play: {
    title: "Million Piece Puzzle",
    description: "Join the shared canvas and start placing pieces on the 1,000,000-piece puzzle.",
    robots: "noindex, follow",
  },
  privacy: {
    title: "Privacy Policy — Million Piece Puzzle",
    description: "What data Million Piece Puzzle collects, why, and how to exercise your rights.",
    robots: "index, follow",
  },
  legal: {
    title: "Legal Notice — Million Piece Puzzle",
    description: "Publisher, hosting and licensing information for Million Piece Puzzle.",
    robots: "index, follow",
  },
};

function setMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function applyRouteMeta(routeName: string | null | undefined, path: string): void {
  const meta = ROUTE_META[routeName ?? ""] ?? LANDING_META;
  const url = path === "/" ? SITE_URL + "/" : SITE_URL + path;

  document.title = meta.title;
  setMeta("name", "description", meta.description);
  setMeta("name", "robots", meta.robots);
  setCanonical(url);
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:url", url);
}

export function installSeoMeta(router: Router): void {
  router.afterEach((to) => applyRouteMeta(typeof to.name === "string" ? to.name : null, to.path));
}
