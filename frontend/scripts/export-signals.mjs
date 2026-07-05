#!/usr/bin/env node
/**
 * export-signals.mjs — emit `signals.json` for downstream consumers
 *
 * Reads the static `frontend/public/data/cot.json` produced by the
 * `backend/scraper/export_static_json.py` pipeline, runs the TS signal
 * engine over it via `tsx`, and writes the result to
 * `frontend/public/data/signals.json`.
 *
 * Consumers:
 *   - `backend/scraper/morning_brief.py` reads signals.json to surface per-rule
 *     CoT signals in the Telegram brief (replacing the previous MM-net-only
 *     summary).
 *   - Standalone HTML export already inlines its own evaluation, so it does
 *     NOT depend on signals.json.
 *
 * Output schema:
 *   {
 *     "date":        "YYYY-MM-DD",        // date of the latest COT row
 *     "scoreNY":     number,              // -10..10, clamped & rounded
 *     "scoreLDN":    number,              // -10..10, clamped & rounded
 *     "signals":     Signal[],            // current week's signals
 *     "history":     HistoricalWeek[],    // last 8 weeks
 *     "generatedAt": ISO timestamp
 *   }
 *
 * Run:
 *   node frontend/scripts/export-signals.mjs                  # default paths
 *   node frontend/scripts/export-signals.mjs --input <path>   # custom input
 *   node frontend/scripts/export-signals.mjs --output <path>  # custom output
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// TS-on-the-fly is provided by the `--import tsx` flag in the npm script
// (`export:signals` in package.json). Running this file directly with
// `node` will fail to import the .ts modules below — use `npm run
// export:signals` or replicate the flag manually.

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..", "..");
const DEFAULT_IN  = resolve(REPO_ROOT, "frontend/public/data/cot.json");
const DEFAULT_OUT = resolve(REPO_ROOT, "frontend/public/data/signals.json");

function parseArgs(argv) {
  const out = { input: DEFAULT_IN, output: DEFAULT_OUT };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--input"  && argv[i + 1]) { out.input  = resolve(argv[++i]); }
    else if (argv[i] === "--output" && argv[i + 1]) { out.output = resolve(argv[++i]); }
  }
  return out;
}

async function main() {
  const { input, output } = parseArgs(process.argv);

  const { transformApiData }                        = await import("../lib/cot/transformApiData.ts");
  const { evaluateSignals, evaluateHistoricalSignals } = await import("../lib/cot/signalEngine.ts");

  const raw       = JSON.parse(await readFile(input, "utf8"));
  const processed = transformApiData(raw);
  if (!processed.length) {
    console.error(`[export-signals] no rows after transformApiData (input=${input})`);
    process.exit(1);
  }

  const latest    = processed[processed.length - 1];
  const signals   = evaluateSignals(processed);
  const history   = evaluateHistoricalSignals(processed, 8);
  const lastWeek  = history[history.length - 1];

  // Preserve non-COT rows (the "AGRO" agronomic alerts that the weather
  // pipeline merges in via agronomic_alerts.merge_into_signals_json). This
  // export owns the COT rows; without this read-merge it would clobber the
  // agronomic block every run — the two workflows write the same file from
  // different concurrency groups. Mirror image of the Python merge, which
  // keeps the COT rows and replaces only AGRO.
  let preserved = [];
  try {
    const prev = JSON.parse(await readFile(output, "utf8"));
    preserved = (prev.signals || []).filter(s => s?.category === "AGRO");
  } catch { /* no existing signals.json yet — nothing to preserve */ }

  const payload = {
    date:        latest.date,
    scoreNY:     lastWeek?.scoreNY  ?? 0,
    scoreLDN:    lastWeek?.scoreLDN ?? 0,
    signals:     [...signals, ...preserved],
    history,
    generatedAt: new Date().toISOString(),
  };

  await writeFile(output, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`[export-signals] wrote ${output}`);
  console.log(`                 date=${payload.date} signals=${signals.length} history=${history.length}`);
  console.log(`                 scoreNY=${payload.scoreNY} scoreLDN=${payload.scoreLDN}`);
}

main().catch(err => { console.error(err); process.exit(1); });
