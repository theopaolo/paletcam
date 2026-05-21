export const PALETTE_EXPORT_VERSION = 2;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_BYTE_CHUNK_SIZE = 0x6000;
const BASE64_YIELD_CHUNK_INTERVAL = 32;
const SERIALIZATION_YIELD_INTERVAL = 1;
const EXPORT_CONTENT_TYPE = "application/json";
const EXPORT_BLOB_BATCH_SIZE_BYTES = 8 * 1024 * 1024;
const OMITTED_EXPORT_FIELDS = [
  "id",
  "previewGalleryBlob",
  "previewGalleryFooterLabel",
  "previewViewerBlob",
  "previewViewerFooterLabel",
  "previewBlob",
  "previewFooterLabel",
  "hasPhotoAsset",
];

function waitForNextTask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function encodeBase64Range(bytes, start, end) {
  let output = "";
  let index = start;

  for (; index + 2 < end; index += 3) {
    const triplet = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      BASE64_ALPHABET[(triplet >> 18) & 63] +
      BASE64_ALPHABET[(triplet >> 12) & 63] +
      BASE64_ALPHABET[(triplet >> 6) & 63] +
      BASE64_ALPHABET[triplet & 63];
  }

  const remaining = end - index;
  if (remaining === 1) {
    const triplet = bytes[index] << 16;
    output += `${BASE64_ALPHABET[(triplet >> 18) & 63]}${BASE64_ALPHABET[(triplet >> 12) & 63]}==`;
  } else if (remaining === 2) {
    const triplet = (bytes[index] << 16) | (bytes[index + 1] << 8);
    output +=
      BASE64_ALPHABET[(triplet >> 18) & 63] +
      BASE64_ALPHABET[(triplet >> 12) & 63] +
      BASE64_ALPHABET[(triplet >> 6) & 63] +
      "=";
  }

  return output;
}

async function encodeBase64(bytes) {
  const bufferCtor = globalThis.Buffer;
  if (typeof bufferCtor?.from === "function") {
    return bufferCtor.from(bytes).toString("base64");
  }

  const parts = [];
  let chunkCount = 0;
  let index = 0;

  while (index < bytes.length) {
    const remaining = bytes.length - index;
    const nextChunkSize = Math.min(BASE64_BYTE_CHUNK_SIZE, remaining);
    const safeChunkSize =
      remaining > nextChunkSize ? nextChunkSize - (nextChunkSize % 3) : nextChunkSize;
    const end = index + safeChunkSize;

    parts.push(encodeBase64Range(bytes, index, end));
    index = end;
    chunkCount += 1;

    if (chunkCount % BASE64_YIELD_CHUNK_INTERVAL === 0 && index < bytes.length) {
      await waitForNextTask();
    }
  }

  return parts.join("");
}

