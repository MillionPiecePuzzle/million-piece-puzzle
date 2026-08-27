// One HUD flag button as a drop target for a dragged cluster, in client
// coordinates: the one frame the DOM bar and the canvas both speak. Measured by
// the bar, hit-tested by the stage. The landing spot itself is searched by
// `findFreeOrigin` (@mpp/shared), which the server runs too.

export type FlagDropTarget = { id: string; rect: DOMRect };
export type FlagDropTargetSource = () => FlagDropTarget[];
