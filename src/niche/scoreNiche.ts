import type { ChannelInfo, VideoInfo } from "../youtube/youtubeApi.js";

// ---------- Rules (easy to tune later in Step 6) ----------
export const MIN_VIDEOS_FOR_SCORE = 30; // your minimum data rule
export const MIN_FOR_SUBSCORE = 10; // each score needs at least this many items
export const GIANT_CHANNEL_SUBS = 1_000_000; // excluded from Opportunity
export const OUTLIER_RATIO = 2; // video views must be 2x the channel's subscribers
export const NEW_CHANNEL_DAYS = 182; // "new channel" = started less than 6 months ago
export const MIN_TYPICAL_VIDEOS = 10; // ordinary uploads needed before they can correct a score
const DAY_MS = 86_400_000;

// ---------- Shapes ----------
export type Confidence = "not enough data" | "low" | "medium" | "high";

export type ProofItem = { label: string; detail: string; url: string };

export type Score = {
  name: string;
  score: number | null; // null = not scored
  meaning: string;
  explanation: string;
  proof: ProofItem[];
};

export type WindowStat = { months: number; videos: number; medianViews: number | null };

// The raw numbers behind the scores (shown on the page so you can decide with numbers)
export type NicheMetrics = {
  videos: number; // verified long videos used
  channels: number; // different channels among them
  channelsWithPublicSubs: number;
  medianViews: number | null;
  medianViewsPerDay: number | null;
  medianSubscribers: number | null; // Competition is based on this
  giantChannels: number; // channels with 1M+ subscribers
  smallChannelVideos: number; // videos from channels under 1M (Opportunity pool)
  outlierVideos: number; // of those, videos with 2x+ more views than subscribers
  newChannels: number; // channels less than 6 months old
  newChannelVideos: number; // videos made by those channels
  medianDurationMin: number | null;
  videosLast90Days: number;
  medianLikesPer1kViews: number | null; // engagement: likes per 1,000 views
  medianCommentsPer1kViews: number | null; // engagement: comments per 1,000 views
  // Ordinary recent uploads (30-90 days old, newest first): what normal videos get
  typicalVideos: number; // 0 = not collected
  typicalChannels: number;
  typicalMedianViews: number | null;
  typicalUnder1kShare: number | null; // share of ordinary uploads with fewer than 1,000 views
  typicalSmallChannelVideos: number;
  typicalBreakouts: number; // of those, videos with 2x+ more views than subscribers
  topToTypicalGap: number | null; // median top views / median ordinary views
};

// Which scores were corrected with ordinary uploads (false = based on top videos only)
export type Corrections = { demand: boolean; opportunity: boolean };

export type TypicalInput = { videos: VideoInfo[]; channels: ChannelInfo[] } | null;

export type NicheScores = {
  metrics: NicheMetrics;
  corrected: Corrections;
  sampleSize: number;
  confidence: Confidence;
  windows: WindowStat[];
  demand: Score;
  competition: Score;
  opportunity: Score;
  freshness: Score;
  money: Score;
};