function decodeBase64(base64) {
  const bufferCtor = globalThis.Buffer;
  if (typeof bufferCtor?.from === "function") {
    return new Uint8Array(bufferCtor.from(base64, "base64"));
  }

  if (typeof atob !== "function") {
    throw new Error("Base64 decoding unavailable.");
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function dataUrlToBlob(dataUrl) {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex <= 4) {
    throw new Error("Invalid data URL format.");
  }

  const header = dataUrl.slice(0, separatorIndex);
  if (!header.startsWith("data:")) {
    throw new Error("Invalid data URL format.");
  }

  const content = dataUrl.slice(separatorIndex + 1);
  const mimeSection = header.slice("data:".length);
  const mimeType =
    mimeSection
      .split(";")
      .filter((part) => part && part !== "base64")
      .join(";") || "application/octet-stream";

  if (header.includes(";base64")) {
    return new Blob([decodeBase64(content)], { type: mimeType });
  }

  const decodedContent = decodeURIComponent(content);
  return new Blob([new TextEncoder().encode(decodedContent)], { type: mimeType });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = blob.type || "application/octet-stream";
  return `data:${mimeType};base64,${await encodeBase64(bytes)}`;
}

function stripNonExportFields(entry) {
  OMITTED_EXPORT_FIELDS.forEach((field) => {
    delete entry[field];
  });
}

function normalizeImportedPalette(entry) {
  const palette = { ...entry };

  if (typeof palette.photoBlob === "string" && palette.photoBlob.startsWith("data:")) {
    palette.photoBlob = dataUrlToBlob(palette.photoBlob);
  }

  delete palette.id;
  delete palette.previewGalleryBlob;
  delete palette.previewGalleryFooterLabel;
  delete palette.previewViewerBlob;
  delete palette.previewViewerFooterLabel;
  delete palette.previewBlob;
  delete palette.previewFooterLabel;
  delete palette.hasPhotoAsset;

  palette.remoteCatchId = palette.remoteCatchId ?? null;
  palette.moderationStatus = palette.moderationStatus ?? null;
  palette.postedAt = palette.postedAt ?? null;
  palette.moderationUpdatedAt = palette.moderationUpdatedAt ?? null;
  palette.lastModerationCheckAt = palette.lastModerationCheckAt ?? null;

  return palette;
}

export async function serializePalettesForExport(palettes, options) {
  return (await serializePalettesForExportParts(palettes, options)).join("");
}

async function serializePaletteEntryForExport(palette) {
  const entry = { ...palette };

  if (entry.photoBlob instanceof Blob) {
    entry.photoBlob = await blobToDataUrl(entry.photoBlob);
  }

  stripNonExportFields(entry);
  return JSON.stringify(entry);
}

export async function serializePalettesForExportParts(
  palettes,
  { onProgress, yieldInterval = SERIALIZATION_YIELD_INTERVAL } = {},
) {
  const total = Array.isArray(palettes) ? palettes.length : 0;
  const parts = [`{"version":${PALETTE_EXPORT_VERSION},"palettes":[`];

  for (let index = 0; index < total; index += 1) {
    parts.push(index > 0 ? "," : "", await serializePaletteEntryForExport(palettes[index]));

    if (typeof onProgress === "function") {
      onProgress({
        completed: index + 1,
        phase: "serializing",
        total,
      });
    }

    if (yieldInterval > 0 && (index + 1) % yieldInterval === 0 && index + 1 < total) {
      await waitForNextTask();
    }
  }

  parts.push("]}");
  return parts;
}

function getExportBlobBatchSizeBytes(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return EXPORT_BLOB_BATCH_SIZE_BYTES;
  }

  return Math.max(1024, Math.floor(numericValue));
}

export async function serializePalettesForExportBlob(
  palettes,
  {
    blobBatchSizeBytes = EXPORT_BLOB_BATCH_SIZE_BYTES,
    onProgress,
    yieldInterval = SERIALIZATION_YIELD_INTERVAL,
  } = {},
) {
  const total = Array.isArray(palettes) ? palettes.length : 0;
  const maxBatchSizeBytes = getExportBlobBatchSizeBytes(blobBatchSizeBytes);
  const blobParts = [];
  let currentParts = [`{"version":${PALETTE_EXPORT_VERSION},"palettes":[`];
  let currentBatchSize = currentParts[0].length;

  function flushCurrentParts() {
    if (currentParts.length === 0) {
      return;
    }

    blobParts.push(new Blob(currentParts, { type: EXPORT_CONTENT_TYPE }));
    currentParts = [];
    currentBatchSize = 0;
  }

  for (let index = 0; index < total; index += 1) {
    const prefix = index > 0 ? "," : "";
    const serializedEntry = await serializePaletteEntryForExport(palettes[index]);

    currentParts.push(prefix, serializedEntry);
    currentBatchSize += prefix.length + serializedEntry.length;

    if (typeof onProgress === "function") {
      onProgress({
        completed: index + 1,
        phase: "serializing",
        total,
      });
    }

    if (currentBatchSize >= maxBatchSizeBytes && index + 1 < total) {
      flushCurrentParts();
    }

    if (yieldInterval > 0 && (index + 1) % yieldInterval === 0 && index + 1 < total) {
      await waitForNextTask();
    }
  }

  currentParts.push("]}");
  flushCurrentParts();

  return new Blob(blobParts, { type: EXPORT_CONTENT_TYPE });
}

export async function deserializePalettesFromImport(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data || !Array.isArray(data.palettes)) {
    throw new Error("Format de fichier invalide.");
  }

  return data.palettes.map(normalizeImportedPalette);
}
