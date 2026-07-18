import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const IMAGE_CORPUS_DIRECTORY = "public/assets/img";
export const IMAGE_CORPUS_MANIFEST = "public/debug/image-corpus-manifest.json";
export const IMAGE_CORPUS_PUBLIC_PREFIX = "assets/img/";
export const EXPECTED_IMAGE_CORPUS_FILES = 216;

const IMAGE_EXTENSIONS = new Set(["jpeg", "jpg", "png", "webp"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isImageFilename(filename) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export function serializeImageCorpusManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function listCorpusFiles(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listCorpusFiles(directory, absolutePath)));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(relative(directory, absolutePath).split("\\").join("/"));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export async function buildImageCorpusManifest(
  root = process.cwd(),
  { directory: relativeDirectory = IMAGE_CORPUS_DIRECTORY } = {},
) {
  const directory = join(root, relativeDirectory);
  const corpusFiles = await listCorpusFiles(directory);
  const unsupportedFiles = corpusFiles.filter((filename) => !isImageFilename(filename));
  if (unsupportedFiles.length > 0) {
    throw new Error(`Unsupported files in the image corpus: ${unsupportedFiles.join(", ")}`);
  }

  const files = [];
  for (const filename of corpusFiles) {
    const bytes = await readFile(join(directory, filename));
    files.push({
      path: `${IMAGE_CORPUS_PUBLIC_PREFIX}${filename}`,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }

  const aggregateInput = files
    .map(({ path, bytes, sha256: fileHash }) => `${path}\0${bytes}\0${fileHash}\n`)
    .join("");
  return {
    schemaVersion: 1,
    files,
    totals: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      sha256: sha256(aggregateInput),
    },
  };
}

export async function readImageCorpusManifest(root = process.cwd()) {
  const manifestPath = join(root, IMAGE_CORPUS_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.totals ||
    manifest.files.some(
      (file) =>
        typeof file?.path !== "string" ||
        !file.path.startsWith(IMAGE_CORPUS_PUBLIC_PREFIX) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256),
    )
  ) {
    throw new Error(`Invalid preprod image corpus manifest: ${IMAGE_CORPUS_MANIFEST}`);
  }
  return manifest;
}
