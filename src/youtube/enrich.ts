import { cached, hasCache } from "../cache/fileCache.js";
import { getRecentUploadIds, getTopComments, getVideos, type CommentInfo } from "./youtubeApi.js";

// Extra free YouTube data that makes the numbers more trustworthy.
// Each result is saved for 7 days, so it's never paid for twice.
const ENRICH_CACHE_HOURS = 24 * 7;

// A video needs this many days to collect most of its views. Younger uploads are left
// out of a channel's "normal", so a brand-new upload doesn't drag the median down.
export const BASELINE_MIN_AGE_DAYS = 14;
// We only trust a channel's "normal" when it's based on at least this many uploads
export const BASELINE_MIN_VIDEOS = 5;
const SHORTS_MAX_SECONDS = 180;
const DAY_MS = 86_400_000;

// ---------- 1. A channel's normal views, from its latest uploads ----------

export type ChannelBaseline = {
  channelId: string;
  uploadsChecked: number; // latest uploads YouTube returned (up to 50)
  longVideosUsed: number; // long videos older than 14 days, used for the median
  medianLongViews: number | null; // null = fewer than 5 usable long videos
  shortsUsed: number;
  medianShortViews: number | null;
  checkedAt: string;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const baselineKey = (channelId: string) => `baseline:v1:${channelId}`;

// Costs 2 units per channel (uploads list + their stats), 0 if saved in the last 7 days.
// cacheOnly = never call YouTube (returns null when nothing is saved).
export async function getChannelBaseline(
  channelId: string,
  cacheOnly = false,
): Promise<{ baseline: ChannelBaseline | null; unitsUsed: number }> {
  const key = baselineKey(channelId);
  if (cacheOnly && !(await hasCache(key, ENRICH_CACHE_HOURS))) return { baseline: null, unitsUsed: 0 };

  let units = 0;
  const result = await cached<ChannelBaseline>(key, ENRICH_CACHE_HOURS, async () => {
    const ids = await getRecentUploadIds(channelId, 50);
    units += 1;
    const videos = ids.length ? await getVideos(ids) : [];
    if (ids.length) units += 1;

    const now = Date.now();
    const oldEnough = videos.filter((v) => now - new Date(v.publishedAt).getTime() >= BASELINE_MIN_AGE_DAYS * DAY_MS);
    const long = oldEnough.filter((v) => v.durationSeconds === 0 || v.durationSeconds > SHORTS_MAX_SECONDS);
    const shorts = oldEnough.filter((v) => v.durationSeconds > 0 && v.durationSeconds <= SHORTS_MAX_SECONDS);

    return {
      channelId,
      uploadsChecked: videos.length,
      longVideosUsed: long.length,
      medianLongViews: long.length >= BASELINE_MIN_VIDEOS ? median(long.map((v) => v.views)) : null,
      shortsUsed: shorts.length,
      medianShortViews: shorts.length >= BASELINE_MIN_VIDEOS ? median(shorts.map((v) => v.views)) : null,
      checkedAt: new Date().toISOString(),
    };
  });
  return { baseline: result.data, unitsUsed: units };
}

// Most channels a single niche check looks up (2 units each), to keep its cost predictable
export const MAX_BASELINE_CHANNELS = 100;

export async function getBaselines(
  channelIds: string[],
  cacheOnly = false,
): Promise<{ baselines: Record<string, ChannelBaseline>; unitsUsed: number; skipped: number }> {
  const unique = [...new Set(channelIds)];
  const baselines: Record<string, ChannelBaseline> = {};
  let unitsUsed = 0;
  let skipped = 0;
  for (const [i, id] of unique.entries()) {
    const onlySaved = cacheOnly || i >= MAX_BASELINE_CHANNELS;
    const { baseline, unitsUsed: used } = await getChannelBaseline(id, onlySaved);
    unitsUsed += used;
    if (baseline) baselines[id] = baseline;
    else skipped++;
  }
  return { baselines, unitsUsed, skipped };
}

// ---------- 2. What viewers say: top comments and their requests ----------

export type ViewerRequest = CommentInfo & { matched: string };

export type VideoComments = {
  videoId: string;
  checkedAt: string;
  comments: CommentInfo[]; // up to 20 top comments, as YouTube ranks them
  requests: ViewerRequest[]; // comments that ask for a video, found with the phrases below
};

// Phrases that mean "please make a video about…" (English and Spanish).
// A comment counts as a request only if it contains one of these exact phrases.
export const REQUEST_PHRASES = [
  "make a video", "do a video", "make one about", "do one about", "do one on",
  "part 2", "part two", "next video", "can you do", "could you do", "please do", "you should do",
  "haz un video", "hagan un video", "parte 2", "segunda parte", "próximo video", "proximo video",
];

function findRequest(text: string): string | null {
  const t = text.toLowerCase();
  return REQUEST_PHRASES.find((p) => t.includes(p)) ?? null;
}

// Costs 1 unit per video, 0 if saved in the last 7 days
export async function getVideoComments(
  videoId: string,
  cacheOnly = false,
): Promise<{ comments: VideoComments | null; unitsUsed: number }> {
  const key = `comments:v1:${videoId}`;
  if (cacheOnly && !(await hasCache(key, ENRICH_CACHE_HOURS))) return { comments: null, unitsUsed: 0 };

  let units = 0;
  const result = await cached<VideoComments>(key, ENRICH_CACHE_HOURS, async () => {
    const comments = await getTopComments(videoId, 20);
    units += 1;
    const requests: ViewerRequest[] = [];
    for (const c of comments) {
      const matched = findRequest(c.text);
      if (matched) requests.push({ ...c, matched: matched.trim() });
    }
    return { videoId, checkedAt: new Date().toISOString(), comments, requests };
  });
  return { comments: result.data, unitsUsed: units };
}
