import type { NicheResult } from "./niche/collectNiche.js";
import { scoreNiche, type Score } from "./niche/scoreNiche.js";
import { findTopics, type VideoSignal } from "./topics/findTopics.js";

// Smaller video shape for the page (only what it shows and filters on)
export function videoForPage(s: VideoSignal) {
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

// Scores, topic ideas and proof videos for one collected niche (no YouTube calls)
export function analysisFor(result: NicheResult) {
  const scores = scoreNiche(result.exactVideos, result.channels);
  const topics = findTopics(result);

  const removed: Record<string, number> = {};
  for (const r of result.removed) removed[r.filter] = (removed[r.filter] ?? 0) + 1;

  const scoreList: Score[] = [scores.demand, scores.competition, scores.opportunity, scores.freshness, scores.money];

  return {
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
  };
}

