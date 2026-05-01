export const PALETTE_EXPORT_VERSION = 2;

function encodeBase64(bytes) {
  const bufferCtor = globalThis.Buffer;
  if (typeof bufferCtor?.from === "function") {
    return bufferCtor.from(bytes).toString("base64");
  }

  if (typeof btoa !== "function") {
    throw new Error("Base64 encoding unavailable.");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
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
  const mimeType = mimeSection
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
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

function normalizeImportedPalette(entry) {
  const palette = { ...entry };

  if (typeof palette.photoBlob === "string" && palette.photoBlob.startsWith("data:")) {
    palette.photoBlob = dataUrlToBlob(palette.photoBlob);
  }

  delete palette.id;
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

export async function serializePalettesForExport(palettes) {
  const serialized = [];

  for (const palette of palettes) {
    const entry = { ...palette };

    if (entry.photoBlob instanceof Blob) {
      entry.photoBlob = await blobToDataUrl(entry.photoBlob);
    }

    delete entry.id;
    delete entry.previewBlob;
    delete entry.previewFooterLabel;
    delete entry.hasPhotoAsset;
    serialized.push(entry);
  }

  return JSON.stringify({
    version: PALETTE_EXPORT_VERSION,
    palettes: serialized,
  });
}

export async function deserializePalettesFromImport(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data || !Array.isArray(data.palettes)) {
    throw new Error("Format de fichier invalide.");
  }

  return data.palettes.map(normalizeImportedPalette);
}
