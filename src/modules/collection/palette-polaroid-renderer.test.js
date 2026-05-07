import { afterEach, describe, expect, test } from "bun:test";
import { resetAppSettingsForTests, updateAppSettings } from "../../app-settings.js";

import {
  getPalettePreviewImageMimeType,
  getPalettePhotoAspectRatioValue,
  renderPalettePolaroidBlob,
  resetPalettePreviewImageSupportForTests,
  resolveNormalizedCropRectToPixelRect,
} from "./palette-polaroid-renderer.js";

const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalGetComputedStyleDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "getComputedStyle",
);
const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
const POLAROID_TOKEN_VALUES = Object.freeze({
  "--color-polaroid-footer-dark": "#121416",
  "--color-polaroid-footer-light": "#f5f5f5",
  "--color-polaroid-footer-text-dark": "rgba(250, 250, 250, 0.96)",
  "--color-polaroid-footer-text-light": "rgba(44, 44, 44, 0.88)",
  "--color-polaroid-shell-dark": "#090b0d",
  "--color-polaroid-shell-light": "#fefefe",
});

function setGlobalProperty(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installPolaroidTokenMocks(tokenValues = POLAROID_TOKEN_VALUES) {
  setGlobalProperty("getComputedStyle", () => ({
    getPropertyValue(name) {
      return tokenValues[name] ?? "";
    },
  }));
}

afterEach(() => {
  resetAppSettingsForTests();
  resetPalettePreviewImageSupportForTests();

  if (originalImageDescriptor) {
    Object.defineProperty(globalThis, "Image", originalImageDescriptor);
  }

  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
  }

  if (originalGetComputedStyleDescriptor) {
    Object.defineProperty(globalThis, "getComputedStyle", originalGetComputedStyleDescriptor);
  } else {
    delete globalThis.getComputedStyle;
  }

  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("getPalettePreviewImageMimeType", () => {
  test("uses jpeg when the browser cannot encode webp data urls", () => {
    resetPalettePreviewImageSupportForTests();
    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName !== "canvas") {
          throw new Error(`Unexpected element creation: ${tagName}`);
        }

        return {
          height: 0,
          width: 0,
          toDataURL(type) {
            return type === "image/webp" ? "data:image/png;base64,AA==" : "";
          },
        };
      },
    });

    expect(getPalettePreviewImageMimeType()).toBe("image/jpeg");
  });
});

describe("resolveNormalizedCropRectToPixelRect", () => {
  test("converts normalized crop values to pixel coordinates", () => {
    expect(
      resolveNormalizedCropRectToPixelRect({
        cropRect: { x: 0.125, y: 0.25, width: 0.5, height: 0.5 },
        imageWidth: 800,
        imageHeight: 600,
      }),
    ).toEqual({
      x: 100,
      y: 150,
      width: 400,
      height: 300,
    });
  });

  test("clamps out-of-range values and preserves a valid rect", () => {
    expect(
      resolveNormalizedCropRectToPixelRect({
        cropRect: { x: -0.2, y: 0.7, width: 2, height: 0.8 },
        imageWidth: 1000,
        imageHeight: 500,
      }),
    ).toEqual({
      x: 0,
      y: 350,
      width: 1000,
      height: 150,
    });
  });
});

describe("getPalettePhotoAspectRatioValue", () => {
  test("returns supported ratios and null for legacy/missing metadata", () => {
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "1:1" })).toBe(1);
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "4:3" })).toBeCloseTo(4 / 3);
    expect(getPalettePhotoAspectRatioValue({ captureAspectRatio: "weird" })).toBeNull();
    expect(getPalettePhotoAspectRatioValue({})).toBeNull();
    expect(
      getPalettePhotoAspectRatioValue({
        captureCropRect: { x: 0, y: 0, width: 1, height: 0.75 },
      }),
    ).toBeNull();
  });
});

