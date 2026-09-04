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
// The same verdict the other way: one fast frame in the middle of a bad stretch
// is not a machine that recovered.
const SUSTAINED_FAST_MS = 3_000;
// The board's first seconds are its own arrival, streaming the textures of the
// viewport it opened on, rather than the machine failing to draw it.
const WARMUP_MS = 5_000;
// A band that comes and goes inside a second is a flicker nobody gets to read,
// and one returning every time the frames wobble is worse than the symptom it
// reports: it holds its ground once raised, and stays away a while once gone.
const MIN_NOTICE_MS = 5_000;
const NOTICE_COOLDOWN_MS = 30_000;

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
// canvas. One frame the other way drops the run in progress, so either verdict
// is only ever an unbroken run. Answers whether the notice belongs on screen.
export function createLowFrameRateWatch() {
  let readyAt: number | null = null;
  let lastFrame: number | null = null;
  let slowSince: number | null = null;
  let fastSince: number | null = null;
  let raisedAt: number | null = null;
  let clearedAt: number | null = null;

  return {
    frame(now: number, ready: boolean, visible: boolean): boolean {
      const previous = lastFrame;
      lastFrame = now;
      // A rebuild puts the loading cover back up and starts the wait over.
      if (!ready) readyAt = null;
      else if (readyAt === null) readyAt = now;
      // A board still loading, a hidden tab and the arrival itself say nothing
      // about the machine, so the run in progress is dropped and a notice
      // already up holds its place until there is something to read again.
      const measurable =
        visible && previous !== null && readyAt !== null && now - readyAt >= WARMUP_MS;
      if (!measurable) {
        slowSince = null;
        fastSince = null;
        return raisedAt !== null;
      }

      if (now - previous > SLOW_FRAME_MS) {
        fastSince = null;
        // The gap itself proves nothing: a tab the browser stopped servicing
        // delivers one enormous frame and then normal ones, so the run is timed
        // from this frame rather than from the gap in front of it.
        if (slowSince === null) slowSince = now;
        else if (
          raisedAt === null &&
          now - slowSince >= SUSTAINED_SLOW_MS &&
          (clearedAt === null || now - clearedAt >= NOTICE_COOLDOWN_MS)
        ) {
          raisedAt = now;
        }
      } else {
        slowSince = null;
        if (fastSince === null) fastSince = now;
        else if (
          raisedAt !== null &&
          now - fastSince >= SUSTAINED_FAST_MS &&
          now - raisedAt >= MIN_NOTICE_MS
        ) {
          raisedAt = null;
          clearedAt = now;
        }
      }
      return raisedAt !== null;
    },
  };
}

export function useFrameRateProbe(): void {
  const { ready } = useStageControls();
  const watch = createLowFrameRateWatch();

  useRafLoop(() => {
    if (dismissed.value) return;
    const visible = document.visibilityState === "visible";
    lowFrameRate.value = watch.frame(performance.now(), ready.value, visible);
  });
}

export function useRenderHealth() {
  function dismissNotice(): void {
    dismissed.value = true;
    writeDismissed();
  }
  return { noticeVisible, dismissNotice };
}