// ---------- Helpers ----------
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Views and subscribers grow 10x at a time, so we score on a "log" scale:
// e.g. 1K -> 0, 10K -> 33, 100K -> 67, 1M -> 100
function logScale(value: number, lowLog: number, highLog: number): number {
  const v = Math.log10(Math.max(value, 1));
  const pct = ((v - lowLog) / (highLog - lowLog)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

// A share (like 15%) turned into 0-100, reaching 100 at `fullAt`
function shareScore(share: number, fullAt: number): number {
  return Math.round(Math.min(100, (share / fullAt) * 100));
}

function confidenceFor(n: number): Confidence {
  if (n < MIN_VIDEOS_FOR_SCORE) return "not enough data";
  if (n < 50) return "low";
  if (n < 100) return "medium";
  return "high";
}

function notScored(name: string, meaning: string, explanation: string): Score {
  return { name, score: null, meaning, explanation, proof: [] };
}

const MEANINGS = {
  demand: "higher = more people watch this topic",
  competition: "higher = bigger channels = harder to compete",
  opportunity: "higher = small channels often get big views",
  freshness: "higher = new channels are making it here",
  money: "expected ad rates",
};

// ---------- Main ----------
export function scoreNiche(
  videos: VideoInfo[],
  channels: ChannelInfo[],
  now = new Date(),
  typical: TypicalInput = null,
): NicheScores {
  const channelById = new Map<string, ChannelInfo>(channels.map((c) => [c.id, c]));
  const subsOf = (v: VideoInfo) => channelById.get(v.channelId)?.subscribers ?? null;
  const n = videos.length;
  const confidence = confidenceFor(n);

  // Views over time: last 3, 6 and 12 months
  const windows: WindowStat[] = [3, 6, 12].map((months) => {
    const cutoff = now.getTime() - months * 30.44 * DAY_MS;
    const inWindow = videos.filter((v) => new Date(v.publishedAt).getTime() >= cutoff);
    return { months, videos: inWindow.length, medianViews: median(inWindow.map((v) => v.views)) };
  });

  // Raw numbers (computed even when there is not enough data to score)
  const allNicheChannels = [...new Set(videos.map((v) => v.channelId))]
    .map((id) => channelById.get(id))
    .filter((c): c is ChannelInfo => c !== undefined);
  const publicSubs = allNicheChannels.map((c) => c.subscribers).filter((x): x is number => x !== null);
  const isNewChannel = (c: ChannelInfo) => now.getTime() - new Date(c.createdAt).getTime() < NEW_CHANNEL_DAYS * DAY_MS;
  const newChannelIds = new Set(allNicheChannels.filter(isNewChannel).map((c) => c.id));
  const smallPool = videos.filter((v) => {
    const subs = subsOf(v);
    return subs !== null && subs > 0 && subs < GIANT_CHANNEL_SUBS;
  });
  const per1k = (count: number | null, views: number) => (count === null || views <= 0 ? null : (count / views) * 1000);
  const roundOrNull = (x: number | null, digits = 0) => (x === null ? null : Number(x.toFixed(digits)));
  const metrics: NicheMetrics = {
    videos: n,
    channels: allNicheChannels.length,
    channelsWithPublicSubs: publicSubs.length,
    medianViews: roundOrNull(median(videos.map((v) => v.views))),
    medianViewsPerDay: roundOrNull(
      median(videos.map((v) => v.views / Math.max(1, (now.getTime() - new Date(v.publishedAt).getTime()) / DAY_MS))),
    ),
    medianSubscribers: roundOrNull(median(publicSubs)),
    giantChannels: publicSubs.filter((x) => x >= GIANT_CHANNEL_SUBS).length,
    smallChannelVideos: smallPool.length,
    outlierVideos: smallPool.filter((v) => v.views >= (subsOf(v) ?? Infinity) * OUTLIER_RATIO).length,
    newChannels: newChannelIds.size,
    newChannelVideos: videos.filter((v) => newChannelIds.has(v.channelId)).length,
    medianDurationMin: roundOrNull(median(videos.map((v) => v.durationSeconds / 60)), 1),
    videosLast90Days: videos.filter((v) => now.getTime() - new Date(v.publishedAt).getTime() <= 90 * DAY_MS).length,
    medianLikesPer1kViews: roundOrNull(
      median(videos.map((v) => per1k(v.likes, v.views)).filter((x): x is number => x !== null)), 1),
    medianCommentsPer1kViews: roundOrNull(
      median(videos.map((v) => per1k(v.comments, v.views)).filter((x): x is number => x !== null)), 2),
    typicalVideos: 0, typicalChannels: 0, typicalMedianViews: null, typicalUnder1kShare: null,
    typicalSmallChannelVideos: 0, typicalBreakouts: 0, topToTypicalGap: null,
  };

  // Ordinary recent uploads (the "not only winners" sample)
  const tVideos = typical?.videos ?? [];
  const tChannelById = new Map<string, ChannelInfo>((typical?.channels ?? []).map((c) => [c.id, c]));
  const tSubsOf = (v: VideoInfo) => tChannelById.get(v.channelId)?.subscribers ?? null;
  const tSmall = tVideos.filter((v) => {
    const subs = tSubsOf(v);
    return subs !== null && subs > 0 && subs < GIANT_CHANNEL_SUBS;
  });
  const tBreakouts = tSmall.filter((v) => v.views >= (tSubsOf(v) ?? Infinity) * OUTLIER_RATIO);
  const tMedian = median(tVideos.map((v) => v.views));
  metrics.typicalVideos = tVideos.length;
  metrics.typicalChannels = new Set(tVideos.map((v) => v.channelId)).size;
  metrics.typicalMedianViews = roundOrNull(tMedian);
  metrics.typicalUnder1kShare = tVideos.length ? roundOrNull(tVideos.filter((v) => v.views < 1000).length / tVideos.length, 2) : null;
  metrics.typicalSmallChannelVideos = tSmall.length;
  metrics.typicalBreakouts = tBreakouts.length;
  metrics.topToTypicalGap = tMedian && metrics.medianViews ? roundOrNull(metrics.medianViews / tMedian, 1) : null;
  const corrected: Corrections = {
    demand: tVideos.length >= MIN_TYPICAL_VIDEOS,
    opportunity: tSmall.length >= MIN_FOR_SUBSCORE,
  };

  const money = notScored(
    "Money",
    MEANINGS.money,
    "Not scored yet: we don't have a real ad-rate data source, and we won't guess.",
  );

  // Minimum data rule: no scores at all below 30 videos
  if (confidence === "not enough data") {
    const why = `Only ${n} verified videos (need ${MIN_VIDEOS_FOR_SCORE}+). Not scored.`;
    return {
      metrics,
      corrected: { demand: false, opportunity: false },
      sampleSize: n,
      confidence,
      windows,
      demand: notScored("Demand", MEANINGS.demand, why),
      competition: notScored("Competition", MEANINGS.competition, why),
      opportunity: notScored("Opportunity", MEANINGS.opportunity, why),
      freshness: notScored("Freshness", MEANINGS.freshness, why),
      money,
    };
  }

  // ---- 1. Demand: median views ----
  const medViews = median(videos.map((v) => v.views)) ?? 0;
  const topByViews = [...videos].sort((a, b) => b.views - a.views).slice(0, 3);
  const topDemand = logScale(medViews, 3, 6);
  const typicalDemand = corrected.demand && tMedian !== null ? logScale(tMedian, 3, 6) : null;
  const demand: Score = {
    name: "Demand",
    score: typicalDemand === null ? topDemand : Math.round((topDemand + typicalDemand) / 2),
    meaning: MEANINGS.demand,
    explanation: typicalDemand === null
      ? `Median ${fmt(medViews)} views across ${n} top videos (1K = 0, 1M+ = 100). Not corrected: fewer than ${MIN_TYPICAL_VIDEOS} ordinary recent uploads found, so this may look better than reality.`
      : `Average of top videos (median ${fmt(medViews)} views = ${topDemand}) and ordinary recent uploads (median ${fmt(tMedian ?? 0)} views across ${tVideos.length} videos = ${typicalDemand}). Scale: 1K = 0, 1M+ = 100.`,
    proof: topByViews.map((v) => ({
      label: v.title,
      detail: `${fmt(v.views)} views | ${v.channelTitle}`,
      url: v.url,
    })),
  };

  // ---- 2. Competition: median subscribers of the niche's channels ----
  const nicheChannels = [...new Set(videos.map((v) => v.channelId))]
    .map((id) => channelById.get(id))
    .filter((c): c is ChannelInfo => c !== undefined && c.subscribers !== null);

  let competition: Score;
  if (nicheChannels.length < MIN_FOR_SUBSCORE) {
    competition = notScored(
      "Competition",
      MEANINGS.competition,
      `Only ${nicheChannels.length} channels with public subscriber counts (need ${MIN_FOR_SUBSCORE}+).`,
    );
  } else {
    const medSubs = median(nicheChannels.map((c) => c.subscribers ?? 0)) ?? 0;
    const biggest = [...nicheChannels].sort((a, b) => (b.subscribers ?? 0) - (a.subscribers ?? 0)).slice(0, 3);
    competition = {
      name: "Competition",
      score: logScale(medSubs, 3, 7),
      meaning: MEANINGS.competition,
      explanation: `Median channel has ${fmt(medSubs)} subscribers, across ${nicheChannels.length} channels (1K = 0, 10M+ = 100).`,
      proof: biggest.map((c) => ({
        label: c.title,
        detail: `${fmt(c.subscribers ?? 0)} subscribers`,
        url: c.url,
      })),
    };
  }

  // ---- 3. Opportunity: small channels getting big views (giants excluded) ----
  const pool = videos.filter((v) => {
    const s = subsOf(v);
    return s !== null && s > 0 && s < GIANT_CHANNEL_SUBS;
  });

  let opportunity: Score;
  if (corrected.opportunity) {
    const share = tBreakouts.length / tSmall.length;
    opportunity = {
      name: "Opportunity",
      score: shareScore(share, 0.3),
      meaning: MEANINGS.opportunity,
      explanation: `Of ${tSmall.length} ordinary recent uploads from channels under 1M subs, ${tBreakouts.length} got ${OUTLIER_RATIO}x+ more views than subscribers (${Math.round(share * 100)}%; 30%+ = 100). Measured on ordinary uploads, not only the most-viewed ones.`,
      proof: [...tBreakouts]
        .map((v) => ({ v, subs: tSubsOf(v) ?? 1 }))
        .sort((a, b) => b.v.views / b.subs - a.v.views / a.subs)
        .slice(0, 3)
        .map(({ v, subs }) => ({
          label: v.title,
          detail: `${fmt(v.views)} views vs ${fmt(subs)} subs (${(v.views / subs).toFixed(1)}x) | ${v.channelTitle}`,
          url: v.url,
        })),
    };
  } else if (pool.length < MIN_FOR_SUBSCORE) {
    opportunity = notScored(
      "Opportunity",
      MEANINGS.opportunity,
      `Only ${pool.length} videos from channels under 1M subscribers (need ${MIN_FOR_SUBSCORE}+).`,
    );
  } else {
    const outliers = pool
      .map((v) => ({ v, subs: subsOf(v) ?? 1, ratio: v.views / (subsOf(v) ?? 1) }))
      .filter((x) => x.ratio >= OUTLIER_RATIO)
      .sort((a, b) => b.ratio - a.ratio);
    const share = outliers.length / pool.length;
    opportunity = {
      name: "Opportunity",
      score: shareScore(share, 0.3),
      meaning: MEANINGS.opportunity,
      explanation: `${outliers.length} of ${pool.length} top videos from channels under 1M subs got ${OUTLIER_RATIO}x+ more views than subscribers (${Math.round(share * 100)}%; 30%+ = 100). Not corrected: fewer than ${MIN_FOR_SUBSCORE} ordinary recent uploads from small channels, so this may look better than reality.`,
      proof: outliers.slice(0, 3).map(({ v, subs, ratio }) => ({
        label: v.title,
        detail: `${fmt(v.views)} views vs ${fmt(subs)} subs (${ratio.toFixed(1)}x) | ${v.channelTitle}`,
        url: v.url,
      })),
    };
  }

  // ---- 4. Freshness: channels less than 6 months old ----
  const allChannels = [...new Set(videos.map((v) => v.channelId))]
    .map((id) => channelById.get(id))
    .filter((c): c is ChannelInfo => c !== undefined);

  let freshness: Score;
  if (allChannels.length < MIN_FOR_SUBSCORE) {
    freshness = notScored(
      "Freshness",
      MEANINGS.freshness,
      `Only ${allChannels.length} channels (need ${MIN_FOR_SUBSCORE}+).`,
    );
  } else {
    const isNew = (c: ChannelInfo) => now.getTime() - new Date(c.createdAt).getTime() < NEW_CHANNEL_DAYS * DAY_MS;
    const newIds = new Set(allChannels.filter(isNew).map((c) => c.id));
    const freshVideos = videos.filter((v) => newIds.has(v.channelId)).sort((a, b) => b.views - a.views);
    const share = freshVideos.length / n;
    freshness = {
      name: "Freshness",
      score: shareScore(share, 0.2),
      meaning: MEANINGS.freshness,
      explanation: `${newIds.size} of ${allChannels.length} channels are less than 6 months old; they made ${freshVideos.length} of ${n} videos (${Math.round(share * 100)}%; 20%+ = 100).`,
      proof: freshVideos.slice(0, 3).map((v) => ({
        label: v.title,
        detail: `${fmt(v.views)} views | channel started ${channelById.get(v.channelId)?.createdAt.slice(0, 10)} | ${v.channelTitle}`,
        url: v.url,
      })),
    };
  }

  return { metrics, corrected, sampleSize: n, confidence, windows, demand, competition, opportunity, freshness, money };
}
