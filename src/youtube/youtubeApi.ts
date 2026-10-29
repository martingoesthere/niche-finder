import "dotenv/config";

const BASE_URL = "https://www.googleapis.com/youtube/v3";

// ---------- Clean shapes we use in our app ----------

export type VideoInfo = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  views: number;
  likes: number | null; // null = hidden by creator
  comments: number | null;
  durationSeconds: number;
  categoryId: string | null; // YouTube's category, e.g. "27" = Education, "23" = Comedy
  audioLanguage: string | null; // spoken language, if the creator set it (e.g. "en", "hi")
  textLanguage: string | null; // title/description language, if set
  url: string;
};

export type ChannelInfo = {
  id: string;
  title: string;
  country: string | null; // null = creator didn't set it
  subscribers: number | null; // null = hidden by creator
  totalViews: number;
  videoCount: number;
  createdAt: string;
  url: string;
};

export type SearchOptions = {
  publishedAfter?: Date;
  maxResults?: number; // YouTube allows up to 50
  order?: "viewCount" | "relevance" | "date";
  language?: string; // "en" or "es"
  regionCode?: string; // "US", "MX", etc.
  pageToken?: string; // ask for the next page of results
};

export type SearchPage = {
  ids: string[];
  nextPageToken: string | null; // null = no more pages
};

// ---------- Clear errors ----------

export class YouTubeApiError extends Error {
  status: number;
  reason: string;

  constructor(message: string, status: number, reason: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
    this.reason = reason;
  }
}

function friendlyMessage(reason: string, original?: string): string {
  switch (reason) {
    case "quotaExceeded":
    case "dailyLimitExceeded":
      return "Daily YouTube quota is used up. It resets at midnight Pacific Time.";
    case "keyInvalid":
      return "Your API key is not valid. Check the YOUTUBE_API_KEY line in .env.";
    case "accessNotConfigured":
      return "YouTube Data API v3 is not enabled for your Google Cloud project.";
    default:
      return original ?? "YouTube returned an unknown error.";
  }
}

// ---------- Core request helper ----------

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || key === "paste_your_key_here") {
    throw new Error("No YouTube API key found. Check your .env file.");
  }
  return key;
}

type ApiErrorBody = {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
};

async function callYouTube<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", getApiKey());

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new YouTubeApiError(
      "Could not reach YouTube. Check your internet connection.",
      0,
      "network",
    );
  }

  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason ?? "unknown";
    throw new YouTubeApiError(
      friendlyMessage(reason, data.error?.message),
      response.status,
      reason,
    );
  }

  return data;
}

// ---------- Helpers ----------

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Turns YouTube's "PT1H2M3S" into seconds (3723)
function parseDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const match = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0)
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

// ---------- 1. Search one page (costs 100 units per call) ----------

type RawSearchResponse = {
  nextPageToken?: string;
  items?: Array<{ id: { videoId?: string } }>;
};

export async function searchVideos(
  query: string,
  options: SearchOptions = {},
): Promise<SearchPage> {
  const params: Record<string, string> = {
    part: "id",
    type: "video",
    q: query,
    maxResults: String(Math.min(options.maxResults ?? 50, 50)),
    order: options.order ?? "viewCount",
  };
  if (options.publishedAfter)
    params.publishedAfter = options.publishedAfter.toISOString();
  if (options.language) params.relevanceLanguage = options.language;
  if (options.regionCode) params.regionCode = options.regionCode;
  if (options.pageToken) params.pageToken = options.pageToken;

  const data = await callYouTube<RawSearchResponse>("search", params);

  const ids = (data.items ?? [])
    .map((item) => item.id.videoId)
    .filter((id): id is string => Boolean(id));

  return { ids, nextPageToken: data.nextPageToken ?? null };
}

// ---------- 2. Video stats (costs 1 unit per 50 videos) ----------

type RawVideosResponse = {
  items?: Array<{
    id: string;
    snippet: {
      title: string;
      channelId: string;
      channelTitle: string;
      publishedAt: string;
      categoryId?: string;
      defaultAudioLanguage?: string;
      defaultLanguage?: string;
    };
    statistics: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    contentDetails: { duration?: string };
  }>;
};

export async function getVideos(videoIds: string[]): Promise<VideoInfo[]> {
  const results: VideoInfo[] = [];

  for (const group of chunk(videoIds, 50)) {
    const data = await callYouTube<RawVideosResponse>("videos", {
      part: "snippet,statistics,contentDetails",
      id: group.join(","),
      maxResults: "50",
    });

    for (const v of data.items ?? []) {
      results.push({
        id: v.id,
        title: v.snippet.title,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        views: toNumber(v.statistics.viewCount) ?? 0,
        likes: toNumber(v.statistics.likeCount),
        comments: toNumber(v.statistics.commentCount),
        durationSeconds: parseDuration(v.contentDetails.duration),
        categoryId: v.snippet.categoryId ?? null,
        audioLanguage: v.snippet.defaultAudioLanguage ?? null,
        textLanguage: v.snippet.defaultLanguage ?? null,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      });
    }
  }

  return results;
}

// ---------- 3. Channel stats (costs 1 unit per 50 channels) ----------

type RawChannelsResponse = {
  items?: Array<{
    id: string;
    snippet: { title: string; publishedAt: string; country?: string };
    statistics: {
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      viewCount?: string;
      videoCount?: string;
    };
  }>;
};

export async function getChannels(
  channelIds: string[],
): Promise<ChannelInfo[]> {
  const uniqueIds = [...new Set(channelIds)];
  const results: ChannelInfo[] = [];

  for (const group of chunk(uniqueIds, 50)) {
    const data = await callYouTube<RawChannelsResponse>("channels", {
      part: "snippet,statistics",
      id: group.join(","),
      maxResults: "50",
    });

    for (const c of data.items ?? []) {
      results.push({
        id: c.id,
        title: c.snippet.title,
        country: c.snippet.country ?? null,
        subscribers: c.statistics.hiddenSubscriberCount
          ? null
          : toNumber(c.statistics.subscriberCount),
        totalViews: toNumber(c.statistics.viewCount) ?? 0,
        videoCount: toNumber(c.statistics.videoCount) ?? 0,
        createdAt: c.snippet.publishedAt,
        url: `https://www.youtube.com/channel/${c.id}`,
      });
    }
  }

  return results;
}
