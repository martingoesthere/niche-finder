import { analysisFor } from "../analysis.js";
import { collectNiche } from "../niche/collectNiche.js";
import { DAILY_AUTO_CAP, DAILY_LIMIT, addUnits, autoBudgetLeft, unitsUsedToday } from "../quota.js";
import { checkNodes, collectOptionsFor, type NodeRow } from "./discover.js";
import { NICHE_TREE, findNode, type TreeNode } from "./nicheTree.js";

// Automatic report (no input at all): your top 10 choices.
// Checks the 10 niches, then goes deeper into each one, best first: its sub-niches,
// then the best sub-niche's micro-niches. Each pick shows its best path and top video ideas.
// Never auto-spends more than DAILY_AUTO_CAP units per day; saved data is reused for 7 days.

function best(rows: NodeRow[]): NodeRow | null {
  const scored = rows.filter((r) => r.fit !== null).sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
  if (scored.length) return scored[0];
  const checked = rows.filter((r) => r.checked).sort((a, b) => b.sampleSize - a.sampleSize);
  return checked[0] ?? null;
}

type Checked = { rows: NodeRow[]; skipped: number; error: string | null };

async function checkWithinBudget(nodes: TreeNode[]): Promise<Checked> {
  const budget = await autoBudgetLeft();
  const report = await checkNodes(nodes, budget, (line) => console.log("   " + line));
  await addUnits(report.unitsUsed);
  return { rows: report.rows, skipped: report.skipped.length, error: report.error };
}

export type PickIdea = {
  phrase: string;
  tags: string[];
  videoCount: number;
  channelCount: number;
  medianViews: number;
  proof: { title: string; url: string; views: number; subscribers: number | null } | null;
};

export type Pick = {
  rank: number;
  niche: NodeRow;
  bestSub: NodeRow | null;
  bestMicro: NodeRow | null;
  focus: NodeRow; // the most specific level with real data: its numbers and ideas are shown
  subsChecked: number;
  subsTotal: number;
  microsChecked: number;
  microsTotal: number;
  ideas: PickIdea[]; // top 3 video ideas for the focus
};

// Top video ideas for one checked node, from saved data only (free)
async function ideasFor(row: NodeRow) {
  const node = findNode(row.id)!;
  const result = await collectNiche(node.query, { ...collectOptionsFor(node), cacheOnly: true });
  return analysisFor(result);
}

export async function buildReport() {
  const notes: string[] = [];
  let waiting = { niches: 0, subs: 0, micros: 0 };
  let error: string | null = null;

  // 1. The 10 niches
  const niches = await checkWithinBudget(NICHE_TREE);
  waiting.niches = niches.skipped;
  error ??= niches.error;

  // 2. Go deeper, best niche first: its sub-niches, then the best sub-niche's micro-niches.
  //    When today's automatic limit is reached, the rest are read from saved data only.
  const ranked = niches.rows
    .filter((r) => r.checked)
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || b.sampleSize - a.sampleSize);

  const picks: Pick[] = [];
  for (const niche of ranked) {
    const nicheNode = findNode(niche.id)!;
    const subs = await checkWithinBudget(nicheNode.children);
    waiting.subs += subs.skipped;
    error ??= subs.error;
    const scoredSub = subs.rows.find((r) => r.fit !== null) ? best(subs.rows) : null;

    let micros: Checked = { rows: [], skipped: 0, error: null };
    let bestMicro: NodeRow | null = null;
    if (scoredSub) {
      micros = await checkWithinBudget(findNode(scoredSub.id)!.children);
      waiting.micros += micros.skipped;
      error ??= micros.error;
      bestMicro = micros.rows.find((r) => r.fit !== null) ? best(micros.rows) : null;
    }

    const focus = bestMicro ?? scoredSub ?? niche;
    const analysis = await ideasFor(focus);
    picks.push({
      rank: picks.length + 1,
      niche,
      bestSub: scoredSub,
      bestMicro,
      focus,
      subsChecked: subs.rows.filter((r) => r.checked).length,
      subsTotal: subs.rows.length,
      microsChecked: micros.rows.filter((r) => r.checked).length,
      microsTotal: scoredSub ? findNode(scoredSub.id)!.children.length : 0,
      ideas: analysis.topics.slice(0, 3).map((t) => ({
        phrase: t.phrase,
        tags: t.tags,
        videoCount: t.videoCount,
        channelCount: t.channelCount,
        medianViews: t.medianViews,
        proof: t.proof[0]
          ? { title: t.proof[0].title, url: t.proof[0].url, views: t.proof[0].views, subscribers: t.proof[0].subscribers }
          : null,
      })),
    });
  }

  // 3. Rank the 10 picks by the Fit of their most specific checked level
  picks.sort((a, b) => (b.focus.fit ?? -1) - (a.focus.fit ?? -1) || (b.niche.fit ?? -1) - (a.niche.fit ?? -1));
  picks.forEach((p, i) => (p.rank = i + 1));

  if (error) notes.push(`Stopped early: ${error}`);
  const waitingParts = [
    waiting.niches ? `${waiting.niches} niches` : "",
    waiting.subs ? `${waiting.subs} sub-niches` : "",
    waiting.micros ? `${waiting.micros} micro-niches` : "",
  ].filter(Boolean);
  if (waitingParts.length) {
    notes.push(`Today's automatic limit is reached. Still waiting: ${waitingParts.join(", ")}. They'll be checked automatically tomorrow, so this list gets more complete each day.`);
  }

  // Full video ideas for the #1 pick (saved data: free)
  const top = picks[0] ?? null;
  const ideas = top ? { forId: top.focus.id, ...(await ideasFor(top.focus)) } : null;

  return {
    builtAt: new Date().toISOString(),
    unitsUsedToday: await unitsUsedToday(),
    dailyAutoCap: DAILY_AUTO_CAP,
    dailyLimit: DAILY_LIMIT,
    notes,
    picks,
    niches: niches.rows,
    ideas,
  };
}
