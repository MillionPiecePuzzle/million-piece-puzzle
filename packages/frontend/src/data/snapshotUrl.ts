// The spectator snapshot is served from the WS host by default (same Node
// process), so the dev URL is derived from VITE_WS_URL by swapping the scheme
// and pointing at `/snapshot`. In production the snapshot is fronted by a
// dedicated Cloudflare-proxied hostname and VITE_SNAPSHOT_URL pins it
// explicitly.
const DEFAULT_WS_URL = "ws://localhost:8080/";
const SNAPSHOT_PATH = "snapshot";

export function snapshotUrl(): string {
  const override = import.meta.env.VITE_SNAPSHOT_URL;
  if (typeof override === "string" && override.length > 0) return override;
  const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  try {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = u.pathname.endsWith("/")
      ? `${u.pathname}${SNAPSHOT_PATH}`
      : `${u.pathname}/${SNAPSHOT_PATH}`;
    return u.toString();
  } catch {
    return `http://localhost:8080/${SNAPSHOT_PATH}`;
  }
}
