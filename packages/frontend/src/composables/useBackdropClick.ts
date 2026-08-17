// A backdrop should close its dialog only when the whole click, press and
// release, lands on the backdrop itself. `@click.self` alone checks only
// where the click event resolves, which the DOM computes as the nearest
// common ancestor of the press and release targets: pressing inside the
// dialog (e.g. selecting text) and releasing over the backdrop still
// resolves there, closing the dialog on an accidental drag.
export function useBackdropClick(onBackdropClick: () => void) {
  let pressedBackdrop = false;

  function onMousedown(e: MouseEvent): void {
    pressedBackdrop = e.target === e.currentTarget;
  }

  function onClick(e: MouseEvent): void {
    if (pressedBackdrop && e.target === e.currentTarget) onBackdropClick();
    pressedBackdrop = false;
  }

  return { onMousedown, onClick };
}
