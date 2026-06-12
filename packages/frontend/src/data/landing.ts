import type { LandingResponse } from "@mpp/shared";
import { landingUrl } from "./spectatorUrl";

export type InterestState = { count: number; me: boolean };
export type LandingData = LandingResponse;

let cached: LandingData | null = null;
let inFlight: Promise<LandingData | null> | null = null;

// One shared GET /landing per session, read by both the landing countdown and the
// /play entry guard so the gate and the CTA can never disagree on eventStartsAt.
// Only a successful response is cached; a failure stays retryable.
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

// /play is sealed only while a real start is scheduled and still in the future.
// An unset start (0) leaves it open, so scheduling the event is what arms the
// gate; dev with no date set keeps /play reachable.
export function eventGateOpen(eventStartsAt: number | null, now = Date.now()): boolean {
  if (eventStartsAt === null || eventStartsAt <= 0) return true;
  return now >= eventStartsAt;
}

// Used by the router guard. A failed /landing fetch (null) opens the gate, so a
// transient blip during the live event never strands a spectator on the countdown.
export async function playRouteOpen(): Promise<boolean> {
  const data = await loadLanding();
  return eventGateOpen(data ? data.eventStartsAt : null);
}
