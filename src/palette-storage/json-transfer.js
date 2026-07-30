import { hasCompleteRasterImageContainer, hasSafeRasterImageDimensions } from "./image-header.js";
import {
  PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
  PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
} from "./backup-error-codes.js";

export {
  PALETTE_BACKUP_INTEGRITY_ERROR_CODE,
  PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE,
} from "./backup-error-codes.js";

export const PALETTE_EXPORT_VERSION = 2;
// JSON.parse temporarily retains the source string and parsed string values at
// the same time. Keeping this bound well below a typical mobile browser's
// process limit prevents a user-selected backup from creating a 100+ MiB UTF-16
// source allocation in the worker. A 16 MiB photo still has over 10 MiB of JSON
// envelope/base64 headroom and is far above Paletcam's 2048 px WebP/JPEG output.
export const PALETTE_IMPORT_MAX_JSON_BYTES = 32 * 1024 * 1024;
// Blob imports are parsed incrementally, so their total file bound can be much
// larger than the bound used by the legacy JSON.parse path without creating a
// same-sized UTF-16 string. The 768 MiB envelope leaves base64 and metadata
// headroom for collections containing up to 512 MiB of decoded photos. Each
// individual palette remains separately bounded below, and batches are durably
// staged instead of retaining the complete collection in memory.
export const PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES = 768 * 1024 * 1024;
export const PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES = 32 * 1024 * 1024;
export const PALETTE_IMPORT_MAX_COUNT = 2_000;
export const PALETTE_IMPORT_MAX_PHOTO_BYTES = 16 * 1024 * 1024;
export const PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES = 512 * 1024 * 1024;
export const PALETTE_IMPORT_MAX_PHOTO_PIXELS = 12_000_000;
// Backups produced before the bounded schema could contain more swatches than
// the current 3–7 color capture control. Preserve those historical palettes
// without widening the live capture range or accepting unbounded arrays.
export const PALETTE_IMPORT_MAX_COLORS = 16;
const PALETTE_IMPORT_MAX_REMOTE_ID_LENGTH = 256;
const REMOTE_OWNER_ACCOUNT_KEY_PATTERN = /^account:[a-f0-9]{16}$/;
const PALETTE_IMPORT_MAX_RAL_CODE_LENGTH = 64;
const PALETTE_IMPORT_MAX_RAL_NAME_LENGTH = 160;
const PALETTE_IMPORT_MAX_FOOTER_LABEL_LENGTH = 160;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_BYTE_CHUNK_SIZE = 0x6000;
const BASE64_YIELD_CHUNK_INTERVAL = 32;
const SERIALIZATION_YIELD_INTERVAL = 1;
const EXPORT_CONTENT_TYPE = "application/json";
const EXPORT_BLOB_BATCH_SIZE_BYTES = 8 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 2;
const IMPORT_BLOB_SLICE_BYTES = 256 * 1024;
const IMPORT_ROOT_VALUE_MAX_JSON_BYTES = 1024 * 1024;
const IMPORT_ROOT_KEY_MAX_JSON_BYTES = 1024;
const VALID_CAPTURE_MODES = new Set(["palette", "ral"]);
const VALID_MODERATION_STATUSES = new Set(["TO_MODERATE", "PUBLIC", "REJECTED", "PRIVATE"]);
const VALID_IMPORTED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OMITTED_EXPORT_FIELDS = [
  "id",
  "favoritedAt",
  "previewGalleryBlob",
  "previewGalleryFooterLabel",
  "previewViewerBlob",
  "previewViewerFooterLabel",
  "previewBlob",
  "previewFooterLabel",
  "hasPhotoAsset",
  "remoteCatchId",
  "remoteOwnerAccountKey",
  "moderationStatus",
  "postedAt",
  "moderationUpdatedAt",
  "lastModerationCheckAt",
];

/**
 * @typedef {object} PaletteSerializationProgress
 * @property {number} completed
 * @property {"serializing"} phase
 * @property {number} total
 */

/**
 * @typedef {object} PaletteSerializationOptions
 * @property {number} [blobBatchSizeBytes]
 * @property {number} [maxEntryJsonBytes]
 * @property {number} [maxJsonBytes]
 * @property {number} [maxTotalPhotoBytes]
 * @property {(progress: PaletteSerializationProgress) => void} [onProgress]
 * @property {number} [yieldInterval]
 */

/**
 * @typedef {object} PaletteImportProgress
 * @property {number} completed
 * @property {number} loadedBytes
 * @property {"parsing"} phase
 * @property {number} totalBytes
 */

