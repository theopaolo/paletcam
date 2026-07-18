import { describe, expect, test } from "bun:test";

import {
  createAppView,
  getMissingRequiredAppViewElements,
  hasRequiredAppViewElements,
} from "./app-view.js";

function createDocumentStub({ missingSelector = "", missingId = "" } = {}) {
  const queriedSelectors = [];
  const queriedIds = [];
  const createdTags = [];
  const elements = new Map();
  const getElement = (key, tagName = "DIV") => {
    if (!elements.has(key)) {
      elements.set(key, { key, tagName });
    }
    return elements.get(key);
  };

  return {
    createdTags,
    queriedIds,
    queriedSelectors,
    querySelector(selector) {
      queriedSelectors.push(selector);
      return selector === missingSelector ? null : getElement(selector);
    },
    getElementById(id) {
      queriedIds.push(id);
      return id === missingId ? null : getElement(id);
    },
    createElement(tagName) {
      createdTags.push(tagName);
      return getElement(`created:${tagName}`, tagName.toUpperCase());
    },
  };
}

describe("app view factory", () => {
  test("collects the app DOM in one typed view and creates owned surfaces", () => {
    const documentStub = createDocumentStub();
    const view = createAppView(/** @type {Document} */ (/** @type {unknown} */ (documentStub)));

    expect(
      documentStub.queriedSelectors.filter((selector) => selector === ".capture-palette-stage"),
    ).toHaveLength(1);
    expect(documentStub.queriedSelectors).toContain(".camera-feed");
    expect(documentStub.queriedSelectors).toContain("config-panel");
    expect(documentStub.queriedIds).toContain("canvas-palette");
    expect(documentStub.createdTags).toEqual(["div", "div", "canvas"]);
    expect(hasRequiredAppViewElements(view)).toBe(true);
    expect(getMissingRequiredAppViewElements(view)).toEqual([]);
  });

  test("reports only missing elements required to initialize the camera app", () => {
    const documentStub = createDocumentStub({ missingId: "canvas" });
    const view = createAppView(/** @type {Document} */ (/** @type {unknown} */ (documentStub)));

    expect(hasRequiredAppViewElements(view)).toBe(false);
    expect(getMissingRequiredAppViewElements(view)).toEqual(["frameCanvas"]);
  });

  test("keeps optional controls nullable without invalidating the app view", () => {
    const documentStub = createDocumentStub({ missingSelector: ".btn-rotate" });
    const view = createAppView(/** @type {Document} */ (/** @type {unknown} */ (documentStub)));

    expect(view.rotateButton).toBeNull();
    expect(hasRequiredAppViewElements(view)).toBe(true);
  });
});
