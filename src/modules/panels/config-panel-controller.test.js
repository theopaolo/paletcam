import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetAppSettingsForTests, getAppSettings, updateAppSettings } from "../../app-settings.js";
import { mountConfigPanel } from "./config-panel-controller.js";

const SETTINGS_STORAGE_KEY = "paletcam:settings:v1";
const GLOBAL_SETTINGS_STORE_KEY = "__paletcamAppSettingsStore__";

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
  return attributeName
    .slice(5)
    .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
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

function createDisplaySpan(attributeName) {
  const element = new FakeElement("span");
  element.setAttribute(attributeName, "");
  return element;
}

function createPresetButton(presetId) {
  const button = createButton("", { "data-config-preset": presetId, "aria-pressed": "false" });
  button.textContent = presetId;
  return button;
}

function createRangeShell({ shellId, inputId, min, max, step, value, displayAttribute }) {
  const shell = new FakeElement("div");
  shell.setAttribute("id", shellId);
  const input = new FakeElement("input");
  input.setAttribute("id", inputId);
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const display = createDisplaySpan(displayAttribute);
  shell.append(input, display);
  return { display, input, shell };
}

function createPanel(panelId, tabId) {
  const panel = new FakeElement("section");
  panel.setAttribute("id", panelId);
  panel.setAttribute("data-config-tabpanel", tabId);
  return panel;
}

