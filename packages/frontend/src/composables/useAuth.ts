import { computed, ref } from "vue";
import { useMode } from "./useMode";
import { usePseudo } from "./usePseudo";

export type AuthUser = { name: string };

const signedIn = ref(false);

export function useAuth() {
  const { setMode } = useMode();
  const { pseudo } = usePseudo();

  // A contributor is a signed-in client that has a pseudo. The mock sign-in
  // and the pseudo are set independently, so the user only materializes once
  // both are in place.
  const user = computed<AuthUser | null>(() =>
    signedIn.value && pseudo.value ? { name: pseudo.value } : null,
  );

  function completeSignIn() {
    signedIn.value = true;
    setMode("contributor");
  }

  function signOut() {
    signedIn.value = false;
    setMode("spectator");
  }

  return {
    user,
    completeSignIn,
    signOut,
  };
}
