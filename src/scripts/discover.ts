import { DEFAULT_BUDGET, maxUnitsFor, runDiscovery } from "../discover/discover.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Optional: npm run discover -- 3000   (a different unit budget)
const budgetArg = Number(process.argv[2]);
const budget = Number.isFinite(budgetArg) && budgetArg > 0 ? budgetArg : DEFAULT_BUDGET;

console.log(`🧭 Checking the 10 niches | budget ${fmt(budget)} units (up to ~${maxUnitsFor("niche")} per new niche)\n`);

try {
  const report = await runDiscovery(budget, (line) => console.log("   " + line));

  console.log(`\n✅ Done. About ${fmt(report.unitsUsed)} units used this run.`);
  if (report.error) console.log(`⚠️ Stopped early: ${report.error}`);
  if (report.skipped.length > 0) {
    console.log(`⏳ Not checked yet: ${report.skipped.join(", ")}. Run again tomorrow to continue.`);
  }

  console.log("\n🏆 RANKING (fit = average of Demand, Opportunity, Freshness and 100 − Competition)\n");
  report.rows.forEach((r, i) => {
    const s = (n: number | null) => (n === null ? "—" : String(n));
    const label = !r.checked ? "not checked yet" : r.fit === null ? `not scored (${r.confidence}, ${r.sampleSize} videos)` : `fit ${r.fit}`;
    console.log(`${String(i + 1).padStart(2)}. ${r.query} [${r.group}]  ${label}`);
    if (r.fit !== null) {
      console.log(`    demand ${s(r.demand)} | competition ${s(r.competition)} | opportunity ${s(r.opportunity)} | freshness ${s(r.freshness)} | confidence ${r.confidence}`);
    }
    if (r.topTopics.length) console.log(`    popular topics: ${r.topTopics.map((t) => `"${t}"`).join(", ")}`);
    if (r.bestOutlier) console.log(`    best proof: "${r.bestOutlier.title}" (${r.bestOutlier.ratio}x its channel) ${r.bestOutlier.url}`);
    console.log("");
  });
  console.log("Open the app (npm run dev) to click into sub-niches and micro-niches.");
} catch (err: unknown) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
