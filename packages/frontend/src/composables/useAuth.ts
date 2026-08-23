import { computed, ref } from "vue";
import { useMode } from "./useMode";
import { usePseudoModal } from "./usePseudoModal";
import { useNationalityModal } from "./useNationalityModal";
import { authBaseUrl } from "../data/authBaseUrl";

// The authenticated contributor as exposed by GET /auth/session. pseudo and
// country are null until the user completes the forced onboarding steps. guest
// is true for an in-site guest (no Google account) and drives the options menu:
// the sync action while it holds, the synced state carrying email and name once a
// Google account is linked.
export type SessionUser = {
  id: string;
  guest: boolean;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  pseudo: string | null;
  country: string | null;
};

export type PseudoResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "invalid" | "error" }
  | { ok: false; reason: "cooldown"; retryAt: number };
export type CountryResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "error" }
  | { ok: false; reason: "cooldown"; retryAt: number };
export type GuestResult = { ok: true } | { ok: false; reason: "taken" | "invalid" | "error" };

// Guest claim tokens still to spend, oldest first. POST /guest/claim folds the
// guest each one names into the signed-in account. A list rather than a single
// slot: an account switch signs this browser out on the way to Google, so a
// sign-in abandoned there comes back to a fresh guest mint, and that mint must
// not overwrite the token of the guest still waiting to be folded in.
const GUEST_CLAIM_TOKENS_KEY = "mpp.guestClaimTokens";
const LEGACY_GUEST_CLAIM_TOKEN_KEY = "mpp.guestClaimToken";
const MAX_PENDING_CLAIM_TOKENS = 5;

const user = ref<SessionUser | null>(null);
const ready = ref(false);
// True when the session request could not reach the server at all, as opposed to
// the server answering "no session". Onboarding must not start in that case: the
// server that would mint the guest is down, so the player belongs on the
// maintenance screen instead of in a modal whose submit is bound to fail.
const backendDown = ref(false);
// False while a guest-claim is pending on boot, so the onboarding gate does not
// flash a forced-pseudo modal at a freshly synced account before the claim
// settles.
const claimSettled = ref(true);
// Pseudo captured in the first guest-onboarding modal, sent with the country to
// POST /guest in the second.
const guestPseudo = ref<string | null>(null);
// Auth.js error code from a sign-in it refused, handed back by the auth host's
// handoff route as a query param on /play. "AccountNotLinked" is the one that
// happens here: the Google account already belongs to another profile.
const authError = ref<string | null>(null);

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
    backendDown.value = res.status >= 500;
    if (res.ok) {
      const data = (await res.json()) as { user?: SessionUser } | null;
      user.value = data?.user ?? null;
    } else {
      user.value = null;
    }
  } catch {
    backendDown.value = true;
    user.value = null;
  } finally {
    ready.value = true;
  }
  return user.value;
}

async function signIn(provider = "google", callbackUrl = window.location.href): Promise<void> {
  const csrfToken = await fetchCsrf();
  submitForm(`${authBaseUrl()}/auth/signin/${provider}`, { csrfToken, callbackUrl });
}

async function signOutTo(callbackUrl: string): Promise<void> {
  const csrfToken = await fetchCsrf();
  submitForm(`${authBaseUrl()}/auth/signout`, { csrfToken, callbackUrl });
}

async function signOut(): Promise<void> {
  await signOutTo(window.location.origin);
}

// The Google account already belongs to another profile, so Auth.js refuses to
// attach it to this guest as well. Dropping this session first turns the next
// attempt into an ordinary sign-in, which lands in that profile, and the pending
// claim tokens fold this browser's guest into it on arrival.
async function switchToLinkedAccount(): Promise<void> {
  await signOutTo(`${window.location.origin}/play?resumeSignIn=1`);
}

function clearAuthError(): void {
  authError.value = null;
}

const AUTH_ERROR_PARAM = "authError";
const RESUME_SIGN_IN_PARAM = "resumeSignIn";

