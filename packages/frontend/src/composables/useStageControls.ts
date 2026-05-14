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

export function useStageControls() {
  function setControls(next: StageControls | null): void {
    controls.value = next;
  }
  function setCamera(next: StageCamera): void {
    camera.value = next;
  }
  return { controls, camera, zoomPercent, setControls, setCamera };
}
