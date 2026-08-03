import { describe, expect, test } from "bun:test";
import { readRasterImageDimensions } from "../../palette-storage/image-header.js";
import {
  buildPaletteMetadataColors,
  embedPaletteMetadata,
  embedPaletteMetadataBytes,
} from "./palette-image-metadata.js";

const COLORS = [
  { r: 6, g: 9, b: 31 },
  { r: 3, g: 38, b: 98 },
  { r: 0, g: 72, b: 184 },
];
const HEX = ["#06091F", "#032662", "#0048B8"];

const textEncoder = new TextEncoder();

/**
 * Stands in for the consuming application: the app itself never reads a packet
 * back, so the test extracts it the way a third party would.
 * @param {Uint8Array | Blob} source
 */
async function extractPaletteFromImage(source) {
  const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
  const text = new TextDecoder().decode(bytes);
  const open = "<cc:palette>";
  const start = text.indexOf(open);
  const end = text.indexOf("</cc:palette>");
  if (start < 0 || end <= start) {
    return null;
  }

  return JSON.parse(
    text
      .slice(start + open.length, end)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

function bytesFrom(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Minimal but structurally valid JPEG: SOI, APP0/JFIF, SOF0 carrying the size, EOI. */
function createJpegFixture(width = 40, height = 30) {
  const app0 = bytesFrom(
    new Uint8Array([0xff, 0xe0, 0x00, 0x10]),
    textEncoder.encode("JFIF"),
    new Uint8Array([0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  );
  const sof0 = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  return bytesFrom(new Uint8Array([0xff, 0xd8]), app0, sof0, new Uint8Array([0xff, 0xd9]));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = bytesFrom(textEncoder.encode(type), data);
  const chunk = new Uint8Array(typeAndData.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndData));
  return chunk;
}

function createPngFixture(width = 40, height = 30) {
  const ihdrData = new Uint8Array(13);
  const view = new DataView(ihdrData.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  return bytesFrom(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    pngChunk("IEND", new Uint8Array(0)),
  );
}

/** Simple lossy WebP: RIFF/WEBP with a single VP8 chunk carrying the frame header. */
function createWebpFixture(width = 40, height = 30) {
  const vp8Data = new Uint8Array(14);
  vp8Data.set([0x9d, 0x01, 0x2a], 3);
  vp8Data[6] = width & 0xff;
  vp8Data[7] = (width >> 8) & 0x3f;
  vp8Data[8] = height & 0xff;
  vp8Data[9] = (height >> 8) & 0x3f;

  const chunk = new Uint8Array(8 + vp8Data.length);
  chunk.set(textEncoder.encode("VP8 "), 0);
  new DataView(chunk.buffer).setUint32(4, vp8Data.length, true);
  chunk.set(vp8Data, 8);

  const payload = bytesFrom(textEncoder.encode("WEBP"), chunk);
  const out = new Uint8Array(8 + payload.length);
  out.set(textEncoder.encode("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

describe("palette metadata colors", () => {
  test("emits uppercase hex in palette order", () => {
    expect(buildPaletteMetadataColors(COLORS)).toEqual(HEX);
  });

  test("drops malformed entries and tolerates a missing palette", () => {
    expect(buildPaletteMetadataColors([])).toEqual([]);
    expect(buildPaletteMetadataColors(null)).toEqual([]);
    expect(buildPaletteMetadataColors([{ r: Number.NaN, g: 0, b: 0 }])).toEqual([]);
    expect(buildPaletteMetadataColors([{ r: 0, g: 0, b: 0 }, null])).toEqual(["#000000"]);
  });

  test("clamps out-of-range channels", () => {
    expect(buildPaletteMetadataColors([{ r: -20, g: 300, b: 12.6 }])).toEqual(["#00FF0D"]);
  });
});

describe.each([
  ["image/jpeg", createJpegFixture],
  ["image/png", createPngFixture],
  ["image/webp", createWebpFixture],
])("%s container", (mimeType, createFixture) => {
  test("a consumer reads the palette back without the container breaking", async () => {
    const embedded = embedPaletteMetadataBytes(createFixture(), mimeType, HEX);

    expect(embedded).toBeInstanceOf(Uint8Array);
    expect(await extractPaletteFromImage(embedded)).toEqual(HEX);
    expect(readRasterImageDimensions(embedded, mimeType)).toEqual({ width: 40, height: 30 });
  });

  test("an untouched file carries no packet", async () => {
    expect(await extractPaletteFromImage(createFixture())).toBeNull();
  });

  test("embeds through the blob helper", async () => {
    const blob = new Blob([createFixture()], { type: mimeType });
    const embedded = await embedPaletteMetadata(blob, COLORS);

    expect(embedded).not.toBe(blob);
    expect(embedded.type).toBe(mimeType);
    expect(await extractPaletteFromImage(embedded)).toEqual(HEX);
  });
});

describe("palette metadata export guarantees", () => {
  test("returns the blob untouched when the container cannot hold a packet", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/gif" });

    expect(await embedPaletteMetadata(blob, COLORS)).toBe(blob);
  });

  test("returns the blob untouched when the palette has no usable colors", async () => {
    const blob = new Blob([createJpegFixture()], { type: "image/jpeg" });

    expect(await embedPaletteMetadata(blob, [])).toBe(blob);
    expect(await embedPaletteMetadata(blob, null)).toBe(blob);
  });

  test("ignores non-blob input", async () => {
    expect(await embedPaletteMetadata(null, COLORS)).toBeNull();
  });

  test("refuses a packet larger than a JPEG segment", () => {
    const huge = Array.from({ length: 8000 }, () => "#123456");

    expect(embedPaletteMetadataBytes(createJpegFixture(), "image/jpeg", huge)).toBeNull();
  });
});
