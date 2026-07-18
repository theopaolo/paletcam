import { afterEach, describe, expect, mock, test } from "bun:test";

const i18nModuleUrl = new URL("../../i18n.js", import.meta.url).href;
const colorNameModuleUrl = new URL("../color-name-api.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("../error-reporting.js", import.meta.url).href;
const imageLoaderModuleUrl = new URL("../image-element-loader.js", import.meta.url).href;
const panelManagerModuleUrl = new URL("../panels/panel-manager.js", import.meta.url).href;
const previewAssetsModuleUrl = new URL("./palette-preview-assets.js", import.meta.url).href;
const sessionBoundActionModuleUrl = new URL("./session-bound-action.js", import.meta.url).href;
const versoModuleUrl = new URL("./palette-verso.js", import.meta.url).href;
const viewerModuleUrl = new URL("./palette-viewer-overlay.js", import.meta.url).href;

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
const originalWindow = globalThis.window;

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
}

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {
      removeProperty() {},
      setProperty() {},
    };
    this.clientWidth = 100;
    this.scrollLeft = 0;
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.id = "";
    this._innerHTML = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  focus() {}

  removeAttribute() {}

  replaceChildren(...children) {
    this.children = [...children];
  }

  scrollTo({ left }) {
    this.scrollLeft = left;
  }

  setAttribute() {}

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

afterEach(() => {
  mock.restore();
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
  else globalThis.HTMLElement = originalHTMLElement;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe("palette viewer terminal lifecycle", () => {
  test("cancels singleton listeners, subscriptions, RAF and idle preload exactly once", async () => {
    const elements = new Map(
      [
        "catchDetailsTrack",
        "catchDetailsShareButton",
        "catchDetailsExportButton",
        "catchDetailsPublishButton",
        "catchDetailsCameraButton",
        "catchDetailsDeleteButton",
        "catchDetailsMeta",
        "catchDetailsMetaDate",
        "catchDetailsMetaPosition",
      ].map((id) => [id, new FakeElement()]),
    );
    const rafCallbacks = new Map();
    const idleCallbacks = new Map();
    let nextRafId = 0;
    let nextIdleId = 100;
    const cancelAnimationFrame = mock((id) => rafCallbacks.delete(id));
    const cancelIdleCallback = mock((id) => idleCallbacks.delete(id));
    const fakeWindow = new EventTarget();
    Object.assign(fakeWindow, {
      cancelAnimationFrame,
      cancelIdleCallback,
      clearTimeout: mock(() => {}),
      matchMedia: () => ({ matches: true }),
      requestAnimationFrame: mock((callback) => {
        const id = ++nextRafId;
        rafCallbacks.set(id, callback);
        return id;
      }),
      requestIdleCallback: mock((callback) => {
        const id = ++nextIdleId;
        idleCallbacks.set(id, callback);
        return id;
      }),
      setTimeout: mock(() => 200),
    });
    globalThis.window = fakeWindow;
    globalThis.HTMLElement = FakeElement;
    globalThis.document = {
      activeElement: null,
      createElement: () => new FakeElement(),
      getElementById: (id) => elements.get(id) ?? null,
    };

    const unsubscribeLocale = mock(() => {});
    const unsubscribeClosing = mock(() => {});
    const unsubscribeClosed = mock(() => {});
    let localeListener = () => {};
    let closingListener = () => {};
    let closedListener = () => {};
    const closeSharedPanel = mock(() => true);
    mock.module(i18nModuleUrl, () => ({
      getIntlLocale: () => "en",
      subscribeLocaleChange: mock((listener) => {
        localeListener = listener;
        return unsubscribeLocale;
      }),
      t: (key) => key,
    }));
    mock.module(colorNameModuleUrl, () => ({ getColorNames: mock(async () => []) }));
    mock.module(errorReportingModuleUrl, () => ({ reportAppError: mock(() => {}) }));
    mock.module(imageLoaderModuleUrl, () => ({
      loadImageElementBlobSource: mock(async () => ({ source: "data:image/webp;base64," })),
    }));
    mock.module(panelManagerModuleUrl, () => ({
      closeSharedPanel,
      openSharedPanel: mock(() => true),
      subscribeSharedPanelClosed: mock((_name, listener) => {
        closedListener = listener;
        return unsubscribeClosed;
      }),
      subscribeSharedPanelClosing: mock((_name, listener) => {
        closingListener = listener;
        return unsubscribeClosing;
      }),
    }));
    mock.module(previewAssetsModuleUrl, () => ({
      getPalettePreviewDebugInfo: mock(() => ({})),
    }));
    mock.module(versoModuleUrl, () => ({ createPaletteVersoElement: mock(() => null) }));
    mock.module(sessionBoundActionModuleUrl, () => ({
      runSessionBoundAction: mock(async () => {}),
    }));

    const viewer = await import(`${viewerModuleUrl}?test=${Math.random()}`);
    const getPreviewAsset = mock(() => new Promise(() => {}));
    const palettes = Array.from({ length: 2_000 }, (_, index) => ({
      id: index + 1,
      colors: [],
      timestamp: "2026-01-01T00:00:00.000Z",
    }));
    let currentPalettes = palettes;
    expect(
      viewer.openPaletteViewerOverlay({
        palettes,
        initialIndex: 1_000,
        getPalettes: () => currentPalettes,
        getPreviewAsset,
      }),
    ).toBe(true);
    expect(elements.get("catchDetailsTrack").children.length).toBeLessThanOrEqual(7);

    const alignmentCallback = rafCallbacks.get(1);
    expect(alignmentCallback).toBeFunction();
    alignmentCallback();
    expect(fakeWindow.requestIdleCallback).toHaveBeenCalledTimes(1);

    const track = elements.get("catchDetailsTrack");
    track.scrollLeft = 1_500 * track.clientWidth;
    track.dispatchEvent(new Event("scroll"));
    rafCallbacks.get(2)?.();
    expect(track.children.length).toBeLessThanOrEqual(7);
    expect(track.children.some((child) => child.dataset.index === "1500")).toBe(true);

    currentPalettes = currentPalettes.filter((palette) => palette.id !== 1_501);
    expect(viewer.refreshPaletteViewerOverlay({ fallbackIndex: 1_500 })).toBe(true);
    localeListener();
    expect(track.children.length).toBeLessThanOrEqual(7);

    closingListener();
    closedListener();
    expect(track.children).toHaveLength(0);
    expect(
      viewer.openPaletteViewerOverlay({
        palettes: currentPalettes,
        initialIndex: currentPalettes.length - 1,
        getPalettes: () => currentPalettes,
        getPreviewAsset,
      }),
    ).toBe(true);
    expect(track.children.length).toBeLessThanOrEqual(7);

    expect(viewer.destroyPaletteViewerOverlay()).toBe(true);
    expect(viewer.destroyPaletteViewerOverlay()).toBe(false);
    expect(cancelIdleCallback).toHaveBeenCalled();
    expect(unsubscribeLocale).toHaveBeenCalledTimes(1);
    expect(unsubscribeClosing).toHaveBeenCalledTimes(1);
    expect(unsubscribeClosed).toHaveBeenCalledTimes(1);
    expect(closeSharedPanel).toHaveBeenCalledWith("catch-details");
    expect(viewer.openPaletteViewerOverlay({ palettes: [], getPreviewAsset })).toBe(false);
  });
});
