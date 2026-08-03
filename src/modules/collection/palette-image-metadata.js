/**
 * Writes the palette into an exported image as an XMP packet, so a file leaving
 * the app carries machine-readable colors next to the picture. Color Catchers
 * never reads them back — the consumer is another application.
 *
 * The packet is a standard XMP wrapper — exiftool and Bridge can display it —
 * holding one JSON array of hex colors under a Color Catchers namespace. JSON
 * rather than RDF properties because the consumer should be able to
 * `JSON.parse` the extracted text instead of walking XML; the format version
 * lives in the namespace URI rather than in a field of its own.
 *
 * Canvas encoders drop every metadata block, so injection happens on the
 * encoded bytes, and each container is assumed to come straight from an
 * encoder — nothing here replaces a packet an earlier pass may have written.
 * See docs/palette-image-metadata.md for the wire format.
 */

import { readRasterImageDimensions } from "../../palette-storage/image-header.js";

const XMP_NAMESPACE_URI = "https://colorcatchers.co/ns/palette/1.0/";
const XMP_PACKET_ID = "W5M0MpCehiHzreSzNTczkc9d";
// The APP1 signature is NUL-terminated, and the terminator counts toward the
// segment length.
const JPEG_XMP_SIGNATURE = `http://ns.adobe.com/xap/1.0/${String.fromCharCode(0)}`;
const PNG_XMP_KEYWORD = "XML:com.adobe.xmp";
const PALETTE_ELEMENT = "cc:palette";

// An APP1 segment carries a 16-bit length that counts itself.
const JPEG_MAX_SEGMENT_BYTES = 65533;
const WEBP_XMP_FLAG = 0x04;
const WEBP_ALPHA_FLAG = 0x10;

const textEncoder = new TextEncoder();

/** @param {Uint8Array} bytes @param {number} offset @param {number} length */
function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** @param {number} value */
function hexPair(value) {
  const clamped = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

/**
 * @param {Array<{ r: number, g: number, b: number }>} colors
 * @returns {string[]} palette order preserved, malformed entries dropped
 */
export function buildPaletteMetadataColors(colors) {
  if (!Array.isArray(colors)) {
    return [];
  }

  return colors
    .filter(
      (color) =>
        color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b),
    )
    .map((color) => `#${hexPair(color.r)}${hexPair(color.g)}${hexPair(color.b)}`);
}

/** @param {string} value */
function escapeXmlText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** @param {string[]} hexColors */
function serializeXmpPacket(hexColors) {
  const json = escapeXmlText(JSON.stringify(hexColors));
  return [
    `<?xpacket begin="﻿" id="${XMP_PACKET_ID}"?>`,
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:cc="${XMP_NAMESPACE_URI}">`,
    `<${PALETTE_ELEMENT}>${json}</${PALETTE_ELEMENT}>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}

// ── JPEG ──

/** @param {Uint8Array} bytes @param {Uint8Array} packet */
function embedJpegXmp(bytes, packet) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const signature = textEncoder.encode(JPEG_XMP_SIGNATURE);
  const segmentLength = 2 + signature.length + packet.length;
  if (segmentLength > JPEG_MAX_SEGMENT_BYTES) {
    return null;
  }

  const header = new Uint8Array([0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff]);
  return concatBytes([bytes.subarray(0, 2), header, signature, packet, bytes.subarray(2)]);
}

// ── PNG ──

let crcTable = null;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function buildPngChunk(type, data) {
  const typeAndData = concatBytes([textEncoder.encode(type), data]);
  const chunk = new Uint8Array(typeAndData.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndData));
  return chunk;
}

/** @param {Uint8Array} bytes @param {Uint8Array} packet */
function embedPngXmp(bytes, packet) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG") {
    return null;
  }

  const iendOffset = bytes.length - 12;
  if (iendOffset < 8 || ascii(bytes, iendOffset + 4, 4) !== "IEND") {
    return null;
  }

  // iTXt: keyword, NUL, compression flag, compression method, language tag,
  // NUL, translated keyword, NUL, then the uncompressed text.
  const data = concatBytes([
    textEncoder.encode(PNG_XMP_KEYWORD),
    new Uint8Array([0, 0, 0, 0, 0]),
    packet,
  ]);
  return concatBytes([
    bytes.subarray(0, iendOffset),
    buildPngChunk("iTXt", data),
    bytes.subarray(iendOffset),
  ]);
}

