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
    this.children = [];
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.hidden = false;
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
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

  setAttribute() {}

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

  test("renders canonical lens chips and rolls back a failed horizontal scrub", async () => {
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

    const chipRack = findByClass(overlayHost, "camera-zoom-chip-rack");
    const readout = findByClass(overlayHost, "camera-zoom-readout");
    const scrubber = findByClass(overlayHost, "camera-zoom-scrubber");
    const chipLabels = chipRack.children.map((chip) => chip.textContent);
    const activeChip = chipRack.children.find((chip) => chip.dataset.active === "true");

    expect(chipLabels).toEqual([".5", "1x", "2"]);
    expect(readout.textContent).toBe("1x");
    expect(activeChip?.textContent).toBe("1x");

    chipRack.dispatch("pointerdown", {
      button: 0,
      clientX: 100,
      pointerId: 1,
      target: activeChip,
    });
    chipRack.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: activeChip,
    });

    expect(scrubber.hidden).toBe(false);
    expect(readout.textContent).toBe("1.4x");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(readout.textContent).toBe("1x");

    chipRack.dispatch("pointermove", {
      clientX: 144,
      pointerId: 1,
      target: activeChip,
    });

    expect(applyRequestCount).toBe(2);
  });
});
