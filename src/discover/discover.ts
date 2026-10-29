import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectNiche, DEFAULT_MAX_PAGES, NotCachedError } from "../niche/collectNiche.js";
import { scoreNiche, type Confidence } from "../niche/scoreNiche.js";
import { findTopics } from "../topics/findTopics.js";
import { SEED_NICHES, type SeedGroup } from "./seedNiches.js";

// Most units one new niche can use: each page = 1 search (100) + video stats (1) + channel stats (1)
export const MAX_UNITS_PER_NICHE = DEFAULT_MAX_PAGES * 102;

// Default budget per run, leaving plenty of your 10,000 daily units for normal searches
export const DEFAULT_BUDGET = 4_500;

// Discovery reuses saved YouTube data for 7 days, so several runs build the full list
const DISCOVERY_CACHE_HOURS = 24 * 7;

const DATA_DIR = path.resolve("data");
const LATEST_FILE = path.join(DATA_DIR, "discovery-latest.json");

export type DiscoveryRow = {
  query: string;
  group: SeedGroup;
  checkedAt: string; // when the YouTube data was collected
  confidence: Confidence;
  sampleSize: number;
  demand: number | null;
  competition: number | null;
  opportunity: number | null;
  freshness: number | null;
  fit: number | null; // simple average, see fitScore()
  bestOutlier: { title: string; url: string; views: number; subscribers: number | null; ratio: number } | null;
  topTopic: string | null;
};

export type DiscoveryReport = {
  ranAt: string;
  unitsUsed: number;
  checked: number;
  notCheckedYet: string[]; // skipped this run to protect your quota
  rows: DiscoveryRow[]; // best first
};

/**
 * One easy-to-read number for ranking niches.
 * Equal-weight average of Demand, Opportunity, Freshness and (100 - Competition).
 * It's a sorting aid, not a prediction. Needs all four scores, otherwise null.
 */
export function fitScore(r: Pick<DiscoveryRow, "demand" | "competition" | "opportunity" | "freshness">): number | null {
  if (r.demand === null || r.competition === null || r.opportunity === null || r.freshness === null) return null;
  return Math.round((r.demand + (100 - r.competition) + r.opportunity + r.freshness) / 4);
}

export async function runDiscovery(budget = DEFAULT_BUDGET, log: (line: string) => void = () => {}): Promise<DiscoveryReport> {
  const rows: DiscoveryRow[] = [];
  const notCheckedYet: string[] = [];
  let unitsUsed = 0;

  for (const seed of SEED_NICHES) {
    // Stop before a niche could push us over the budget (saved niches cost 0, so keep trying those)
    const canAffordNew = unitsUsed + MAX_UNITS_PER_NICHE <= budget;

    try {
      const result = await collectNiche(seed.query, {
        language: "en",
        region: "US",
        maxAgeHours: DISCOVERY_CACHE_HOURS,
        cacheOnly: !canAffordNew, // over budget: only use saved data, never call YouTube
      });
      unitsUsed += result.unitsUsed;

      const scores = scoreNiche(result.exactVideos, result.channels);
      const topics = findTopics(result);
      const best = topics.outliers[0];

      const row: DiscoveryRow = {
        query: seed.query,
        group: seed.group,
        checkedAt: result.savedAt,
        confidence: scores.confidence,
        sampleSize: scores.sampleSize,
        demand: scores.demand.score,
        competition: scores.competition.score,
        opportunity: scores.opportunity.score,
        freshness: scores.freshness.score,
        fit: null,
        bestOutlier: best
          ? {
              title: best.video.title,
              url: best.video.url,
              views: best.video.views,
              subscribers: best.channel?.subscribers ?? null,
              ratio: Number((best.outlierRatio ?? 0).toFixed(1)),
            }
          : null,
        topTopic: topics.topics[0]?.phrase ?? null,
      };
      row.fit = fitScore(row);
      rows.push(row);
      log(`${result.fromCache ? "📦" : "🌐"} ${seed.query}: ${row.fit === null ? scores.confidence : `fit ${row.fit}`} (${result.unitsUsed} units)`);
    } catch (err: unknown) {
      if (err instanceof NotCachedError) {
        notCheckedYet.push(seed.query); // over budget and not saved yet: check it next run
        continue;
      }
      // Quota or network problem: stop here and keep what we have
      log(`❌ ${seed.query}: ${err instanceof Error ? err.message : String(err)}`);
      notCheckedYet.push(...SEED_NICHES.slice(SEED_NICHES.indexOf(seed)).map((s) => s.query));
      break;
    }
  }

  // Best first: scored niches by fit, then the rest
  rows.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));

  const report: DiscoveryReport = {
    ranAt: new Date().toISOString(),
    unitsUsed,
    checked: rows.length,
    notCheckedYet: [...new Set(notCheckedYet)],
    rows,
  };

  // Save the latest results, plus a dated copy for backtesting later
  await mkdir(path.join(DATA_DIR, "history"), { recursive: true });
  const json = JSON.stringify(report, null, 2);
  await writeFile(LATEST_FILE, json, "utf8");
  await writeFile(path.join(DATA_DIR, "history", `discovery-${report.ranAt.slice(0, 10)}.json`), json, "utf8");

  return report;
}

export async function readLatestDiscovery(): Promise<DiscoveryReport | null> {
  try {
    return JSON.parse(await readFile(LATEST_FILE, "utf8")) as DiscoveryReport;
  } catch {
    return null;
  }
}
