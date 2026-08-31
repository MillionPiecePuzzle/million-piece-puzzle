const DEFAULT_BASE = "https://assets.millionpiecepuzzle.com";

export function manifestUrlFor(puzzleId: string): string {
  const override = import.meta.env.VITE_MANIFEST_BASE;
  const raw = typeof override === "string" && override.length > 0 ? override : DEFAULT_BASE;
  const base = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return `${base}/${puzzleId}/manifest.json`;
}

export function manifestBaseUrl(url: string): string {
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(0, i + 1) : "/";
}

// The DZI convention (see manifest.ts): the descriptor's tiles live in a sibling
// folder named after it, `source.dzi` -> `source_files/`, both paths relative to
// the manifest.
export function dziTilesPath(dziPath: string): string {
  return `${dziPath.replace(/\.[^./]+$/, "")}_files/`;
}
