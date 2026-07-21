import { shallowRef } from "vue";
import type { MinimapDetailSnapshot, MinimapSnapshot } from "../canvas/puzzleStage";

// Pull-based bridge from the canvas to the minimap panel: the minimap reads a
// fresh snapshot each animation frame rather than the stage pushing reactive
// updates, so per-frame piece positions never go through Vue reactivity.
export type MinimapSource = () => MinimapSnapshot | null;

// Push side: the minimap asks the camera to center a world point picked from the
// overview (click or drag), so the panel stays a thin view over the stage.
export type MinimapNavigate = (worldX: number, worldY: number) => void;

// Second pull source for the detail modal only: a whole-play-zone tile scan is
// too costly to run at the minimap's 60fps pull cadence, so it is kept on its own
// bridge, read at a throttled interval only while the modal is mounted.
export type MinimapDetailSource = () => MinimapDetailSnapshot | null;

const source = shallowRef<MinimapSource | null>(null);
const navigate = shallowRef<MinimapNavigate | null>(null);
const detailSource = shallowRef<MinimapDetailSource | null>(null);

export function useMinimap() {
  function setMinimapSource(next: MinimapSource | null): void {
    source.value = next;
  }
  function setMinimapNavigate(next: MinimapNavigate | null): void {
    navigate.value = next;
  }
  function setMinimapDetailSource(next: MinimapDetailSource | null): void {
    detailSource.value = next;
  }
  return {
    source,
    navigate,
    detailSource,
    setMinimapSource,
    setMinimapNavigate,
    setMinimapDetailSource,
  };
}
