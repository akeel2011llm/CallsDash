/**
 * Writes the current routes, server actions and form fields into tests/parity/baseline.json.
 * Run it (npm run parity:update) after adding a screen or a field on purpose.
 *
 * It refuses when something that was in the baseline has gone and tests/parity/moves.json does not say where or why:
 * that is exactly the "feature quietly lost" case the parity test exists to catch.
 */
import { writeFileSync } from "node:fs";
import { BASELINE, compare, inventory, loadBaseline, loadMoves, redirectSources } from "../tests/helpers/parity";

const now = inventory();
let base;
try { base = loadBaseline(); } catch { base = { routes: [], actions: [], fields: [] }; }
const p = compare(now, base, loadMoves(), redirectSources());
const lost = [...p.missing.routes, ...p.missing.actions, ...p.missing.fields];
if (lost.length || p.brokenRedirects.length) {
  console.error("Not updated. These were in the baseline and are gone without an entry in tests/parity/moves.json:");
  for (const x of lost) console.error("  - " + x);
  for (const x of p.brokenRedirects) console.error("  - moved route without a redirect in next.config.ts: " + x);
  process.exit(1);
}
writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
const added = p.unrecorded.routes.length + p.unrecorded.actions.length + p.unrecorded.fields.length;
console.log(`Baseline written: ${now.routes.length} routes, ${now.actions.length} actions, ${now.fields.length} fields (${added} new).`);
