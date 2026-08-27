import { shallowRef } from "vue";
import type { MinimapSnapshot } from "../canvas/puzzleStage";

// Pull-based bridge from the canvas to the minimap panel: the minimap reads a
// fresh snapshot each animation frame rather than the stage pushing reactive
// updates, so per-frame piece positions never go through Vue reactivity.
export type MinimapSource = () => MinimapSnapshot | null;

// Push side: the minimap asks the camera to center a world point picked from the
// overview (click or drag), so the panel stays a thin view over the stage.
export type MinimapNavigate = (worldX: number, worldY: number) => void;

const source = shallowRef<MinimapSource | null>(null);
const navigate = shallowRef<MinimapNavigate | null>(null);

export function useMinimap() {
  function setMinimapSource(next: MinimapSource | null): void {
    source.value = next;
  }
  function setMinimapNavigate(next: MinimapNavigate | null): void {
    navigate.value = next;
  }
  return { source, navigate, setMinimapSource, setMinimapNavigate };
}
