import { computed, onUnmounted, ref, watch, type Ref } from "vue";

export type CountdownParts = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

// Split a remaining duration into zero-padded DD:HH:MM:SS. Days are padded to two
// digits but never capped, so a launch more than 99 days out reads its true width.
export function formatCountdown(remainingMs: number): CountdownParts {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

// Drives the landing countdown. `scheduled` is true only for a real future start;
// a start of 0 (no date set) or one already in the past leaves it false so the
// caller shows the placeholder. The 1s ticker runs only while a future start is
// pending and stops itself when the start is reached or the component unmounts.
export function useCountdown(eventStartsAt: Ref<number>, now: () => number = () => Date.now()) {
  const current = ref(now());
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick(): void {
    current.value = now();
    if (current.value >= eventStartsAt.value) stop();
  }

  const scheduled = computed(() => eventStartsAt.value > 0 && current.value < eventStartsAt.value);
  // True once a real start has been reached. Flips on the tick that crosses the
  // start, so the landing can swap its CTA without a reload.
  const launched = computed(() => eventStartsAt.value > 0 && current.value >= eventStartsAt.value);
  const remainingMs = computed(() => Math.max(0, eventStartsAt.value - current.value));
  const parts = computed(() => formatCountdown(remainingMs.value));

  watch(
    eventStartsAt,
    (value) => {
      current.value = now();
      stop();
      if (value > 0 && current.value < value) timer = setInterval(tick, 1000);
    },
    { immediate: true },
  );

  onUnmounted(stop);

  return { scheduled, launched, remainingMs, parts };
}
