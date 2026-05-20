<script setup lang="ts">
import { RouterView } from "vue-router";
import AuthModalStub from "./components/AuthModalStub.vue";
import PseudoModal from "./components/PseudoModal.vue";
</script>

<template>
  <RouterView />
  <AuthModalStub />
  <PseudoModal />
</template>