function createConfigFixture() {
  const root = new FakeElement("config-panel");
  const drawer = new FakeElement("section");
  drawer.setAttribute("id", "configDrawer");
  root.appendChild(drawer);

  const tabList = new FakeElement("div");
  const analysisTab = createButton("configTabAnalysis", { "data-config-tab": "analysis" });
  const colorsTab = createButton("configTabColors", { "data-config-tab": "colors" });
  const balanceTab = createButton("configTabBalance", { "data-config-tab": "balance" });
  const presetsTab = createButton("configTabPresets", { "data-config-tab": "presets" });
  tabList.append(analysisTab, colorsTab, balanceTab, presetsTab);

  const presetsPanel = createPanel("configPanelPresets", "presets");
  presetsPanel.hidden = true;
  const presetRack = new FakeElement("div");
  const presetBalanced = createPresetButton("balanced");
  const presetVivid = createPresetButton("vivid");
  const presetDynamic = createPresetButton("dynamic");
  const presetSubtle = createPresetButton("subtle");
  const presetRare = createPresetButton("rare");
  presetRack.append(
    presetBalanced,
    presetVivid,
    presetDynamic,
    presetSubtle,
    presetRare,
  );
  presetsPanel.append(presetRack);

  const analysisPanel = createPanel("configPanelAnalysis", "analysis");
  const pool = createRangeShell({
    displayAttribute: "data-config-median-cut-pool-display",
    inputId: "configMedianCutPoolRange",
    max: 64,
    min: 4,
    shellId: "configMedianCutPoolSlider",
    step: 1,
    value: 16,
  });
  const pixels = createRangeShell({
    displayAttribute: "data-config-median-cut-pixels-display",
    inputId: "configMedianCutPixelsRange",
    max: 60000,
    min: 1000,
    shellId: "configMedianCutPixelsSlider",
    step: 1000,
    value: 12000,
  });
  analysisPanel.append(pool.shell, pixels.shell);

  const colorsPanel = createPanel("configPanelColors", "colors");
  colorsPanel.hidden = true;
  const oneMoreColorToggle = new FakeElement("input");
  oneMoreColorToggle.setAttribute("id", "configOneMoreColorToggle");
  oneMoreColorToggle.type = "checkbox";
  oneMoreColorToggle.checked = false;

  const vibrancy = createRangeShell({
    displayAttribute: "data-config-scoring-vibrancy-display",
    inputId: "configScoringVibrancyRange",
    max: 10,
    min: 0,
    shellId: "configScoringVibrancySlider",
    step: 0.5,
    value: 2.5,
  });
  const rarity = createRangeShell({
    displayAttribute: "data-config-scoring-rarity-display",
    inputId: "configScoringRarityRange",
    max: 10,
    min: 0,
    shellId: "configScoringRaritySlider",
    step: 0.5,
    value: 2,
  });
  colorsPanel.append(vibrancy.shell, rarity.shell, oneMoreColorToggle);

  const balancePanel = createPanel("configPanelBalance", "balance");
  balancePanel.hidden = true;
  const diversity = createRangeShell({
    displayAttribute: "data-config-scoring-diversity-display",
    inputId: "configScoringDiversityRange",
    max: 10,
    min: 0,
    shellId: "configScoringDiversitySlider",
    step: 0.5,
    value: 4,
  });
  const contrast = createRangeShell({
    displayAttribute: "data-config-scoring-contrast-display",
    inputId: "configScoringContrastRange",
    max: 10,
    min: 0,
    shellId: "configScoringContrastSlider",
    step: 0.5,
    value: 1.5,
  });
  balancePanel.append(diversity.shell, contrast.shell);

  const undoButton = createButton("configUndoButton");
  const redoButton = createButton("configRedoButton");
  const resetButton = createButton("configResetButton");
  const footer = new FakeElement("div");
  footer.append(undoButton, redoButton, resetButton);

  drawer.append(tabList, analysisPanel, colorsPanel, balancePanel, presetsPanel, footer);

  const toggleSection = new FakeElement("section");
  const toggleButton = createButton("", { class: "btn-config" });
  toggleSection.appendChild(toggleButton);

  return {
    analysisTab,
    balanceTab,
    colorsPanel,
    colorsTab,
    contrastInput: contrast.input,
    drawer,
    diversityDisplay: diversity.display,
    diversityInput: diversity.input,
    presetBalanced,
    presetRare,
    presetsPanel,
    presetsTab,
    presetSubtle,
    presetVivid,
    oneMoreColorToggle,
    redoButton,
    root,
    toggleButton,
    toggleSection,
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

    fixture.toggleButton.click();

    expect(fixture.drawer.hidden).toBe(false);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.toggleButton.classList.contains("is-active")).toBe(true);

    fakeDocument.dispatch("keydown", { key: "Escape" });

    expect(fixture.drawer.hidden).toBe(true);
    expect(fixture.toggleButton.getAttribute("aria-expanded")).toBe("false");
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

    expect(fixture.colorsPanel.hidden).toBe(true);
    expect(fixture.presetsPanel.hidden).toBe(true);

    fixture.colorsTab.click();

    expect(fixture.colorsPanel.hidden).toBe(false);
    expect(fixture.colorsTab.getAttribute("aria-selected")).toBe("true");
    expect(fixture.analysisTab.getAttribute("aria-selected")).toBe("false");

    fixture.colorsTab.dispatch("keydown", { key: "ArrowRight" });

    expect(fixture.balanceTab.getAttribute("aria-selected")).toBe("true");
    expect(fixture.balanceTab.wasFocused).toBe(true);

    fixture.presetsTab.click();

    expect(fixture.presetsPanel.hidden).toBe(false);
    expect(fixture.presetsTab.getAttribute("aria-selected")).toBe("true");
    expect(fixture.colorsPanel.hidden).toBe(true);

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
    expect(fixture.diversityDisplay.textContent).toBe("4");

    fixture.diversityInput.dispatch("pointerdown");
    fixture.diversityInput.value = "5.5";
    fixture.diversityInput.dispatch("input");
    fixture.diversityInput.dispatch("pointerup");

    expect(getAppSettings().paletteScoring.diversityWeight).toBe(55);
    expect(fixture.undoButton.disabled).toBe(false);
    expect(fixture.diversityDisplay.textContent).toBe("5.5");

    fixture.undoButton.click();

    expect(getAppSettings().paletteScoring.diversityWeight).toBe(40);
    expect(fixture.redoButton.disabled).toBe(false);
    expect(fixture.diversityDisplay.textContent).toBe("4");

    fixture.redoButton.click();

    expect(getAppSettings().paletteScoring.diversityWeight).toBe(55);
    expect(fixture.diversityDisplay.textContent).toBe("5.5");

    cleanup();
  });

  test("applies scoring presets and tracks the active preset", () => {
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

    expect(fixture.presetBalanced.getAttribute("aria-pressed")).toBe("true");
    expect(fixture.presetVivid.getAttribute("aria-pressed")).toBe("false");

    fixture.presetVivid.click();

    expect(getAppSettings().paletteScoring.chromaWeight).toBe(55);
    expect(getAppSettings().paletteScoring.lumaSpreadWeight).toBe(5);
    expect(getAppSettings().paletteScoring.rarityWeight).toBe(10);
    expect(getAppSettings().paletteScoring.diversityWeight).toBe(30);
    expect(fixture.presetBalanced.getAttribute("aria-pressed")).toBe("false");
    expect(fixture.presetVivid.getAttribute("aria-pressed")).toBe("true");
    expect(fixture.undoButton.disabled).toBe(false);

    fixture.presetSubtle.click();

    expect(getAppSettings().paletteScoring.chromaWeight).toBe(25);
    expect(getAppSettings().paletteScoring.lumaSpreadWeight).toBe(5);
    expect(getAppSettings().paletteScoring.rarityWeight).toBe(5);
    expect(getAppSettings().paletteScoring.diversityWeight).toBe(15);
    expect(fixture.presetSubtle.getAttribute("aria-pressed")).toBe("true");

    cleanup();
  });

  test("updates one more color toggle from the config panel", () => {
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

    expect(fixture.oneMoreColorToggle.checked).toBe(false);

    fixture.oneMoreColorToggle.checked = true;
    fixture.oneMoreColorToggle.dispatch("change");

    expect(getAppSettings().oneMoreColor).toBe(true);
    expect(fixture.oneMoreColorToggle.checked).toBe(true);

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

    cleanup();
  });
});
