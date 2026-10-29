// Candidate niches to check automatically.
// These are IDEAS only (your rule: AI may suggest niche ideas, never scores).
// Every score comes from real YouTube data when the app checks them.
// Picked to fit "profitable niche" traits: evergreen, faceless-friendly,
// lots of video ideas, and audiences in high-paying countries.
// Edit this list freely: add, remove or reorder lines.

export type SeedGroup = "history" | "finance" | "business & tech" | "science & mind" | "skills";

export type SeedNiche = {
  query: string;
  group: SeedGroup;
};

export const SEED_NICHES: SeedNiche[] = [
  // History (evergreen, very faceless-friendly)
  { query: "medieval", group: "history" },
  { query: "ancient rome", group: "history" },
  { query: "ancient egypt", group: "history" },
  { query: "victorian era", group: "history" },
  { query: "history of food", group: "history" },
  { query: "life before electricity", group: "history" },
  { query: "lost civilizations", group: "history" },
  { query: "history of medicine", group: "history" },
  { query: "cold war", group: "history" },

  // Finance (advertisers usually pay more here)
  { query: "credit cards", group: "finance" },
  { query: "credit score", group: "finance" },
  { query: "budgeting", group: "finance" },
  { query: "index funds", group: "finance" },
  { query: "retirement planning", group: "finance" },
  { query: "real estate investing", group: "finance" },
  { query: "side hustles", group: "finance" },
  { query: "frugal living", group: "finance" },
  { query: "debt payoff", group: "finance" },
  { query: "insurance explained", group: "finance" },

  // Business & tech
  { query: "ai tools", group: "business & tech" },
  { query: "cybersecurity", group: "business & tech" },
  { query: "small business", group: "business & tech" },
  { query: "scams explained", group: "business & tech" },

  // Science & mind
  { query: "psychology facts", group: "science & mind" },
  { query: "space facts", group: "science & mind" },
  { query: "geography", group: "science & mind" },
  { query: "how things work", group: "science & mind" },

  // Practical skills
  { query: "survival skills", group: "skills" },
  { query: "home repair", group: "skills" },
  { query: "productivity", group: "skills" },
];
