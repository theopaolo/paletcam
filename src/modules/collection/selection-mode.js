/**
 * Applies a card click while collection select mode is active.
 *
 * @param {object} options
 * @param {number} options.paletteId
 * @param {Set<number>} options.selectedIds
 * @param {boolean} [options.suppressNextClick]
 * @returns {{ isSelected: boolean, suppressNextClick: boolean, toggled: boolean }}
 */
export function applySelectionModeCardClick({
  paletteId,
  selectedIds,
  suppressNextClick = false,
}) {
  if (suppressNextClick) {
    return {
      isSelected: selectedIds.has(paletteId),
      suppressNextClick: false,
      toggled: false,
    };
  }

  if (selectedIds.has(paletteId)) {
    selectedIds.delete(paletteId);
    return {
      isSelected: false,
      suppressNextClick: false,
      toggled: true,
    };
  }

  selectedIds.add(paletteId);
  return {
    isSelected: true,
    suppressNextClick: false,
    toggled: true,
  };
}
