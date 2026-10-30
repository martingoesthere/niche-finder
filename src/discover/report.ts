import { analysisFor } from "../analysis.js";
import { collectNiche } from "../niche/collectNiche.js";
import { DAILY_AUTO_CAP, DAILY_LIMIT, addUnits, autoBudgetLeft, unitsUsedToday } from "../quota.js";
import { checkNodes, collectOptionsFor, type NodeRow } from "./discover.js";
import { NICHE_TREE, findNode, type TreeNode } from "./nicheTree.js";

// Automatic report (no input at all):
// checks the 10 niches, then the best niche's sub-niches, then the best sub-niche's
// micro-niches, and returns everything plus video ideas for the best one.
// Never auto-spends more than DAILY_AUTO_CAP units per day; saved data is reused for 7 days.

function best(rows: NodeRow[]): NodeRow | null {
  const scored = rows.filter((r) => r.fit !== null).sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
  if (scored.length) return scored[0];
  const checked = rows.filter((r) => r.checked).sort((a, b) => b.sampleSize - a.sampleSize);
  return checked[0] ?? null;
}

async function checkWithinBudget(nodes: TreeNode[]): Promise<{ rows: NodeRow[]; note: string | null }> {
  const budget = await autoBudgetLeft();
  const report = await checkNodes(nodes, budget, (line) => console.log("   " + line));
  await addUnits(report.unitsUsed);
  let note: string | null = null;
  if (report.error) note = `Stopped early: ${report.error}`;
  else if (report.skipped.length) note = `${report.skipped.length} not checked yet to protect today's quota. They'll be checked automatically tomorrow.`;
  return { rows: report.rows, note };
}

export async function buildReport() {
  const notes: string[] = [];

  const niches = await checkWithinBudget(NICHE_TREE);
  if (niches.note) notes.push(`Niches: ${niches.note}`);
  const bestNiche = best(niches.rows);

  let subs: NodeRow[] = [];
  let bestSub: NodeRow | null = null;
  if (bestNiche) {
    const node = findNode(bestNiche.id)!;
    const checked = await checkWithinBudget(node.children);
    if (checked.note) notes.push(`Sub-niches: ${checked.note}`);
    subs = checked.rows;
    bestSub = best(subs);
  }

  let micros: NodeRow[] = [];
  let bestMicro: NodeRow | null = null;
  if (bestSub) {
    const node = findNode(bestSub.id)!;
    const checked = await checkWithinBudget(node.children);
    if (checked.note) notes.push(`Micro-niches: ${checked.note}`);
    micros = checked.rows;
    bestMicro = micros.find((r) => r.fit !== null) ? best(micros) : null;
  }

  // Video ideas for the most specific level that has a real score (saved data: free)
  const ideasRow = bestMicro ?? bestSub ?? bestNiche;
  let ideas = null;
  if (ideasRow) {
    const node = findNode(ideasRow.id)!;
    const result = await collectNiche(node.query, { ...collectOptionsFor(node), cacheOnly: true });
    ideas = { forId: ideasRow.id, ...analysisFor(result) };
  }

  return {
    builtAt: new Date().toISOString(),
    unitsUsedToday: await unitsUsedToday(),
    dailyAutoCap: DAILY_AUTO_CAP,
    dailyLimit: DAILY_LIMIT,
    notes,
    path: { niche: bestNiche, sub: bestSub, micro: bestMicro },
    niches: niches.rows,
    subs,
    micros,
    ideas,
  };
}

