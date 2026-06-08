import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import LandingPage from "./pages/LandingPage.vue";
import PlayPage from "./pages/PlayPage.vue";
import PrivacyPage from "./pages/PrivacyPage.vue";
import LegalPage from "./pages/LegalPage.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "landing", component: LandingPage },
  { path: "/play", name: "play", component: PlayPage },
  { path: "/privacy", name: "privacy", component: PrivacyPage },
  { path: "/legal", name: "legal", component: LegalPage },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
