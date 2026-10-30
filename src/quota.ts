import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Keeps a running count of YouTube units used today, so automatic checks
// can never use up your whole daily quota.
// YouTube resets the quota at midnight Pacific Time, so "today" is a Pacific date.

export const DAILY_LIMIT = 10_000; // YouTube's free daily quota
export const DAILY_AUTO_CAP = 7_000; // automatic checks stop here, leaving room for your own searches

const FILE = path.resolve("data", "quota.json");

type QuotaFile = { date: string; units: number };

function pacificDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

export async function unitsUsedToday(): Promise<number> {
  try {
    const q = JSON.parse(await readFile(FILE, "utf8")) as QuotaFile;
    return q.date === pacificDate() ? q.units : 0;
  } catch {
    return 0;
  }
}

export async function addUnits(units: number): Promise<number> {
  const total = (await unitsUsedToday()) + units;
  if (units > 0) {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify({ date: pacificDate(), units: total }), "utf8");
  }
  return total;
}

// How many units automatic checks may still use today
export async function autoBudgetLeft(): Promise<number> {
  return Math.max(0, DAILY_AUTO_CAP - (await unitsUsedToday()));
}
