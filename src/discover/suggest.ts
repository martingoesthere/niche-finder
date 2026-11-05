import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectNiche } from "../niche/collectNiche.js";
import { getKeywords } from "../niche/relevance.js";
import { findTopics } from "../topics/findTopics.js";
import { collectOptionsFor, type NodeRow } from "./discover.js";
import { NICHE_TREE, findNode, setSuggestedNodes, type TreeNode } from "./nicheTree.js";

// Topics suggested by real data (the footprints 👣):
// phrases that 2+ different channels used in the tags or titles of verified videos
// inside a topic the app already checked. A suggestion is only an idea: it gets the
// same full real-data check as every other topic before it gets a grade.

export const NEW_SUGGESTIONS_PER_DAY = 3; // limits how many units suggestions can use each day
export const MAX_SUGGESTIONS = 15; // the list never grows past this (each one is re-checked weekly, like every topic)
export const MIN_SUGGESTION_CHANNELS = 2;

// Tags that are too broad to be a topic of their own
const GENERIC_TAGS = new Set([
  "podcast", "podcasts", "mental health", "personal growth", "personal development", "self improvement",
  "self help", "productivity", "philosophy", "motivation", "motivational", "education", "educational",
  "documentary", "history documentary", "history", "facts", "fun facts", "explained", "explainer",
  "shorts", "viral", "trending", "youtube", "video", "videos", "news", "interview", "storytelling",
  "animation", "animated", "story", "stories", "entertainment", "vlog", "tutorial", "how to", "tips",
  "life", "lifestyle", "success", "mindset", "money", "finance", "personal finance", "business",
]);

const FILE = path.resolve("data", "suggestions.json");

export type Suggestion = {
  query: string;
  parentId: string; // the checked topic where the clue was found
  parentQuery: string;
  source: "tags" | "titles";
  channels: number; // how many different channels used it
  medianViews: number; // median views of those videos
  foundAt: string;
};

export const suggestionId = (query: string) => `suggested/${query}`;

function toNode(s: Suggestion): TreeNode {
  const parent = findNode(s.parentId);
  return { id: suggestionId(s.query), query: s.query, level: "micro", group: parent?.group ?? "history", children: [] };
}

export async function loadSuggestions(): Promise<Suggestion[]> {
  try {
    const list = (JSON.parse(await readFile(FILE, "utf8")) as { items: Suggestion[] }).items ?? [];
    setSuggestedNodes(list.map(toNode));
    return list;
  } catch {
    setSuggestedNodes([]);
    return [];
  }
}

async function saveSuggestions(list: Suggestion[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ items: list }, null, 2), "utf8");
  setSuggestedNodes(list.map(toNode));
}

function allTreeQueries(): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: TreeNode[]) => nodes.forEach((n) => (out.add(n.query.toLowerCase()), walk(n.children)));
  walk(NICHE_TREE);
  return out;
}

// Clues from one checked topic, from saved data only (free)
async function cluesFrom(row: NodeRow): Promise<Suggestion[]> {
  const node = findNode(row.id);
  if (!node) return [];
  let result;
  try {
    result = await collectNiche(node.query, { ...collectOptionsFor(node), cacheOnly: true });
  } catch {
    return []; // not saved yet
  }
  const topics = findTopics(result);
  const parentWords = new Set(getKeywords(node.query));
  const now = new Date().toISOString();
  const clues: Suggestion[] = [];

  const good = (phrase: string) => {
    const words = phrase.trim().split(/\s+/);
    if (words.length < 2 || words.length > 4) return false; // one word is too vague; 5+ is a title, not a topic
    if (GENERIC_TAGS.has(phrase)) return false;
    if (!/^[\p{Script=Latin}0-9 '&-]+$/u.test(phrase)) return false; // other alphabets: other audiences
    if (/^\d|\b(19|20)\d\d\b/.test(phrase)) return false; // years go stale ("best cards 2026")
    const concepts = getKeywords(phrase);
    if (concepts.length < 2) return false;
    if (concepts.every((w) => parentWords.has(w))) return false; // only the parent topic's own words
    return true;
  };

  // Tags: exactly as creators typed them
  for (const t of topics.topTags) {
    if (t.channels >= MIN_SUGGESTION_CHANNELS && good(t.tag)) {
      clues.push({ query: t.tag, parentId: row.id, parentQuery: node.query, source: "tags", channels: t.channels, medianViews: t.medianViews, foundAt: now });
    }
  }
  // Titles: multi-word phrases that worked for 2+ channels (the same ones shown as video ideas).
  // Search with the parent topic in front, so the search stays on topic ("psychology gen x").
  for (const t of topics.topics) {
    if (t.channelCount < MIN_SUGGESTION_CHANNELS || !t.phrase.includes(" ")) continue;
    const query = `${node.query} ${t.phrase}`;
    if (good(query)) {
      clues.push({ query, parentId: row.id, parentQuery: node.query, source: "titles", channels: t.channelCount, medianViews: Math.round(t.medianViews), foundAt: now });
    }
  }
  return clues;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso));

/**
 * Adds up to NEW_SUGGESTIONS_PER_DAY new suggestions from the checked rows and returns the full list.
 * Reads saved data only: finding clues costs no YouTube units.
 */
export async function updateSuggestions(checkedRows: NodeRow[]): Promise<Suggestion[]> {
  const list = await loadSuggestions();
  const taken = new Set([...list.map((s) => s.query.toLowerCase()), ...allTreeQueries()]);

  const clues: Suggestion[] = [];
  for (const row of checkedRows.filter((r) => r.checked)) clues.push(...(await cluesFrom(row)));
  // Best clues first: more channels, then more views
  clues.sort((a, b) => b.channels - a.channels || b.medianViews - a.medianViews);

  let addedToday = list.filter((s) => dayOf(s.foundAt) === today()).length;
  for (const c of clues) {
    if (addedToday >= NEW_SUGGESTIONS_PER_DAY || list.length >= MAX_SUGGESTIONS) break;
    const key = c.query.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    list.push(c);
    addedToday++;
  }
  await saveSuggestions(list);
  return list;
}
