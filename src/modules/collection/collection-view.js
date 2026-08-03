/**
 * @typedef {object} CollectionView
 * @property {(HTMLElement & { panelTitle: string }) | null} panel
 * @property {HTMLElement | null} grid
 * @property {HTMLElement | null} viewListButton
 * @property {HTMLElement | null} viewGridButton
 * @property {HTMLElement | null} viewSwatchButton
 * @property {HTMLElement | null} filterPublishedButton
 * @property {HTMLElement | null} filterFavoritesButton
 * @property {HTMLElement | null} selectionBar
 * @property {HTMLElement | null} selectionCount
 * @property {HTMLElement | null} selectionCancelButton
 * @property {HTMLElement | null} selectionDeleteButton
 * @property {HTMLElement | null} selectionFavoriteButton
 * @property {HTMLElement | null} selectionExportButton
 * @property {HTMLElement | null} selectionPublishButton
 * @property {HTMLElement | null} selectionUnpublishButton
 */

/** @param {Document} documentRef @returns {CollectionView} */
export function createCollectionView(documentRef) {
  return {
    panel: /** @type {(HTMLElement & { panelTitle: string }) | null} */ (
      documentRef.querySelector(".collection-panel")
    ),
    grid: documentRef.getElementById("collectionGrid"),
    viewListButton: documentRef.getElementById("collectionViewListButton"),
    viewGridButton: documentRef.getElementById("collectionViewGridButton"),
    viewSwatchButton: documentRef.getElementById("collectionViewSwatchButton"),
    filterPublishedButton: documentRef.getElementById("collectionFilterPublishedButton"),
    filterFavoritesButton: documentRef.getElementById("collectionFilterFavoritesButton"),
    selectionBar: documentRef.getElementById("collectionSelectionBar"),
    selectionCount: documentRef.getElementById("collectionSelectionCount"),
    selectionCancelButton: documentRef.getElementById("collectionSelectionCancel"),
    selectionDeleteButton: documentRef.getElementById("collectionSelectionDelete"),
    selectionFavoriteButton: documentRef.getElementById("collectionSelectionFavorite"),
    selectionExportButton: documentRef.getElementById("collectionSelectionExport"),
    selectionPublishButton: documentRef.getElementById("collectionSelectionPublish"),
    selectionUnpublishButton: documentRef.getElementById("collectionSelectionUnpublish"),
  };
}

/** @param {CollectionView} view */
export function getMissingRequiredCollectionViewElements(view) {
  return [
    ["panel", view.panel],
    ["grid", view.grid],
  ]
    .filter(([, element]) => !element)
    .map(([key]) => key);
}

/** @param {CollectionView} view */
export function hasRequiredCollectionViewElements(view) {
  return getMissingRequiredCollectionViewElements(view).length === 0;
}
