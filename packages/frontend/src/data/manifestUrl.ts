const PUZZLES_BASE = "/puzzles";

export function manifestUrlFor(puzzleId: string): string {
  const override = import.meta.env.VITE_MANIFEST_BASE;
  const base = typeof override === "string" && override.length > 0 ? override : PUZZLES_BASE;
  return `${base}/${puzzleId}/manifest.json`;
}

export function manifestBaseUrl(url: string): string {
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(0, i + 1) : "/";
}
