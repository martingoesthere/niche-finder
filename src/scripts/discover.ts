import { DEFAULT_BUDGET, MAX_UNITS_PER_NICHE, runDiscovery } from "../discover/discover.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Optional: npm run discover -- 3000   (a different unit budget)
const budgetArg = Number(process.argv[2]);
const budget = Number.isFinite(budgetArg) && budgetArg > 0 ? budgetArg : DEFAULT_BUDGET;

console.log(`🧭 Discovering niches | budget ${fmt(budget)} units (up to ~${MAX_UNITS_PER_NICHE} per new niche)\n`);

try {
  const report = await runDiscovery(budget, (line) => console.log("   " + line));

  console.log(`\n✅ Done. ${report.checked} niches checked | about ${fmt(report.unitsUsed)} units used this run`);
  if (report.notCheckedYet.length > 0) {
    console.log(`⏳ Not checked yet (to protect your quota): ${report.notCheckedYet.length}. Run again tomorrow to continue.`);
  }

  console.log("\n🏆 RANKING (fit = average of Demand, Opportunity, Freshness and 100 − Competition)\n");
  report.rows.forEach((r, i) => {
    const s = (n: number | null) => (n === null ? " —" : String(n).padStart(3));
    const fit = r.fit === null ? `not scored (${r.confidence}, ${r.sampleSize} videos)` : `fit ${r.fit}`;
    console.log(`${String(i + 1).padStart(2)}. ${r.query} [${r.group}]  ${fit}`);
    if (r.fit !== null) {
      console.log(`    demand ${s(r.demand)} | competition ${s(r.competition)} | opportunity ${s(r.opportunity)} | freshness ${s(r.freshness)} | confidence ${r.confidence}`);
    }
    if (r.bestOutlier) {
      const subs = r.bestOutlier.subscribers === null ? "hidden" : fmt(r.bestOutlier.subscribers);
      console.log(`    best proof: "${r.bestOutlier.title}" ${fmt(r.bestOutlier.views)} views, ${subs} subs (${r.bestOutlier.ratio}x its channel)`);
      console.log(`    ${r.bestOutlier.url}`);
    }
    if (r.topTopic) console.log(`    top topic idea: "${r.topTopic}"`);
    console.log("");
  });
  console.log("Results saved in the data folder (with a dated copy for backtesting later).");
} catch (err: unknown) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