/**
 * Batches are provisional until the returned promise resolves: the parser can
 * only validate trailing root syntax after the last palette has been emitted.
 * Consumers must not commit a batch outside an atomic import operation.
 *
 * @typedef {object} PaletteBlobDeserializationOptions
 * @property {number} [batchSize]
 * @property {boolean} [collect]
 * @property {number} [maxEntryJsonBytes]
 * @property {number} [maxJsonBytes]
 * @property {number} [maxPaletteCount]
 * @property {number} [maxPhotoBytes]
 * @property {number} [maxPhotoPixels]
 * @property {number} [maxTotalPhotoBytes]
 * @property {(palettes: object[], progress: PaletteImportProgress) => void | Promise<void>} [onBatch]
 * @property {(progress: PaletteImportProgress) => void} [onProgress]
 */

function waitForNextTask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getUtf8ByteLength(value, stopAfterBytes = Infinity) {
  let byteLength = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      // BMP characters and unmatched surrogates both encode to three UTF-8 bytes.
      byteLength += 3;
    }

    if (byteLength > stopAfterBytes) {
      return byteLength;
    }
  }

  return byteLength;
}

function isUtf8StringWithinByteLimit(value, maxBytes) {
  return getUtf8ByteLength(value, maxBytes) <= maxBytes;
}

export function assertPaletteImportStringSize(
  jsonString,
  maxJsonBytes = PALETTE_IMPORT_MAX_JSON_BYTES,
) {
  if (typeof jsonString !== "string") {
    throw new Error("Palette backup must be JSON text.");
  }
  if (!isUtf8StringWithinByteLimit(jsonString, maxJsonBytes)) {
    throw new PaletteBackupSizeLimitError("Palette backup exceeds the import size limit.");
  }
}

export class PaletteBackupSizeLimitError extends Error {
  /** @param {string} [message] */
  constructor(message = "Palette backup is too large to export and restore safely.") {
    super(message);
    this.name = "PaletteBackupSizeLimitError";
    this.code = PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE;
  }
}

export class PaletteBackupIntegrityError extends Error {
  /** @param {string} [message] @param {{cause?: unknown}} [options] */
  constructor(
    message = "A stored palette is damaged or unsupported and cannot be backed up safely.",
    options = {},
  ) {
    super(message, options);
    this.name = "PaletteBackupIntegrityError";
    this.code = PALETTE_BACKUP_INTEGRITY_ERROR_CODE;
  }
}

export function assertPaletteExportCount(palettes) {
  const paletteCount = Array.isArray(palettes) ? palettes.length : 0;
  if (paletteCount > PALETTE_IMPORT_MAX_COUNT) {
    throw new PaletteBackupSizeLimitError(
      `A restorable backup can contain at most ${PALETTE_IMPORT_MAX_COUNT} palettes.`,
    );
  }
  return paletteCount;
}

function getExportMaxJsonBytes(value, maximumJsonBytes = PALETTE_IMPORT_MAX_JSON_BYTES) {
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    return maximumJsonBytes;
  }
  return Math.min(numericValue, maximumJsonBytes);
}

function addExportPartBytesOrThrow(currentBytes, part, maxJsonBytes) {
  const remainingBytes = maxJsonBytes - currentBytes;
  const partBytes = getUtf8ByteLength(part, remainingBytes);
  if (partBytes > remainingBytes) {
    throw new PaletteBackupSizeLimitError();
  }
  return currentBytes + partBytes;
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

function decodeDataUrl(dataUrl) {
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
    return { bytes: decodeBase64(content), mimeType };
  }

  const decodedContent = decodeURIComponent(content);
  return { bytes: new TextEncoder().encode(decodedContent), mimeType };
}

export function dataUrlToBlob(dataUrl) {
  const { bytes, mimeType } = decodeDataUrl(dataUrl);
  return new Blob([bytes], { type: mimeType });
}

async function blobToValidatedDataUrl(blob) {
  if (!(blob instanceof Blob) || blob.size > PALETTE_IMPORT_MAX_PHOTO_BYTES) {
    throw new PaletteBackupSizeLimitError(
      "A photo in the collection exceeds the safe backup size limit.",
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = String(blob.type || "").toLowerCase();
  if (
    !VALID_IMPORTED_PHOTO_MIME_TYPES.has(mimeType) ||
    !hasSafeRasterImageDimensions(bytes, mimeType, PALETTE_IMPORT_MAX_PHOTO_PIXELS) ||
    !hasCompleteRasterImageContainer(bytes, mimeType)
  ) {
    throw new PaletteBackupIntegrityError();
  }
  return `data:${mimeType};base64,${await encodeBase64(bytes)}`;
}

function stripNonExportFields(entry) {
  OMITTED_EXPORT_FIELDS.forEach((field) => {
    delete entry[field];
  });
}

function getBase64DecodedSize(base64) {
  const paddingLength = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - paddingLength);
}

function assertPhotoDataUrlWithinLimit(dataUrl, maxPhotoBytes) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return 0;
  }

  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) {
    throw new Error("Invalid photo data in palette backup.");
  }

  const header = dataUrl.slice(0, separatorIndex);
  const content = dataUrl.slice(separatorIndex + 1);
  const estimatedBytes = header.includes(";base64")
    ? getBase64DecodedSize(content)
    : new TextEncoder().encode(content).byteLength;

  if (estimatedBytes > maxPhotoBytes) {
    throw new PaletteBackupSizeLimitError(
      "A photo in the palette backup exceeds the import size limit.",
    );
  }
  return estimatedBytes;
}

