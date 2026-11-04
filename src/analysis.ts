import type { NicheResult } from "./niche/collectNiche.js";
import { scoreNiche, type Score } from "./niche/scoreNiche.js";
import { findTopics, type VideoSignal } from "./topics/findTopics.js";
import { getVideoComments, type VideoComments } from "./youtube/enrich.js";

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
    id: s.video.id,
    // views vs the channel's normal views, for every channel (giants included), used by the Explorer
    ratioVsChannel:
      s.channelAvgViews && s.channelAvgViews > 0 ? Number((s.video.views / s.channelAvgViews).toFixed(1)) : null,
    subscribers: s.channel?.subscribers ?? null,
    viewsPerDay: Math.round(s.viewsPerDay),
    ageDays: Math.round(s.ageDays),
    outlierRatio: s.outlierRatio === null ? null : Number(s.outlierRatio.toFixed(1)),
    channelAvgViews: s.channelAvgViews === null ? null : Math.round(s.channelAvgViews),
    baselineSource: s.baselineSource,
    baselineSample: s.baselineSample,
    likes: s.video.likes,
    comments: s.video.comments,
    tags: s.video.tags ?? [],
  };
}

// How many of the top outliers get their comments read (1 unit each, saved 7 days)
export const COMMENT_VIDEOS = 5;

// Top comments and viewer requests on the best outliers. cacheOnly = never call YouTube.
export async function commentsFor(videoIds: string[], cacheOnly: boolean) {
  const out: VideoComments[] = [];
  let unitsUsed = 0;
  for (const id of videoIds.slice(0, COMMENT_VIDEOS)) {
    const { comments, unitsUsed: used } = await getVideoComments(id, cacheOnly);
    unitsUsed += used;
    if (comments) out.push(comments);
  }
  return { comments: out, unitsUsed };
}

// Scores, topic ideas and proof videos for one collected niche (no YouTube calls)
export function analysisFor(result: NicheResult) {
  const scores = scoreNiche(result.exactVideos, result.channels, new Date(), result.typical);
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
    metrics: scores.metrics,
    corrected: scores.corrected,
    typical: result.typical
      ? { savedAt: result.typical.savedAt, windowDays: result.typical.windowDays, totalFound: result.typical.totalFound, used: result.typical.videos.length }
      : null,
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
    topTags: topics.topTags,
    baselines: {
      channels: Object.keys(result.baselines ?? {}).length,
      recentUploadVideos: topics.all.filter((s) => s.baselineSource === "recent uploads").length,
      lifetimeAverageVideos: topics.all.filter((s) => s.baselineSource === "lifetime average").length,
    },
  };
}

