import { collectNiche } from "../niche/collectNiche.js";
import { scoreNiche, type Score } from "../niche/scoreNiche.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const query = process.argv.slice(2).join(" ").trim() || "credit cards for college students";

function bar(score: number | null): string {
  if (score === null) return "not scored";
  const filled = Math.round(score / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${score}`;
}

function printScore(s: Score) {
  console.log(`${s.name.padEnd(12)} ${bar(s.score)}   (${s.meaning})`);
  console.log(`             ${s.explanation}`);
  s.proof.forEach((p) => {
    console.log(`             • ${p.label}`);
    console.log(`               ${p.detail}`);
    console.log(`               ${p.url}`);
  });
  console.log("");
}

try {
  const result = await collectNiche(query, { region: "US", language: "en" });
  const scores = scoreNiche(result.exactVideos, result.channels);

  console.log(`📊 Niche: "${result.query}" | ${result.targetCountries.join(", ")} | last ${result.months} months`);
  console.log(
    result.fromCache
      ? `📦 From cache (saved ${result.savedAt}). 0 units used.`
      : `🌐 Fresh from YouTube. About ${result.unitsUsed} units used.`,
  );
  const count = (filter: string) => result.removed.filter((r) => r.filter === filter).length;
  console.log(
    `Removed: ${count("topic")} off-topic | ${count("country")} wrong/unknown country | ${count("language")} wrong language | ${count("format")} Shorts | ${count("category")} music/gaming/comedy`,
  );
  console.log(`Sample: ${scores.sampleSize} verified long videos | Confidence: ${scores.confidence.toUpperCase()}\n`);

  console.log("Views over time (median):");
  scores.windows.forEach((w) =>
    console.log(
      `  last ${String(w.months).padStart(2)} months: ${w.videos} videos | median ${w.medianViews === null ? "n/a" : fmt(w.medianViews)}`,
    ),
  );
  console.log("");

  [scores.demand, scores.competition, scores.opportunity, scores.freshness, scores.money].forEach(printScore);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
}
