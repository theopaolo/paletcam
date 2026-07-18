const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** @typedef {Error & {kind: string, status: number, payload: any, requestId: string}} HttpRequestError */

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} message
 * @param {{kind: string, status?: number, payload?: any, requestId?: string, cause?: unknown}} options
 * @returns {HttpRequestError}
 */
function createHttpRequestError(
  message,
  { kind, status = 0, payload = null, requestId = "", cause = undefined },
) {
  const error = /** @type {HttpRequestError} */ (
    new Error(message, cause === undefined ? undefined : { cause })
  );
  error.name = "HttpRequestError";
  error.kind = kind;
  error.status = status;
  error.payload = payload;
  error.requestId = requestId;
  return error;
}

function createRequestSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId = null;

  const abortFromExternalSignal = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else {
    externalSignal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort(new DOMException("Request timed out.", "TimeoutError"));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup() {
      if (timeoutId !== null) clearTimeout(timeoutId);
      externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
    },
  };
}

async function readBoundedResponseText(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpRequestError("Response body exceeds the allowed size.", {
      kind: "response_too_large",
      status: response.status,
    });
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw createHttpRequestError("Response body exceeds the allowed size.", {
        kind: "response_too_large",
        status: response.status,
      });
    }
    return text;
  }

  const decoder = new TextDecoder();
  const parts = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw createHttpRequestError("Response body exceeds the allowed size.", {
        kind: "response_too_large",
        status: response.status,
      });
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Executes one bounded JSON request. It intentionally performs no automatic
 * retries: callers must not replay mutations without server-side idempotency.
 *
 * @param {string | URL} url
 * @param {RequestInit & {timeoutMs?: number, maxResponseBytes?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{payload: any, response: Response, requestId: string}>}
 */
export async function requestJson(
  url,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    fetchImpl = globalThis.fetch,
    signal: externalSignal,
    ...requestInit
  } = {},
) {
  const requestId = createRequestId();
  const headers = new Headers(requestInit.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Request-ID", requestId);
  const requestSignal = createRequestSignal(externalSignal, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...requestInit,
      headers,
      signal: requestSignal.signal,
    });
    let rawText;
    try {
      rawText = await readBoundedResponseText(response, maxResponseBytes);
    } catch (error) {
      if (error?.name === "HttpRequestError") {
        error.requestId = requestId;
        throw error;
      }
      throw createHttpRequestError("Unable to read the server response.", {
        kind: "invalid_response",
        status: response.status,
        requestId,
        cause: error,
      });
    }

    let payload = null;
    if (rawText.trim()) {
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        throw createHttpRequestError("Server returned invalid JSON.", {
          kind: "invalid_response",
          status: response.status,
          requestId,
          cause: error,
        });
      }
    }

    if (!response.ok) {
      const payloadMessage = typeof payload?.message === "string" ? payload.message : "";
      throw createHttpRequestError(payloadMessage || `Request failed (${response.status}).`, {
        kind: "http",
        status: response.status,
        payload,
        requestId,
      });
    }

    return { payload, response, requestId };
  } catch (error) {
    if (error?.name === "HttpRequestError") throw error;
    const kind = requestSignal.didTimeout()
      ? "timeout"
      : externalSignal?.aborted
        ? "aborted"
        : "network";
    const message =
      kind === "timeout"
        ? `Request timed out after ${timeoutMs}ms.`
        : kind === "aborted"
          ? "Request was cancelled."
          : "Network request failed.";
    throw createHttpRequestError(message, { kind, requestId, cause: error });
  } finally {
    requestSignal.cleanup();
  }
}
