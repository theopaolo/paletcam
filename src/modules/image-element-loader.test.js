import { describe, expect, test } from "bun:test";

import { blobToDataUrl, loadImageElementSource } from "./image-element-loader.js";

class MockImageElement extends EventTarget {
  constructor(onSrcAssigned) {
    super();
    this.complete = false;
    this.naturalWidth = 0;
    this._src = "";
    this._onSrcAssigned = onSrcAssigned;
  }

  set src(value) {
    this._src = value;
    this._onSrcAssigned?.(this, value);
  }

  get src() {
    return this._src;
  }
}

describe("blobToDataUrl", () => {
  test("converts a blob to a data URL string", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const result = await blobToDataUrl(blob);
    expect(typeof result).toBe("string");
    expect(result.startsWith("data:text/plain")).toBe(true);
  });
});

describe("loadImageElementSource", () => {
  test("waits for a later load event when complete is true before dimensions are ready", async () => {
    const image = new MockImageElement((target) => {
      target.complete = true;
      target.naturalWidth = 0;

      setTimeout(() => {
        target.naturalWidth = 120;
        target.dispatchEvent(new Event("load"));
      }, 0);
    });

    await loadImageElementSource(image, "blob:preview", { timeoutMs: 50 });

    expect(image.src).toBe("blob:preview");
    expect(image.naturalWidth).toBe(120);
  });

  test("rejects when the image errors", async () => {
    const image = new MockImageElement((target) => {
      setTimeout(() => {
        target.dispatchEvent(new Event("error"));
      }, 0);
    });

    const result = loadImageElementSource(image, "blob:broken", { timeoutMs: 50 })
      .then(() => null)
      .catch((error) => error);

    await expect(result).resolves.toBeInstanceOf(Error);
    await expect(result).resolves.toHaveProperty("message", "Unable to load preview image element");
  });
});