// ── WebP ──

/** @param {Uint8Array} bytes */
function readWebpChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (dataStart + size > bytes.length) {
      return null;
    }
    chunks.push({ type, data: bytes.subarray(dataStart, dataStart + size) });
    offset = dataStart + size + (size % 2);
  }
  return chunks;
}

/** @param {string} type @param {Uint8Array} data */
function buildRiffChunk(type, data) {
  const chunk = new Uint8Array(8 + data.length + (data.length % 2));
  chunk.set(textEncoder.encode(type), 0);
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

/**
 * A simple WebP has no room for metadata, so it is promoted to the extended
 * format: a VP8X header declaring the canvas and an XMP flag, then the original
 * image data, then the packet. An encoder that already emitted VP8X — which is
 * what an alpha channel produces — only needs the flag set.
 * @param {Uint8Array} bytes @param {Uint8Array} packet
 */
function embedWebpXmp(bytes, packet) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return null;
  }

  const chunks = readWebpChunks(bytes);
  if (!chunks || chunks.length === 0) {
    return null;
  }

  const body = chunks.filter((chunk) => chunk.type !== "XMP " && chunk.type !== "VP8X");
  const existingVp8x = chunks.find((chunk) => chunk.type === "VP8X");
  let vp8xData;

  if (existingVp8x && existingVp8x.data.length >= 10) {
    vp8xData = Uint8Array.from(existingVp8x.data);
    vp8xData[0] |= WEBP_XMP_FLAG;
  } else {
    const dimensions = readRasterImageDimensions(bytes, "image/webp");
    if (!dimensions) {
      return null;
    }

    const hasAlpha =
      chunks.some((chunk) => chunk.type === "ALPH") ||
      (bytes.length > 24 && ascii(bytes, 12, 4) === "VP8L" && ((bytes[24] >> 4) & 1) === 1);

    vp8xData = new Uint8Array(10);
    vp8xData[0] = WEBP_XMP_FLAG | (hasAlpha ? WEBP_ALPHA_FLAG : 0);
    const width = dimensions.width - 1;
    const height = dimensions.height - 1;
    vp8xData[4] = width & 0xff;
    vp8xData[5] = (width >> 8) & 0xff;
    vp8xData[6] = (width >> 16) & 0xff;
    vp8xData[7] = height & 0xff;
    vp8xData[8] = (height >> 8) & 0xff;
    vp8xData[9] = (height >> 16) & 0xff;
  }

  const payload = concatBytes([
    textEncoder.encode("WEBP"),
    buildRiffChunk("VP8X", vp8xData),
    ...body.map((chunk) => buildRiffChunk(chunk.type, chunk.data)),
    buildRiffChunk("XMP ", packet),
  ]);

  const out = new Uint8Array(8 + payload.length);
  out.set(textEncoder.encode("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

// ── Public API ──

/**
 * @param {Uint8Array} bytes
 * @param {string} mimeType
 * @param {string[]} hexColors
 * @returns {Uint8Array | null} null when the container is unsupported or malformed
 */
export function embedPaletteMetadataBytes(bytes, mimeType, hexColors) {
  if (!(bytes instanceof Uint8Array) || !Array.isArray(hexColors) || hexColors.length === 0) {
    return null;
  }

  const packet = textEncoder.encode(serializeXmpPacket(hexColors));
  if (mimeType === "image/jpeg") return embedJpegXmp(bytes, packet);
  if (mimeType === "image/png") return embedPngXmp(bytes, packet);
  if (mimeType === "image/webp") return embedWebpXmp(bytes, packet);
  return null;
}

/**
 * Returns the blob unchanged when the palette carries no colors or the
 * container cannot hold a packet: an export must never fail over metadata.
 * @param {Blob | null} blob
 * @param {Array<{ r: number, g: number, b: number }>} colors
 * @returns {Promise<Blob | null>}
 */
export async function embedPaletteMetadata(blob, colors) {
  if (!(blob instanceof Blob)) {
    return blob;
  }

  const hexColors = buildPaletteMetadataColors(colors);
  if (hexColors.length === 0) {
    return blob;
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = embedPaletteMetadataBytes(bytes, blob.type, hexColors);
    return embedded ? new Blob([embedded], { type: blob.type }) : blob;
  } catch (_error) {
    return blob;
  }
}
