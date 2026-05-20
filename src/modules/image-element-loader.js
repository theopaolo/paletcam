const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 8000;

async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) {
    throw new Error("Missing image blob");
  }

  if (typeof FileReader === "function") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read image blob"));
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export function loadImageElementSource(
  image,
  src,
  { timeoutMs = DEFAULT_IMAGE_LOAD_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      clearTimeout(timeoutId);
    };

    const finalize = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleLoad = () => {
      finalize(() => resolve());
    };

    const handleError = () => {
      finalize(() => reject(new Error("Unable to load preview image element")));
    };

    const timeoutId = setTimeout(() => {
      if (image.naturalWidth > 0) {
        finalize(() => resolve());
        return;
      }

      finalize(() => reject(new Error("Timed out loading preview image element")));
    }, timeoutMs);

    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      finalize(() => resolve());
    }
  });
}

export async function loadImageElementBlobSource(image, blob, options = {}) {
  const source = await blobToDataUrl(blob);
  await loadImageElementSource(image, source, options);
  return { source };
}
