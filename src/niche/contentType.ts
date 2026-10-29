import type { VideoInfo } from "../youtube/youtubeApi.js";
import type { RemovedVideo } from "./relevance.js";

// Which kind of videos to score
export type VideoFormat = "long" | "short" | "all";

// YouTube Shorts can be up to 3 minutes long
export const SHORTS_MAX_SECONDS = 180;

// YouTube categories that are almost never real explainer / how-to content.
// Step 6 test ("medieval life"): many real history channels use "Entertainment"
// and animated explainers use "Film & Animation", so those two are NOT blocked.
export const BLOCKED_CATEGORIES: Record<string, string> = {
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "20": "Gaming",
  "23": "Comedy",
};

// Title words that mean "this is not an explainer" (found while testing "medieval")
export const NON_EXPLAINER_WORDS = [
  "music", "song", "songs", "lullaby", "for kids", "nursery", "full movie", "trailer", "challenge",
  "gameplay", "playthrough", "minecraft", "soundtrack", "ambience", "ambient", "playlist", "dance",
];

function normalizeTitle(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function nonExplainerWord(title: string): string | null {
  const t = normalizeTitle(title);
  for (const word of NON_EXPLAINER_WORDS) {
    if (new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(t)) return word;
  }
  return null;
}

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

    // 2. YouTube says it's made for kids
    if (video.madeForKids === true) {
      removed.push({ video, filter: "category", reason: 'YouTube marks it "made for kids"' });
      continue;
    }

    // 3. The title says it's music, a movie, a challenge, gameplay...
    const word = nonExplainerWord(video.title);
    if (word) {
      removed.push({ video, filter: "category", reason: `title says "${word}" (not an explainer)` });
      continue;
    }

    // 4. YouTube's own category says it's not an explainer
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
