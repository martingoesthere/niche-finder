import { cached } from "../cache/fileCache.js";
import { filterRelevant, type RemovedVideo } from "./relevance.js";
import { filterAudience, TARGET_COUNTRIES } from "./audience.js";
import {
  getChannels,
  getVideos,
  searchVideos,
  type ChannelInfo,
  type VideoInfo,
} from "../youtube/youtubeApi.js";

// Your reliability rule: score only with at least this many kept videos
export const MIN_VIDEOS = 30;

// Safety cap: never fetch more than this many search pages per niche
export const DEFAULT_MAX_PAGES = 3;

// What we save in the cache: YouTube's raw answer, before filtering
type RawNicheData = {
  query: string;
  language: string;
  region: string;
  months: number;
  pagesFetched: number;
  stoppedBecause: string;
  unitsUsed: number;
  videos: VideoInfo[];
  channels: ChannelInfo[];
};

// What the rest of the app gets: filtered data + proof of what was removed
export type NicheResult = {
  query: string;
  language: "en" | "es";
  region: string;
  months: number;
  targetCountries: string[];
  fromCache: boolean;
  savedAt: string;
  unitsUsed: number;
  pagesFetched: number;
  stoppedBecause: string;
  keywords: string[];
  totalFound: number;
  exactVideos: VideoInfo[]; // the micro-niche itself
  broadVideos: VideoInfo[]; // the parent topic
  videos: VideoInfo[]; // exact + broad
  removed: RemovedVideo[]; // off-topic, wrong country or wrong language, with the reason
  unknownCountryVideos: number;
  channels: ChannelInfo[]; // channels of the kept videos
};

export type CollectOptions = {
  months?: number; // how far back to look (default 12)
  language?: "en" | "es";
  region?: string; // default "US"
  targetCountries?: string[]; // default depends on language
  maxPages?: number; // default 3
};

// Runs all filters. Used while fetching (to decide when to stop) and at the end.
function applyFilters(
  videos: VideoInfo[],
  channels: ChannelInfo[],
  query: string,
  targetCountries: string[],
  language: "en" | "es",
) {
  const relevance = filterRelevant(videos, query);
  const channelById = new Map<string, ChannelInfo>(
    channels.map((c) => [c.id, c]),
  );
  const exact = filterAudience(
    relevance.exact,
    channelById,
    targetCountries,
    language,
  );
  const broad = filterAudience(
    relevance.broad,
    channelById,
    targetCountries,
    language,
  );
  return {
    relevance,
    exact,
    broad,
    keptCount: exact.kept.length + broad.kept.length,
  };
}

export async function collectNiche(
  query: string,
  options: CollectOptions = {},
): Promise<NicheResult> {
  const months = options.months ?? 12;
  const language = options.language ?? "en";
  const region = (options.region ?? "US").toUpperCase();
  const targetCountries = options.targetCountries ?? TARGET_COUNTRIES[language];
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const cleanQuery = query.trim().toLowerCase();
  const key = `niche:v4:${language}:${region}:${months}m:p${maxPages}:${targetCountries.join("-")}:${cleanQuery}`;

  // 1. Get raw data page by page (from cache if saved in the last 24 hours)
  const raw = await cached<RawNicheData>(key, 24, async () => {
    const publishedAfter = new Date();
    publishedAfter.setMonth(publishedAfter.getMonth() - months);

    const videos: VideoInfo[] = [];
    const channels: ChannelInfo[] = [];
    const seenVideoIds = new Set<string>();
    const seenChannelIds = new Set<string>();
    let pageToken: string | undefined;
    let pagesFetched = 0;
    let unitsUsed = 0;
    let stoppedBecause = `reached the ${maxPages}-page limit`;

    while (pagesFetched < maxPages) {
      const page = await searchVideos(cleanQuery, {
        publishedAfter,
        language,
        regionCode: region,
        order: "viewCount",
        maxResults: 50,
        pageToken,
      });
      pagesFetched++;
      unitsUsed += 100;

      // Only look up videos we haven't seen yet
      const newIds = page.ids.filter((id) => !seenVideoIds.has(id));
      newIds.forEach((id) => seenVideoIds.add(id));

      if (newIds.length > 0) {
        const newVideos = await getVideos(newIds);
        unitsUsed += Math.ceil(newIds.length / 50);
        videos.push(...newVideos);

        // Only look up channels we haven't seen yet
        const newChannelIds = [
          ...new Set(newVideos.map((v) => v.channelId)),
        ].filter((id) => !seenChannelIds.has(id));
        newChannelIds.forEach((id) => seenChannelIds.add(id));

        if (newChannelIds.length > 0) {
          channels.push(...(await getChannels(newChannelIds)));
          unitsUsed += Math.ceil(newChannelIds.length / 50);
        }
      }

      // Enough kept videos? Stop early and save quota.
      const { keptCount } = applyFilters(
        videos,
        channels,
        cleanQuery,
        targetCountries,
        language,
      );
      if (keptCount >= MIN_VIDEOS) {
        stoppedBecause = `reached ${MIN_VIDEOS}+ kept videos`;
        break;
      }

      if (!page.nextPageToken) {
        stoppedBecause = "YouTube had no more results";
        break;
      }
      pageToken = page.nextPageToken;
    }

    return {
      query: cleanQuery,
      language,
      region,
      months,
      pagesFetched,
      stoppedBecause,
      unitsUsed,
      videos,
      channels,
    };
  });

  // 2. Run the filters on the full raw data (free)
  const { relevance, exact, broad } = applyFilters(
    raw.data.videos,
    raw.data.channels,
    cleanQuery,
    targetCountries,
    language,
  );

  const videos = [...exact.kept, ...broad.kept];
  const keptChannelIds = new Set(videos.map((v) => v.channelId));

  return {
    query: cleanQuery,
    language,
    region,
    months,
    targetCountries,
    fromCache: raw.fromCache,
    savedAt: raw.savedAt,
    unitsUsed: raw.fromCache ? 0 : raw.data.unitsUsed,
    pagesFetched: raw.data.pagesFetched,
    stoppedBecause: raw.data.stoppedBecause,
    keywords: relevance.keywords,
    totalFound: raw.data.videos.length,
    exactVideos: exact.kept,
    broadVideos: broad.kept,
    videos,
    removed: [...relevance.removed, ...exact.removed, ...broad.removed],
    unknownCountryVideos: exact.unknownCountry + broad.unknownCountry,
    channels: raw.data.channels.filter((c) => keptChannelIds.has(c.id)),
  };
}
