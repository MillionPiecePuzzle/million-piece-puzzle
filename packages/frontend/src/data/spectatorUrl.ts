// The spectator stream (keyframe + event windows) is served from the WS host by
// default (same Node process), so the dev base is derived from VITE_WS_URL by
// swapping the scheme. In production the stream is fronted by a dedicated
// Cloudflare-proxied hostname and VITE_SPECTATOR_BASE_URL pins it explicitly.
const DEFAULT_WS_URL = "ws://localhost:8080/";

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function spectatorBaseUrl(): string {
  const override = import.meta.env.VITE_SPECTATOR_BASE_URL;
  if (typeof override === "string" && override.length > 0) return trimTrailingSlash(override);
  const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  try {
    const u = new URL(wsUrl);
    const scheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${u.host}`;
  } catch {
    return "http://localhost:8080";
  }
}

export function keyframeUrl(): string {
  return `${spectatorBaseUrl()}/keyframe`;
}

export function eventsUrl(t0: number): string {
  return `${spectatorBaseUrl()}/events/${t0}`;
}

// Landing data (event start + interested count), served from the same host as the
// spectator stream. Kept separate from the keyframe so the landing never fetches a
// full board just to read the countdown date.
export function landingUrl(): string {
  return `${spectatorBaseUrl()}/landing`;
}

export function interestedUrl(): string {
  return `${spectatorBaseUrl()}/interested`;
}
