import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetAppSettingsForTests, getAppSettings, updateAppSettings } from "../../app-settings.js";
import { mountConfigPanel } from "./config-panel-controller.js";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";
const CONFIG_OPEN_ARIA_LABELS = [
  "Ouvrir la configuration",
  "Open configuration",
  "capture.configOpen",
];
const CONFIG_CLOSE_ARIA_LABELS = [
  "Fermer la configuration",
  "Close configuration",
  "capture.configClose",
];
const CONFIG_OPEN_LABELS = ["Config", "Tune", "capture.configLabel"];
const CONFIG_CLOSE_LABELS = ["Fermer", "Close", "capture.configCloseLabel"];

function expectOneOf(actualValue, expectedValues) {
  expect(expectedValues).toContain(actualValue);
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach((token) => {
      this.tokens.add(token);
    });
    this.#sync();
  }

  contains(token) {
    return this.tokens.has(token);
  }

  remove(...tokens) {
    tokens.forEach((token) => {
      this.tokens.delete(token);
    });
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

  #sync() {
    this.element._className = [...this.tokens].join(" ");
  }
}

function toDatasetKey(attributeName) {
  return attributeName.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }

  if (selector.startsWith("[")) {
    const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!attributeMatch) {
      return false;
    }

    const [, attributeName, expectedValue] = attributeMatch;
    if (!element.attributes.has(attributeName)) {
      return false;
    }

    if (expectedValue == null) {
      return true;
    }

    return element.attributes.get(attributeName) === expectedValue;
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, eventInit = {}) {
    const event = {
      currentTarget: this,
      defaultPrevented: false,
      key: "",
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      target: this,
      ...eventInit,
    };

    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }

    return event;
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((candidate) => candidate !== handler),
    );
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.id = "";
    this.parentElement = null;
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.textContent = "";
    this.type = "";
    this.value = "";
    this.min = "";
    this.max = "";
    this.step = "";
    this._className = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.set(value);
  }

  append(...nodes) {
    nodes.forEach((node) => {
      this.appendChild(node);
    });
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  click() {
    this.dispatch("click");
  }

  focus() {
    this.wasFocused = true;
  }

  contains(node) {
    if (node === this) {
      return true;
    }

    return this.children.some(
      (child) => typeof child.contains === "function" && child.contains(node),
    );
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };

    visit(this);
    return matches;
  }

  setAttribute(name, value) {
    const normalizedValue = String(value);
    this.attributes.set(name, normalizedValue);

    if (name === "class") {
      this.className = normalizedValue;
    }

    if (name === "id") {
      this.id = normalizedValue;
    }

    if (name.startsWith("data-")) {
      this.dataset[toDatasetKey(name)] = normalizedValue;
    }
  }
}

