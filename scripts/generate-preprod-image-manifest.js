import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  IMAGE_CORPUS_MANIFEST,
  buildImageCorpusManifest,
  serializeImageCorpusManifest,
} from "./preprod-image-corpus.js";

const root = process.cwd();
const outputPath = join(root, IMAGE_CORPUS_MANIFEST);
const manifest = await buildImageCorpusManifest(root);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializeImageCorpusManifest(manifest), "utf8");

console.log(
  `Wrote ${IMAGE_CORPUS_MANIFEST}: ${manifest.totals.files} files, ${manifest.totals.bytes} bytes, ${manifest.totals.sha256}.`,
);
