import express, { type Request, type Response } from "express";
import { collectNiche } from "./niche/collectNiche.js";
import { scoreNiche, type Score } from "./niche/scoreNiche.js";
import { findTopics, type VideoSignal } from "./topics/findTopics.js";
import { YouTubeApiError } from "./youtube/youtubeApi.js";
import { readLatestDiscovery } from "./discover/discover.js";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

// The search page lives in the "public" folder
app.use(express.static("public"));

// Smaller video shape for the page (only what it shows and filters on)
function videoForPage(s: VideoSignal) {
  return {
    title: s.video.title,
    url: s.video.url,
    views: s.video.views,
    publishedAt: s.video.publishedAt,
    durationSeconds: s.video.durationSeconds,
    language: s.video.audioLanguage ?? s.video.textLanguage,
    channelTitle: s.video.channelTitle,
    channelUrl: s.channel?.url ?? null,
    country: s.channel?.country ?? null,
    channelCreatedAt: s.channel?.createdAt ?? null,
    channelVideoCount: s.channel?.videoCount ?? null,
    // views vs the channel's own average, for every channel (giants included), used by the Explorer
    ratioVsChannel:
      s.channelAvgViews && s.channelAvgViews > 0 ? Number((s.video.views / s.channelAvgViews).toFixed(1)) : null,
    subscribers: s.channel?.subscribers ?? null,
    viewsPerDay: Math.round(s.viewsPerDay),
    ageDays: Math.round(s.ageDays),
    outlierRatio: s.outlierRatio === null ? null : Number(s.outlierRatio.toFixed(1)),
    channelAvgViews: s.channelAvgViews === null ? null : Math.round(s.channelAvgViews),
  };
}

// One request does everything: collect (or read from cache), score, find topics
app.get("/api/analyze", async (req: Request, res: Response) => {
  const query = String(req.query.q ?? "").trim();
  const language = req.query.lang === "es" ? "es" : "en";
  const format = req.query.format === "short" || req.query.format === "all" ? req.query.format : "long";

  if (query.length < 2 || query.length > 80) {
    res.status(400).json({ error: "Type a topic between 2 and 80 characters." });
    return;
  }

  try {
    const result = await collectNiche(query, { language, format, region: language === "es" ? "MX" : "US" });
    const scores = scoreNiche(result.exactVideos, result.channels);
    const topics = findTopics(result);

    const removed: Record<string, number> = {};
    for (const r of result.removed) removed[r.filter] = (removed[r.filter] ?? 0) + 1;

    const scoreList: Score[] = [scores.demand, scores.competition, scores.opportunity, scores.freshness, scores.money];

    res.json({
      query: result.query,
      language: result.language,
      targetCountries: result.targetCountries,
      fromCache: result.fromCache,
      savedAt: result.savedAt,
      unitsUsed: result.unitsUsed,
      pagesFetched: result.pagesFetched,
      totalFound: result.totalFound,
      removed,
      sampleSize: scores.sampleSize,
      confidence: scores.confidence,
      windows: scores.windows,
      scores: scoreList,
      topics: topics.topics.slice(0, 10).map((t) => ({
        phrase: t.phrase,
        tags: t.tags,
        videoCount: t.videos.length,
        channelCount: t.channelCount,
        medianViews: Math.round(t.medianViews),
        medianViewsPerDay: Math.round(t.medianViewsPerDay),
        recentVideos: t.recentVideos,
        proof: t.videos.slice(0, 3).map(videoForPage),
      })),
      format: result.format,
      videos: topics.all.map(videoForPage),
      outliers: topics.outliers.slice(0, 5).map(videoForPage),
      momentum: topics.momentum.slice(0, 5).map(videoForPage),
    });
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

// Latest discovery ranking (made by "npm run discover"; reading it costs nothing)
app.get("/api/discovery", async (_req: Request, res: Response) => {
  const report = await readLatestDiscovery();
  if (!report) {
    res.status(404).json({ error: 'No discovered niches yet. In the terminal, run: npm run discover' });
    return;
  }
  res.json(report);
});

// Only reachable from your own computer
app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Niche Finder is running: open http://localhost:${PORT}`);
  console.log("   Press Ctrl + C to stop it.");
});
