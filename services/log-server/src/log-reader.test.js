import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDailyLogEntries } from "./log-reader.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function createTemporaryLogDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "paletcam-log-reader-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

function jsonLines(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test("reads every validated rotated segment before the current daily file", async () => {
  const directory = await createTemporaryLogDirectory();
  await Promise.all([
    writeFile(
      join(directory, "2026-07-15-2026-07-15T09-00-00-000Z.jsonl"),
      jsonLines({ id: 1 }, { id: 2 }),
    ),
    writeFile(join(directory, "2026-07-15-2026-07-15T11-00-00-000Z.jsonl"), jsonLines({ id: 3 })),
    writeFile(join(directory, "2026-07-15.jsonl"), jsonLines({ id: 4 }, { id: 5 })),
    writeFile(join(directory, "2026-07-14.jsonl"), jsonLines({ id: "other-day" })),
    writeFile(join(directory, "2026-07-15-not-a-rotation.jsonl"), jsonLines({ id: "invalid" })),
    writeFile(
      join(directory, "2026-07-15-2026-07-15T99-00-00-000Z.jsonl"),
      jsonLines({ id: "invalid-time" }),
    ),
    writeFile(join(directory, "notes.txt"), jsonLines({ id: "unrelated" })),
  ]);

  const result = await readDailyLogEntries(directory, "2026-07-15", { limit: 3 });

  expect(result).toEqual({
    totalLines: 5,
    entries: [{ id: 3 }, { id: 4 }, { id: 5 }],
  });
});

test("returns an empty result when the log directory does not exist", async () => {
  const directory = join(tmpdir(), `paletcam-missing-logs-${crypto.randomUUID()}`);

  await expect(readDailyLogEntries(directory, "2026-07-15", { limit: 10 })).resolves.toEqual({
    totalLines: 0,
    entries: [],
  });
});

test("bounds individual lines and preserves tail-limit semantics for rejected lines", async () => {
  const directory = await createTemporaryLogDirectory();
  const oversizedLine = JSON.stringify({ message: "x".repeat(100) });
  await writeFile(
    join(directory, "2026-07-15.jsonl"),
    `${jsonLines({ id: 1 })}${oversizedLine}\nnot-json\n${jsonLines({ id: 4 }, { id: 5 })}`,
  );

  const result = await readDailyLogEntries(directory, "2026-07-15", {
    limit: 4,
    maxLineBytes: 32,
  });

  expect(result).toEqual({
    totalLines: 5,
    entries: [{ id: 4 }, { id: 5 }],
  });
});

test("ignores symlinks even when their names look like same-day segments", async () => {
  const directory = await createTemporaryLogDirectory();
  const outsideFile = join(directory, "outside.jsonl");
  await writeFile(outsideFile, jsonLines({ id: "outside" }));
  await symlink(outsideFile, join(directory, "2026-07-15-2026-07-15T10-00-00-000Z.jsonl"));
  await writeFile(join(directory, "2026-07-15.jsonl"), jsonLines({ id: "base" }));

  await expect(readDailyLogEntries(directory, "2026-07-15", { limit: 10 })).resolves.toEqual({
    totalLines: 1,
    entries: [{ id: "base" }],
  });
});
