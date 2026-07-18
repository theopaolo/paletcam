const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** @param {Uint8Array} bytes @param {number} offset @param {number} length */
function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** @param {Uint8Array} bytes @param {number} offset */
function readUint24LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/** @param {Uint8Array} bytes @param {number} offset */
function readUint32LittleEndian(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** @param {Uint8Array} bytes */
function readPngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 3) !== "PNG" ||
    ascii(bytes, 12, 4) !== "IHDR"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** @param {Uint8Array} bytes */
function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }
  return null;
}

/** @param {Uint8Array} bytes */
function readWebpDimensions(bytes) {
  if (bytes.length < 25 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return null;
  }

  const chunkType = ascii(bytes, 12, 4);
  if (chunkType === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (
    chunkType === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

/**
 * Reads dimensions without invoking an image decoder. Returning null means the
 * payload does not contain a valid supported header and must not be persisted.
 * @param {Uint8Array} bytes
 * @param {string} mimeType
 */
export function readRasterImageDimensions(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  if (mimeType === "image/webp") return readWebpDimensions(bytes);
  return null;
}

/** @param {Uint8Array} bytes @param {string} mimeType @param {number} maxPixels */
export function hasSafeRasterImageDimensions(bytes, mimeType, maxPixels) {
  const dimensions = readRasterImageDimensions(bytes, mimeType);
  return Boolean(
    dimensions &&
      Number.isInteger(dimensions.width) &&
      Number.isInteger(dimensions.height) &&
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      dimensions.width * dimensions.height <= maxPixels,
  );
}

/**
 * Rejects obviously truncated or length-inconsistent containers after header
 * validation. This is deliberately decoder-free so hostile inputs cannot force
 * full pixel allocation before the import transaction.
 * @param {Uint8Array} bytes
 * @param {string} mimeType
 */
export function hasCompleteRasterImageContainer(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array)) return false;

  if (mimeType === "image/png") {
    const offset = bytes.length - 12;
    return (
      offset >= 24 &&
      bytes[offset] === 0 &&
      bytes[offset + 1] === 0 &&
      bytes[offset + 2] === 0 &&
      bytes[offset + 3] === 0 &&
      ascii(bytes, offset + 4, 4) === "IEND"
    );
  }

  if (mimeType === "image/jpeg") {
    return bytes.length >= 4 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }

  if (mimeType === "image/webp") {
    if (
      bytes.length < 20 ||
      ascii(bytes, 0, 4) !== "RIFF" ||
      ascii(bytes, 8, 4) !== "WEBP" ||
      readUint32LittleEndian(bytes, 4) + 8 !== bytes.length
    ) {
      return false;
    }

    let offset = 12;
    let hasImagePayload = false;
    while (offset + 8 <= bytes.length) {
      const chunkType = ascii(bytes, offset, 4);
      const chunkSize = readUint32LittleEndian(bytes, offset + 4);
      offset += 8;
      if (offset + chunkSize > bytes.length) return false;
      if (chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "ANMF") {
        hasImagePayload = true;
      }
      offset += chunkSize + (chunkSize % 2);
    }
    return hasImagePayload && offset === bytes.length;
  }

  return false;
}
