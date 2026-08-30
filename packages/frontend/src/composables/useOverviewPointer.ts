import type { Ref } from "vue";
import type { MapTransform } from "../canvas/overviewView";
import { useOverview } from "./useOverview";

// Press-and-sweep camera jump over an overview canvas, shared by the panel and
// the enlarged view so both invert the same painter's mapping instead of each
// keeping its own copy of the arithmetic.
export function useOverviewPointer(canvasEl: Ref<HTMLCanvasElement | null>) {
  const { navigate } = useOverview();

  // Last canvas->world mapping the draw loop produced, captured so a pointer
  // press can invert it without recomputing the layout. Null until the first
  // real frame.
  let transform: MapTransform | null = null;
  let dragging = false;

  function captureTransform(next: MapTransform | null): void {
    if (next) transform = next;
  }

  // Invert the draw loop's mapping: pointer (CSS px relative to the canvas) ->
  // device px -> world. Works for out-of-bounds points too, so a drag past the
  // canvas edge keeps pushing the camera until applyCamera's clamp stops it.
  function pointerToWorld(ev: PointerEvent): { x: number; y: number } | null {
    const canvas = canvasEl.value;
    if (!canvas || !transform) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const t = transform;
    return {
      x: (cx - t.offX) / t.scale + t.zoneMinX - t.margin,
      y: (cy - t.offY) / t.scale + t.zoneMinY - t.margin,
    };
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const world = pointerToWorld(ev);
    if (!world) return;
    dragging = true;
    // Capture so the sweep keeps tracking the pointer once it leaves the canvas.
    canvasEl.value?.setPointerCapture(ev.pointerId);
    navigate.value?.(world.x, world.y);
    ev.preventDefault();
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!dragging) return;
    const world = pointerToWorld(ev);
    if (world) navigate.value?.(world.x, world.y);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    canvasEl.value?.releasePointerCapture(ev.pointerId);
  }

  return { captureTransform, onPointerDown, onPointerMove, onPointerUp };
}
