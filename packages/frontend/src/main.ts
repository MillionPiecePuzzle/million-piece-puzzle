import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { i18n, activeLocale } from "./i18n";
import { consumeAnalyticsOptOut, initAnalytics } from "./analytics";
import { stripAuthFlags } from "./composables/useAuth";
import { installSeoMeta } from "./seo";
import "./styles/tokens.css";
import "./styles/base.css";

document.documentElement.lang = activeLocale();
initAnalytics();
installSeoMeta(router);

createApp(App).use(i18n).use(router).mount("#app");

// Runs after the router's own initial navigation settles, so this replace is
// the last write to the address bar rather than one the router overwrites. Both
// consumers have already been read by then, this only tidies the address bar.
void router.isReady().then(() => {
  const withoutOptOut = consumeAnalyticsOptOut(window.location.href, window.localStorage);
  const cleaned = stripAuthFlags(withoutOptOut ?? window.location.href) ?? withoutOptOut;
  if (cleaned) void router.replace(cleaned);
});
