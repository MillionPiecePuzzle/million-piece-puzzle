// Camera transform shared with the stage: world maps to screen as
// `screen = world * zoom + offset`. Used by anything overlaying screen-space
// content on the camera-transformed world (peer cursors, the canvas pin
// overlay), so the formula lives in one place.
export type CameraTransform = { x: number; y: number; zoom: number };

export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: CameraTransform,
): { x: number; y: number } {
  return { x: worldX * camera.zoom + camera.x, y: worldY * camera.zoom + camera.y };
}
