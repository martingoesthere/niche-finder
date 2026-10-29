import "dotenv/config";

// 1. Read the key from your private .env file
const apiKey = process.env.YOUTUBE_API_KEY;

if (!apiKey || apiKey === "paste_your_key_here") {
  console.error(
    "❌ No API key found. Check your .env file: YOUTUBE_API_KEY=your_key",
  );
  process.exit(1);
}

// 2. Ask YouTube about one well-known video (costs 1 unit)
const testVideoId = "dQw4w9WgXcQ";

const url = new URL("https://www.googleapis.com/youtube/v3/videos");
url.searchParams.set("part", "snippet,statistics");
url.searchParams.set("id", testVideoId);
url.searchParams.set("key", apiKey);

type VideoResponse = {
  items?: Array<{
    snippet: { title: string; channelTitle: string; publishedAt: string };
    statistics: { viewCount?: string };
  }>;
  error?: { code: number; message: string };
};

const response = await fetch(url);
const data = (await response.json()) as VideoResponse;

// 3. Handle errors clearly
if (!response.ok) {
  console.error(
    `❌ YouTube returned an error (${response.status}): ${data.error?.message ?? "unknown error"}`,
  );
  process.exit(1);
}

const video = data.items?.[0];

if (!video) {
  console.error("❌ YouTube answered, but the video was not found.");
  process.exit(1);
}

// 4. Show the real data
const views = Number(video.statistics.viewCount ?? 0).toLocaleString("en-US");

console.log("✅ Your API key works!");
console.log(`Title:     ${video.snippet.title}`);
console.log(`Channel:   ${video.snippet.channelTitle}`);
console.log(`Published: ${video.snippet.publishedAt.slice(0, 10)}`);
console.log(`Views:     ${views}`);
console.log("Quota used: 1 unit (out of 10,000 per day)");
