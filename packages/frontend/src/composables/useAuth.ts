import { ref, readonly } from "vue";
import { useMode } from "./useMode";

export type AuthUser = { name: string; provider: "google" };

const user = ref<AuthUser | null>(null);

export function useAuth() {
  const { setMode } = useMode();

  function signInWithGoogle() {
    user.value = { name: "playful-otter", provider: "google" };
    setMode("contributor");
  }

  function signOut() {
    user.value = null;
    setMode("spectator");
  }

  return {
    user: readonly(user),
    signInWithGoogle,
    signOut,
  };
}
