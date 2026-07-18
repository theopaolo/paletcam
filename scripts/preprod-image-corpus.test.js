import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImageCorpusManifest } from "./preprod-image-corpus.js";

async function withCorpus(run) {
  const root = await mkdtemp(join(tmpdir(), "paletcam-corpus-"));
  try {
    await mkdir(join(root, "public/assets/img/sets/sample"), { recursive: true });
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("preprod image corpus manifest", () => {
  test("hashes nested image paths deterministically and ignores filesystem metadata", async () => {
    await withCorpus(async (root) => {
      await Promise.all([
        writeFile(join(root, "public/assets/img/z.png"), "z"),
        writeFile(join(root, "public/assets/img/sets/sample/a.webp"), "alpha"),
        writeFile(join(root, "public/assets/img/.DS_Store"), "local metadata"),
      ]);

      const first = await buildImageCorpusManifest(root);
      const second = await buildImageCorpusManifest(root);

      expect(second).toEqual(first);
      expect(first.files.map((file) => file.path)).toEqual([
        "assets/img/sets/sample/a.webp",
        "assets/img/z.png",
      ]);
      expect(first.totals.files).toBe(2);
      expect(first.totals.bytes).toBe(6);
      expect(first.totals.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test("rejects unexpected non-image files anywhere in the corpus", async () => {
    await withCorpus(async (root) => {
      await writeFile(join(root, "public/assets/img/sets/sample/notes.txt"), "not an image");

      await expect(buildImageCorpusManifest(root)).rejects.toThrow(
        "Unsupported files in the image corpus: sets/sample/notes.txt",
      );
    });
  });
});
