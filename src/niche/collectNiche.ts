import { cached, hasCache } from "../cache/fileCache.js";
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
import { getBaselines, type ChannelBaseline } from "../youtube/enrich.js";
import { GIANT_CHANNEL_SUBS } from "./scoreNiche.js";

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

// Ordinary recent uploads: newest first (not most-viewed), uploaded 30 to 90 days ago.
// They fix the "only winners" bias: search by views only shows the most-watched videos,
// so we also look at what normal videos in the niche get.
export const TYPICAL_WINDOW_DAYS = { from: 90, to: 30 };
export const TYPICAL_MAX_PAGES = 2;
export const TYPICAL_ENOUGH = 20;

type RawTypicalData = {
  pagesFetched: number;
  unitsUsed: number;
  videos: VideoInfo[];
  channels: ChannelInfo[];
};

export type TypicalSample = {
  savedAt: string;
  windowDays: { from: number; to: number };
  pagesFetched: number;
  totalFound: number; // videos YouTube returned
  videos: VideoInfo[]; // exact matches that passed every filter (the same filters as the top sample)
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
  // Each kept channel's normal views, from its latest uploads (missing = not checked yet)
  baselines: Record<string, ChannelBaseline>;
  // Ordinary recent uploads (null = not collected yet, e.g. data saved before this existed)
  typical: TypicalSample | null;
};

export type CollectOptions = {
  months?: number; // how far back to look (default 12)
  language?: "en" | "es";
  region?: string; // default "US"
  targetCountries?: string[]; // default depends on language
  maxPages?: number; // default 5
  maxAgeHours?: number; // reuse saved data this long (default 24)
  cacheOnly?: boolean; // true = never call YouTube; throws NotCachedError if nothing is saved
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

// Thrown when cacheOnly is set and this niche has no saved data yet
export class NotCachedError extends Error {
  constructor(query: string) {
    super(`No saved data yet for "${query}"`);
    this.name = "NotCachedError";
  }
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
  const key = `niche:v9:${language}:${region}:${months}m:p${maxPages}:${format}:${targetCountries.join("-")}:${cleanQuery}`;

  if (options.cacheOnly && !(await hasCache(key, options.maxAgeHours ?? 24))) {
    throw new NotCachedError(cleanQuery);
  }

  // 1. Get raw data page by page (from cache if saved in the last 24 hours)
  const raw = await cached<RawNicheData>(key, options.maxAgeHours ?? 24, async () => {
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

  // 2. Ordinary recent uploads (newest first, 30-90 days old), same filters as the top videos
  const typicalKey = `typical:v1:${language}:${region}:${format}:${targetCountries.join("-")}:${cleanQuery}`;
  let typical: TypicalSample | null = null;
  let typicalUnits = 0;
  if (!options.cacheOnly || (await hasCache(typicalKey, options.maxAgeHours ?? 24))) {
    const rawTypical = await cached<RawTypicalData>(typicalKey, options.maxAgeHours ?? 24, async () => {
      const now = Date.now();
      const publishedAfter = new Date(now - TYPICAL_WINDOW_DAYS.from * 86_400_000);
      const publishedBefore = new Date(now - TYPICAL_WINDOW_DAYS.to * 86_400_000);
      const videos: VideoInfo[] = [];
      const channels: ChannelInfo[] = [];
      const seenVideos = new Set<string>();
      const seenChannels = new Set<string>();
      let pageToken: string | undefined;
      let pagesFetched = 0;
      let unitsUsed = 0;
      while (pagesFetched < TYPICAL_MAX_PAGES) {
        const page = await searchVideos(cleanQuery, {
          publishedAfter,
          publishedBefore,
          language,
          regionCode: region,
          order: "date",
          maxResults: 50,
          pageToken,
        });
        pagesFetched++;
        unitsUsed += 100;
        const newIds = page.ids.filter((id) => !seenVideos.has(id));
        newIds.forEach((id) => seenVideos.add(id));
        if (newIds.length) {
          const newVideos = await getVideos(newIds);
          unitsUsed += Math.ceil(newIds.length / 50);
          videos.push(...newVideos);
          const newChannelIds = [...new Set(newVideos.map((v) => v.channelId))].filter((id) => !seenChannels.has(id));
          newChannelIds.forEach((id) => seenChannels.add(id));
          if (newChannelIds.length) {
            channels.push(...(await getChannels(newChannelIds)));
            unitsUsed += Math.ceil(newChannelIds.length / 50);
          }
        }
        const { exactCount } = applyFilters(videos, channels, cleanQuery, targetCountries, language, format);
        // 20+ ordinary uploads is plenty to correct the scores (10 are needed), so save the second page
        if (exactCount >= TYPICAL_ENOUGH || !page.nextPageToken) break;
        pageToken = page.nextPageToken;
      }
      return { pagesFetched, unitsUsed, videos, channels };
    });
    const f = applyFilters(rawTypical.data.videos, rawTypical.data.channels, cleanQuery, targetCountries, language, format);
    const keptIds = new Set(f.exactType.kept.map((v) => v.channelId));
    typical = {
      savedAt: rawTypical.savedAt,
      windowDays: TYPICAL_WINDOW_DAYS,
      pagesFetched: rawTypical.data.pagesFetched,
      totalFound: rawTypical.data.videos.length,
      videos: f.exactType.kept,
      channels: rawTypical.data.channels.filter((c) => keptIds.has(c.id)),
    };
    typicalUnits = rawTypical.fromCache ? 0 : rawTypical.data.unitsUsed;
  }

  // 3. Run the filters on the full raw data (free)
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

  // 4. Each kept channel's normal views, from its latest uploads (2 units per channel, saved 7 days)
  // Channels with 1M+ subscribers never count as outliers, so their normal views aren't needed
  const needBaseline = raw.data.channels
    .filter((c) => keptChannelIds.has(c.id) && (c.subscribers ?? 0) < GIANT_CHANNEL_SUBS)
    .map((c) => c.id);
  const { baselines, unitsUsed: baselineUnits } = await getBaselines(needBaseline, options.cacheOnly ?? false);

  return {
    query: cleanQuery,
    language,
    region,
    months,
    targetCountries,
    format,
    fromCache: raw.fromCache,
    savedAt: raw.savedAt,
    unitsUsed: (raw.fromCache ? 0 : raw.data.unitsUsed) + baselineUnits + typicalUnits,
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
    baselines,
    typical,
  };
}
