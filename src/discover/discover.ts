import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectNiche, NotCachedError, type CollectOptions } from "../niche/collectNiche.js";
import { scoreNiche, type Confidence, type NicheMetrics, type WindowStat } from "../niche/scoreNiche.js";
import { findTopics } from "../topics/findTopics.js";
import { NICHE_TREE, PAGES_BY_LEVEL, type NicheGroup, type NicheLevel, type TreeNode } from "./nicheTree.js";

// Default budget for "npm run discover", leaving room for normal searches in your 10,000 daily units
export const DEFAULT_BUDGET = 4_500;

// The tree reuses saved YouTube data for 7 days, so checks you made earlier stay free
const TREE_CACHE_HOURS = 24 * 7;

// Most units one node can use: each page = 1 search (100) + video stats (1) + channel stats (1)
export function maxUnitsFor(level: NicheLevel): number {
  return PAGES_BY_LEVEL[level] * 102;
}

// Same options everywhere, so the page and the scripts share one saved copy per node
export function collectOptionsFor(node: TreeNode): CollectOptions {
  return { language: "en", region: "US", maxPages: PAGES_BY_LEVEL[node.level], maxAgeHours: TREE_CACHE_HOURS };
}

export type NodeRow = {
  id: string;
  query: string;
  level: NicheLevel;
  group: NicheGroup;
  childCount: number;
  checked: boolean; // false = no saved data yet
  checkedAt: string | null;
  confidence: Confidence | null;
  sampleSize: number;
  demand: number | null;
  competition: number | null;
  opportunity: number | null;
  freshness: number | null;
  fit: number | null;
  medianViews: number | null;
  bestOutlier: { title: string; url: string; views: number; subscribers: number | null; ratio: number } | null;
  topTopics: string[];
  // The numbers behind the scores
  metrics: NicheMetrics | null;
  windows: WindowStat[];
  totalFound: number; // videos YouTube returned before filtering
  removed: Record<string, number>; // removed videos by filter
  topicCount: number; // topic ideas found (phrases used by 2+ channels)
  channelOutliers: number; // videos with 3x+ their own channel's average views
};

/**
 * One easy-to-read number for ranking.
 * Equal-weight average of Demand, Opportunity, Freshness and (100 - Competition).
 * A sorting aid, not a prediction. Needs all four scores, otherwise null.
 */
export function fitScore(r: Pick<NodeRow, "demand" | "competition" | "opportunity" | "freshness">): number | null {
  if (r.demand === null || r.competition === null || r.opportunity === null || r.freshness === null) return null;
  return Math.round((r.demand + (100 - r.competition) + r.opportunity + r.freshness) / 4);
}

function emptyRow(node: TreeNode): NodeRow {
  return {
    id: node.id, query: node.query, level: node.level, group: node.group, childCount: node.children.length,
    checked: false, checkedAt: null, confidence: null, sampleSize: 0,
    demand: null, competition: null, opportunity: null, freshness: null, fit: null,
    medianViews: null, bestOutlier: null, topTopics: [],
    metrics: null, windows: [], totalFound: 0, removed: {}, topicCount: 0, channelOutliers: 0,
  };
}

async function rowFor(node: TreeNode, cacheOnly: boolean): Promise<{ row: NodeRow; unitsUsed: number }> {
  let result;
  try {
    result = await collectNiche(node.query, { ...collectOptionsFor(node), cacheOnly });
  } catch (err: unknown) {
    if (err instanceof NotCachedError) return { row: emptyRow(node), unitsUsed: 0 };
    throw err;
  }

  const scores = scoreNiche(result.exactVideos, result.channels);
  const topics = findTopics(result);
  const best = topics.outliers[0];

  const row: NodeRow = {
    ...emptyRow(node),
    checked: true,
    checkedAt: result.savedAt,
    confidence: scores.confidence,
    sampleSize: scores.sampleSize,
    demand: scores.demand.score,
    competition: scores.competition.score,
    opportunity: scores.opportunity.score,
    freshness: scores.freshness.score,
    medianViews: topics.videosUsed > 0 ? Math.round(topics.nicheMedianViews) : null,
    bestOutlier: best
      ? {
          title: best.video.title,
          url: best.video.url,
          views: best.video.views,
          subscribers: best.channel?.subscribers ?? null,
          ratio: Number((best.outlierRatio ?? 0).toFixed(1)),
        }
      : null,
    topTopics: topics.topics.slice(0, 3).map((t) => t.phrase),
    metrics: scores.metrics,
    windows: scores.windows,
    totalFound: result.totalFound,
    removed: result.removed.reduce<Record<string, number>>((acc, r) => {
      acc[r.filter] = (acc[r.filter] ?? 0) + 1;
      return acc;
    }, {}),
    topicCount: topics.topics.length,
    channelOutliers: topics.outliers.length,
  };
  row.fit = fitScore(row);
  return { row, unitsUsed: result.unitsUsed };
}

// Best first: scored by fit, then checked but not scored, then not checked yet
function sortRows(rows: NodeRow[]): NodeRow[] {
  const rank = (r: NodeRow) => (r.fit !== null ? 2 : r.checked ? 1 : 0);
  return [...rows].sort((a, b) => rank(b) - rank(a) || (b.fit ?? 0) - (a.fit ?? 0) || b.sampleSize - a.sampleSize);
}

// Free: only reads saved data, never calls YouTube
export async function readRows(nodes: TreeNode[]): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  for (const node of nodes) rows.push((await rowFor(node, true)).row);
  return sortRows(rows);
}

export type CheckReport = {
  rows: NodeRow[];
  unitsUsed: number;
  skipped: string[]; // not checked, to stay inside the budget
  error: string | null; // e.g. quota used up: rows checked so far are still returned
};

// Spends quota: checks nodes that have no saved data yet, never going over the budget
export async function checkNodes(
  nodes: TreeNode[],
  budget: number,
  log: (line: string) => void = () => {},
): Promise<CheckReport> {
  const rows: NodeRow[] = [];
  const skipped: string[] = [];
  let unitsUsed = 0;
  let error: string | null = null;

  for (const node of nodes) {
    if (error) {
      rows.push((await rowFor(node, true)).row);
      continue;
    }
    const canAfford = unitsUsed + maxUnitsFor(node.level) <= budget;
    try {
      const { row, unitsUsed: used } = await rowFor(node, !canAfford);
      unitsUsed += used;
      rows.push(row);
      if (!row.checked) skipped.push(node.query);
      log(`${!row.checked ? "⏳" : used === 0 ? "📦" : "🌐"} ${node.query}: ${
        !row.checked ? "not checked yet (budget)" : row.fit === null ? `${row.confidence}` : `fit ${row.fit}`
      } (${used} units)`);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
      log(`❌ ${node.query}: ${error}`);
      rows.push(emptyRow(node));
      skipped.push(node.query);
    }
  }

  return { rows: sortRows(rows), unitsUsed, skipped, error };
}

// "npm run discover": checks the 10 top niches and saves a dated copy for backtesting later
export async function runDiscovery(budget = DEFAULT_BUDGET, log: (line: string) => void = () => {}): Promise<CheckReport> {
  const report = await checkNodes(NICHE_TREE, budget, log);
  const dir = path.resolve("data", "history");
  await mkdir(dir, { recursive: true });
  const ranAt = new Date().toISOString();
  await writeFile(path.join(dir, `niches-${ranAt.slice(0, 10)}.json`), JSON.stringify({ ranAt, ...report }, null, 2), "utf8");
  return report;
}