describe("renderPalettePolaroidBlob", () => {
  test("keeps the source blob URL alive until after the canvas draw completes", async () => {
    const revokedUrls = [];
    const drawStates = [];
    const loadedFonts = [];
    const fillTextCalls = [];
    const clipCalls = [];
    const photoUrl = "blob:palette-preview-source";
    const fakeContext = {
      font: "",
      textAlign: "left",
      beginPath() {},
      clearRect() {},
      clip() {
        clipCalls.push(true);
      },
      drawImage() {
        drawStates.push(revokedUrls.length);
      },
      fillRect() {},
      fillText(text, x, y) {
        fillTextCalls.push({ text, x, y });
      },
      closePath() {},
      lineTo() {},
      measureText() {
        return { width: 120 };
      },
      moveTo() {},
      quadraticCurveTo() {},
      rect() {},
      restore() {},
      save() {},
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeContext;
      },
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };

    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName === "canvas") {
          return fakeCanvas;
        }

        throw new Error(`Unexpected element creation: ${tagName}`);
      },
      documentElement: { nodeName: "HTML" },
      fonts: {
        load(descriptor) {
          loadedFonts.push(descriptor);
          return Promise.resolve();
        },
      },
      querySelector() {
        return null;
      },
    });
    installPolaroidTokenMocks();
    globalThis.URL.createObjectURL = () => photoUrl;
    globalThis.URL.revokeObjectURL = (url) => {
      revokedUrls.push(url);
    };
    setGlobalProperty(
      "Image",
      class MockImage {
        constructor() {
          this.width = 1600;
          this.height = 1200;
          this.onload = null;
          this.onerror = null;
        }

        set src(value) {
          this._src = value;

          if (!value) {
            return;
          }

          queueMicrotask(() => {
            this.onload?.();
          });
        }

        get src() {
          return this._src;
        }
      },
    );

    const result = await renderPalettePolaroidBlob({
      colors: [{ r: 255, g: 106, b: 0 }],
      photoBlob: new Blob(["source"], { type: "image/webp" }),
    });

    expect(result).toBeInstanceOf(Blob);
    expect(drawStates).toEqual([0]);
    expect(loadedFonts).toEqual(['400 16px "SNPro"']);
    expect(fakeContext.font).toContain('"SNPro"');
    expect(fakeContext.textAlign).toBe("right");
    expect(clipCalls).toHaveLength(1);
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]?.x).toBe(fakeCanvas.width - 88);
    expect(revokedUrls).toEqual([photoUrl]);
  });

  test("uses design tokens for frame and footer colors when root styles are available", async () => {
    const fillRectCalls = [];
    const fillTextCalls = [];
    const photoUrl = "blob:palette-preview-source";
    const fakeContext = {
      fillStyle: "",
      font: "",
      textAlign: "left",
      beginPath() {},
      clearRect() {},
      clip() {},
      closePath() {},
      drawImage() {},
      fillRect(x, y, width, height) {
        fillRectCalls.push({ fillStyle: this.fillStyle, height, width, x, y });
      },
      fillText(text, x, y) {
        fillTextCalls.push({ fillStyle: this.fillStyle, text, x, y });
      },
      lineTo() {},
      measureText() {
        return { width: 120 };
      },
      moveTo() {},
      quadraticCurveTo() {},
      rect() {},
      restore() {},
      save() {},
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeContext;
      },
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };

    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName === "canvas") {
          return fakeCanvas;
        }

        throw new Error(`Unexpected element creation: ${tagName}`);
      },
      documentElement: { nodeName: "HTML" },
      fonts: {
        load() {
          return Promise.resolve();
        },
      },
      querySelector() {
        return null;
      },
    });
    installPolaroidTokenMocks();
    globalThis.URL.createObjectURL = () => photoUrl;
    globalThis.URL.revokeObjectURL = () => {};
    setGlobalProperty(
      "Image",
      class MockImage {
        constructor() {
          this.width = 1600;
          this.height = 1200;
          this.onload = null;
        }

        set src(value) {
          this._src = value;

          if (!value) {
            return;
          }

          queueMicrotask(() => {
            this.onload?.();
          });
        }
      },
    );

    await renderPalettePolaroidBlob(
      {
        colors: [{ r: 255, g: 106, b: 0 }],
        photoBlob: new Blob(["source"], { type: "image/webp" }),
      },
      {
        darkFrameShell: true,
      },
    );

    expect(fillRectCalls[0]?.fillStyle).toBe(POLAROID_TOKEN_VALUES["--color-polaroid-shell-dark"]);
    expect(fillRectCalls[1]?.fillStyle).toBe(POLAROID_TOKEN_VALUES["--color-polaroid-footer-dark"]);
    expect(fillTextCalls[0]?.fillStyle).toBe(
      POLAROID_TOKEN_VALUES["--color-polaroid-footer-text-dark"],
    );
  });

  test("renders RAL details inside the swatch panel for RAL captures", async () => {
    const fillTextCalls = [];
    const arcCalls = [];
    const lineCalls = [];
    const photoUrl = "blob:palette-preview-source";
    const fakeContext = {
      fillStyle: "",
      font: "",
      lineWidth: 0,
      shadowBlur: 0,
      shadowColor: "",
      strokeStyle: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      arc(x, y, radius) {
        arcCalls.push({ radius, x, y });
      },
      beginPath() {},
      clearRect() {},
      clip() {},
      closePath() {},
      drawImage() {},
      fillRect() {},
      fillText(text, x, y) {
        fillTextCalls.push({ fillStyle: this.fillStyle, text, x, y });
      },
      lineTo() {},
      moveTo(x, y) {
        lineCalls.push({ type: "moveTo", x, y });
      },
      measureText(text) {
        return { width: String(text).length * 10 };
      },
      quadraticCurveTo() {},
      rect() {},
      restore() {},
      save() {},
      stroke() {},
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeContext;
      },
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };

    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName === "canvas") {
          return fakeCanvas;
        }

        throw new Error(`Unexpected element creation: ${tagName}`);
      },
      documentElement: { nodeName: "HTML" },
      fonts: {
        load() {
          return Promise.resolve();
        },
      },
      querySelector() {
        return null;
      },
    });
    installPolaroidTokenMocks();
    globalThis.URL.createObjectURL = () => photoUrl;
    globalThis.URL.revokeObjectURL = () => {};
    setGlobalProperty(
      "Image",
      class MockImage {
        constructor() {
          this.width = 1600;
          this.height = 1200;
          this.onload = null;
        }

        set src(value) {
          this._src = value;

          if (!value) {
            return;
          }

          queueMicrotask(() => {
            this.onload?.();
          });
        }
      },
    );

    await renderPalettePolaroidBlob({
      captureMode: "ral",
      colors: [{ r: 124, g: 112, b: 138 }],
      ralMatch: {
        code: "RAL 4012",
        name: "Pearl blackberry",
        r: 124,
        g: 112,
        b: 138,
        deltaE: 10,
      },
      photoBlob: new Blob(["source"], { type: "image/webp" }),
    });

    const renderedTexts = fillTextCalls.map((call) => call.text);

    expect(renderedTexts).toContain("RAL 4012");
    expect(renderedTexts).toContain("PEARL BLACKBERRY");
    expect(renderedTexts.some((text) => String(text).includes("0%"))).toBe(true);
    expect(renderedTexts).toContain("colorcatchers.co");
    expect(arcCalls).toHaveLength(1);
    const reticleMoveCalls = lineCalls.slice(-2);
    expect(reticleMoveCalls).toHaveLength(2);
    expect(reticleMoveCalls[0]?.y).toBe(arcCalls[0]?.y);
    expect(reticleMoveCalls[1]?.x).toBe(arcCalls[0]?.x);
  });

  test("renders color names inside the palette strip when the watermark toggle is enabled", async () => {
    updateAppSettings({ polaroidShowColorNames: true });

    const fillTextCalls = [];
    const photoUrl = "blob:palette-preview-source";
    const fakeContext = {
      fillStyle: "",
      font: "",
      shadowBlur: 0,
      shadowColor: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      beginPath() {},
      clearRect() {},
      clip() {},
      closePath() {},
      drawImage() {},
      fillRect() {},
      fillText(text, x, y) {
        fillTextCalls.push({ fillStyle: this.fillStyle, text, x, y });
      },
      lineTo() {},
      measureText(text) {
        return { width: String(text).length * 8 };
      },
      moveTo() {},
      quadraticCurveTo() {},
      rect() {},
      restore() {},
      rotate() {},
      save() {},
      scale() {},
      translate() {},
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext() {
        return fakeContext;
      },
      toBlob(callback, type) {
        callback(new Blob(["preview"], { type }));
      },
    };

    setGlobalProperty("document", {
      createElement(tagName) {
        if (tagName === "canvas") {
          return fakeCanvas;
        }

        throw new Error(`Unexpected element creation: ${tagName}`);
      },
      documentElement: { nodeName: "HTML" },
      fonts: {
        load() {
          return Promise.resolve();
        },
      },
      querySelector() {
        return null;
      },
    });
    installPolaroidTokenMocks();
    globalThis.URL.createObjectURL = () => photoUrl;
    globalThis.URL.revokeObjectURL = () => {};
    setGlobalProperty(
      "Image",
      class MockImage {
        constructor() {
          this.width = 1600;
          this.height = 1200;
          this.onload = null;
        }

        set src(value) {
          this._src = value;

          if (!value) {
            return;
          }

          queueMicrotask(() => {
            this.onload?.();
          });
        }
      },
    );

    await renderPalettePolaroidBlob({
      colors: [
        { r: 151, g: 157, b: 26 },
        { r: 255, g: 255, b: 255 },
      ],
      photoBlob: new Blob(["source"], { type: "image/webp" }),
    });

    const renderedTexts = fillTextCalls.map((call) => call.text);

    expect(renderedTexts).toContain("PEA SOUP");
    expect(renderedTexts).toContain("WHITE");
    expect(renderedTexts).toContain("colorcatchers.co");
  });
});
