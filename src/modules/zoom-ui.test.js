import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createZoomUiController } from "./zoom-ui.js";

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      if (token) {
        this.tokens.add(token);
      }
    }
    this.#sync();
  }

  contains(token) {
    return this.tokens.has(token);
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.tokens.delete(token);
    }
    this.#sync();
  }

  set(value) {
    this.tokens = new Set(String(value).split(/\s+/).filter(Boolean));
    this.#sync();
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
    } else if (force === false) {
      this.tokens.delete(token);
    } else if (this.tokens.has(token)) {
      this.tokens.delete(token);
    } else {
      this.tokens.add(token);
    }
    this.#sync();
    return this.tokens.has(token);
  }

  toString() {
    return [...this.tokens].join(" ");
  }

  #sync() {
    this.element._className = this.toString();
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.hidden = false;
    this.listeners = new Map();
    this.parentElement = null;
    this.rect = { height: 20, left: 0, top: 0, width: 220 };
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.tabIndex = -1;
    this.textContent = "";
    this.type = "";
    this._className = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.set(value);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  dispatch(type, eventInit = {}) {
    const event = {
      button: 0,
      clientX: 0,
      clientY: 0,
      currentTarget: this,
      deltaX: 0,
      deltaY: 0,
      key: "",
      pointerId: 1,
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...eventInit,
    };

    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }

    return event;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((candidate) => candidate !== handler),
    );
  }

  replaceChildren(...nodes) {
    this.children = [];
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setPointerCapture() {}
}

function findByClass(root, className) {
  if (root.classList?.contains(className)) {
    return root;
  }

  for (const child of root.children ?? []) {
    const match = findByClass(child, className);
    if (match) {
      return match;
    }
  }

  return null;
}

describe("createZoomUiController", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalVibrate = globalThis.navigator?.vibrate;

  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tagName) {
          return new FakeElement(tagName);
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        clearTimeout,
        setTimeout,
      },
    });

    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "vibrate", {
        configurable: true,
        value() {},
      });
    }
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });

    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "vibrate", {
        configurable: true,
        value: originalVibrate,
      });
    }
  });

  test("renders an always-visible scrubber and rolls back a failed drag", async () => {
    const previewFrame = new FakeElement("div");
    const overlayHost = new FakeElement("div");
    previewFrame.appendChild(overlayHost);

    let applyRequestCount = 0;
    /** @type {(result: boolean) => void} */
    let resolveApply = () => {};
    const cameraController = {
      applyZoom() {
        applyRequestCount += 1;
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      },
      getCurrentZoom() {
        return 1;
      },
      getZoomCapabilities() {
        return { min: 0.5, max: 2.4, step: 0.1 };
      },
    };

    const zoomUi = createZoomUiController({
      cameraController,
      overlayHost,
    });
    zoomUi.initialize();
    zoomUi.syncCapabilities();
    zoomUi.bindEvents();

    const dock = findByClass(overlayHost, "camera-zoom-dock");
    const readout = findByClass(overlayHost, "camera-zoom-readout");
    const scrubber = findByClass(overlayHost, "camera-zoom-scrubber");
    const track = findByClass(overlayHost, "camera-zoom-ruler");
    track.rect = { height: 20, left: 40, top: 0, width: 220 };

    expect(findByClass(overlayHost, "camera-zoom-chip-rack")).toBeNull();
    expect(readout.textContent).toBe("1x");
    expect(scrubber.tabIndex).toBe(0);
    expect(scrubber.getAttribute("aria-valuetext")).toBe("Zoom 1x");

    scrubber.dispatch("pointerdown", {
      button: 0,
      clientX: 98,
      pointerId: 1,
      target: scrubber,
    });
    scrubber.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(dock.classList.contains("is-scrubbing")).toBe(true);
    expect(scrubber.classList.contains("is-active")).toBe(true);
    expect(readout.textContent).toBe("1.4x");
    expect(scrubber.getAttribute("aria-valuetext")).toBe("Zoom 1.4x");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(readout.textContent).toBe("1x");

    scrubber.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(applyRequestCount).toBe(2);

    scrubber.dispatch("pointerup", {
      clientX: 144,
      pointerId: 1,
      target: scrubber,
    });

    expect(dock.classList.contains("is-scrubbing")).toBe(false);
    expect(scrubber.classList.contains("is-active")).toBe(false);
  });

  test("supports keyboard nudges on the scrubber slider", async () => {
    const overlayHost = new FakeElement("div");

    let appliedZoom = null;
    const cameraController = {
      applyZoom(zoomValue) {
        appliedZoom = zoomValue;
        return Promise.resolve(true);
      },
      getCurrentZoom() {
        return 1;
      },
      getZoomCapabilities() {
        return { min: 1, max: 3, step: 0.1 };
      },
    };

    const zoomUi = createZoomUiController({
      cameraController,
      overlayHost,
    });
    zoomUi.initialize();
    zoomUi.syncCapabilities();
    zoomUi.bindEvents();

    const scrubber = findByClass(overlayHost, "camera-zoom-scrubber");
    const readout = findByClass(overlayHost, "camera-zoom-readout");

    scrubber.dispatch("keydown", { key: "ArrowRight", target: scrubber });
    await Promise.resolve();
    zoomUi.handleZoomChange(1.1);

    expect(appliedZoom).toBe(1.1);
    expect(readout.textContent).toBe("1.1x");
    expect(scrubber.getAttribute("aria-valuenow")).toBe("1.1");
    expect(scrubber.classList.contains("is-active")).toBe(true);
  });
});
