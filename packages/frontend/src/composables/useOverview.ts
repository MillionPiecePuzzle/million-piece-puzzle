import { shallowRef } from "vue";
import type { OverviewSnapshot } from "../canvas/puzzleStage";

// Pull-based bridge from the canvas to the overview panel: the panel reads a
// fresh snapshot each animation frame rather than the stage pushing reactive
// updates, so per-frame piece positions never go through Vue reactivity.
export type OverviewSource = () => OverviewSnapshot | null;

// Push side: the panel asks the camera to center a world point picked from the
// overview (click or drag), so the panel stays a thin view over the stage.
export type OverviewNavigate = (worldX: number, worldY: number) => void;

const source = shallowRef<OverviewSource | null>(null);
const navigate = shallowRef<OverviewNavigate | null>(null);

export function useOverview() {
  function setOverviewSource(next: OverviewSource | null): void {
    source.value = next;
  }
  function setOverviewNavigate(next: OverviewNavigate | null): void {
    navigate.value = next;
  }
  return { source, navigate, setOverviewSource, setOverviewNavigate };
}
