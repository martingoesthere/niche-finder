import type { ChannelInfo, VideoInfo } from "../youtube/youtubeApi.js";

// ---------- Rules (easy to tune later in Step 6) ----------
export const MIN_VIDEOS_FOR_SCORE = 30; // your minimum data rule
export const MIN_FOR_SUBSCORE = 10; // each score needs at least this many items
export const GIANT_CHANNEL_SUBS = 1_000_000; // excluded from Opportunity
export const OUTLIER_RATIO = 2; // video views must be 2x the channel's subscribers
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

export type NicheScores = {
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
export function scoreNiche(videos: VideoInfo[], channels: ChannelInfo[], now = new Date()): NicheScores {
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

  const money = notScored(
    "Money",
    MEANINGS.money,
    "Not scored yet: we don't have a real ad-rate data source, and we won't guess.",
  );

  // Minimum data rule: no scores at all below 30 videos
  if (confidence === "not enough data") {
    const why = `Only ${n} verified videos (need ${MIN_VIDEOS_FOR_SCORE}+). Not scored.`;
    return {
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
  const demand: Score = {
    name: "Demand",
    score: logScale(medViews, 3, 6),
    meaning: MEANINGS.demand,
    explanation: `Median ${fmt(medViews)} views across ${n} videos (1K = 0, 1M+ = 100).`,
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
  if (pool.length < MIN_FOR_SUBSCORE) {
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
      explanation: `${outliers.length} of ${pool.length} videos from channels under 1M subs got ${OUTLIER_RATIO}x+ more views than subscribers (${Math.round(share * 100)}%; 30%+ = 100).`,
      proof: outliers.slice(0, 3).map(({ v, subs, ratio }) => ({
        label: v.title,
        detail: `${fmt(v.views)} views vs ${fmt(subs)} subs (${ratio.toFixed(1)}x) | ${v.channelTitle}`,
        url: v.url,
      })),
    };
  }

  // ---- 4. Freshness: channels under 1 year old ----
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
    const isNew = (c: ChannelInfo) => now.getTime() - new Date(c.createdAt).getTime() < 365 * DAY_MS;
    const newIds = new Set(allChannels.filter(isNew).map((c) => c.id));
    const freshVideos = videos.filter((v) => newIds.has(v.channelId)).sort((a, b) => b.views - a.views);
    const share = freshVideos.length / n;
    freshness = {
      name: "Freshness",
      score: shareScore(share, 0.2),
      meaning: MEANINGS.freshness,
      explanation: `${newIds.size} of ${allChannels.length} channels are under 1 year old; they made ${freshVideos.length} of ${n} videos (${Math.round(share * 100)}%; 20%+ = 100).`,
      proof: freshVideos.slice(0, 3).map((v) => ({
        label: v.title,
        detail: `${fmt(v.views)} views | channel started ${channelById.get(v.channelId)?.createdAt.slice(0, 10)} | ${v.channelTitle}`,
        url: v.url,
      })),
    };
  }

  return { sampleSize: n, confidence, windows, demand, competition, opportunity, freshness, money };
}
