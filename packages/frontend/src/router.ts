import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import LandingPage from "./pages/LandingPage.vue";
import PlayPage from "./pages/PlayPage.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "landing", component: LandingPage },
  { path: "/play", name: "play", component: PlayPage },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
