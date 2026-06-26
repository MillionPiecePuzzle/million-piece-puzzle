// The direct-URL admin page and its routes. Mounted by httpApp only when a
// password is configured. Basic-auth gated; the page itself holds no secret. The
// three operations differ in cost: setting the event start applies live, while
// switching the puzzle or wiping everything persist a Redis override and restart
// the process (the container's restart policy boots it back), because the puzzle
// id and seed are consumed at boot to build nearly all server state.

import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";
import type { ConfigOverrides } from "./config.js";
import { adminEventStart, adminPuzzleOverride } from "./redis/keys.js";

// Thrown by switchPuzzle when the requested id is not in the configured list, so
// the handler can answer 400 rather than persisting an override for a puzzle whose
// seed the server does not know.
export class UnknownPuzzleError extends Error {
  constructor(puzzleId: string) {
    super(`unknown puzzle ${puzzleId}`);
    this.name = "UnknownPuzzleError";
  }
}

export type AdminPuzzleOption = { id: string; label: string; current: boolean };

export type AdminDeps = {
  password: string;
  // The puzzles the dropdown offers, recomputed per request so the current marker
  // tracks a live switch. Never carries seeds.
  puzzles: () => AdminPuzzleOption[];
  getEventStartsAt: () => number;
  setEventStartsAt: (at: number) => Promise<void>;
  // Persist the puzzle override; the handler triggers the restart after the
  // response flushes. Throws UnknownPuzzleError for an id outside the list.
  switchPuzzle: (puzzleId: string) => Promise<void>;
  // FLUSHDB + drop the Mongo database; the handler triggers the restart after.
  clearEverything: () => Promise<void>;
  // Injected so tests can assert a restart without killing the test process.
  exit: () => void;
};

// Read the boot-time overrides an earlier admin action persisted. Fail-soft: a
// missing or malformed value just falls back to the env config, never blocks boot.
export async function readAdminOverrides(redis: Redis): Promise<ConfigOverrides> {
  const out: ConfigOverrides = {};
  try {
    const [puzzleRaw, startRaw] = await Promise.all([
      redis.get(adminPuzzleOverride()),
      redis.get(adminEventStart()),
    ]);
    if (puzzleRaw) {
      const parsed = JSON.parse(puzzleRaw) as { puzzleId?: unknown; seed?: unknown };
      if (typeof parsed.puzzleId === "string" && typeof parsed.seed === "string") {
        out.puzzleId = parsed.puzzleId;
        out.generationSeed = parsed.seed;
      }
    }
    if (startRaw) {
      const n = parseInt(startRaw, 10);
      if (Number.isFinite(n)) out.eventStartsAt = n;
    }
  } catch (e) {
    console.error("[admin override]", (e as Error).message);
  }
  return out;
}

// Basic-auth middleware. The username is ignored; only the password is compared,
// in constant time. A failure prompts the browser's native credential dialog.
export function makeAdminAuth(password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const supplied = parseBasicPassword(req.headers.authorization ?? "");
    if (supplied !== null && safeEqual(supplied, password)) {
      next();
      return;
    }
    res
      .status(401)
      .set("WWW-Authenticate", 'Basic realm="mpp-admin", charset="UTF-8"')
      .type("text/plain; charset=utf-8")
      .send("authentication required");
  };
}

