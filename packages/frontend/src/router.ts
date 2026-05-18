import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import LandingPage from "./pages/LandingPage.vue";
import PlayPage from "./pages/PlayPage.vue";
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
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
