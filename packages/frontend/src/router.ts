import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import LandingPage from "./pages/LandingPage.vue";
import PlayPage from "./pages/PlayPage.vue";
import PrivacyPage from "./pages/PrivacyPage.vue";
import LegalPage from "./pages/LegalPage.vue";
import { isAlphaUnlocked } from "./composables/useAlphaGate";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "landing", component: LandingPage },
  {
    path: "/play",
    name: "play",
    component: PlayPage,
    beforeEnter: (_to, _from, next) => {
      if (isAlphaUnlocked()) next();
      else next({ name: "landing" });
    },
  },
  { path: "/privacy", name: "privacy", component: PrivacyPage },
  { path: "/legal", name: "legal", component: LegalPage },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
