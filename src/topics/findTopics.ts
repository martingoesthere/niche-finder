import type { NicheResult } from "../niche/collectNiche.js";
import { median } from "../niche/scoreNiche.js";
import { toWords } from "../niche/relevance.js";
import type { ChannelInfo, VideoInfo } from "../youtube/youtubeApi.js";

// ---------- Rules (easy to tune in Step 6) ----------
export const OUTLIER_MIN_RATIO = 3; // video views must be 3x the channel's average views per video
export const GIANT_CHANNEL_SUBS = 1_000_000; // giant channels can't count as outliers
export const RECENT_DAYS = 90; // "recent" = published in the last 90 days
export const MIN_TOPIC_CHANNELS = 2; // a topic must work for at least 2 different channels
export const REPEATED_CHANNELS = 3; // 3+ channels = "repeated success"
export const MOMENTUM_FACTOR = 1.5; // 1.5x the niche's median views per day = momentum
const DAY_MS = 86_400_000;

// Extra title words that never describe a topic
const TITLE_STOP_WORDS = new Set([
  "you", "i", "we", "it", "do", "don", "t", "s", "get", "about", "from", "why", "when", "will", "can",
  "after", "before", "here", "these", "those", "they", "their", "them", "be", "not", "so", "if", "all",
  "just", "only", "really", "should", "need", "use", "using", "video", "full", "guide", "explained",
  "shorts", "part", "ever", "every", "more", "most", "much", "out", "up", "at", "by", "as", "who",
  // filler words found in real titles during testing ("getting", "over", "people", "actually")
  "getting", "over", "people", "actually", "keep", "keeping", "thing", "stop", "doing", "now", "worth",
  "make", "made", "way", "still", "even", "without", "into", "off", "than", "then", "go", "going",
  "know", "want", "like", "look", "see", "watch", "time", "day", "year", "month", "said", "say",
]);

// ---------- Shapes ----------
export type VideoSignal = {
  video: VideoInfo;
  channel: ChannelInfo | null;
  ageDays: number;
  viewsPerDay: number;
  channelAvgViews: number | null; // channel's lifetime views / number of videos
  outlierRatio: number | null; // video views / channel average
};

export type TopicTag = "outlier" | "repeated" | "momentum" | "gap";

export type TopicIdea = {
  phrase: string;
  videos: VideoSignal[];
  channelCount: number;
  medianViews: number;
  medianViewsPerDay: number;
  recentVideos: number;
  bestOutlierRatio: number | null;
  tags: TopicTag[];
};

export type TopicReport = {
  videosUsed: number;
  nicheMedianViews: number;
  nicheMedianViewsPerDay: number;
  outliers: VideoSignal[];
  momentum: VideoSignal[];
  topics: TopicIdea[];
};

// ---------- Helpers ----------
function toSignal(video: VideoInfo, channel: ChannelInfo | null, now: Date): VideoSignal {
  const ageDays = Math.max(1, (now.getTime() - new Date(video.publishedAt).getTime()) / DAY_MS);
  const channelAvgViews =
    channel && channel.videoCount > 0 ? channel.totalViews / channel.videoCount : null;
  const isGiant = channel?.subscribers !== null && (channel?.subscribers ?? 0) >= GIANT_CHANNEL_SUBS;
  const outlierRatio =
    channelAvgViews && channelAvgViews > 0 && !isGiant ? video.views / channelAvgViews : null;
  return { video, channel, ageDays, viewsPerDay: video.views / ageDays, channelAvgViews, outlierRatio };
}

// Phrases of 1 to 3 words from a title, without the niche's own words
function phrasesOf(title: string, nicheWords: Set<string>): string[] {
  const words = toWords(title).filter((w) => !TITLE_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const phrases = new Set<string>();
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const gram = words.slice(i, i + size);
      if (gram.some((w) => nicheWords.has(w))) continue;
      if (size === 1 && gram[0].length < 4) continue; // single short words are too vague
      phrases.add(gram.join(" "));
    }
  }
  return [...phrases];
}

