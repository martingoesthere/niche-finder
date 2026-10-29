import type { VideoInfo } from "../youtube/youtubeApi.js";

// A "broad" video must match at least this share of the niche's concepts
export const MIN_MATCH_RATIO = 0.5;

// Words in the same group mean the same audience/topic (English + Spanish)
// The FIRST word of each group is the group's name
const SYNONYM_GROUPS: string[][] = [
  [
    "student",
    "college",
    "university",
    "estudiante",
    "universitario",
    "universidad",
  ],
  ["beginner", "newbie", "principiante"],
  ["credit", "credito"],
];

// Small words that don't tell us the topic (English + Spanish)
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "to",
  "of",
  "in",
  "on",
  "and",
  "or",
  "with",
  "how",
  "what",
  "best",
  "top",
  "your",
  "my",
  "is",
  "are",
  "this",
  "that",
  "vs",
  "de",
  "la",
  "el",
  "los",
  "las",
  "para",
  "en",
  "y",
  "con",
  "un",
  "una",
  "que",
  "del",
  "como",
  "mejor",
  "mejores",
  "tu",
  "mi",
  "por",
]);

export type RemovedVideo = {
  video: VideoInfo;
  filter: "topic" | "country" | "language" | "format" | "category";
  reason: string;
};

export type RelevanceResult = {
  keywords: string[];
  exact: VideoInfo[]; // title matches ALL concepts (the micro-niche itself)
  broad: VideoInfo[]; // title matches at least half (the parent topic)
  removed: RemovedVideo[];
};

// Lowercase and remove accents (tarjetas de crédito -> tarjetas de credito)
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Simple plural handling: cards -> card, universities -> university
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

// Build a lookup: each synonym -> its group's name
const CONCEPT_OF = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const name = stem(group[0]);
  for (const word of group) CONCEPT_OF.set(stem(word), name);
}

function toConcept(word: string): string {
  return CONCEPT_OF.get(word) ?? word;
}

function toWords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .map(stem)
    .map(toConcept);
}

export function getKeywords(query: string): string[] {
  return [...new Set(toWords(query))];
}

// For display: "student" -> "student/college/university/..."
export function describeKeyword(keyword: string): string {
  const group = SYNONYM_GROUPS.find((g) => stem(g[0]) === keyword);
  return group ? group.join("/") : keyword;
}

export function filterRelevant(
  videos: VideoInfo[],
  query: string,
): RelevanceResult {
  const keywords = getKeywords(query);

  if (keywords.length === 0) {
    return { keywords, exact: videos, broad: [], removed: [] };
  }

  const exact: VideoInfo[] = [];
  const broad: VideoInfo[] = [];
  const removed: RemovedVideo[] = [];

  for (const video of videos) {
    const titleWords = new Set(toWords(video.title));
    const matched = keywords.filter((k) => titleWords.has(k));
    const ratio = matched.length / keywords.length;

    if (matched.length === keywords.length) {
      exact.push(video);
    } else if (ratio >= MIN_MATCH_RATIO) {
      broad.push(video);
    } else {
      removed.push({
        video,
        filter: "topic",
        reason: `title matches ${matched.length}/${keywords.length} concepts (${matched.join(", ") || "none"})`,
      });
    }
  }

  return { keywords, exact, broad, removed };
}
