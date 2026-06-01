import { computed, ref } from "vue";
import { useMode } from "./useMode";
import { usePseudoModal } from "./usePseudoModal";
import { authBaseUrl } from "../data/authBaseUrl";

// The authenticated contributor as exposed by GET /auth/session. pseudo is null
// until the user completes the forced onboarding modal.
export type SessionUser = {
  id: string;
  name?: string | null;
  image?: string | null;
  pseudo: string | null;
};

export type PseudoResult = { ok: true } | { ok: false; reason: "taken" | "invalid" | "error" };

const user = ref<SessionUser | null>(null);
const ready = ref(false);

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

// App boot and return-from-redirect: resolve the session, then route the user.
// Signed in with no pseudo -> forced onboarding modal. Signed in with a pseudo
// -> contributor mode, so entering /play opens the authenticated WebSocket.
async function bootstrap(): Promise<void> {
  const u = await getSession();
  if (!u) return;
  if (u.pseudo === null) {
    usePseudoModal().show("forced");
  } else {
    useMode().setMode("contributor");
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
    bootstrap,
  };
}
