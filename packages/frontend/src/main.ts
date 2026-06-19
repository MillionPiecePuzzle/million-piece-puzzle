import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { i18n, activeLocale } from "./i18n";
import "./styles/tokens.css";
import "./styles/base.css";

document.documentElement.lang = activeLocale();

createApp(App).use(i18n).use(router).mount("#app");