function readQueryFlag(name: string): string | null {
  try {
    return new URL(window.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

// Strips the flags bootstrap already read, so a reload does not replay them.
// Returns a path+search+hash reference, or null when the URL carried none: the
// caller hands it to router.replace for the same reason consumeAnalyticsOptOut
// does, a raw history write at boot gets clobbered by the router's own initial
// navigation.
export function stripAuthFlags(href: string): string | null {
  const url = new URL(href, window.location.origin);
  const carried = [AUTH_ERROR_PARAM, RESUME_SIGN_IN_PARAM].filter((p) => url.searchParams.has(p));
  if (carried.length === 0) return null;
  for (const param of carried) url.searchParams.delete(param);
  return url.pathname + url.search + url.hash;
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
    if (res.status === 429) {
      const data = (await res.json()) as { retryAt?: number };
      return { ok: false, reason: "cooldown", retryAt: data.retryAt ?? Date.now() };
    }
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
    if (res.status === 429) {
      const data = (await res.json()) as { retryAt?: number };
      return { ok: false, reason: "cooldown", retryAt: data.retryAt ?? Date.now() };
    }
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
      writeClaimTokens([...readClaimTokens(), data.claimToken]);
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

function readClaimTokens(): string[] {
  let tokens: string[] = [];
  try {
    const raw = localStorage.getItem(GUEST_CLAIM_TOKENS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) tokens = parsed.filter((t): t is string => typeof t === "string");
    const legacy = localStorage.getItem(LEGACY_GUEST_CLAIM_TOKEN_KEY);
    if (legacy !== null) {
      tokens = [legacy, ...tokens.filter((t) => t !== legacy)];
      writeClaimTokens(tokens);
    }
  } catch {
    // private mode, disabled storage, or corrupt json: nothing to fold in
  }
  return tokens;
}

function writeClaimTokens(tokens: string[]): void {
  try {
    localStorage.removeItem(LEGACY_GUEST_CLAIM_TOKEN_KEY);
    if (tokens.length === 0) localStorage.removeItem(GUEST_CLAIM_TOKENS_KEY);
    else
      localStorage.setItem(
        GUEST_CLAIM_TOKENS_KEY,
        JSON.stringify(tokens.slice(-MAX_PENDING_CLAIM_TOKENS)),
      );
  } catch {
    // best effort: a token that cannot be stored only costs a later fold-in
  }
}

// Fold every pending guest into the now signed-in account (POST /guest/claim),
// oldest first, filling whatever identity the account is still missing. A 200
// updates the session user and spends the token; a 404 means there is nothing to
// fold in (the guest is gone, or the sign-in linked its document in place), so
// the token is dropped too; any other status keeps it for a later retry.
async function claimGuestContributions(): Promise<void> {
  const pending = readClaimTokens();
  if (pending.length === 0) return;
  const unspent: string[] = [];
  for (const claimToken of pending) {
    try {
      const res = await fetch(`${authBaseUrl()}/guest/claim`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimToken }),
      });
      if (res.ok) {
        const data = (await res.json()) as { user: SessionUser };
        user.value = data.user;
        continue;
      }
      if (res.status !== 404) unspent.push(claimToken);
    } catch {
      // network error: keep the token, a later boot retries
      unspent.push(claimToken);
    }
  }
  writeClaimTokens(unspent);
}

// App boot and return-from-redirect: resolve the session and, for a user who
// already finished onboarding, restore contributor mode. A stored claim token on
// a signed-in session is spent before onboarding runs, so a pseudo and country
// carried over from the guest suppress the forced modals. The forced onboarding
// itself is deferred to startOnboardingIfNeeded, which the app only runs on
// /play.
async function bootstrap(): Promise<void> {
  authError.value = readQueryFlag(AUTH_ERROR_PARAM);
  // Halfway through an account switch: this browser was signed out on purpose
  // and sent back here to finish. Leave for Google straight away, before the
  // onboarding gate can mint the guest a signed-out visitor would get. The
  // callback target is spelled out rather than taken from the current href, so
  // the return lands on a clean /play whatever the address bar still carries.
  if (readQueryFlag(RESUME_SIGN_IN_PARAM) !== null) {
    try {
      await signIn("google", `${window.location.origin}/play`);
      return;
    } catch {
      // the auth host is unreachable: fall through to the ordinary boot, which
      // lands on the maintenance screen rather than a half-finished switch
    }
  }
  const maybeClaim = readClaimTokens().length > 0;
  if (maybeClaim) claimSettled.value = false;
  const u = await getSession();
  if (!u) {
    claimSettled.value = true;
    return;
  }
  if (maybeClaim && u.guest === false) await claimGuestContributions();
  const c = user.value;
  if (c && c.pseudo !== null && c.country !== null) useMode().setMode("contributor");
  claimSettled.value = true;
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
    backendDown: computed(() => backendDown.value),
    authError: computed(() => authError.value),
    clearAuthError,
    switchToLinkedAccount,
    claimSettled: computed(() => claimSettled.value),
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
