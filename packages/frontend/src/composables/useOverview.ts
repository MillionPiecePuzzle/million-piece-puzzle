import { shallowRef } from "vue";
import type { OverviewSnapshot } from "../canvas/puzzleStage";

// Pull-based bridge from the canvas to the overview panel: the panel reads a
// fresh snapshot each animation frame rather than the stage pushing reactive
// updates, so per-frame piece positions never go through Vue reactivity.
export type OverviewSource = () => OverviewSnapshot | null;

// Push side: a view asks the camera to center a world point the player picked on
// it (an overview press or sweep, an aimed click on the enlarged reference), so
// every such view stays thin over the stage.
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
