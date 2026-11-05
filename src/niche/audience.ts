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

// ---------- The backpack check: a channel's latest uploads ----------
// A channel's "country" is whatever its creator typed. Its latest uploads' language labels are a
// second, independent clue. If most labeled uploads are for another language or country
// (for example "hi" or "en-IN" when we want US/UK/CA/AU English), the channel is removed.
export const MIN_LABELED_UPLOADS = 10; // fewer labels than this = not enough evidence, keep the channel
export const MAX_OFF_TARGET_SHARE = 0.5; // more than half off-target = remove

export function offTargetUploads(
  uploadLanguages: Record<string, number> | undefined,
  allowedCountries: string[],
  language: "en" | "es",
): string | null {
  if (!uploadLanguages) return null;
  let labeled = 0;
  let off = 0;
  const offCodes: Record<string, number> = {};
  for (const [code, count] of Object.entries(uploadLanguages)) {
    const [base, region] = code.toLowerCase().split("-");
    if (NOT_A_LANGUAGE.has(base)) continue;
    labeled += count;
    const wrongLanguage = base !== language;
    const wrongRegion = region !== undefined && /^[a-z]{2}$/.test(region) && !allowedCountries.includes(region.toUpperCase());
    if (wrongLanguage || wrongRegion) {
      off += count;
      offCodes[code] = (offCodes[code] ?? 0) + count;
    }
  }
  if (labeled < MIN_LABELED_UPLOADS || off / labeled <= MAX_OFF_TARGET_SHARE) return null;
  const list = Object.entries(offCodes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} "${c}"`).join(", ");
  return `${off} of its ${labeled} latest labeled uploads are for another language or country (${list})`;
}

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