// ---------- Main ----------
export function findTopics(result: NicheResult, now = new Date()): TopicReport {
  const channelById = new Map<string, ChannelInfo>(result.channels.map((c) => [c.id, c]));
  const signals = result.videos.map((v) => toSignal(v, channelById.get(v.channelId) ?? null, now));

  const nicheMedianViews = median(signals.map((s) => s.video.views)) ?? 0;
  const nicheMedianViewsPerDay = median(signals.map((s) => s.viewsPerDay)) ?? 0;

  // 1. Outliers: videos far above their own channel's normal
  const outliers = signals
    .filter((s) => s.outlierRatio !== null && s.outlierRatio >= OUTLIER_MIN_RATIO)
    .sort((a, b) => (b.outlierRatio ?? 0) - (a.outlierRatio ?? 0));

  // 2. Momentum: recent videos with the most views per day
  const momentum = signals
    .filter((s) => s.ageDays <= RECENT_DAYS)
    .sort((a, b) => b.viewsPerDay - a.viewsPerDay);

  // 3. Topics: phrases that appear in titles from several channels
  const nicheWords = new Set(result.keywords);
  const byPhrase = new Map<string, VideoSignal[]>();
  for (const s of signals) {
    for (const phrase of phrasesOf(s.video.title, nicheWords)) {
      const list = byPhrase.get(phrase) ?? [];
      list.push(s);
      byPhrase.set(phrase, list);
    }
  }

  let topics: TopicIdea[] = [];
  for (const [phrase, videos] of byPhrase) {
    const channelCount = new Set(videos.map((s) => s.video.channelId)).size;
    if (channelCount < MIN_TOPIC_CHANNELS) continue;

    const medianViews = median(videos.map((s) => s.video.views)) ?? 0;
    const medianViewsPerDay = median(videos.map((s) => s.viewsPerDay)) ?? 0;
    const recentVideos = videos.filter((s) => s.ageDays <= RECENT_DAYS).length;
    const ratios = videos.map((s) => s.outlierRatio).filter((r): r is number => r !== null);
    const bestOutlierRatio = ratios.length > 0 ? Math.max(...ratios) : null;

    const tags: TopicTag[] = [];
    if (bestOutlierRatio !== null && bestOutlierRatio >= OUTLIER_MIN_RATIO) tags.push("outlier");
    if (channelCount >= REPEATED_CHANNELS) tags.push("repeated");
    if (medianViewsPerDay >= nicheMedianViewsPerDay * MOMENTUM_FACTOR) tags.push("momentum");
    if (medianViews >= nicheMedianViews && recentVideos <= 1) tags.push("gap");

    topics.push({
      phrase,
      videos: [...videos].sort((a, b) => b.video.views - a.video.views),
      channelCount,
      medianViews,
      medianViewsPerDay,
      recentVideos,
      bestOutlierRatio,
      tags,
    });
  }

  // If two phrases cover exactly the same videos, keep only the longer one ("never pay" over "pay")
  const keyOf = (t: TopicIdea) => t.videos.map((s) => s.video.id).sort().join(",");
  const bestByKey = new Map<string, TopicIdea>();
  for (const t of topics) {
    const k = keyOf(t);
    const existing = bestByKey.get(k);
    if (!existing || t.phrase.split(" ").length > existing.phrase.split(" ").length) bestByKey.set(k, t);
  }
  topics = [...bestByKey.values()];

  // Rank: most signals first, then most channels, then most views
  topics.sort(
    (a, b) =>
      b.tags.length - a.tags.length || b.channelCount - a.channelCount || b.medianViews - a.medianViews,
  );

  return { videosUsed: signals.length, nicheMedianViews, nicheMedianViewsPerDay, outliers, momentum, topics };
}
