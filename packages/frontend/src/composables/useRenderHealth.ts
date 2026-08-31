import { computed, ref } from "vue";
import { useRafLoop } from "./useRafLoop";
import { useStageControls } from "./useStageControls";

// A browser that ends up drawing this board the wrong way (acceleration off and
// falling back to software, or on over a driver that cannot carry it) renders
// it at a few frames a second, which a player reads as the game being broken
// rather than as their machine. The cause is not knowable from here (no browser
// agrees on what, if anything, its WebGL renderer string may say), so the
// notice names the symptom and leaves the player the checks that fix it.

// No browser exposes a frame rate either, so the frames themselves are the
// measure: one longer than this is one the machine could not keep up with.
const SLOW_FRAME_MS = 1000 / 15;
// How long every single frame has to stay slow before it is a verdict. Long
// enough that a hitch (a burst of texture streaming, a garbage collection) is
// not one, short enough that a player on software rendering is told at once.
const SUSTAINED_SLOW_MS = 3_000;
// The board's first seconds are its own arrival, streaming the textures of the
// viewport it opened on, rather than the machine failing to draw it.
const WARMUP_MS = 5_000;

// Per browser like the display preferences, and permanent: this is advice, and
// advice a player has read once and chosen to close must not come back every
// session.
const STORAGE_KEY = "mpp.perfNoticeDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private mode or storage disabled: the notice can return next visit.
  }
}

const lowFrameRate = ref(false);
const dismissed = ref(readDismissed());
const noticeVisible = computed(() => lowFrameRate.value && !dismissed.value);

// Reads the gap between the frames the page itself is given, which is what the
// player sees: the board, its HUD and the compositor all share this thread, so
// a stage the machine cannot draw shows up here with nothing to report from the
// canvas. One fast frame clears everything, so the verdict is only ever an
// unbroken run.
export function createLowFrameRateWatch() {
  let readyAt: number | null = null;
  let lastFrame: number | null = null;
  let slowSince: number | null = null;

  return {
    frame(now: number, ready: boolean, visible: boolean): boolean {
      const previous = lastFrame;
      lastFrame = now;
      // A rebuild puts the loading cover back up and starts the wait over.
      if (!ready) {
        readyAt = null;
        slowSince = null;
        return false;
      }
      if (readyAt === null) readyAt = now;
      if (!visible || now - readyAt < WARMUP_MS) {
        slowSince = null;
        return false;
      }
      if (previous === null || now - previous <= SLOW_FRAME_MS) {
        slowSince = null;
        return false;
      }
      // The gap itself proves nothing: a tab the browser stopped servicing
      // delivers one enormous frame and then normal ones, so the run is timed
      // from this frame rather than from the gap in front of it.
      if (slowSince === null) {
        slowSince = now;
        return false;
      }
      return now - slowSince >= SUSTAINED_SLOW_MS;
    },
  };
}

export function useFrameRateProbe(): void {
  const { ready } = useStageControls();
  const watch = createLowFrameRateWatch();

  useRafLoop(() => {
    if (lowFrameRate.value || dismissed.value) return;
    const visible = document.visibilityState === "visible";
    if (watch.frame(performance.now(), ready.value, visible)) lowFrameRate.value = true;
  });
}

export function useRenderHealth() {
  function dismissNotice(): void {
    dismissed.value = true;
    writeDismissed();
  }
  return { noticeVisible, dismissNotice };
}
