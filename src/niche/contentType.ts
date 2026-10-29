import type { VideoInfo } from "../youtube/youtubeApi.js";
import type { RemovedVideo } from "./relevance.js";

// Which kind of videos to score
export type VideoFormat = "long" | "short" | "all";

// YouTube Shorts can be up to 3 minutes long
export const SHORTS_MAX_SECONDS = 180;

// YouTube categories that are almost never real explainer / how-to content.
// Tune this list in Step 6 if real finance or history videos get removed.
export const BLOCKED_CATEGORIES: Record<string, string> = {
  "1": "Film & Animation",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "20": "Gaming",
  "23": "Comedy",
  "24": "Entertainment",
};

export type ContentTypeResult = {
  kept: VideoInfo[];
  removed: RemovedVideo[];
};

export function isShort(video: VideoInfo): boolean {
  // 0 seconds = live stream or unknown length: treat as a long video
  return video.durationSeconds > 0 && video.durationSeconds <= SHORTS_MAX_SECONDS;
}

export function filterContentType(videos: VideoInfo[], format: VideoFormat): ContentTypeResult {
  const kept: VideoInfo[] = [];
  const removed: RemovedVideo[] = [];

  for (const video of videos) {
    const short = isShort(video);

    // 1. Shorts and long videos behave very differently, so we score them separately
    if (format === "long" && short) {
      removed.push({
        video,
        filter: "format",
        reason: `Short (${video.durationSeconds}s); scoring long videos only`,
      });
      continue;
    }
    if (format === "short" && !short) {
      removed.push({
        video,
        filter: "format",
        reason: `long video (${Math.round(video.durationSeconds / 60)} min); scoring Shorts only`,
      });
      continue;
    }

    // 2. YouTube's own category says it's entertainment, not an explainer
    const category = video.categoryId ? BLOCKED_CATEGORIES[video.categoryId] : undefined;
    if (category) {
      removed.push({
        video,
        filter: "category",
        reason: `YouTube category is "${category}"`,
      });
      continue;
    }

    kept.push(video);
  }

  return { kept, removed };
}