function createLocalStorageMock(initialValue = null) {
  const store = new Map();

  if (initialValue !== null) {
    store.set(SETTINGS_STORAGE_KEY, JSON.stringify(initialValue));
  }

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

function createButton(id, attributes = {}) {
  const button = new FakeElement("button");
  if (id) {
    button.setAttribute("id", id);
  }
  for (const [attributeName, attributeValue] of Object.entries(attributes)) {
    button.setAttribute(attributeName, attributeValue);
  }
  return button;
}

function createPanel(panelId, tabId) {
  const panel = new FakeElement("section");
  panel.setAttribute("id", panelId);
  panel.setAttribute("data-config-tabpanel", tabId);
  return panel;
}

function createSteppedShell({ controlKey, shellId, inputId, value }) {
  const shell = new FakeElement("div");
  shell.setAttribute("id", shellId);
  const input = new FakeElement("input");
  input.setAttribute("id", inputId);
  input.type = "range";
  input.min = "0";
  input.max = "3";
  input.step = "1";
  input.value = String(value);
  const labels = new FakeElement("div");
  labels.setAttribute("data-config-step-labels", controlKey);
  shell.append(input, labels);
  return { input, labels, shell };
}

function createConfigFixture() {
  const root = new FakeElement("config-panel");
  const drawer = new FakeElement("section");
  drawer.setAttribute("id", "configDrawer");
  root.appendChild(drawer);

  const tabList = new FakeElement("div");
  const colorsTab = createButton("configTabColors", { "data-config-tab": "colors" });
  const balanceTab = createButton("configTabBalance", { "data-config-tab": "balance" });
  tabList.append(colorsTab, balanceTab);

  const colorsPanel = createPanel("configPanelColors", "colors");
  const balancePanel = createPanel("configPanelBalance", "balance");
  balancePanel.hidden = true;

  const tone = createSteppedShell({
    controlKey: "tone",
    shellId: "configHybridToneSlider",
    inputId: "configHybridToneRange",
    value: 2,
  });
  const spread = createSteppedShell({
    controlKey: "spread",
    shellId: "configHybridSpreadSlider",
    inputId: "configHybridSpreadRange",
    value: 1,
  });

  colorsPanel.append(tone.shell);
  balancePanel.append(spread.shell);

  const undoButton = createButton("configUndoButton");
  const redoButton = createButton("configRedoButton");
  const resetButton = createButton("configResetButton");
  const footer = new FakeElement("div");
  footer.append(undoButton, redoButton, resetButton);

  drawer.append(tabList, colorsPanel, balancePanel, footer);

  const toggleSection = new FakeElement("section");
  const toggleButton = createButton("", {
    "aria-label": "Ouvrir la configuration",
    class: "btn-config",
    "data-i18n-aria-label": "capture.configOpen",
  });
  const toggleIcon = new FakeElement("span");
  toggleIcon.setAttribute("class", "btn-config-icon");
  const toggleLabel = new FakeElement("span");
  toggleLabel.setAttribute("class", "btn-config-label");
  toggleLabel.setAttribute("data-i18n", "capture.configLabel");
  toggleLabel.textContent = "Config";
  toggleButton.append(toggleIcon, toggleLabel);
  toggleSection.appendChild(toggleButton);

  return {
    balancePanel,
    balanceTab,
    colorsPanel,
    colorsTab,
    drawer,
    redoButton,
    root,
    spreadInput: spread.input,
    spreadLabels: spread.labels,
    toggleButton,
    toggleIcon,
    toggleLabel,
    toggleSection,
    toneInput: tone.input,
    toneLabels: tone.labels,
    undoButton,
  };
}

describe("mountConfigPanel", () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    globalThis.localStorage = createLocalStorageMock();
    delete globalThis[GLOBAL_SETTINGS_STORE_KEY];
    resetAppSettingsForTests();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    globalThis.localStorage = originalLocalStorage;
    delete globalThis[GLOBAL_SETTINGS_STORE_KEY];
  });

  test("toggles the drawer and closes on Escape", () => {
    const fixture = createConfigFixture();
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    expect(fixture.drawer.hidden).toBe(true);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("false");
    expectOneOf(fixture.toggleButton.getAttribute("aria-label"), CONFIG_OPEN_ARIA_LABELS);
    expect(fixture.toggleIcon.classList.contains("is-close")).toBe(false);
    expectOneOf(fixture.toggleLabel.textContent, CONFIG_OPEN_LABELS);

    fixture.toggleButton.click();

    expect(fixture.drawer.hidden).toBe(false);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("true");
    expectOneOf(fixture.toggleButton.getAttribute("aria-label"), CONFIG_CLOSE_ARIA_LABELS);
    expect(fixture.toggleButton.classList.contains("is-active")).toBe(true);
    expect(fixture.toggleIcon.classList.contains("is-close")).toBe(true);
    expectOneOf(fixture.toggleLabel.textContent, CONFIG_CLOSE_LABELS);

    fakeDocument.dispatch("keydown", { key: "Escape" });

    expect(fixture.drawer.hidden).toBe(true);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("false");
    expectOneOf(fixture.toggleButton.getAttribute("aria-label"), CONFIG_OPEN_ARIA_LABELS);
    expect(fixture.toggleIcon.classList.contains("is-close")).toBe(false);
    expectOneOf(fixture.toggleLabel.textContent, CONFIG_OPEN_LABELS);
    expect(fixture.toggleButton.wasFocused).toBe(true);

    cleanup();
  });

  test("switches tabs and keeps only the active panel visible", () => {
    const fixture = createConfigFixture();
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    expect(fixture.colorsPanel.hidden).toBe(false);
    expect(fixture.balancePanel.hidden).toBe(true);

    fixture.balanceTab.click();

    expect(fixture.balancePanel.hidden).toBe(false);
    expect(fixture.colorsPanel.hidden).toBe(true);
    expect(fixture.balanceTab.getAttribute("aria-selected")).toBe("true");
    expect(fixture.colorsTab.getAttribute("aria-selected")).toBe("false");

    fixture.balanceTab.dispatch("keydown", { key: "ArrowRight" });

    expect(fixture.colorsTab.getAttribute("aria-selected")).toBe("true");
    expect(fixture.colorsTab.wasFocused).toBe(true);

    cleanup();
  });

  test("snaps hybrid sliders to detents and highlights the active step", () => {
    const fixture = createConfigFixture();
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    expect(fixture.toneInput.value).toBe("2");
    expect(fixture.toneLabels.getAttribute("data-active-index")).toBe("2");

    fixture.toneInput.dispatch("pointerdown");
    fixture.toneInput.value = "3";
    fixture.toneInput.dispatch("input");
    fixture.toneInput.dispatch("pointerup");

    expect(getAppSettings().hybrid.tone).toBe(1);
    expect(fixture.toneLabels.getAttribute("data-active-index")).toBe("3");
    expect(fixture.undoButton.disabled).toBe(false);

    cleanup();
  });

  test("closes the drawer when a pointer starts outside the panel and trigger", () => {
    const fixture = createConfigFixture();
    const outsideElement = new FakeElement("main");
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    fixture.toggleButton.click();
    expect(fixture.drawer.hidden).toBe(false);

    fakeDocument.dispatch("pointerdown", { target: fixture.drawer });
    expect(fixture.drawer.hidden).toBe(false);

    fakeDocument.dispatch("pointerdown", { target: fixture.toggleButton });
    expect(fixture.drawer.hidden).toBe(false);

    fakeDocument.dispatch("pointerdown", { target: outsideElement });
    expect(fixture.drawer.hidden).toBe(true);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.toggleIcon.classList.contains("is-close")).toBe(false);

    cleanup();
  });

  test("tracks slider changes with undo and redo", () => {
    const fixture = createConfigFixture();
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    expect(fixture.undoButton.disabled).toBe(true);
    expect(fixture.spreadInput.value).toBe("2");
    expect(fixture.spreadLabels.getAttribute("data-active-index")).toBe("2");

    fixture.spreadInput.dispatch("pointerdown");
    fixture.spreadInput.value = "0";
    fixture.spreadInput.dispatch("input");
    fixture.spreadInput.dispatch("pointerup");

    expect(getAppSettings().hybrid.spreadStrength).toBe(0.15);
    expect(getAppSettings().hybrid.repulsionRadius).toBe(0.03);
    expect(fixture.undoButton.disabled).toBe(false);
    expect(fixture.spreadLabels.getAttribute("data-active-index")).toBe("0");

    fixture.undoButton.click();

    expect(getAppSettings().hybrid.spreadStrength).toBe(0.6);
    expect(fixture.redoButton.disabled).toBe(false);
    expect(fixture.spreadLabels.getAttribute("data-active-index")).toBe("2");

    fixture.redoButton.click();

    expect(getAppSettings().hybrid.spreadStrength).toBe(0.15);
    expect(fixture.spreadLabels.getAttribute("data-active-index")).toBe("0");

    cleanup();
  });

  test("hides and closes the drawer in RAL mode", () => {
    const fixture = createConfigFixture();
    const fakeDocument = new FakeEventTarget();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const cleanup = mountConfigPanel({
      root: fixture.root,
      toggleButton: fixture.toggleButton,
      toggleSection: fixture.toggleSection,
    });

    fixture.toggleButton.click();
    expect(fixture.drawer.hidden).toBe(false);

    updateAppSettings({ captureMode: "ral" });

    expect(fixture.toggleSection.hidden).toBe(true);
    expect(fixture.toggleButton.hidden).toBe(true);
    expect(fixture.drawer.hidden).toBe(true);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.toggleIcon.classList.contains("is-close")).toBe(false);
    expectOneOf(fixture.toggleLabel.textContent, CONFIG_OPEN_LABELS);

    cleanup();
  });
});
