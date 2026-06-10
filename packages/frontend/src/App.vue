<script setup lang="ts">
import { onMounted, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AuthModal from "./components/AuthModal.vue";
import PseudoModal from "./components/PseudoModal.vue";
import NationalityModal from "./components/NationalityModal.vue";
import { useAuth } from "./composables/useAuth";

const route = useRoute();
const { ready, user, bootstrap, startOnboardingIfNeeded } = useAuth();

// Resolve the session once on boot. This also runs on return from the OAuth
// redirect.
onMounted(() => {
  void bootstrap();
});

// Forced onboarding (pseudo then nationality) only starts on /play, the page
// where contribution happens. Re-checked on navigation and once the session
// resolves, so a user who signs in elsewhere is onboarded when they reach it.
watch(
  [() => route.name, ready, user],
  () => {
    if (route.name === "play") startOnboardingIfNeeded();
  },
  { immediate: true },
);
</script>

<template>
  <RouterView />
  <AuthModal />
  <PseudoModal />
  <NationalityModal />
</template>
