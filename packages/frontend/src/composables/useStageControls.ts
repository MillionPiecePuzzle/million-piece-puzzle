import { computed, ref, shallowRef } from "vue";
import type { PickedSpot } from "../canvas/puzzleStage";

export type StageControls = {
  zoomIn: () => void;
  zoomOut: () => void;
  center: () => void;
  fit: () => void;
  // Personal flags: jump the camera to a marked point, and read the point a new
  // flag is planted on.
  centerOnWorld: (worldX: number, worldY: number) => void;
  viewportCenterWorld: () => { x: number; y: number } | null;
  // A whole framing, position and zoom together, which is what a shared link
  // carries and what a pasted one applies.
  frameWorld: (worldX: number, worldY: number, zoom: number) => void;
  // Bookmarks: let the player mark a spot by aiming at the board itself.
  // `onResize` takes the wheel while a square is being traced, in notches.
  pickSpot: (
    squareWorld: number,
    onResize?: (step: number) => void,
  ) => Promise<PickedSpot | null>;
  setPickSquare: (squareWorld: number) => void;
  cancelPickSpot: () => void;
};

export type StageCamera = {
  x: number;
  y: number;
  zoom: number;
  // World point at the middle of the view, computed by the stage since the
  // transform alone does not give it (the screen size does). Drives the
  // position readout.
  centerX: number;
  centerY: number;
};

const controls = shallowRef<StageControls | null>(null);
const camera = ref<StageCamera>({ x: 0, y: 0, zoom: 1, centerX: 0, centerY: 0 });
const zoomPercent = computed(() => Math.round(camera.value.zoom * 100));
// True only when the board is on screen and interactive (not loading, not
// rebuilding). The shell gates its overlay panels on this so nothing but the
// loading cover and header shows until the canvas is playable.
const ready = ref(false);

export function useStageControls() {
  function setControls(next: StageControls | null): void {
    controls.value = next;
  }
  function setCamera(next: StageCamera): void {
    camera.value = next;
  }
  function setReady(next: boolean): void {
    ready.value = next;
  }
  return { controls, camera, zoomPercent, ready, setControls, setCamera, setReady };
}
