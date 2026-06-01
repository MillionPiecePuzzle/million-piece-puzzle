// Origin of the auth/profile HTTP API (the WS host). Set explicitly in
// production via VITE_AUTH_BASE_URL; in dev it is derived from VITE_WS_URL by
// swapping the ws(s) scheme for http(s), defaulting to the local server.
const DEFAULT_WS_URL = "ws://localhost:8080/";

export function authBaseUrl(): string {
  const override = import.meta.env.VITE_AUTH_BASE_URL;
  if (typeof override === "string" && override.length > 0) return trimTrailingSlash(override);
  const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  try {
    const u = new URL(wsUrl);
    const protocol = u.protocol === "wss:" ? "https:" : "http:";
    return `${protocol}//${u.host}`;
  } catch {
    return "http://localhost:8080";
  }
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
