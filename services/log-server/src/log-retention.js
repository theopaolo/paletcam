import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const LOG_FILENAME_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:-[a-zA-Z0-9-]+)?\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getLogDateFromFilename(filename) {
  const match = LOG_FILENAME_PATTERN.exec(String(filename));
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function pruneExpiredLogFiles(logDirectory, { retentionDays, now = Date.now() }) {
  const effectiveRetentionDays = Math.max(1, Number(retentionDays) || 1);
  const cutoff = now - effectiveRetentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(logDirectory, { withFileTypes: true });
  const removed = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const logDate = getLogDateFromFilename(entry.name);
    // A daily file can contain records through the end of its UTC day. Retain
    // the whole file until every possible record in it is older than the exact
    // retention cutoff; comparing only its midnight timestamp can prune almost
    // a full day too early.
    const logDayEnd = logDate === null ? null : logDate + DAY_MS;
    if (logDayEnd === null || logDayEnd > cutoff) continue;
    await rm(join(logDirectory, entry.name));
    removed.push(entry.name);
  }

  return removed;
}

export async function rotateLogFileIfNeeded(filePath, maxBytes, now = Date.now()) {
  const effectiveMaxBytes = Math.max(1, Number(maxBytes) || 1);
  try {
    const fileStats = await stat(filePath);
    if (fileStats.size < effectiveMaxBytes) return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const suffix = new Date(now).toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const rotatedPath = filePath.replace(/\.jsonl$/, `-${suffix}.jsonl`);
  await rename(filePath, rotatedPath);
  return rotatedPath;
}
