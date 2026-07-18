/**
 * Applies a card click while collection select mode is active.
 *
 * @param {object} options
 * @param {number} options.paletteId
 * @param {Set<number>} options.selectedIds
 * @param {boolean} [options.suppressNextClick]
 * @returns {{ isSelected: boolean, suppressNextClick: boolean, toggled: boolean }}
 */
export function applySelectionModeCardClick({ paletteId, selectedIds, suppressNextClick = false }) {
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

/**
 * Owns collection-selection state without importing DOM, storage, network, or settings.
 */
export function createCollectionSelectionState() {
  const selectedIds = new Set();
  let isActive = false;
  let suppressNextClick = false;

  return {
    /** @param {number} paletteId */
    applyCardClick(paletteId) {
      const result = applySelectionModeCardClick({
        paletteId,
        selectedIds,
        suppressNextClick,
      });
      suppressNextClick = result.suppressNextClick;
      return result;
    },
    enter(initialPaletteId = null, { suppressNextClick: shouldSuppressNextClick = false } = {}) {
      isActive = true;
      suppressNextClick = shouldSuppressNextClick;
      selectedIds.clear();
      if (initialPaletteId !== null) {
        selectedIds.add(initialPaletteId);
      }
    },
    exit() {
      isActive = false;
      suppressNextClick = false;
      selectedIds.clear();
    },
    getCount: () => selectedIds.size,
    /** @param {Palette[]} palettes @param {(palette: Palette) => boolean} [predicate] */
    getSelected(palettes, predicate = () => true) {
      return palettes.filter((palette) => selectedIds.has(palette.id) && predicate(palette));
    },
    getSelectedIds: () => [...selectedIds],
    isActive: () => isActive,
    /** @param {number} paletteId */
    isSelected: (paletteId) => selectedIds.has(paletteId),
    /** @param {Palette[]} palettes */
    pruneUnavailable(palettes) {
      const availableIds = new Set(palettes.map((palette) => palette.id));
      selectedIds.forEach((paletteId) => {
        if (!availableIds.has(paletteId)) {
          selectedIds.delete(paletteId);
        }
      });
    },
  };
}
