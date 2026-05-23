/**
 * Upload a sliced puzzle to R2 via rclone.
 *
 * Wraps `rclone sync generated/<id>/ r2:mpp-assets/<id>/` with parallelism flags
 * tuned for many small AVIF files. Assumes an rclone remote named `r2` is
 * already configured locally and the bucket `mpp-assets` is reachable.
 *
 * Usage:
 *   npm run upload -- --puzzle alpha-3
 *   npm run upload -- --puzzle alpha-3 --dry-run
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Args = {
  puzzle: string;
  dryRun: boolean;
};

const BUCKET = "mpp-assets";
const REMOTE = "r2";
const PUBLIC_BASE = "https://assets.millionpiecepuzzle.com";

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  const puzzle = args["puzzle"];
  if (typeof puzzle !== "string" || puzzle.length === 0) {
    throw new Error("missing required flag --puzzle <id>");
  }
  return { puzzle, dryRun: args["dry-run"] === true };
}

function run(cmd: string, cmdArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const localDir = path.join(repoRoot, "generated", args.puzzle);
  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    throw new Error(`local puzzle directory not found: ${localDir}`);
  }
  if (!existsSync(path.join(localDir, "manifest.json"))) {
    throw new Error(`manifest.json missing in ${localDir}`);
  }
  const dest = `${REMOTE}:${BUCKET}/${args.puzzle}/`;
  const src = `${localDir.replace(/\\/g, "/")}/`;
  const rcloneArgs = [
    "sync",
    src,
    dest,
    "--transfers=64",
    "--checkers=128",
    "--fast-list",
    "--progress",
  ];
  if (args.dryRun) rcloneArgs.push("--dry-run");

  console.log(`[upload] ${args.dryRun ? "(dry-run) " : ""}rclone ${rcloneArgs.join(" ")}`);
  await run("rclone", rcloneArgs);

  const publicBase = `${PUBLIC_BASE}/${args.puzzle}`;
  console.log(`[upload] done. Public URLs:`);
  console.log(`  manifest: ${publicBase}/manifest.json`);
  console.log(`  source:   ${publicBase}/source.avif`);
  console.log(`  pieces:   ${publicBase}/pieces/<bucket>/<id>.avif`);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("upload-puzzle.ts");
if (isMain) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
