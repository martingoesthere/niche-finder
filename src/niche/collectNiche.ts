import { cached } from "../cache/fileCache.js";
import { filterRelevant, type RemovedVideo } from "./relevance.js";
import { filterAudience, TARGET_COUNTRIES } from "./audience.js";
import { filterContentType, type VideoFormat } from "./contentType.js";
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
export const DEFAULT_MAX_PAGES = 5;

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
  format: VideoFormat;
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
  removed: RemovedVideo[]; // every removed video, with the filter and the reason
  unknownCountryVideos: number;
  channels: ChannelInfo[]; // channels of the kept videos
};

export type CollectOptions = {
  months?: number; // how far back to look (default 12)
  language?: "en" | "es";
  region?: string; // default "US"
  targetCountries?: string[]; // default depends on language
  maxPages?: number; // default 3
  format?: VideoFormat; // "long" (default), "short" or "all"
};

// Runs all filters. Used while fetching (to decide when to stop) and at the end.
function applyFilters(
  videos: VideoInfo[],
  channels: ChannelInfo[],
  query: string,
  targetCountries: string[],
  language: "en" | "es",
  format: VideoFormat,
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
  const exactType = filterContentType(exact.kept, format);
  const broadType = filterContentType(broad.kept, format);
  return {
    relevance,
    exact,
    broad,
    exactType,
    broadType,
    keptCount: exactType.kept.length + broadType.kept.length,
    exactCount: exactType.kept.length, // the scores use exact matches only
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
  const format = options.format ?? "long";
  const cleanQuery = query.trim().toLowerCase();
  const key = `niche:v7:${language}:${region}:${months}m:p${maxPages}:${format}:${targetCountries.join("-")}:${cleanQuery}`;

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
      const { exactCount } = applyFilters(
        videos,
        channels,
        cleanQuery,
        targetCountries,
        language,
        format,
      );
      if (exactCount >= MIN_VIDEOS) {
        stoppedBecause = `reached ${MIN_VIDEOS}+ exact-match videos`;
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
  const { relevance, exact, broad, exactType, broadType } = applyFilters(
    raw.data.videos,
    raw.data.channels,
    cleanQuery,
    targetCountries,
    language,
    format,
  );

  const videos = [...exactType.kept, ...broadType.kept];
  const keptChannelIds = new Set(videos.map((v) => v.channelId));

  return {
    query: cleanQuery,
    language,
    region,
    months,
    targetCountries,
    format,
    fromCache: raw.fromCache,
    savedAt: raw.savedAt,
    unitsUsed: raw.fromCache ? 0 : raw.data.unitsUsed,
    pagesFetched: raw.data.pagesFetched,
    stoppedBecause: raw.data.stoppedBecause,
    keywords: relevance.keywords,
    totalFound: raw.data.videos.length,
    exactVideos: exactType.kept,
    broadVideos: broadType.kept,
    videos,
    removed: [
      ...relevance.removed,
      ...exact.removed,
      ...broad.removed,
      ...exactType.removed,
      ...broadType.removed,
    ],
    unknownCountryVideos: exact.unknownCountry + broad.unknownCountry,
    channels: raw.data.channels.filter((c) => keptChannelIds.has(c.id)),
  };
}
