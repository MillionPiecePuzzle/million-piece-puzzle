// CLI entry. Parses flags, kicks off the runner.
//
// Usage:
//   npm run start -w @mpp/load-test -- \
//     --target ws://localhost:8080 \
//     --puzzle test-puzzle-10k \
//     --origin http://localhost:5173 \
//     --bots 20 --duration 300 --spawn-interval 250

import { Runner } from "./runner.js";

type Args = {
  target: string;
  puzzle: string;
  origin: string;
  bots: number;
  durationSec: number;
  spawnIntervalMs: number;
  seed: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag || !flag.startsWith("--")) continue;
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  const target = typeof args["target"] === "string" ? args["target"] : "";
  const puzzle = typeof args["puzzle"] === "string" ? args["puzzle"] : "";
  if (!target) throw new Error("missing --target <ws-url>");
  if (!puzzle) throw new Error("missing --puzzle <puzzleId>");
  return {
    target,
    puzzle,
    origin: typeof args["origin"] === "string" ? args["origin"] : "http://localhost:5173",
    bots: typeof args["bots"] === "string" ? parseInt(args["bots"], 10) : 20,
    durationSec: typeof args["duration"] === "string" ? parseInt(args["duration"], 10) : 300,
    spawnIntervalMs:
      typeof args["spawn-interval"] === "string" ? parseInt(args["spawn-interval"], 10) : 250,
    seed: typeof args["seed"] === "string" ? parseInt(args["seed"], 10) : 42,
    verbose: args["verbose"] === true,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runner = new Runner({
    url: args.target,
    puzzleId: args.puzzle,
    origin: args.origin,
    bots: args.bots,
    durationMs: args.durationSec * 1000,
    spawnIntervalMs: args.spawnIntervalMs,
    seed: args.seed,
    verbose: args.verbose,
  });
  await runner.run();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
