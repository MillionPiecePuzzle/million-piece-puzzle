import { computed, ref, shallowRef } from "vue";

export type StageControls = {
  zoomIn: () => void;
  zoomOut: () => void;
  center: () => void;
  fit: () => void;
};

export type StageCamera = {
  x: number;
  y: number;
  zoom: number;
};

const controls = shallowRef<StageControls | null>(null);
const camera = ref<StageCamera>({ x: 0, y: 0, zoom: 1 });
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