function getExportPhotoBytes(palette) {
  const photo = palette?.photoBlob;
  if (photo instanceof Blob) {
    if (photo.size > PALETTE_IMPORT_MAX_PHOTO_BYTES) {
      throw new PaletteBackupSizeLimitError(
        "A photo in the collection exceeds the safe backup size limit.",
      );
    }
    return photo.size;
  }
  return assertPhotoDataUrlWithinLimit(photo, PALETTE_IMPORT_MAX_PHOTO_BYTES);
}

function addExportPhotoBytesOrThrow(totalPhotoBytes, palette, maxTotalPhotoBytes) {
  const nextTotalPhotoBytes = totalPhotoBytes + getExportPhotoBytes(palette);
  if (nextTotalPhotoBytes > maxTotalPhotoBytes) {
    throw new PaletteBackupSizeLimitError(
      "Photos in the palette backup exceed the cumulative import size limit.",
    );
  }
  return nextTotalPhotoBytes;
}

function assertExportTotalPhotoBytes(palettes, maxTotalPhotoBytes) {
  let totalPhotoBytes = 0;
  for (const palette of palettes) {
    totalPhotoBytes = addExportPhotoBytesOrThrow(totalPhotoBytes, palette, maxTotalPhotoBytes);
  }
}

function assertSerializedEntryWithinLimit(serializedEntryBytes, maxEntryJsonBytes) {
  if (serializedEntryBytes > maxEntryJsonBytes) {
    throw new PaletteBackupSizeLimitError(
      "A palette entry in the backup exceeds the safe import size limit.",
    );
  }
}

function normalizeImportedTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid palette timestamp in backup.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid palette timestamp in backup.");
  }

  return date.toISOString();
}

function normalizeImportedColors(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > PALETTE_IMPORT_MAX_COLORS) {
    throw new Error("Invalid palette colors in backup.");
  }

  return value.map((color) => {
    if (!color || typeof color !== "object" || Array.isArray(color)) {
      throw new Error("Invalid palette color in backup.");
    }

    const channels = [color.r, color.g, color.b];
    if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      throw new Error("Invalid palette color in backup.");
    }

    const normalized = { r: color.r, g: color.g, b: color.b };
    if (color.population !== undefined) {
      if (!Number.isFinite(color.population) || color.population < 0) {
        throw new Error("Invalid palette color population in backup.");
      }
      normalized.population = color.population;
    }
    return normalized;
  });
}

function normalizeImportedCropRect(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid palette crop rectangle in backup.");
  }

  const { x, y, width, height } = value;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new Error("Invalid palette crop rectangle in backup.");
  }
  return { x, y, width, height };
}

function normalizeImportedRalMatch(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid RAL match in palette backup.");
  }

  const code = typeof value.code === "string" ? value.code.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const channels = [value.r, value.g, value.b];
  if (
    !code ||
    !name ||
    code.length > PALETTE_IMPORT_MAX_RAL_CODE_LENGTH ||
    name.length > PALETTE_IMPORT_MAX_RAL_NAME_LENGTH ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255) ||
    !Number.isFinite(value.deltaE) ||
    value.deltaE < 0
  ) {
    throw new Error("Invalid RAL match in palette backup.");
  }
  return { code, name, r: value.r, g: value.g, b: value.b, deltaE: value.deltaE };
}

