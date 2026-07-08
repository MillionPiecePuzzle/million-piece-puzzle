import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

const TICK_MS = 10000;

type Translate = (key: string, params?: Record<string, unknown>) => string;

// Ladder for every "time ago" display in the app: seconds for the first minute,
// then minutes, hours, and days as the gap widens. One shared ladder so the
// live in-canvas ticker and the landing page's activity feed never drift apart.
export function formatRelativeTime(elapsedMs: number, t: Translate): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 10) return t("time.justNow");
  if (seconds < 60) return t("time.secondsAgo", { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { n: hours });
  return t("time.daysAgo", { n: Math.floor(hours / 24) });
}

// Re-ticks every 10s so any mounted caller's relative timestamps stay live
// without each one polling Date.now() on its own.
export function useRelativeTime() {
  const { t } = useI18n();
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now();
    }, TICK_MS);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  function relativeTime(at: number): string {
    return formatRelativeTime(now.value - at, t);
  }

  return { relativeTime };
}
