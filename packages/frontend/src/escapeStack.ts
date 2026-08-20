// Single arbiter for the Escape key. Modals stack over each other and over the
// canvas's carried-cluster cancel, and one window listener per owner fires every
// one of them on a single press, so each owner registers here instead and only
// the most recently registered handler is called.
type EscapeHandler = (event: KeyboardEvent) => void;

const handlers: EscapeHandler[] = [];

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  handlers[handlers.length - 1]?.(event);
}

export function pushEscapeHandler(handler: EscapeHandler): () => void {
  if (handlers.length === 0) window.addEventListener("keydown", onKeydown);
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index === -1) return;
    handlers.splice(index, 1);
    if (handlers.length === 0) window.removeEventListener("keydown", onKeydown);
  };
}
