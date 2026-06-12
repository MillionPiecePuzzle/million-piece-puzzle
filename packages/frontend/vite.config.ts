import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function parseAllowedHosts(raw: string | undefined): true | string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "*" || trimmed === "true") return true;
  const list = trimmed
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

const allowedHosts = parseAllowedHosts(process.env.MPP_ALLOWED_HOSTS);

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
  },
});
