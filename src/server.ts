import express, { type Request, type Response } from "express";
import { collectNiche } from "./niche/collectNiche.js";
import { YouTubeApiError } from "./youtube/youtubeApi.js";
import { checkNodes, collectOptionsFor, maxUnitsFor, readRows } from "./discover/discover.js";
import { NICHE_TREE, findNode } from "./discover/nicheTree.js";
import { CHARACTERISTICS } from "./discover/characteristics.js";
import { DAILY_AUTO_CAP, DAILY_LIMIT, addUnits, unitsUsedToday } from "./quota.js";
import { analysisFor, commentsFor } from "./analysis.js";
import { buildReport } from "./discover/report.js";
import { loadSuggestions } from "./discover/suggest.js";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

// The search page lives in the "public" folder
app.use(express.static("public"));

// One request does everything: collect (or read from cache), score, find topics
// ?node=<tree id> uses the same saved data as the niche tree; ?q=<topic> is a free-typed search
app.get("/api/analyze", async (req: Request, res: Response) => {
  const node = req.query.node ? findNode(String(req.query.node)) : null;
  const query = node ? node.query : String(req.query.q ?? "").trim();
  const language = req.query.lang === "es" ? "es" : "en";
  const format = req.query.format === "short" || req.query.format === "all" ? req.query.format : "long";

  if (req.query.node && !node) {
    res.status(404).json({ error: "That niche is not in the tree." });
    return;
  }
  if (query.length < 2 || query.length > 80) {
    res.status(400).json({ error: "Type a topic between 2 and 80 characters." });
    return;
  }

  try {
    const result = await collectNiche(
      query,
      node ? collectOptionsFor(node) : { language, format, region: language === "es" ? "MX" : "US" },
    );
    const analysis = analysisFor(result);
    const { comments, unitsUsed: commentUnits } = await commentsFor(analysis.outliers.map((v) => v.id), false);
    await addUnits(result.unitsUsed + commentUnits);
    res.json({ ...analysis, unitsUsed: result.unitsUsed + commentUnits, viewerComments: comments });
  } catch (err: unknown) {
    if (err instanceof YouTubeApiError) {
      const status = err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded" ? 429 : 502;
      res.status(status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Something went wrong." });
  }
});

// ---------- Niche tree (no typing needed) ----------

// Free: the rows under a parent (or the 10 niches), using saved data only
app.get("/api/tree", async (req: Request, res: Response) => {
  const parent = req.query.parent ? findNode(String(req.query.parent)) : null;
  if (req.query.parent && !parent) {
    res.status(404).json({ error: "That niche is not in the tree." });
    return;
  }
  const nodes = parent ? parent.children : NICHE_TREE;
  const rows = await readRows(nodes);
  const unchecked = rows.filter((r) => !r.checked).length;
  res.json({
    parent: parent ? { id: parent.id, query: parent.query, level: parent.level } : null,
    rows,
    unchecked,
    unitsToCheck: nodes.length > 0 ? unchecked * maxUnitsFor(nodes[0].level) : 0,
  });
});

// Spends quota: checks the rows under a parent that have no saved data yet
let checking = false; // one check at a time, so two clicks can't spend twice
app.get("/api/tree/check", async (req: Request, res: Response) => {
  const parent = req.query.parent ? findNode(String(req.query.parent)) : null;
  if (req.query.parent && !parent) {
    res.status(404).json({ error: "That niche is not in the tree." });
    return;
  }
  if (checking) {
    res.status(409).json({ error: "A check is already running. Wait for it to finish." });
    return;
  }
  const nodes = parent ? parent.children : NICHE_TREE;
  // Top level: same budget as "npm run discover". Below: enough for all children.
  const budget = parent ? nodes.length * maxUnitsFor(nodes[0].level) : 4_500;

  checking = true;
  try {
    const report = await checkNodes(nodes, budget, (line) => console.log("   " + line));
    await addUnits(report.unitsUsed);
    res.json(report);
  } finally {
    checking = false;
  }
});

// ---------- Automatic report (no input at all) ----------
// Checks the 10 niches, then the best niche's sub-niches, then the best sub-niche's
// micro-niches, and returns everything plus video ideas for the best one.
// Never auto-spends more than DAILY_AUTO_CAP units per day; saved data is reused for 7 days.

let reportInFlight: ReturnType<typeof buildReport> | null = null; // reloads share one run, never spend twice
app.get("/api/report", async (_req: Request, res: Response) => {
  try {
    reportInFlight ??= buildReport().finally(() => (reportInFlight = null));
    res.json(await reportInFlight);
  } catch (err: unknown) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Something went wrong." });
  }
});

// The raw YouTube data behind a result, so you can check every number yourself (free: saved data only)
app.get("/api/raw", async (req: Request, res: Response) => {
  const node = req.query.node ? findNode(String(req.query.node)) : null;
  const query = node ? node.query : String(req.query.q ?? "").trim();
  const language = req.query.lang === "es" ? "es" : "en";
  const format = req.query.format === "short" || req.query.format === "all" ? req.query.format : "long";
  try {
    const result = await collectNiche(query, {
      ...(node ? collectOptionsFor(node) : { language, format, region: language === "es" ? "MX" : "US" }),
      cacheOnly: true,
    });
    const file = `niche-finder-raw-${query.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
    res.json({
      about: "Raw YouTube Data API v3 data saved by Niche Finder. Every score is calculated from these fields.",
      query: result.query,
      collectedAt: result.savedAt,
      keptVideos: result.videos,
      removedVideos: result.removed.map((r) => ({ id: r.video.id, title: r.video.title, url: r.video.url, filter: r.filter, reason: r.reason })),
      channels: result.channels,
      channelBaselines: result.baselines,
      ordinaryRecentUploads: result.typical,
    });
  } catch (err: unknown) {
    res.status(404).json({ error: err instanceof Error ? err.message : "No saved data for this topic yet." });
  }
});

// Today's YouTube units used by this app (free: reads a small saved file)
app.get("/api/quota", async (_req: Request, res: Response) => {
  const used = await unitsUsedToday();
  res.json({ used, limit: DAILY_LIMIT, left: Math.max(0, DAILY_LIMIT - used), autoCap: DAILY_AUTO_CAP });
});

app.get("/api/characteristics", (_req: Request, res: Response) => {
  res.json(CHARACTERISTICS);
});

// Topics the data suggested on earlier days, so they can be opened and checked
await loadSuggestions();

// Only reachable from your own computer
app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Niche Finder is running: open http://localhost:${PORT}`);
  console.log("   Press Ctrl + C to stop it.");
});
