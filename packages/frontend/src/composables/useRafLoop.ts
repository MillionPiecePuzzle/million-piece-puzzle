import { onBeforeUnmount, onMounted } from "vue";

// Shared rAF-loop lifecycle: schedules `callback` on every animation frame (or
// every Nth, if throttled), started on mount and cancelled on unmount. Used by
// the minimap, its detail modal, and the canvas pin overlay, each polling a
// stage snapshot at their own cadence.
export function useRafLoop(callback: () => void, everyNFrames = 1): void {
  let raf = 0;
  let frame = 0;
  function tick(): void {
    raf = requestAnimationFrame(tick);
    frame++;
    if (frame % everyNFrames === 0) callback();
  }
  onMounted(() => {
    raf = requestAnimationFrame(tick);
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
  });
}
