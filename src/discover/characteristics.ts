// 100 characteristics of a profitable faceless YouTube niche.
// status:
//   "measured"  = the app measures it now with real YouTube data
//   "later"     = possible with real data we can add (snapshots, descriptions, likes...)
//   "not-data"  = YouTube's free data can't show it; judge it yourself (the app won't guess)

export type CharacteristicStatus = "measured" | "later" | "not-data";

export type Characteristic = {
  n: number;
  group: string;
  text: string;
  status: CharacteristicStatus;
  how?: string; // how the app measures it (when measured)
};

type Row = [text: string, status: CharacteristicStatus, how?: string];

const GROUPS: Array<[group: string, rows: Row[]]> = [
  ["Demand", [
    ["Top videos get high views (median, not one viral hit)", "measured", "Demand score"],
    ["Views hold up across the last 3, 6 and 12 months", "measured", "views over time"],
    ["Recent uploads still get strong views", "measured", "Momentum list"],
    ["High views per day on new videos", "measured", "views/day"],
    ["Many different videos succeed, not just one", "measured", "median of 30+ videos"],
    ["Old videos keep getting views for years (evergreen)", "later"],
    ["Interest is growing, not shrinking", "later", "needs daily snapshots"],
    ["Demand is steady all year (not only seasonal)", "later", "needs daily snapshots"],
    ["People actively search for it", "not-data"],
    ["Viewers binge many videos in a row", "not-data"],
  ]],
  ["Room for new channels", [
    ["Top results are not all giant channels", "measured", "Competition score"],
    ["Small channels get outlier videos", "measured", "Opportunity score"],
    ["Channels less than 6 months old are succeeding", "measured", "Freshness score"],
    ["The same topic works for several different channels", "measured", "repeated success tag"],
    ["High views but few recent videos (a gap)", "measured", "gap tag"],
    ["Videos far above their channel's normal views", "measured", "outlier score"],
    ["A few channels don't control all the top results", "later"],
    ["Top competitor videos are old", "later"],
    ["Competitors upload rarely", "later"],
    ["Competitor quality is beatable (titles, thumbnails, scripts)", "not-data"],
  ]],
  ["Money", [
    ["Audience lives in high-paying countries (US, UK, CA, AU)", "measured", "country filter"],
    ["Long videos work (8+ minutes allows more ads)", "measured", "duration of top videos"],
    ["Monetization is reachable fast (strong views on long videos)", "measured", "median views of long videos"],
    ["Sponsors already pay creators in this niche", "later", "scan descriptions"],
    ["Affiliate products to recommend", "later", "scan descriptions"],
    ["Advertisers pay high rates (RPM)", "not-data"],
    ["Viewers have buying intent", "not-data"],
    ["High-value audience (investors, homeowners, business owners)", "not-data"],
    ["Room for your own digital products later", "not-data"],
    ["Several income streams possible", "not-data"],
    ["Low demonetization risk", "not-data"],
    ["Memberships or Patreon potential", "not-data"],
    ["Brand deals pay well", "not-data"],
    ["Lead generation value for businesses", "not-data"],
    ["Advertiser-friendly topic", "not-data"],
  ]],
  ["Works for faceless channels", [
    ["Many sub-topics to cover (100+ video ideas)", "measured", "topic ideas"],
    ["A repeatable title format already works", "measured", "repeated phrases across channels"],
    ["The best video length is proven", "measured", "duration filter"],
    ["No face needed to explain it", "not-data"],
    ["Voiceover narration fits", "not-data"],
    ["Stock footage is easy to find", "not-data"],
    ["Maps, animation or AI visuals fit", "not-data"],
    ["Facts are easy to research", "not-data"],
    ["Scripts can follow a template", "not-data"],
    ["Low production cost", "not-data"],
    ["Easy to outsource", "not-data"],
    ["Videos can be made in batches", "not-data"],
    ["Long narration keeps attention", "not-data"],
    ["Faceless channels already succeed here", "not-data"],
    ["Doesn't depend on one personality", "not-data"],
  ]],
  ["Long-term safety", [
    ["Not a short-lived fad", "later", "needs daily snapshots"],
    ["Stable through algorithm changes", "later", "needs daily snapshots"],
    ["Works in Spanish too", "later", "run with Spanish"],
    ["Low copyright risk (no movie, music or sports clips)", "not-data"],
    ["Doesn't depend on breaking news", "not-data"],
    ["Low legal risk", "not-data"],
    ["Safe under YouTube policies", "not-data"],
    ["Not flooded with low-quality AI spam", "not-data"],
    ["Works on other platforms too", "not-data"],
    ["Titles stay true for years", "not-data"],
    ["Videos don't expire", "not-data"],
    ["Library of videos gains value over time", "not-data"],
    ["Low controversy", "not-data"],
    ["Low misinformation risk", "not-data"],
    ["Low burnout risk for the creator", "not-data"],
  ]],
  ["Audience", [
    ["Viewers like videos (like-to-view ratio)", "later", "likes are already saved"],
    ["Viewers comment (comment-to-view ratio)", "later", "comments are already saved"],
    ["Spanish-speaking audience is underserved", "later", "compare English vs Spanish runs"],
    ["Viewers come back again and again", "not-data"],
    ["Community potential", "not-data"],
    ["Mostly adult audience", "not-data"],
    ["Clear problem the viewer wants solved", "not-data"],
    ["Passionate hobbyists", "not-data"],
    ["Videos get shared", "not-data"],
    ["Comments ask for more videos", "not-data"],
    ["Audience buys things", "not-data"],
    ["Long watch sessions (TV and desktop)", "not-data"],
    ["International appeal", "not-data"],
    ["Big total audience", "not-data"],
    ["Underserved group of viewers", "not-data"],
  ]],
  ["You as the creator", [
    ["You enjoy the topic", "not-data"],
    ["You know about it (or can learn fast)", "not-data"],
    ["You can make 100+ videos without running out", "not-data"],
    ["The workload is sustainable", "not-data"],
    ["It matches your skills", "not-data"],
    ["You'll stay interested for years", "not-data"],
    ["It connects with your other channel", "not-data"],
    ["You have an advantage (language, experience)", "not-data"],
    ["You have access to good sources", "not-data"],
    ["It fits your budget", "not-data"],
  ]],
  ["Data you can trust", [
    ["30+ verified videos before scoring", "measured", "minimum data rule"],
    ["Median instead of average", "measured", "all scores"],
    ["Proof videos shown for every score", "measured", "proof links"],
    ["Off-topic videos removed", "measured", "topic filter"],
    ["Wrong-country and wrong-language videos removed", "measured", "country and language filters"],
    ["Shorts scored separately from long videos", "measured", "video type"],
    ["Music, kids, movies and games removed", "measured", "non-explainer filter"],
    ["Giant channels excluded from Opportunity", "measured", "1M+ subs excluded"],
    ["Confidence level shown", "measured", "low / medium / high"],
    ["Results checked again after 30 to 90 days (backtesting)", "later", "dated copies are already saved"],
  ]],
];

export const CHARACTERISTICS: Characteristic[] = GROUPS.flatMap(([group, rows]) =>
  rows.map(([text, status, how]) => ({ n: 0, group, text, status, how })),
).map((c, i) => ({ ...c, n: i + 1 }));
