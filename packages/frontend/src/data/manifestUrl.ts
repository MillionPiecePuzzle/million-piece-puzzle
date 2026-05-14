const DEFAULT_MANIFEST_URL = "/puzzle/manifest.json";

export function resolveManifestUrl(): string {
  return import.meta.env.VITE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
}

export function manifestBaseUrl(url: string): string {
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(0, i + 1) : "/";
}
