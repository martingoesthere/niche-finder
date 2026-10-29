import type { ChannelInfo, VideoInfo } from "../youtube/youtubeApi.js";
import type { RemovedVideo } from "./relevance.js";

// Countries we treat as the target audience for each language
export const TARGET_COUNTRIES: Record<"en" | "es", string[]> = {
  en: ["US", "CA", "GB", "AU"],
  es: ["US", "MX", "ES", "CO", "AR", "CL", "PE"],
};

// If more than this share of a title's letters are non-Latin (Hindi, Korean...), remove it
const MAX_NON_LATIN_SHARE = 0.3;

// Language codes that don't tell us a real language
const NOT_A_LANGUAGE = new Set(["zxx", "und", "mul"]);

export type AudienceResult = {
  kept: VideoInfo[];
  removed: RemovedVideo[];
  unknownCountry: number; // removed because the channel didn't set a country
};

// "en-US" -> "en", "es-419" -> "es"
function baseLanguage(code: string | null): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split("-")[0];
  return NOT_A_LANGUAGE.has(base) ? null : base;
}

// "en-US" -> "US" (only when the language matches the target language)
function regionOf(code: string | null, language: string): string | null {
  if (!code) return null;
  const [base, region] = code.split("-");
  if (!region || base.toLowerCase() !== language) return null;
  return region.toUpperCase();
}

function nonLatinShare(title: string): number {
  const letters = title.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length;
}

export function filterAudience(
  videos: VideoInfo[],
  channelById: Map<string, ChannelInfo>,
  allowedCountries: string[],
  language: "en" | "es",
): AudienceResult {
  const kept: VideoInfo[] = [];
  const removed: RemovedVideo[] = [];
  let unknownCountry = 0;

  for (const video of videos) {
    const country = channelById.get(video.channelId)?.country ?? null;
    const videoLanguage = baseLanguage(
      video.audioLanguage ?? video.textLanguage,
    );
    const scriptShare = nonLatinShare(video.title);

    // 1. Channel didn't say its country. A regional language tag on the video
    //    (like "en-US" or "en-GB") is real proof of the audience, so we keep those.
    //    A plain "en" tag is not enough (many channels outside the target use it).
    const taggedRegion = regionOf(video.audioLanguage ?? video.textLanguage, language);
    const verifiedByTag = taggedRegion !== null && allowedCountries.includes(taggedRegion);
    if (country === null && !verifiedByTag) {
      unknownCountry++;
      removed.push({
        video,
        filter: "country",
        reason: "channel did not set a country (can't verify the audience)",
      });
      continue;
    }

    // 2. Channel is from a non-target country
    if (country !== null && !allowedCountries.includes(country)) {
      removed.push({
        video,
        filter: "country",
        reason: `channel country is ${country} (target: ${allowedCountries.join(", ")})`,
      });
      continue;
    }

    // 3. YouTube says the video is in another language
    if (videoLanguage !== null && videoLanguage !== language) {
      removed.push({
        video,
        filter: "language",
        reason: `video language is "${videoLanguage}" (target: "${language}")`,
      });
      continue;
    }

    // 4. Title is mostly written in a non-Latin script
    if (scriptShare > MAX_NON_LATIN_SHARE) {
      removed.push({
        video,
        filter: "language",
        reason: `title is ${Math.round(scriptShare * 100)}% non-Latin script`,
      });
      continue;
    }

    kept.push(video);
  }

  return { kept, removed, unknownCountry };
}
