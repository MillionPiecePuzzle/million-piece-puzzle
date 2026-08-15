const OPT_OUT_PARAM = "umamiOptOut";
const OPT_OUT_KEY = "umami.disabled";

// Reads the opt-out marker off a URL and, if present, records it in storage
// (see DECISIONS: self-hosted analytics via Umami). Returns a path+search+hash
// reference with the marker stripped, or null when the URL carried no marker.
// Relative (not absolute) so the caller can hand it straight to router.replace:
// Vue Router's createWebHistory captures window.location at construction time
// (module-eval, before any of main.ts's own code runs) and re-asserts it during
// its own initial navigation, so a raw history.replaceState call here gets
// silently clobbered once the router mounts. Routing the strip through the
// router itself keeps its internal state and the address bar in sync.
export function consumeAnalyticsOptOut(
  href: string,
  storage: Pick<Storage, "setItem">,
): string | null {
  const url = new URL(href);
  if (url.searchParams.get(OPT_OUT_PARAM) !== "1") return null;
  storage.setItem(OPT_OUT_KEY, "1");
  url.searchParams.delete(OPT_OUT_PARAM);
  return url.pathname + url.search + url.hash;
}

export function umamiScriptUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/script.js`;
}

// No-op unless both env vars are set, so local dev and any deploy without a
// configured instance never load the script or send events.
export function initAnalytics(): void {
  const base = import.meta.env.VITE_UMAMI_URL;
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
  if (!base || !websiteId) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = umamiScriptUrl(base);
  script.dataset.websiteId = websiteId;
  document.head.appendChild(script);
}
