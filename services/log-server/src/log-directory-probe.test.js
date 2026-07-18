import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeLogDirectoryWritable } from "./log-directory-probe.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "paletcam-log-probe-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("log directory readiness probe", () => {
  test("leaves no probe artifact after a successful real filesystem check", async () => {
    const directory = await createTemporaryDirectory();

    await probeLogDirectoryWritable(directory);

    expect(await readdir(directory)).toEqual([]);
  });

  test("writes, syncs, closes, and removes an exclusively created hidden probe", async () => {
    const calls = [];
    const file = {
      async writeFile(content, encoding) {
        calls.push(["write", content, encoding]);
      },
      async sync() {
        calls.push(["sync"]);
      },
      async close() {
        calls.push(["close"]);
      },
    };

    await probeLogDirectoryWritable("/logs", {
      createProbeId: () => "unique-id",
      async openFile(path, flags, mode) {
        calls.push(["open", path, flags, mode]);
        return file;
      },
      async removeFile(path) {
        calls.push(["remove", path]);
      },
    });

    const expectedPath = join("/logs", `.paletcam-log-write-probe-${process.pid}-unique-id.tmp`);
    expect(calls).toEqual([
      ["open", expectedPath, "wx", 0o600],
      ["write", "paletcam log directory readiness probe\n", "utf8"],
      ["sync"],
      ["close"],
      ["remove", expectedPath],
    ]);
  });

  test("never overwrites or removes a colliding file", async () => {
    const directory = await createTemporaryDirectory();
    const collisionPath = join(directory, `.paletcam-log-write-probe-${process.pid}-collision.tmp`);
    await writeFile(collisionPath, "user data");

    await expect(
      probeLogDirectoryWritable(directory, {
        createProbeId: () => "collision",
        openFile: open,
        removeFile: rm,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(collisionPath, "utf8")).toBe("user data");
    expect(await readdir(directory)).toEqual([
      `.paletcam-log-write-probe-${process.pid}-collision.tmp`,
    ]);
  });

  test("closes and removes its file after a write failure, then surfaces the failure", async () => {
    const writeError = new Error("disk full");
    const calls = [];

    await expect(
      probeLogDirectoryWritable("/logs", {
        createProbeId: () => "write-failure",
        async openFile() {
          return {
            async writeFile() {
              calls.push("write");
              throw writeError;
            },
            async sync() {
              calls.push("sync");
            },
            async close() {
              calls.push("close");
            },
          };
        },
        async removeFile() {
          calls.push("remove");
        },
      }),
    ).rejects.toBe(writeError);

    expect(calls).toEqual(["write", "close", "remove"]);
  });

  test("surfaces cleanup failures alongside the original probe failure", async () => {
    const writeError = new Error("write failed");
    const closeError = new Error("close failed");
    const removeError = new Error("remove failed");

    try {
      await probeLogDirectoryWritable("/logs", {
        createProbeId: () => "cleanup-failure",
        async openFile() {
          return {
            async writeFile() {
              throw writeError;
            },
            async sync() {},
            async close() {
              throw closeError;
            },
          };
        },
        async removeFile() {
          throw removeError;
        },
      });
      throw new Error("expected readiness probe to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([writeError, closeError, removeError]);
    }
  });
});
