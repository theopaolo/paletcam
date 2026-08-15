export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured byte limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads a request body into one Uint8Array while enforcing the byte limit as
 * chunks arrive, so an oversized upload is cancelled instead of buffered.
 * @param {Request} request @param {number} maxBytes
 */
export async function readBoundedRequestBytes(request, maxBytes) {
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** @param {Request} request @param {number} maxBytes */
export async function readBoundedRequestText(request, maxBytes) {
  const bytes = await readBoundedRequestBytes(request, maxBytes);
  return new TextDecoder().decode(bytes);
}
