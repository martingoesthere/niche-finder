// The ready-made niche tree: 10 niches > 3 sub-niches each > 3 micro-niches each.
// These are IDEAS only (your rule: AI may suggest niche ideas, never scores).
// Every score comes from real YouTube data when the app checks a node.
// Picked for profitable-niche traits: evergreen, faceless-friendly, many video
// ideas, audiences in high-paying countries. Edit freely.

export type NicheLevel = "niche" | "sub" | "micro";
export type NicheGroup = "history" | "finance" | "business & tech" | "science & mind" | "skills";

export type TreeNode = {
  id: string; // e.g. "medieval/medieval peasants/medieval peasant food"
  query: string; // what we search on YouTube
  level: NicheLevel;
  group: NicheGroup;
  children: TreeNode[];
};

// How many search pages each level uses (1 page = about 102 units)
export const PAGES_BY_LEVEL: Record<NicheLevel, number> = { niche: 5, sub: 3, micro: 3 };

type Raw = [query: string, group: NicheGroup, subs: Array<[query: string, micros: string[]]>];

const RAW: Raw[] = [
  ["medieval", "history", [
    ["medieval peasants", ["medieval peasant food", "medieval peasant homes", "medieval peasant jobs"]],
    ["medieval castles", ["castle life", "castle sieges", "knight training"]],
    ["black death", ["plague doctors", "plague cures", "medieval medicine"]],
  ]],
  ["ancient rome", "history", [
    ["roman soldiers", ["roman legion training", "roman weapons", "roman battles"]],
    ["roman daily life", ["roman food", "roman baths", "roman houses"]],
    ["roman emperors", ["crazy roman emperors", "fall of rome", "roman assassinations"]],
  ]],
  ["life before modern conveniences", "history", [
    ["life before electricity", ["before refrigerators", "history of candles", "before air conditioning"]],
    ["history of hygiene", ["history of toilets", "history of soap", "history of bathing"]],
    ["history of food", ["food preservation history", "victorian food", "ancient bread"]],
  ]],
  ["credit cards", "finance", [
    ["credit card debt", ["pay off credit card debt", "credit card interest", "credit card minimum payment"]],
    ["credit score", ["raise credit score", "credit report errors", "credit score myths"]],
    ["credit card rewards", ["travel credit cards", "cash back credit cards", "credit card points"]],
  ]],
  ["investing for beginners", "finance", [
    ["index funds", ["s&p 500 index fund", "vanguard index funds", "index funds vs etfs"]],
    ["retirement planning", ["roth ira", "401k explained", "early retirement"]],
    ["dividend investing", ["dividend stocks", "monthly dividend stocks", "dividend income"]],
  ]],
  ["saving money", "finance", [
    ["budgeting", ["budgeting for beginners", "zero based budget", "cash envelope budget"]],
    ["frugal living", ["frugal living tips", "grocery savings", "minimalism money"]],
    ["side hustles", ["side hustles from home", "online side hustles", "side hustle ideas"]],
  ]],
  ["scams explained", "business & tech", [
    ["online scams", ["phone scams", "crypto scams", "romance scams"]],
    ["identity theft", ["identity theft protection", "data breaches", "credit freeze"]],
    ["famous frauds", ["ponzi schemes", "corporate fraud", "con artists"]],
  ]],
  ["ai tools", "business & tech", [
    ["ai tools for business", ["ai automation", "chatgpt tips", "ai video tools"]],
    ["cybersecurity", ["password security", "vpn explained", "hacking explained"]],
    ["tech explained", ["how the internet works", "how computers work", "how smartphones work"]],
  ]],
  ["psychology", "science & mind", [
    ["psychology facts", ["dark psychology", "body language", "psychology tricks"]],
    ["habits", ["habit building", "dopamine detox", "self discipline"]],
    ["stoicism", ["marcus aurelius", "stoic philosophy", "seneca"]],
  ]],
  ["survival skills", "skills", [
    ["wilderness survival", ["bushcraft", "survival shelter", "survival fire"]],
    ["emergency preparedness", ["emergency food storage", "power outage preparedness", "bug out bag"]],
    ["homesteading", ["off grid living", "raising chickens", "food preservation"]],
  ]],
];

export const NICHE_TREE: TreeNode[] = RAW.map(([query, group, subs]) => ({
  id: query,
  query,
  level: "niche",
  group,
  children: subs.map(([subQuery, micros]) => ({
    id: `${query}/${subQuery}`,
    query: subQuery,
    level: "sub",
    group,
    children: micros.map((microQuery) => ({
      id: `${query}/${subQuery}/${microQuery}`,
      query: microQuery,
      level: "micro",
      group,
      children: [],
    })),
  })),
}));

export function findNode(id: string, nodes: TreeNode[] = NICHE_TREE): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inChild = findNode(id, n.children);
    if (inChild) return inChild;
  }
  return null;
}
