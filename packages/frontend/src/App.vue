<script setup lang="ts">
import { onMounted, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AuthModal from "./components/AuthModal.vue";
import OptionsModal from "./components/OptionsModal.vue";
import PseudoModal from "./components/PseudoModal.vue";
import NationalityModal from "./components/NationalityModal.vue";
import { useAuth } from "./composables/useAuth";

const route = useRoute();
const { ready, claimSettled, user, bootstrap, startOnboardingIfNeeded } = useAuth();

// Resolve the session once on boot. This also runs on return from the OAuth
// redirect.
onMounted(() => {
  void bootstrap();
});

// Identity onboarding only starts on /play, the page where contribution happens,
// and only once the session has resolved (ready): a fresh visitor is minted as a
// guest, a signed-in user finishes any missing pseudo/country. Re-checked on
// navigation and as the session resolves, so the gate never fires before we know
// whether a session exists. claimSettled holds it off until a pending guest-claim
// has carried over pseudo/country, so a freshly synced account skips onboarding.
watch(
  [() => route.name, ready, claimSettled, user],
  () => {
    if (route.name === "play" && ready.value && claimSettled.value) startOnboardingIfNeeded();
  },
  { immediate: true },
);
</script>

<template>
  <RouterView />
  <AuthModal />
  <OptionsModal />
  <PseudoModal />
  <NationalityModal />
</template>
