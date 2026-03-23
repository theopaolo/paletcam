const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 8000;

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
