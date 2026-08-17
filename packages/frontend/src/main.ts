import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { i18n, activeLocale } from "./i18n";
import { consumeAnalyticsOptOut, initAnalytics } from "./analytics";
import { installSeoMeta } from "./seo";
import "./styles/tokens.css";
import "./styles/base.css";

document.documentElement.lang = activeLocale();
initAnalytics();
installSeoMeta(router);

createApp(App).use(i18n).use(router).mount("#app");

// Runs after the router's own initial navigation settles, so this replace is
// the last write to the address bar rather than one the router overwrites.
void router.isReady().then(() => {
  const cleaned = consumeAnalyticsOptOut(window.location.href, window.localStorage);
  if (cleaned) void router.replace(cleaned);
});