function normalizeOptionalIsoString(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Invalid ${fieldName} in palette backup.`);
  }
  return new Date(value).toISOString();
}

function normalizeImportedPhoto(value, maxPhotoBytes, maxPhotoPixels) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.startsWith("data:image/")) {
    throw new Error("Invalid photo data in palette backup.");
  }
  assertPhotoDataUrlWithinLimit(value, maxPhotoBytes);
  const { bytes, mimeType: rawMimeType } = decodeDataUrl(value);
  const mimeType = rawMimeType.toLowerCase();
  if (!VALID_IMPORTED_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new Error("Invalid photo data in palette backup.");
  }
  if (!hasSafeRasterImageDimensions(bytes, mimeType, maxPhotoPixels)) {
    throw new Error("Photo dimensions in the palette backup are invalid or exceed the limit.");
  }
  if (!hasCompleteRasterImageContainer(bytes, mimeType)) {
    throw new Error("Photo data in the palette backup is truncated or incomplete.");
  }
  return new Blob([bytes], { type: mimeType });
}

function normalizeImportedPalette(entry, { maxPhotoBytes, maxPhotoPixels }) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Invalid palette entry in backup.");
  }

  const captureMode = entry.captureMode ?? "palette";
  if (!VALID_CAPTURE_MODES.has(captureMode)) {
    throw new Error("Invalid palette capture mode in backup.");
  }

  const captureAspectRatio = entry.captureAspectRatio ?? "4:3";
  if (
    !(
      (typeof captureAspectRatio === "string" && new Set(["1:1", "4:3"]).has(captureAspectRatio)) ||
      (Number.isFinite(captureAspectRatio) && captureAspectRatio >= 0.25 && captureAspectRatio <= 4)
    )
  ) {
    throw new Error("Invalid palette aspect ratio in backup.");
  }

  const moderationStatus = entry.moderationStatus ?? null;
  if (moderationStatus !== null && !VALID_MODERATION_STATUSES.has(moderationStatus)) {
    throw new Error("Invalid moderation status in palette backup.");
  }

  const remoteCatchId = entry.remoteCatchId ?? null;
  if (
    remoteCatchId !== null &&
    (typeof remoteCatchId !== "string" ||
      !remoteCatchId.trim() ||
      remoteCatchId.trim().length > PALETTE_IMPORT_MAX_REMOTE_ID_LENGTH)
  ) {
    throw new Error("Invalid remote catch id in palette backup.");
  }

  const remoteOwnerAccountKey = entry.remoteOwnerAccountKey ?? null;
  if (
    remoteOwnerAccountKey !== null &&
    (typeof remoteOwnerAccountKey !== "string" ||
      !REMOTE_OWNER_ACCOUNT_KEY_PATTERN.test(remoteOwnerAccountKey.trim()))
  ) {
    throw new Error("Invalid remote owner account key in palette backup.");
  }

  // Keep validating device-local and legacy authority metadata even though none
  // of it is trusted or restored. This preserves a strict, deterministic import
  // boundary: a malformed file still fails closed instead of being half-read.
  normalizeOptionalIsoString(entry.favoritedAt, "favorite date");
  normalizeOptionalIsoString(entry.postedAt, "posted date");
  normalizeOptionalIsoString(entry.moderationUpdatedAt, "moderation update date");
  normalizeOptionalIsoString(entry.lastModerationCheckAt, "moderation check date");

  const polaroidRenderSettings = entry.polaroidRenderSettings ?? null;
  if (
    polaroidRenderSettings !== null &&
    (!polaroidRenderSettings ||
      typeof polaroidRenderSettings !== "object" ||
      Array.isArray(polaroidRenderSettings) ||
      typeof polaroidRenderSettings.footerLabel !== "string" ||
      polaroidRenderSettings.footerLabel.trim().length > PALETTE_IMPORT_MAX_FOOTER_LABEL_LENGTH ||
      (polaroidRenderSettings.showColorNames !== undefined &&
        typeof polaroidRenderSettings.showColorNames !== "boolean"))
  ) {
    throw new Error("Invalid polaroid settings in palette backup.");
  }

  return {
    timestamp: normalizeImportedTimestamp(entry.timestamp),
    colors: normalizeImportedColors(entry.colors),
    photoBlob: normalizeImportedPhoto(entry.photoBlob, maxPhotoBytes, maxPhotoPixels),
    captureAspectRatio,
    captureCropRect: normalizeImportedCropRect(entry.captureCropRect),
    captureMode,
    ralMatch: normalizeImportedRalMatch(entry.ralMatch),
    polaroidRenderSettings:
      polaroidRenderSettings === null
        ? null
        : {
            footerLabel: polaroidRenderSettings.footerLabel.trim(),
            ...(polaroidRenderSettings.showColorNames !== undefined
              ? { showColorNames: polaroidRenderSettings.showColorNames }
              : {}),
          },
    // Favourites are a device-local shortlist, not part of the capture. They are
    // neither written to a backup nor read back from one, so importing the same
    // file on another device never disturbs the favourites already there.
    favoritedAt: null,
    // A backup is portable user data, not proof that the importing browser's
    // current account owns a server-side catch. Validate legacy fields above so
    // malformed files still fail closed, then deliberately remove publication
    // authority at the transfer boundary. Imported palettes can be published
    // again by the authenticated account without acting on an arbitrary remote
    // identifier carried by a file.
    remoteCatchId: null,
    remoteOwnerAccountKey: null,
    moderationStatus: null,
    postedAt: null,
    moderationUpdatedAt: null,
    lastModerationCheckAt: null,
  };
}

/** @param {object[]} palettes @param {PaletteSerializationOptions} [options] */
export async function serializePalettesForExport(palettes, options) {
  return (await serializePalettesForExportParts(palettes, options)).join("");
}

async function serializePaletteEntryForExport(palette) {
  const entry = { ...palette };

  if (entry.photoBlob instanceof Blob) {
    try {
      const photoDataUrl = await blobToValidatedDataUrl(entry.photoBlob);
      const normalizedEntry = normalizeImportedPalette(
        { ...entry, photoBlob: undefined },
        {
          maxPhotoBytes: PALETTE_IMPORT_MAX_PHOTO_BYTES,
          maxPhotoPixels: PALETTE_IMPORT_MAX_PHOTO_PIXELS,
        },
      );
      stripNonExportFields(normalizedEntry);
      return JSON.stringify({ ...normalizedEntry, photoBlob: photoDataUrl });
    } catch (error) {
      if (
        error?.code === PALETTE_BACKUP_SIZE_LIMIT_ERROR_CODE ||
        error?.code === PALETTE_BACKUP_INTEGRITY_ERROR_CODE
      ) {
        throw error;
      }
      throw new PaletteBackupIntegrityError(undefined, { cause: error });
    }
  }

  stripNonExportFields(entry);
  return JSON.stringify(entry);
}

export async function serializePalettesForExportParts(
  palettes,
  /** @type {PaletteSerializationOptions} */
  {
    maxEntryJsonBytes = PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES,
    maxJsonBytes = PALETTE_IMPORT_MAX_JSON_BYTES,
    maxTotalPhotoBytes = PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES,
    onProgress,
    yieldInterval = SERIALIZATION_YIELD_INTERVAL,
  } = {},
) {
  const total = assertPaletteExportCount(palettes);
  assertExportTotalPhotoBytes(palettes, maxTotalPhotoBytes);
  const effectiveMaxJsonBytes = getExportMaxJsonBytes(maxJsonBytes);
  const envelopePrefix = `{"version":${PALETTE_EXPORT_VERSION},"palettes":[`;
  const parts = [envelopePrefix];
  let exportBytes = addExportPartBytesOrThrow(0, envelopePrefix, effectiveMaxJsonBytes);

  for (let index = 0; index < total; index += 1) {
    const prefix = index > 0 ? "," : "";
    const serializedEntry = await serializePaletteEntryForExport(palettes[index]);
    assertSerializedEntryWithinLimit(getUtf8ByteLength(serializedEntry), maxEntryJsonBytes);
    exportBytes = addExportPartBytesOrThrow(exportBytes, prefix, effectiveMaxJsonBytes);
    exportBytes = addExportPartBytesOrThrow(exportBytes, serializedEntry, effectiveMaxJsonBytes);
    parts.push(prefix, serializedEntry);

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

  addExportPartBytesOrThrow(exportBytes, "]}", effectiveMaxJsonBytes);
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
  /** @type {PaletteSerializationOptions} */
  {
    blobBatchSizeBytes = EXPORT_BLOB_BATCH_SIZE_BYTES,
    maxEntryJsonBytes = PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES,
    maxJsonBytes = PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
    maxTotalPhotoBytes = PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES,
    onProgress,
    yieldInterval = SERIALIZATION_YIELD_INTERVAL,
  } = {},
) {
  const total = assertPaletteExportCount(palettes);
  assertExportTotalPhotoBytes(palettes, maxTotalPhotoBytes);
  const effectiveMaxJsonBytes = getExportMaxJsonBytes(
    maxJsonBytes,
    PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
  );
  const maxBatchSizeBytes = getExportBlobBatchSizeBytes(blobBatchSizeBytes);
  const blobParts = [];
  const envelopePrefix = `{"version":${PALETTE_EXPORT_VERSION},"palettes":[`;
  let currentParts = [envelopePrefix];
  let currentBatchSize = getUtf8ByteLength(envelopePrefix);
  let exportBytes = addExportPartBytesOrThrow(0, envelopePrefix, effectiveMaxJsonBytes);

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
    const prefixBytes = getUtf8ByteLength(prefix);
    const serializedEntryBytes = getUtf8ByteLength(serializedEntry);
    assertSerializedEntryWithinLimit(serializedEntryBytes, maxEntryJsonBytes);

    exportBytes = addExportPartBytesOrThrow(exportBytes, prefix, effectiveMaxJsonBytes);
    exportBytes = addExportPartBytesOrThrow(exportBytes, serializedEntry, effectiveMaxJsonBytes);

    currentParts.push(prefix, serializedEntry);
    currentBatchSize += prefixBytes + serializedEntryBytes;

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

  addExportPartBytesOrThrow(exportBytes, "]}", effectiveMaxJsonBytes);
  currentParts.push("]}");
  flushCurrentParts();

  return new Blob(blobParts, { type: EXPORT_CONTENT_TYPE });
}

function isJsonWhitespace(character) {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

function isJsonValueDelimiter(character) {
  return (
    character === undefined ||
    isJsonWhitespace(character) ||
    character === "," ||
    character === "]" ||
    character === "}"
  );
}

function appendBoundedJsonPart(parts, part, currentBytes, maxBytes, message) {
  if (!part) {
    return currentBytes;
  }

  const remainingBytes = maxBytes - currentBytes;
  const partBytes = getUtf8ByteLength(part, remainingBytes);
  if (partBytes > remainingBytes) {
    throw new PaletteBackupSizeLimitError(message);
  }
  parts.push(part);
  return currentBytes + partBytes;
}

class BlobJsonTextReader {
  constructor(blob) {
    this.blob = blob;
    this.chunk = "";
    this.chunkIndex = 0;
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.done = false;
    this.loadedBytes = 0;
    this.sliceOffset = 0;
  }

  async loadNextChunk() {
    while (this.chunkIndex >= this.chunk.length && !this.done) {
      let bytes;
      if (this.sliceOffset < this.blob.size) {
        const nextOffset = Math.min(this.sliceOffset + IMPORT_BLOB_SLICE_BYTES, this.blob.size);
        bytes = new Uint8Array(await this.blob.slice(this.sliceOffset, nextOffset).arrayBuffer());
        this.sliceOffset = nextOffset;
      } else {
        this.done = true;
        this.chunk = this.decoder.decode();
        this.chunkIndex = 0;
        continue;
      }

      this.loadedBytes += bytes.byteLength;
      this.chunk = this.decoder.decode(bytes, { stream: true });
      this.chunkIndex = 0;
    }

    return this.chunkIndex < this.chunk.length;
  }

  async peekCharacter() {
    return (await this.loadNextChunk()) ? this.chunk[this.chunkIndex] : undefined;
  }

  async consumeCharacter() {
    const character = await this.peekCharacter();
    if (character !== undefined) {
      this.chunkIndex += 1;
    }
    return character;
  }

  async skipWhitespace() {
    while (await this.loadNextChunk()) {
      let index = this.chunkIndex;
      while (index < this.chunk.length && isJsonWhitespace(this.chunk[index])) {
        index += 1;
      }
      this.chunkIndex = index;
      if (index < this.chunk.length) {
        return;
      }
    }
  }

  async expectCharacter(expected) {
    const character = await this.consumeCharacter();
    if (character !== expected) {
      throw new SyntaxError("Invalid JSON syntax in palette backup.");
    }
  }

  async readJsonString(maxBytes = IMPORT_ROOT_KEY_MAX_JSON_BYTES) {
    const source = await this.readJsonValue(maxBytes, "Palette backup metadata is too large.");
    const value = JSON.parse(source);
    if (typeof value !== "string") {
      throw new SyntaxError("Invalid JSON object key in palette backup.");
    }
    return value;
  }

  async readPrimitiveJsonValue(maxBytes, sizeMessage) {
    const parts = [];
    let sourceBytes = 0;

    while (await this.loadNextChunk()) {
      const start = this.chunkIndex;
      let index = start;
      while (index < this.chunk.length && !isJsonValueDelimiter(this.chunk[index])) {
        index += 1;
      }
      this.chunkIndex = index;
      sourceBytes = appendBoundedJsonPart(
        parts,
        this.chunk.slice(start, index),
        sourceBytes,
        maxBytes,
        sizeMessage,
      );
      if (index < this.chunk.length) {
        break;
      }
    }

    if (parts.length === 0) {
      throw new SyntaxError("Missing JSON value in palette backup.");
    }
    return parts.join("");
  }

  async readStructuredJsonValue(firstCharacter, maxBytes, sizeMessage) {
    const parts = [];
    const closingCharacters = [];
    const isRootString = firstCharacter === '"';
    let sourceBytes = 0;
    let inString = false;
    let escaped = false;
    let started = false;

    while (await this.loadNextChunk()) {
      const start = this.chunkIndex;
      let isComplete = false;

      while (this.chunkIndex < this.chunk.length) {
        const character = this.chunk[this.chunkIndex];
        this.chunkIndex += 1;

        if (!started) {
          started = true;
          if (character === '"') {
            inString = true;
          } else {
            closingCharacters.push(character === "{" ? "}" : "]");
          }
          continue;
        }

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === '"') {
            inString = false;
            if (isRootString) {
              isComplete = true;
              break;
            }
          }
          continue;
        }

        if (character === '"') {
          inString = true;
        } else if (character === "{" || character === "[") {
          closingCharacters.push(character === "{" ? "}" : "]");
        } else if (character === "}" || character === "]") {
          if (closingCharacters.pop() !== character) {
            throw new SyntaxError("Invalid JSON nesting in palette backup.");
          }
          if (closingCharacters.length === 0) {
            isComplete = true;
            break;
          }
        }
      }

      sourceBytes = appendBoundedJsonPart(
        parts,
        this.chunk.slice(start, this.chunkIndex),
        sourceBytes,
        maxBytes,
        sizeMessage,
      );
      if (isComplete) {
        return parts.join("");
      }
    }

    throw new SyntaxError("Truncated JSON value in palette backup.");
  }

  async readJsonValue(maxBytes, sizeMessage) {
    await this.skipWhitespace();
    const firstCharacter = await this.peekCharacter();
    if (firstCharacter === '"' || firstCharacter === "{" || firstCharacter === "[") {
      return this.readStructuredJsonValue(firstCharacter, maxBytes, sizeMessage);
    }
    return this.readPrimitiveJsonValue(maxBytes, sizeMessage);
  }

  async cancel() {
    // Fixed-size Blob slices have no persistent reader to cancel.
  }
}

function getPositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createImportProgress(reader, completed, totalBytes) {
  return {
    completed,
    loadedBytes: Math.min(reader.loadedBytes, totalBytes),
    phase: "parsing",
    totalBytes,
  };
}

async function parseStreamingPaletteArray(
  reader,
  {
    batchSize,
    collect,
    maxEntryJsonBytes,
    maxPaletteCount,
    maxPhotoBytes,
    maxPhotoPixels,
    maxTotalPhotoBytes,
    onBatch,
    onProgress,
    totalBytes,
  },
) {
  const collectedPalettes = [];
  let pendingBatch = [];
  let completed = 0;
  let totalPhotoBytes = 0;

  async function flushBatch() {
    if (pendingBatch.length === 0) {
      return;
    }
    const batch = pendingBatch;
    pendingBatch = [];
    await onBatch?.(batch, createImportProgress(reader, completed, totalBytes));
  }

  await reader.skipWhitespace();
  await reader.expectCharacter("[");
  await reader.skipWhitespace();
  if ((await reader.peekCharacter()) === "]") {
    await reader.consumeCharacter();
    return collectedPalettes;
  }

  while (true) {
    if (completed >= maxPaletteCount) {
      throw new Error("Palette backup contains too many palettes.");
    }

    const source = await reader.readJsonValue(
      maxEntryJsonBytes,
      "A palette entry in the backup exceeds the safe import size limit.",
    );
    const entry = JSON.parse(source);
    const normalizedPalette = normalizeImportedPalette(entry, {
      maxPhotoBytes,
      maxPhotoPixels,
    });
    totalPhotoBytes += normalizedPalette.photoBlob?.size ?? 0;
    if (totalPhotoBytes > maxTotalPhotoBytes) {
      throw new PaletteBackupSizeLimitError(
        "Photos in the palette backup exceed the cumulative import size limit.",
      );
    }
    completed += 1;
    if (collect) {
      collectedPalettes.push(normalizedPalette);
    }
    pendingBatch.push(normalizedPalette);

    const progress = createImportProgress(reader, completed, totalBytes);
    onProgress?.(progress);
    if (pendingBatch.length >= batchSize) {
      await flushBatch();
    }

    await reader.skipWhitespace();
    const delimiter = await reader.consumeCharacter();
    if (delimiter === "]") {
      await flushBatch();
      return collectedPalettes;
    }
    if (delimiter !== ",") {
      throw new SyntaxError("Invalid palette array syntax in backup.");
    }
    await reader.skipWhitespace();
    if ((await reader.peekCharacter()) === "]") {
      throw new SyntaxError("Invalid trailing comma in palette backup.");
    }
  }
}

/**
 * Incrementally parses a schema-v2 Blob without ever materializing the complete
 * JSON source string. At most one bounded JSON palette entry plus one normalized
 * batch is retained by the parser when `collect` is false.
 *
 * @param {Blob} blob
 * @param {PaletteBlobDeserializationOptions} [options]
 * @returns {Promise<object[]>}
 */
export async function deserializePalettesFromImportBlob(
  blob,
  {
    batchSize = IMPORT_BATCH_SIZE,
    collect = true,
    maxEntryJsonBytes = PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES,
    maxJsonBytes = PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
    maxPaletteCount = PALETTE_IMPORT_MAX_COUNT,
    maxPhotoBytes = PALETTE_IMPORT_MAX_PHOTO_BYTES,
    maxPhotoPixels = PALETTE_IMPORT_MAX_PHOTO_PIXELS,
    maxTotalPhotoBytes = PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES,
    onBatch,
    onProgress,
  } = {},
) {
  if (!(blob instanceof Blob)) {
    throw new Error("Palette backup must be a JSON Blob.");
  }
  if (!Number.isSafeInteger(blob.size) || blob.size > maxJsonBytes) {
    throw new PaletteBackupSizeLimitError("Palette backup exceeds the import size limit.");
  }

  const reader = new BlobJsonTextReader(blob);
  const seenRootKeys = new Set();
  let palettes = null;
  let version;

  try {
    await reader.skipWhitespace();
    await reader.expectCharacter("{");
    await reader.skipWhitespace();

    while ((await reader.peekCharacter()) !== "}") {
      const key = await reader.readJsonString();
      if (seenRootKeys.has(key)) {
        throw new SyntaxError("Duplicate root field in palette backup.");
      }
      seenRootKeys.add(key);
      await reader.skipWhitespace();
      await reader.expectCharacter(":");

      if (key === "version") {
        version = JSON.parse(
          await reader.readJsonValue(
            IMPORT_ROOT_VALUE_MAX_JSON_BYTES,
            "Palette backup metadata is too large.",
          ),
        );
        if (version !== PALETTE_EXPORT_VERSION) {
          throw new Error("Unsupported palette backup version.");
        }
      } else if (key === "palettes") {
        if (version !== PALETTE_EXPORT_VERSION) {
          throw new Error("Palette backup version must precede its palette array.");
        }
        palettes = await parseStreamingPaletteArray(reader, {
          batchSize: getPositiveInteger(batchSize, IMPORT_BATCH_SIZE),
          collect: collect !== false,
          maxEntryJsonBytes: getPositiveInteger(
            maxEntryJsonBytes,
            PALETTE_IMPORT_MAX_ENTRY_JSON_BYTES,
          ),
          maxPaletteCount,
          maxPhotoBytes,
          maxPhotoPixels,
          maxTotalPhotoBytes,
          onBatch,
          onProgress,
          totalBytes: blob.size,
        });
      } else {
        JSON.parse(
          await reader.readJsonValue(
            IMPORT_ROOT_VALUE_MAX_JSON_BYTES,
            "Palette backup metadata is too large.",
          ),
        );
      }

      await reader.skipWhitespace();
      const delimiter = await reader.consumeCharacter();
      if (delimiter === "}") {
        break;
      }
      if (delimiter !== ",") {
        throw new SyntaxError("Invalid root JSON syntax in palette backup.");
      }
      await reader.skipWhitespace();
      if ((await reader.peekCharacter()) === "}") {
        throw new SyntaxError("Invalid trailing comma in palette backup.");
      }
    }

    if ((await reader.peekCharacter()) === "}") {
      await reader.consumeCharacter();
    }
    if (version !== PALETTE_EXPORT_VERSION) {
      throw new Error("Unsupported palette backup version.");
    }
    if (!Array.isArray(palettes)) {
      throw new Error("Format de fichier invalide.");
    }

    await reader.skipWhitespace();
    if ((await reader.peekCharacter()) !== undefined) {
      throw new SyntaxError("Unexpected trailing data in palette backup.");
    }
    return palettes;
  } catch (error) {
    await reader.cancel();
    throw error;
  }
}

export async function deserializePalettesFromImport(
  jsonString,
  {
    maxJsonBytes = PALETTE_IMPORT_MAX_JSON_BYTES,
    maxPaletteCount = PALETTE_IMPORT_MAX_COUNT,
    maxPhotoBytes = PALETTE_IMPORT_MAX_PHOTO_BYTES,
    maxPhotoPixels = PALETTE_IMPORT_MAX_PHOTO_PIXELS,
    maxTotalPhotoBytes = PALETTE_IMPORT_MAX_TOTAL_PHOTO_BYTES,
  } = {},
) {
  assertPaletteImportStringSize(jsonString, maxJsonBytes);

  const data = JSON.parse(jsonString);
  if (!data || !Array.isArray(data.palettes)) {
    throw new Error("Format de fichier invalide.");
  }

  if (data.version !== PALETTE_EXPORT_VERSION) {
    throw new Error("Unsupported palette backup version.");
  }

  if (data.palettes.length > maxPaletteCount) {
    throw new Error("Palette backup contains too many palettes.");
  }

  let totalPhotoBytes = 0;
  return data.palettes.map((entry) => {
    const palette = normalizeImportedPalette(entry, { maxPhotoBytes, maxPhotoPixels });
    totalPhotoBytes += palette.photoBlob?.size ?? 0;
    if (totalPhotoBytes > maxTotalPhotoBytes) {
      throw new PaletteBackupSizeLimitError(
        "Photos in the palette backup exceed the cumulative import size limit.",
      );
    }
    return palette;
  });
}
