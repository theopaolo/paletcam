import { describe, expect, test } from "bun:test";

import { loadImageElementBlobSource, loadImageElementSource } from "./image-element-loader.js";

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

  test("loads blob sources through data urls instead of blob urls", async () => {
    const assignedSources = [];
    const image = new MockImageElement((target, value) => {
      assignedSources.push(value);

      setTimeout(() => {
        target.complete = true;
        target.naturalWidth = 120;
        target.dispatchEvent(new Event("load"));
      }, 0);
    });

    await loadImageElementBlobSource(image, new Blob(["preview"], { type: "image/webp" }), {
      timeoutMs: 50,
    });

    expect(assignedSources[0].startsWith("data:image/webp;base64,")).toBe(true);
    expect(assignedSources[0].startsWith("blob:")).toBe(false);
  });
});
