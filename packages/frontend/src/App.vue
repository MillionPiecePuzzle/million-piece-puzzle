<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import AuthModal from "./components/AuthModal.vue";
import PseudoModal from "./components/PseudoModal.vue";
import { useAuth } from "./composables/useAuth";

// Resolve the session once on boot. This also runs on return from the OAuth
// redirect, routing a freshly signed-in user into pseudo onboarding or
// contributor mode.
onMounted(() => {
  void useAuth().bootstrap();
});
</script>

<template>
  <RouterView />
  <AuthModal />
  <PseudoModal />
</template>
