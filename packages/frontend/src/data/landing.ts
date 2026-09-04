import type { LandingResponse, LiveResponse } from "@mpp/shared";
import { authBaseUrl } from "./authBaseUrl";

// Public landing endpoints, served from the WS host (the same Node process as the
// auth and queue routes): the countdown/progress read and the interested opt-in.
// Anonymous, wildcard-CORS, never cached.
export function landingUrl(): string {
  return `${authBaseUrl()}/landing`;
}

export function interestedUrl(): string {
  return `${authBaseUrl()}/interested`;
}

export function liveUrl(): string {
  return `${authBaseUrl()}/live`;
}

export type InterestState = { count: number; me: boolean };
export type LandingData = LandingResponse;
export type LiveData = LiveResponse;

// The figures both landing routes carry, and their server stamp.
export type Figures = Pick<LiveResponse, "figuresAt" | "progress" | "leaderboard" | "activity">;

let figures: Figures | null = null;

// The freshest figures this page load has seen, from either route. GET /landing is
// uncached and GET /live rides an edge cache, so a poll can answer with a body up
// to that cache's window older than the one the page is already showing, and a
// landing remounted from /play (the topbar brand is a router link) would otherwise
// start over from whatever its own read returns. Ordering them by the server stamp
// is what keeps the locked counter from falling back, while a board reset still
// applies since its body is stamped later. A body that loses is dropped whole:
// its standings and its feed are as old as its counter.
export function offerFigures(next: Figures): Figures {
  if (!figures || stampOf(next) >= stampOf(figures)) figures = next;
  return figures;
}

// A body from a server that does not stamp its figures yet counts as stamp 0, so
// every body wins and the page behaves as it did before the stamp existed. The
// frontend deploys on a merge and the backend by hand, so that pair runs in
// production for as long as the redeploy takes, and a landing that quietly froze
// its figures for that window would be the worse failure.
function stampOf(f: Figures): number {
  return f.figuresAt ?? 0;
}

let cached: LandingData | null = null;
let inFlight: Promise<LandingData | null> | null = null;

// One shared GET /landing per session, read by the /play entry guard so the gate
// and the CTA can never disagree on eventStartsAt. Only a successful response is
// cached; a failure stays retryable. The landing page itself reads through
// reloadLanding: this body is as old as the first read of the page load, and its
// interested block, status and figures all go stale behind it.
export function loadLanding(): Promise<LandingData | null> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetch(landingUrl())
      .then((res) => (res.ok ? (res.json() as Promise<LandingData>) : null))
      .catch(() => null)
      .then((data) => {
        if (data) cached = data;
        inFlight = null;
        return data;
      });
  }
  return inFlight;
}

// Re-reads GET /landing and replaces the cached body, which also keeps the entry
// gate agreeing with what the page was just told. Every mount of the landing goes
// through here, and so does the one transition that outdates an open page, a board
// completing under it, where the recap has to be read again.
export async function reloadLanding(): Promise<LandingData | null> {
  const data = await fetch(landingUrl())
    .then((res) => (res.ok ? (res.json() as Promise<LandingData>) : null))
    .catch(() => null);
  if (data) cached = data;
  return data;
}

// How often an open landing re-reads the live figures. The server answers GET
// /live with a longer `s-maxage` than this, so a reader polling at this cadence
// mostly reads an edge cache rather than the origin.
export const LIVE_POLL_INTERVAL_MS = 5_000;

// One poll of the live figures. Never rejects: a failed poll
// resolves to null and the caller keeps what it already has on screen, so a
// blip never repaints the landing.
export async function loadLive(): Promise<LiveData | null> {
  try {
    // `no-store` is what makes the poll a poll: the origin answers `max-age=0`,
    // but Cloudflare's Browser Cache TTL rewrites that on the way out, and a
    // plain fetch would then read the browser's own copy for hours and never see
    // a figure move. The edge still absorbs the load through `s-maxage`.
    const res = await fetch(liveUrl(), { cache: "no-store" });
    return res.ok ? ((await res.json()) as LiveData) : null;
  } catch {
    return null;
  }
}

// Reachability probe for the maintenance screens: does the backend answer at
// all. Deliberately not loadLanding, whose cached success predates the outage
// and would read as "back up" on the first check.
export async function backendReachable(): Promise<boolean> {
  try {
    const res = await fetch(landingUrl(), { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

// Spread between two probes while the backend is unreachable. Randomized so a
// few hundred waiting clients come back staggered rather than in one wave the
// instant the server accepts connections again.
const RETRY_MIN_MS = 8_000;
const RETRY_MAX_MS = 16_000;

export function backendRetryDelayMs(rand: () => number = Math.random): number {
  return RETRY_MIN_MS + Math.floor(rand() * (RETRY_MAX_MS - RETRY_MIN_MS));
}

// /play is sealed only while a real start is scheduled and still in the future.
// An unset start (0) leaves it open, so scheduling the event is what arms the
// gate; dev with no date set keeps /play reachable.
export function eventGateOpen(eventStartsAt: number | null, now = Date.now()): boolean {
  if (eventStartsAt === null || eventStartsAt <= 0) return true;
  return now >= eventStartsAt;
}

// Used by the router guard. A failed /landing fetch (null) opens the gate, so a
// transient blip during the live event never strands a visitor on the countdown.
export async function playRouteOpen(): Promise<boolean> {
  const data = await loadLanding();
  return eventGateOpen(data ? data.eventStartsAt : null);
}
