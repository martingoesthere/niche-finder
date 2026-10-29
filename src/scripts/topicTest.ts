import { collectNiche } from "../niche/collectNiche.js";
import { findTopics, type TopicTag, type VideoSignal, OUTLIER_MIN_RATIO, RECENT_DAYS } from "../topics/findTopics.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const query = process.argv.slice(2).join(" ").trim() || "credit cards";

const TAG_LABELS: Record<TopicTag, string> = {
  outlier: "🎯 outlier",
  repeated: "🔁 repeated success",
  momentum: "🚀 momentum",
  gap: "🕳️ gap",
};

function printVideo(s: VideoSignal, extra: string) {
  const subs = s.channel?.subscribers != null ? fmt(s.channel.subscribers) : "hidden";
  console.log(`   • ${s.video.title}`);
  console.log(`     ${fmt(s.video.views)} views | ${subs} subs | ${s.video.channelTitle} | ${extra}`);
  console.log(`     ${s.video.url}`);
}

try {
  const result = await collectNiche(query, { region: "US", language: "en" });
  const report = findTopics(result);

  console.log(`💡 Topic Finder: "${result.query}" | ${result.targetCountries.join(", ")} | long videos`);
  console.log(
    result.fromCache
      ? `📦 From cache (saved ${result.savedAt}). 0 units used.`
      : `🌐 Fresh from YouTube. About ${result.unitsUsed} units used.`,
  );
  console.log(
    `Based on ${report.videosUsed} verified videos | niche median ${fmt(report.nicheMedianViews)} views, ${fmt(report.nicheMedianViewsPerDay)} views/day`,
  );
  console.log("Topic phrases come from real video titles. No AI, no guessing.\n");

  console.log(`🎯 OUTLIERS (${OUTLIER_MIN_RATIO}x+ their channel's average, channels under 1M subs)\n`);
  if (report.outliers.length === 0) console.log("   (none)");
  report.outliers.slice(0, 5).forEach((s) =>
    printVideo(s, `${(s.outlierRatio ?? 0).toFixed(1)}x its channel's average of ${fmt(s.channelAvgViews ?? 0)}`),
  );

  console.log(`\n🚀 MOMENTUM (published in the last ${RECENT_DAYS} days, most views per day)\n`);
  if (report.momentum.length === 0) console.log("   (none)");
  report.momentum.slice(0, 5).forEach((s) =>
    printVideo(s, `${fmt(s.viewsPerDay)} views/day, ${Math.round(s.ageDays)} days old`),
  );

  console.log("\n💡 TOPIC IDEAS (phrases that worked for 2+ different channels)\n");
  if (report.topics.length === 0) console.log("   (none found with enough data)");
  report.topics.slice(0, 10).forEach((t, i) => {
    const tags = t.tags.length > 0 ? t.tags.map((tag) => TAG_LABELS[tag]).join("  ") : "no strong signal";
    console.log(`${i + 1}. "${t.phrase}"   ${tags}`);
    console.log(
      `   ${t.videos.length} videos | ${t.channelCount} channels | median ${fmt(t.medianViews)} views | ${fmt(t.medianViewsPerDay)} views/day | ${t.recentVideos} in last ${RECENT_DAYS} days`,
    );
    t.videos.slice(0, 3).forEach((s) => printVideo(s, `${fmt(s.viewsPerDay)} views/day`));
    console.log("");
  });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
}
