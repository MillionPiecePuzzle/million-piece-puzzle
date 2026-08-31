import { computed, ref } from "vue";
import { useRafLoop } from "./useRafLoop";
import { useStageControls } from "./useStageControls";

// A browser that ends up drawing this board the wrong way (acceleration off and
// falling back to software, or on over a driver that cannot carry it) renders
// it at a few frames a second, which a player reads as the game being broken
// rather than as their machine. The verdict is the sustained frame rate and
// nothing else: the cause is not knowable from here (no browser agrees on what,
// if anything, its WebGL renderer string may say), so the notice names the
// symptom and leaves the player the checks that fix it.
const SAMPLE_WINDOW_MS = 2_000;
const LOW_FPS = 20;
// 16 unbroken seconds under the bar, one recovered window resetting the count.
// A machine falling back to software rendering is slow for the whole session,
// so waiting costs nothing on the case worth naming, while the expensive
// stretches of ordinary play (arriving on a dense region, a burst of texture
// streaming) are seconds long and recover, and are what a shorter run would
// misread.
const LOW_WINDOWS_TO_RAISE = 8;
// Nothing before the board is playable counts, and not the first seconds after
// it either: building a million pieces and streaming the first textures costs
// frames on any machine, which is the board arriving rather than the device
// failing to draw it.
const WARMUP_MS = 12_000;
// A window far longer than the one it asked for was paused, not slow: rAF stops
// in a hidden tab and resumes with one enormous frame.
const MAX_WINDOW_MS = SAMPLE_WINDOW_MS * 2;

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

// Counts the frames the page itself is given, which is what the player sees:
// the board, its HUD and the compositor all share this thread, so a stage the
// machine cannot draw shows up here with nothing to report from the canvas.
export function createLowFrameRateWatch() {
  let readyAt: number | null = null;
  let windowStart: number | null = null;
  let frames = 0;
  let lowWindows = 0;

  return {
    frame(now: number, ready: boolean, visible: boolean): boolean {
      // A rebuild puts the loading cover back up and starts the wait over.
      if (!ready) {
        readyAt = null;
        windowStart = null;
        lowWindows = 0;
        return false;
      }
      if (readyAt === null) readyAt = now;
      if (now - readyAt < WARMUP_MS) return false;
      if (windowStart === null) {
        windowStart = now;
        frames = 0;
        return false;
      }
      frames++;
      const elapsed = now - windowStart;
      if (elapsed < SAMPLE_WINDOW_MS) return false;
      const measurable = elapsed <= MAX_WINDOW_MS && visible;
      const fps = (frames * 1000) / elapsed;
      lowWindows = measurable && fps < LOW_FPS ? lowWindows + 1 : 0;
      windowStart = now;
      frames = 0;
      return lowWindows >= LOW_WINDOWS_TO_RAISE;
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
