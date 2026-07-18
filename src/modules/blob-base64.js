const FALLBACK_BINARY_CHUNK_BYTES = 32 * 1024;

async function blobToBase64Fallback(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const binaryChunks = [];
  for (let offset = 0; offset < bytes.length; offset += FALLBACK_BINARY_CHUNK_BYTES) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + FALLBACK_BINARY_CHUNK_BYTES)),
    );
  }
  return btoa(binaryChunks.join(""));
}

/**
 * Uses the browser's asynchronous native data-URL encoder so publication does
 * not build a binary string one JavaScript character at a time on the main
 * thread. The chunked fallback supports non-browser test/runtime environments.
 * @param {Blob} blob
 * @param {{FileReaderCtor?: typeof FileReader}} [options]
 */
export async function blobToBase64(blob, { FileReaderCtor = globalThis.FileReader } = {}) {
  if (typeof FileReaderCtor !== "function") {
    return blobToBase64Fallback(blob);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReaderCtor();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read photo data."));
    reader.onabort = () => reject(new DOMException("Photo encoding was aborted.", "AbortError"));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("Photo encoder returned an invalid result."));
        return;
      }

      const separatorIndex = dataUrl.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("Photo encoder returned an invalid data URL."));
        return;
      }

      resolve(dataUrl.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}
