import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// All saved results go into the "cache" folder (already in .gitignore)
const CACHE_DIR = path.resolve("cache");

type CacheEntry<T> = {
  key: string;
  savedAt: string;
  data: T;
};

export type CachedResult<T> = {
  data: T;
  fromCache: boolean;
  savedAt: string;
};

// Turns a key like "search:credit cards:12m" into a safe file name
function fileFor(key: string): string {
  const readable = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 10);
  return path.join(CACHE_DIR, `${readable}-${hash}.json`);
}

async function readCache<T>(key: string, maxAgeHours: number): Promise<CacheEntry<T> | null> {
  try {
    const raw = await readFile(fileFor(key), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    const ageHours = (Date.now() - new Date(entry.savedAt).getTime()) / 3_600_000;
    return ageHours <= maxAgeHours ? entry : null;
  } catch {
    return null; // no file yet, or unreadable: treat as "not cached"
  }
}

async function writeCache<T>(key: string, data: T): Promise<CacheEntry<T>> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: CacheEntry<T> = { key, savedAt: new Date().toISOString(), data };
  await writeFile(fileFor(key), JSON.stringify(entry, null, 2), "utf8");
  return entry;
}

/**
 * Use the saved copy if it's fresh enough.
 * Otherwise run `fetcher` (which calls YouTube), save the answer, and return it.
 */
export async function cached<T>(
  key: string,
  maxAgeHours: number,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T>> {
  const hit = await readCache<T>(key, maxAgeHours);
  if (hit) {
    return { data: hit.data, fromCache: true, savedAt: hit.savedAt };
  }

  const fresh = await fetcher();
  const entry = await writeCache(key, fresh);
  return { data: entry.data, fromCache: false, savedAt: entry.savedAt };
}
