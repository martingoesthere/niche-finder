import { collectNiche, MIN_VIDEOS } from "../niche/collectNiche.js";
import { describeKeyword } from "../niche/relevance.js";
import type { ChannelInfo, VideoInfo } from "../youtube/youtubeApi.js";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtMedian = (values: number[]) => {
  const m = median(values);
  return m === null ? "n/a" : fmt(Math.round(m));
};
const dataLabel = (count: number) =>
  count >= MIN_VIDEOS
    ? `✅ enough data (${MIN_VIDEOS}+)`
    : `⚠️ not enough data (under ${MIN_VIDEOS})`;

const query =
  process.argv.slice(2).join(" ").trim() || "credit cards for college students";

try {
  const result = await collectNiche(query, { region: "US", language: "en" });
  const channelById = new Map<string, ChannelInfo>(
    result.channels.map((c) => [c.id, c]),
  );

  const printVideos = (list: VideoInfo[], howMany: number) => {
    [...list]
      .sort((a, b) => b.views - a.views)
      .slice(0, howMany)
      .forEach((v, i) => {
        const ch = channelById.get(v.channelId);
        const subs =
          ch && ch.subscribers !== null ? fmt(ch.subscribers) : "hidden";
        const country = ch?.country ?? "?";
        const lang = v.audioLanguage ?? v.textLanguage ?? "?";
        console.log(
          `${i + 1}. ${fmt(v.views)} views | ${subs} subs | ${country} | lang ${lang} | ${v.channelTitle}`,
        );
        console.log(`   ${v.title}`);
        console.log(`   ${v.url}\n`);
      });
  };

  const removedTopic = result.removed.filter(
    (r) => r.filter === "topic",
  ).length;
  const removedCountry = result.removed.filter(
    (r) => r.filter === "country",
  ).length;
  const removedLanguage = result.removed.filter(
    (r) => r.filter === "language",
  ).length;

  console.log(
    `🔎 Niche: "${result.query}" | region ${result.region} | last ${result.months} months`,
  );
  console.log(
    `🎯 Target countries: ${result.targetCountries.join(", ")} | language: ${result.language}\n`,
  );

  console.log(
    result.fromCache
      ? `📦 Loaded from cache (saved ${result.savedAt}). 0 units used.`
      : `🌐 Fresh from YouTube. About ${result.unitsUsed} units used.`,
  );
  console.log(
    `📄 Pages fetched: ${result.pagesFetched} (stopped because: ${result.stoppedBecause})\n`,
  );

  console.log("Concepts used:");
  result.keywords.forEach((k) => console.log(`  - ${describeKeyword(k)}`));
  console.log("");

  console.log(`Videos from YouTube:       ${result.totalFound}`);
  console.log(`Removed (off-topic):       ${removedTopic}`);
  console.log(`Removed (wrong country):   ${removedCountry}`);
  console.log(`Removed (wrong language):  ${removedLanguage}`);
  console.log(`Kept, country unknown:     ${result.unknownCountryVideos}`);
  console.log("");
  console.log(
    `EXACT match (micro-niche): ${result.exactVideos.length} videos | median ${fmtMedian(result.exactVideos.map((v) => v.views))} views | ${dataLabel(result.exactVideos.length)}`,
  );
  console.log(
    `BROAD match (parent):      ${result.broadVideos.length} videos | median ${fmtMedian(result.broadVideos.map((v) => v.views))} views`,
  );
  console.log(
    `ALL kept:                  ${result.videos.length} videos | median ${fmtMedian(result.videos.map((v) => v.views))} views | ${dataLabel(result.videos.length)}`,
  );

  console.log("\n--- Top EXACT match videos (the proof) ---\n");
  if (result.exactVideos.length === 0) console.log("(none)\n");
  printVideos(result.exactVideos, 10);

  console.log("--- Top BROAD match videos ---\n");
  if (result.broadVideos.length === 0) console.log("(none)\n");
  printVideos(result.broadVideos, 5);

  // Show language removals first, so we can check the new filter
  const order = { language: 0, topic: 1, country: 2 } as const;
  const removedSorted = [...result.removed].sort(
    (a, b) => order[a.filter] - order[b.filter],
  );

  if (removedSorted.length > 0) {
    console.log("--- Removed (first 12) ---\n");
    removedSorted.slice(0, 12).forEach(({ video, filter, reason }) => {
      console.log(`- [${filter}] ${video.title}`);
      console.log(`  why: ${reason}`);
      console.log(`  ${video.url}\n`);
    });
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
}
