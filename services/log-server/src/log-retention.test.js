import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getLogDateFromFilename,
  pruneExpiredLogFiles,
  rotateLogFileIfNeeded,
} from "./log-retention.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function createTemporaryLogDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "paletcam-logs-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

test("recognizes current and rotated daily log filenames", () => {
  expect(getLogDateFromFilename("2026-07-11.jsonl")).toBe(Date.parse("2026-07-11T00:00:00Z"));
  expect(getLogDateFromFilename("2026-07-11-2026-07-11T10-00-00-000Z.jsonl")).toBe(
    Date.parse("2026-07-11T00:00:00Z"),
  );
  expect(getLogDateFromFilename("notes.txt")).toBeNull();
});

test("prunes expired logs while preserving recent and unrelated files", async () => {
  const directory = await createTemporaryLogDirectory();
  await Promise.all([
    writeFile(join(directory, "2026-06-01.jsonl"), "old"),
    writeFile(join(directory, "2026-07-05.jsonl"), "recent"),
    writeFile(join(directory, "notes.txt"), "keep"),
  ]);

  const removed = await pruneExpiredLogFiles(directory, {
    retentionDays: 30,
    now: Date.parse("2026-07-11T12:00:00Z"),
  });

  expect(removed).toEqual(["2026-06-01.jsonl"]);
  expect((await readdir(directory)).sort()).toEqual(["2026-07-05.jsonl", "notes.txt"]);
});

test("retains a UTC daily file until its entire day is beyond the exact cutoff", async () => {
  const directory = await createTemporaryLogDirectory();
  await Promise.all([
    writeFile(join(directory, "2026-06-30.jsonl"), "expired-day"),
    writeFile(join(directory, "2026-07-01.jsonl"), "partially-retained-day"),
  ]);

  const removed = await pruneExpiredLogFiles(directory, {
    retentionDays: 30,
    now: Date.parse("2026-07-31T12:00:00Z"),
  });

  expect(removed).toEqual(["2026-06-30.jsonl"]);
  expect(await readdir(directory)).toEqual(["2026-07-01.jsonl"]);
});

test("rotates a full daily file before the next append", async () => {
  const directory = await createTemporaryLogDirectory();
  const filePath = join(directory, "2026-07-11.jsonl");
  await writeFile(filePath, "12345");

  const rotatedPath = await rotateLogFileIfNeeded(filePath, 5, Date.parse("2026-07-11T10:00:00Z"));

  expect(rotatedPath).not.toBeNull();
  expect(await readdir(directory)).toEqual(["2026-07-11-2026-07-11T10-00-00-000Z.jsonl"]);
});
