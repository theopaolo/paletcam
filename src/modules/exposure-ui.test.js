import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createExposureUiController } from "./exposure-ui.js";

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
    this.classList = new FakeClassList(this);
    this.boundingRect = {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    };
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

  getBoundingClientRect() {
    const { left, top, width, height } = this.boundingRect;
    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top,
    };
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

  setAttribute() {}

  setBoundingRect(rect) {
    this.boundingRect = { ...this.boundingRect, ...rect };
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

describe("createExposureUiController", () => {
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

  test("reverts optimistic exposure after a rejected apply and retries the same EV request", async () => {
    const previewFrame = new FakeElement("div");
    previewFrame.setBoundingRect({ height: 640, width: 360 });
    const overlayHost = new FakeElement("div");
    overlayHost.setBoundingRect({ height: 640, width: 360 });
    previewFrame.appendChild(overlayHost);

    let applyRequestCount = 0;
    /** @type {(result: boolean) => void} */
    let resolveApply = () => {};
    const cameraController = {
      applyExposureCompensation() {
        applyRequestCount += 1;
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      },
      getCurrentExposureCompensation() {
        return 0;
      },
      getExposureCapabilities() {
        return { min: -2, max: 2, step: 0.1 };
      },
      setMeteringPoint() {
        return Promise.resolve(true);
      },
    };

    const exposureUi = createExposureUiController({
      cameraController,
      overlayHost,
    });
    exposureUi.initialize();
    exposureUi.syncCapabilities();
    exposureUi.bindEvents();

    const exposureLayer = findByClass(overlayHost, "camera-exposure-layer");
    const rail = findByClass(overlayHost, "camera-ev-rail");
    const valueBadge = findByClass(overlayHost, "camera-ev-value");
    const passiveIndicator = findByClass(overlayHost, "camera-ev-indicator");

    rail.setBoundingRect({ height: 146, top: 100 });

    expect(passiveIndicator.hidden).toBe(false);

    exposureUi.handleExposureChange(0.8);
    expect(passiveIndicator.textContent).toBe("EV +0.8");

    exposureUi.handleExposureChange(0);
    expect(passiveIndicator.textContent).toBe("EV 0.0");

    passiveIndicator.dispatch("pointerdown", {
      button: 0,
      pointerId: 1,
    });
    expect(exposureLayer.classList.contains("is-visible")).toBe(true);

    rail.dispatch("pointerdown", {
      button: 0,
      clientY: 133,
      pointerId: 2,
    });

    expect(valueBadge.textContent).toBe("+1.1");
    expect(applyRequestCount).toBe(1);

    resolveApply(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(valueBadge.textContent).toBe("0.0");
    expect(passiveIndicator.textContent).toBe("EV 0.0");

    rail.dispatch("pointerdown", {
      button: 0,
      clientY: 133,
      pointerId: 3,
    });

    expect(applyRequestCount).toBe(2);
  });
});
