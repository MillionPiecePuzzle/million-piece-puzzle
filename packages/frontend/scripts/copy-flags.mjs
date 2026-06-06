// Copy the round country-flag SVGs from the circle-flags package into the Vite
// public dir so they are served self-hosted at /flags/<code>.svg. Run by the
// predev/prebuild npm hooks; the output dir is gitignored.

import { createRequire } from "node:module";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("circle-flags/package.json")), "flags");
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "flags");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-flags] ${src} -> ${dest}`);
