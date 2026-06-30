import { computed, ref } from "vue";
import { useMode } from "./useMode";
import { usePseudoModal } from "./usePseudoModal";
import { useNationalityModal } from "./useNationalityModal";
import { authBaseUrl } from "../data/authBaseUrl";

// The authenticated contributor as exposed by GET /auth/session. pseudo and
// country are null until the user completes the forced onboarding steps.
export type SessionUser = {
  id: string;
  name?: string | null;
  image?: string | null;
  pseudo: string | null;
  country: string | null;
};

export type PseudoResult = { ok: true } | { ok: false; reason: "taken" | "invalid" | "error" };
export type CountryResult = { ok: true } | { ok: false; reason: "invalid" | "error" };
export type GuestResult = { ok: true } | { ok: false; reason: "taken" | "invalid" | "error" };

// The one-time guest claim token, stored at mint so a later Google sign-in can
// reattribute the guest's contributions (POST /guest/claim).
const GUEST_CLAIM_TOKEN_KEY = "mpp.guestClaimToken";

const user = ref<SessionUser | null>(null);
const ready = ref(false);
// Pseudo captured in the first guest-onboarding modal, sent with the country to
// POST /guest in the second.
const guestPseudo = ref<string | null>(null);

async function fetchCsrf(): Promise<string> {
  const res = await fetch(`${authBaseUrl()}/auth/csrf`, { credentials: "include" });
  if (!res.ok) throw new Error(`csrf ${res.status}`);
  const data = (await res.json()) as { csrfToken: string };
  return data.csrfToken;
}

// Auth.js sign-in and sign-out are top-level form POSTs (the documented SPA
// pattern): the server then 302s to the provider. A fetch cannot follow the
// cross-origin OAuth redirect, so a real form navigation is required.
function submitForm(action: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

async function getSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${authBaseUrl()}/auth/session`, { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { user?: SessionUser } | null;
      user.value = data?.user ?? null;
    } else {
      user.value = null;
    }
  } catch {
    user.value = null;
  } finally {
    ready.value = true;
  }
  return user.value;
}

async function signIn(provider = "google"): Promise<void> {
  const csrfToken = await fetchCsrf();
  submitForm(`${authBaseUrl()}/auth/signin/${provider}`, {
    csrfToken,
    callbackUrl: window.location.href,
  });
}

async function signOut(): Promise<void> {
  const csrfToken = await fetchCsrf();
  submitForm(`${authBaseUrl()}/auth/signout`, {
    csrfToken,
    callbackUrl: window.location.origin,
  });
}

async function submitPseudo(pseudo: string): Promise<PseudoResult> {
  try {
    const res = await fetch(`${authBaseUrl()}/profile/pseudo`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pseudo }),
    });
    if (res.ok) {
      const data = (await res.json()) as { user: SessionUser };
      user.value = data.user;
      return { ok: true };
    }
    if (res.status === 409) return { ok: false, reason: "taken" };
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

async function submitCountry(country: string): Promise<CountryResult> {
  try {
    const res = await fetch(`${authBaseUrl()}/profile/country`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country }),
    });
    if (res.ok) {
      const data = (await res.json()) as { user: SessionUser };
      user.value = data.user;
      return { ok: true };
    }
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function setGuestPseudo(pseudo: string): void {
  guestPseudo.value = pseudo;
}

// No session yet: mint a guest (a real User + DB session) from the chosen pseudo
// and country. The server sets the session cookie, so the next WS upgrade
// authenticates as this guest with no Google round trip; the one-time claim token
// is stored for a later account sync. A taken pseudo is a 409, surfaced back to
// the pseudo step.
async function createGuest(pseudo: string, country: string): Promise<GuestResult> {
  try {
    const res = await fetch(`${authBaseUrl()}/guest`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pseudo, country }),
    });
    if (res.ok) {
      const data = (await res.json()) as { user: SessionUser; claimToken: string };
      user.value = data.user;
      try {
        localStorage.setItem(GUEST_CLAIM_TOKEN_KEY, data.claimToken);
      } catch {
        // best effort: the claim token only enables a later Google sync
      }
      useMode().setMode("contributor");
      return { ok: true };
    }
    if (res.status === 409) return { ok: false, reason: "taken" };
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// App boot and return-from-redirect: resolve the session and, for a user who
// already finished onboarding, restore contributor mode. The forced onboarding
// itself is deferred to startOnboardingIfNeeded, which the app only runs on
// /play.
async function bootstrap(): Promise<void> {
  const u = await getSession();
  if (!u) return;
  if (u.pseudo !== null && u.country !== null) {
    useMode().setMode("contributor");
  }
}

// Identity gate for /play, run once the session has resolved. A fresh visitor
// (no session) is minted as a guest in-site: the pseudo step, then the country
// step that calls POST /guest, no Google round trip. A signed-in user who has not
// finished onboarding is prompted for the missing pseudo or country.
function startOnboardingIfNeeded(): void {
  const u = user.value;
  if (!u) {
    usePseudoModal().show("guest");
    return;
  }
  if (u.pseudo === null) {
    usePseudoModal().show("forced");
  } else if (u.country === null) {
    useNationalityModal().show("forced");
  }
}

export function useAuth() {
  return {
    user: computed(() => user.value),
    ready: computed(() => ready.value),
    getSession,
    signIn,
    signOut,
    submitPseudo,
    submitCountry,
    guestPseudo: computed(() => guestPseudo.value),
    setGuestPseudo,
    createGuest,
    bootstrap,
    startOnboardingIfNeeded,
  };
}
