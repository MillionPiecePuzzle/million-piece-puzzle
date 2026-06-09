/**
 * Run the geometry generator at full scale and validate it.
 *
 * The exit-criterion proof for the `piece-generation` track: generates and
 * checks every piece of a 1000x1000 board (1M pieces, ~2M shared edges) without
 * materializing the whole board, then prints the report. Exits non-zero on any
 * violation so it can gate a release.
 *
 *   npm run validate:generation                 # 1000x1000, seed "one-million"
 *   tsx scripts/validate-generation.ts --rows 1000 --cols 1000 --seed photo-x
 */

import { fileURLToPath } from "node:url";
import { validateGeneration } from "@mpp/shared";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function run(argv: string[]): void {
  const rows = Number(flag(argv, "rows") ?? 1000);
  const cols = Number(flag(argv, "cols") ?? 1000);
  const seed = flag(argv, "seed") ?? "one-million";
  const pieceSize = flag(argv, "piece-size") ? Number(flag(argv, "piece-size")) : undefined;

  console.log(
    `validating ${cols}x${rows} (${(rows * cols).toLocaleString()} pieces), seed "${seed}"`,
  );
  const report = validateGeneration({ seed, rows, cols, pieceSize });

  console.log(`pieces:        ${report.pieces.toLocaleString()}`);
  console.log(`interior edges: ${report.interiorEdges.toLocaleString()}`);
  console.log(`unique edges:   ${report.uniqueEdges.toLocaleString()}`);
  console.log(`duration:       ${(report.durationMs / 1000).toFixed(1)}s`);

  if (report.ok) {
    console.log("OK: every piece valid, every shared edge unique");
    return;
  }

  console.error(
    `FAIL: ${report.violationCount} violation(s); first ${report.violationSamples.length}:`,
  );
  for (const sample of report.violationSamples) console.error(`  ${sample}`);
  process.exit(1);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("validate-generation.ts");
if (isMain) {
  run(process.argv.slice(2));
}
