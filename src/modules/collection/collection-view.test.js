import { describe, expect, test } from "bun:test";

import {
  createCollectionView,
  getMissingRequiredCollectionViewElements,
  hasRequiredCollectionViewElements,
} from "./collection-view.js";

function createDocumentStub({ missingIds = [], missingSelector = "" } = {}) {
  const queriedIds = [];
  const queriedSelectors = [];
  const elements = new Map();
  const getElement = (key) => {
    if (!elements.has(key)) {
      elements.set(key, { key });
    }
    return elements.get(key);
  };

  return {
    queriedIds,
    queriedSelectors,
    querySelector(selector) {
      queriedSelectors.push(selector);
      return selector === missingSelector ? null : getElement(selector);
    },
    getElementById(id) {
      queriedIds.push(id);
      return missingIds.includes(id) ? null : getElement(id);
    },
  };
}

describe("collection view factory", () => {
  test("collects collection DOM through an injected document", () => {
    const documentStub = createDocumentStub();
    const view = createCollectionView(
      /** @type {Document} */ (/** @type {unknown} */ (documentStub)),
    );

    expect(documentStub.queriedSelectors).toEqual([".collection-panel"]);
    expect(documentStub.queriedIds).toEqual([
      "collectionGrid",
      "collectionViewListButton",
      "collectionViewGridButton",
      "collectionViewSwatchButton",
      "collectionCollapseAllButton",
      "collectionFilterPublishedButton",
      "collectionFilterFavoritesButton",
      "collectionSelectionBar",
      "collectionSelectionCount",
      "collectionSelectionCancel",
      "collectionSelectionDelete",
      "collectionSelectionFavorite",
      "collectionSelectionExport",
      "collectionSelectionPublish",
      "collectionSelectionUnpublish",
    ]);
    expect(view.panel).not.toBeNull();
    expect(view.grid).not.toBeNull();
    expect(hasRequiredCollectionViewElements(view)).toBe(true);
  });

  test("reports missing required elements in deterministic contract order", () => {
    const documentStub = createDocumentStub({
      missingIds: ["collectionGrid"],
      missingSelector: ".collection-panel",
    });
    const view = createCollectionView(
      /** @type {Document} */ (/** @type {unknown} */ (documentStub)),
    );

    expect(hasRequiredCollectionViewElements(view)).toBe(false);
    expect(getMissingRequiredCollectionViewElements(view)).toEqual(["panel", "grid"]);
  });

  test("keeps optional controls nullable without invalidating the view", () => {
    const documentStub = createDocumentStub({
      missingIds: ["collectionSelectionBar", "collectionViewSwatchButton"],
    });
    const view = createCollectionView(
      /** @type {Document} */ (/** @type {unknown} */ (documentStub)),
    );

    expect(view.selectionBar).toBeNull();
    expect(view.viewSwatchButton).toBeNull();
    expect(getMissingRequiredCollectionViewElements(view)).toEqual([]);
    expect(hasRequiredCollectionViewElements(view)).toBe(true);
  });
});