function parseBasicPassword(header: string): string | null {
  const m = /^Basic (.+)$/.exec(header);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  return idx < 0 ? null : decoded.slice(idx + 1);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function makeAdminPageHandler(deps: Pick<AdminDeps, "puzzles" | "getEventStartsAt">) {
  return (_req: Request, res: Response): void => {
    res
      .status(200)
      .set("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .send(renderAdminPage({ puzzles: deps.puzzles(), eventStartsAt: deps.getEventStartsAt() }));
  };
}

export function makeAdminEventStartHandler(deps: Pick<AdminDeps, "setEventStartsAt">) {
  return async (req: Request, res: Response): Promise<void> => {
    const at = (req.body as { at?: unknown } | undefined)?.at;
    if (typeof at !== "number" || !Number.isInteger(at) || at < 0) {
      res.status(400).json({ error: "invalid_at" });
      return;
    }
    try {
      await deps.setEventStartsAt(at);
      res.status(200).json({ eventStartsAt: at });
    } catch (e) {
      console.error("[admin event-start]", (e as Error).message);
      res.status(500).json({ error: "server" });
    }
  };
}

export function makeAdminSwitchHandler(deps: Pick<AdminDeps, "switchPuzzle" | "exit">) {
  return async (req: Request, res: Response): Promise<void> => {
    const puzzleId = (req.body as { puzzleId?: unknown } | undefined)?.puzzleId;
    if (typeof puzzleId !== "string" || puzzleId.length === 0) {
      res.status(400).json({ error: "invalid_puzzle" });
      return;
    }
    try {
      await deps.switchPuzzle(puzzleId);
    } catch (e) {
      if (e instanceof UnknownPuzzleError) {
        res.status(400).json({ error: "unknown_puzzle" });
        return;
      }
      console.error("[admin switch]", (e as Error).message);
      res.status(500).json({ error: "server" });
      return;
    }
    restartAfterResponse(res, deps.exit);
    res.status(200).json({ restarting: true, puzzleId });
  };
}

export function makeAdminClearHandler(deps: Pick<AdminDeps, "clearEverything" | "exit">) {
  return async (req: Request, res: Response): Promise<void> => {
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== "WIPE") {
      res.status(400).json({ error: "confirm_required" });
      return;
    }
    try {
      await deps.clearEverything();
    } catch (e) {
      console.error("[admin clear]", (e as Error).message);
      res.status(500).json({ error: "server" });
      return;
    }
    restartAfterResponse(res, deps.exit);
    res.status(200).json({ cleared: true, restarting: true });
  };
}

// Exit once the response has flushed, so the client receives the 200 before the
// socket drops on restart.
function restartAfterResponse(res: Response, exit: () => void): void {
  res.on("finish", () => exit());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAdminPage(state: { puzzles: AdminPuzzleOption[]; eventStartsAt: number }): string {
  const options = state.puzzles
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}"${p.current ? " selected" : ""}>${escapeHtml(
          p.label,
        )}${p.current ? " (current)" : ""}</option>`,
    )
    .join("");
  const stateJson = JSON.stringify({ eventStartsAt: state.eventStartsAt });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>MPP Admin</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
  section h2 { font-size: 1.05rem; margin: 0 0 .5rem; }
  section.danger { border-color: #e0b4b4; background: #fff7f7; }
  label { display: block; font-size: .85rem; color: #555; margin-bottom: .25rem; }
  input, select { font: inherit; padding: .4rem .5rem; border: 1px solid #bbb; border-radius: 6px; }
  input[type=datetime-local], select { width: 100%; box-sizing: border-box; }
  button { font: inherit; padding: .45rem .9rem; border: 0; border-radius: 6px; background: #2b5; color: #fff; cursor: pointer; margin-top: .6rem; }
  button.secondary { background: #888; }
  button.danger { background: #c33; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; }
  .muted { color: #777; font-size: .82rem; }
  .out { margin-top: .6rem; font-size: .85rem; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>MPP Admin</h1>

<section>
  <h2>Event start</h2>
  <label for="start">Scheduled start (local time)</label>
  <input id="start" type="datetime-local" />
  <p class="muted" id="startMs"></p>
  <div class="row">
    <button id="setStart">Set start</button>
    <button id="clearStart" class="secondary" type="button">Clear (no scheduled start)</button>
  </div>
  <div class="out" id="startOut"></div>
</section>

<section>
  <h2>Switch puzzle</h2>
  <label for="puzzle">Active puzzle</label>
  <select id="puzzle">${options}</select>
  <p class="muted">Persists the choice and restarts the server to boot it.</p>
  <button id="switch" type="button">Switch &amp; restart</button>
  <div class="out" id="switchOut"></div>
</section>

<section class="danger">
  <h2>Clear everything</h2>
  <p class="muted">Wipes ALL Redis and Mongo data (pieces, merges, users, sessions) and restarts. Resets the puzzle and event start to their baseline. Irreversible.</p>
  <label for="wipe">Type WIPE to confirm</label>
  <input id="wipe" type="text" autocomplete="off" />
  <button id="clear" class="danger" type="button">Clear everything &amp; restart</button>
  <div class="out" id="clearOut"></div>
</section>

<script>
const STATE = ${stateJson};
const $ = (id) => document.getElementById(id);

function fmtLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function showMs(ms) {
  $("startMs").textContent = ms > 0 ? ("unix ms: " + ms + " (" + new Date(ms).toUTCString() + ")") : "no scheduled start (0)";
}
if (STATE.eventStartsAt > 0) $("start").value = fmtLocal(STATE.eventStartsAt);
showMs(STATE.eventStartsAt);

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

$("setStart").addEventListener("click", async (e) => {
  e.preventDefault();
  const v = $("start").value;
  if (!v) { $("startOut").textContent = "Pick a date first."; return; }
  const ms = new Date(v).getTime();
  const r = await post("/admin/event-start", { at: ms });
  $("startOut").textContent = r.ok ? ("Set to " + ms) : ("Error: " + r.status + " " + JSON.stringify(r.data));
  if (r.ok) showMs(ms);
});

$("clearStart").addEventListener("click", async () => {
  const r = await post("/admin/event-start", { at: 0 });
  $("startOut").textContent = r.ok ? "Cleared (no scheduled start)." : ("Error: " + r.status);
  if (r.ok) { $("start").value = ""; showMs(0); }
});

$("switch").addEventListener("click", async () => {
  const puzzleId = $("puzzle").value;
  if (!confirm("Switch to " + puzzleId + " and restart the server?")) return;
  $("switchOut").textContent = "Switching...";
  const r = await post("/admin/switch-puzzle", { puzzleId });
  $("switchOut").textContent = r.ok
    ? "Override saved. Server is restarting; reload in a few seconds."
    : ("Error: " + r.status + " " + JSON.stringify(r.data));
});

$("clear").addEventListener("click", async () => {
  if ($("wipe").value !== "WIPE") { $("clearOut").textContent = 'Type WIPE to confirm.'; return; }
  if (!confirm("Wipe ALL Redis and Mongo data and restart? This cannot be undone.")) return;
  $("clearOut").textContent = "Wiping...";
  const r = await post("/admin/clear", { confirm: "WIPE" });
  $("clearOut").textContent = r.ok
    ? "Wiped. Server is restarting; reload in a few seconds."
    : ("Error: " + r.status + " " + JSON.stringify(r.data));
});
</script>
</body>
</html>`;
}
