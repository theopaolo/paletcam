import { describe, expect, test } from "bun:test";

import {
  hasCompleteRasterImageContainer,
  hasSafeRasterImageDimensions,
  readRasterImageDimensions,
} from "./image-header.js";

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("reads PNG and JPEG dimensions without decoding pixels", () => {
  expect(readRasterImageDimensions(pngHeader(2048, 1536), "image/png")).toEqual({
    width: 2048,
    height: 1536,
  });
  expect(
    readRasterImageDimensions(
      new Uint8Array([
        0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0x04, 0x00, 0x08, 0x00, 3, 1, 0x11, 0, 2, 0x11, 0, 3,
        0x11, 0, 0xff, 0xd9,
      ]),
      "image/jpeg",
    ),
  ).toEqual({ width: 2048, height: 1024 });
});

describe("WebP headers", () => {
  test("reads extended, lossy, and lossless dimensions", () => {
    const extended = new Uint8Array(30);
    extended.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")]);
    extended.set([0xff, 0x07, 0, 0xff, 0x03, 0], 24);
    expect(readRasterImageDimensions(extended, "image/webp")).toEqual({
      width: 2048,
      height: 1024,
    });

    const lossy = new Uint8Array(30);
    lossy.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
    lossy.set([0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x08, 0x00, 0x04], 20);
    expect(readRasterImageDimensions(lossy, "image/webp")).toEqual({
      width: 2048,
      height: 1024,
    });

    const lossless = new Uint8Array(25);
    lossless.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8L")]);
    lossless.set([0x2f, 0xff, 0x47, 0xff, 0], 20);
    expect(readRasterImageDimensions(lossless, "image/webp")).toEqual({
      width: 2048,
      height: 1022,
    });
  });
});

test("rejects malformed headers, zero dimensions, and decompression bombs", () => {
  expect(readRasterImageDimensions(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
  expect(hasSafeRasterImageDimensions(pngHeader(0, 20), "image/png", 1_000)).toBe(false);
  expect(hasSafeRasterImageDimensions(pngHeader(20_000, 20_000), "image/png", 12_000_000)).toBe(
    false,
  );
  expect(hasSafeRasterImageDimensions(pngHeader(2048, 1536), "image/png", 12_000_000)).toBe(true);
});

test("rejects truncated PNG, JPEG, and WebP containers after reading their headers", () => {
  const png = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const jpeg = new Uint8Array(Buffer.from("/9j/wAARCAABAAEDAREAAhEAAxEA/9k=", "base64"));
  const webp = new Uint8Array(
    Buffer.from(
      "UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
      "base64",
    ),
  );

  for (const [bytes, mimeType] of [
    [png, "image/png"],
    [jpeg, "image/jpeg"],
    [webp, "image/webp"],
  ]) {
    expect(hasCompleteRasterImageContainer(bytes, mimeType)).toBe(true);
    expect(hasCompleteRasterImageContainer(bytes.slice(0, -2), mimeType)).toBe(false);
  }
});
