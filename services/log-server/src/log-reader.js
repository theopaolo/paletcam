import { createReadStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

const ROTATED_SEGMENT_SUFFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

export const DEFAULT_MAX_LOG_LINE_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

function getSegmentSortKey(filename, requestedDate) {
  const baseFilename = `${requestedDate}.jsonl`;
  if (filename === baseFilename) return `1-${filename}`;

  const prefix = `${requestedDate}-`;
  if (!filename.startsWith(prefix) || !filename.endsWith(".jsonl")) return null;

  const suffix = filename.slice(prefix.length, -".jsonl".length);
  const match = ROTATED_SEGMENT_SUFFIX_PATTERN.exec(suffix);
  if (!match) return null;

  const isoTimestamp = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== isoTimestamp)
    return null;

  return `0-${suffix}`;
}

async function listDailyLogSegments(logDirectory, requestedDate) {
  const segments = [];
  let directory;

  try {
    directory = await opendir(logDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return segments;
    throw error;
  }

  try {
    for await (const entry of directory) {
      if (!entry.isFile()) continue;
      const sortKey = getSegmentSortKey(entry.name, requestedDate);
      if (sortKey === null) continue;
      segments.push({ filename: entry.name, sortKey });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return segments
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map(({ filename }) => join(logDirectory, filename));
}

function createTailCollector(limit) {
  const values = new Array(limit);
  let totalLines = 0;

  return {
    add(value) {
      values[totalLines % limit] = value;
      totalLines += 1;
    },
    result() {
      const retained = Math.min(totalLines, limit);
      const start = totalLines > limit ? totalLines % limit : 0;
      const entries = [];

      for (let offset = 0; offset < retained; offset += 1) {
        const value = values[(start + offset) % limit];
        if (value !== null) entries.push(value);
      }

      return { entries, totalLines };
    },
  };
}

async function readLogSegment(filePath, { maxLineBytes, onLine }) {
  const stream = createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES });
  let lineParts = [];
  let lineBytes = 0;
  let lineTooLong = false;

  function appendPart(part) {
    if (part.length === 0 || lineTooLong) return;
    if (lineBytes + part.length > maxLineBytes) {
      lineParts = [];
      lineBytes = 0;
      lineTooLong = true;
      return;
    }
    lineParts.push(part);
    lineBytes += part.length;
  }

  function finishLine() {
    if (lineTooLong) {
      onLine(null);
    } else if (lineBytes > 0) {
      const line =
        lineParts.length === 1
          ? lineParts[0].toString("utf8")
          : Buffer.concat(lineParts).toString("utf8");
      try {
        onLine(JSON.parse(line));
      } catch {
        onLine(null);
      }
    }

    lineParts = [];
    lineBytes = 0;
    lineTooLong = false;
  }

  try {
    for await (const chunk of stream) {
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        appendPart(chunk.subarray(start, index));
        finishLine();
        start = index + 1;
      }
      appendPart(chunk.subarray(start));
    }

    if (lineTooLong || lineBytes > 0) finishLine();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function readDailyLogEntries(
  logDirectory,
  requestedDate,
  { limit, maxLineBytes = DEFAULT_MAX_LOG_LINE_BYTES },
) {
  const effectiveLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const effectiveMaxLineBytes = Math.max(1, Math.floor(Number(maxLineBytes) || 1));
  const collector = createTailCollector(effectiveLimit);
  const filePaths = await listDailyLogSegments(logDirectory, requestedDate);

  for (const filePath of filePaths) {
    await readLogSegment(filePath, {
      maxLineBytes: effectiveMaxLineBytes,
      onLine: (entry) => collector.add(entry),
    });
  }

  return collector.result();
}
