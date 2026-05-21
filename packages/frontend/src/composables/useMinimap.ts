import { shallowRef } from "vue";
import type { MinimapSnapshot } from "../canvas/puzzleStage";

// Pull-based bridge from the canvas to the minimap panel: the minimap reads a
// fresh snapshot each animation frame rather than the stage pushing reactive
// updates, so per-frame piece positions never go through Vue reactivity.
export type MinimapSource = () => MinimapSnapshot | null;

const source = shallowRef<MinimapSource | null>(null);

export function useMinimap() {
  function setMinimapSource(next: MinimapSource | null): void {
    source.value = next;
  }
  return { source, setMinimapSource };
}
