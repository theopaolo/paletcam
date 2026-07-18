/**
 * @typedef {{status: "exported"} | {status: "failed", error?: unknown}} PaletteExportOutcome
 */

/**
 * @typedef {
 *   | {status: "shared"}
 *   | {status: "cancelled"}
 *   | {status: "fallback_exported"}
 *   | {status: "unsupported", error?: unknown}
 *   | {status: "failed", error?: unknown}
 * } PaletteShareOutcome
 */

/**
 * @param {unknown} [error]
 * @returns {{status: "failed", error?: unknown}}
 */
function createFailedOutcome(error) {
  return error === undefined ? { status: "failed" } : { status: "failed", error };
}

/**
 * @param {unknown} [error]
 * @returns {{status: "unsupported", error?: unknown}}
 */
function createUnsupportedOutcome(error) {
  return error === undefined ? { status: "unsupported" } : { status: "unsupported", error };
}

/**
 * Coordinates palette output policy without importing DOM, browser, storage,
 * translation, or reporting adapters. Every command resolves to a closed
 * outcome so an unexpected adapter failure cannot become an unhandled action
 * rejection.
 *
 * @param {object} dependencies
 * @param {(palette: Palette) => unknown | Promise<unknown>} dependencies.exportPolaroid
 * @param {(palette: Palette) => unknown | Promise<unknown>} dependencies.sharePolaroid
 * @param {(blob: Blob, filename: string) => unknown | Promise<unknown>} dependencies.download
 * @param {() => unknown | Promise<unknown>} dependencies.loadVersoTools
 */
export function createPaletteOutputCommands({
  exportPolaroid,
  sharePolaroid,
  download,
  loadVersoTools,
}) {
  /**
   * @param {Palette} palette
   * @returns {Promise<PaletteExportOutcome>}
   */
  async function exportPalette(palette) {
    try {
      const exported = await exportPolaroid(palette);
      return exported === true ? { status: "exported" } : { status: "failed" };
    } catch (error) {
      return createFailedOutcome(error);
    }
  }

  /**
   * @param {Palette} palette
   * @returns {Promise<PaletteExportOutcome>}
   */
  async function exportPaletteVerso(palette) {
    try {
      const tools = await loadVersoTools();
      if (
        !tools ||
        typeof tools !== "object" ||
        !("getColorNames" in tools) ||
        typeof tools.getColorNames !== "function" ||
        !("renderVersoBlob" in tools) ||
        typeof tools.renderVersoBlob !== "function"
      ) {
        return createFailedOutcome(
          new TypeError("Palette verso tools do not satisfy the output contract."),
        );
      }

      const names = await tools.getColorNames(palette.colors);
      if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
        return createFailedOutcome(
          new TypeError("Palette color names do not satisfy the output contract."),
        );
      }

      const blob = await tools.renderVersoBlob(palette, names);
      const exported = await download(blob, `palette-${palette.id}-verso.png`);
      return exported === true ? { status: "exported" } : { status: "failed" };
    } catch (error) {
      return createFailedOutcome(error);
    }
  }

  /**
   * @param {Palette} palette
   * @returns {Promise<PaletteShareOutcome>}
   */
  async function sharePalette(palette) {
    try {
      const shareResult = await sharePolaroid(palette);
      if (!shareResult || typeof shareResult !== "object" || !("status" in shareResult)) {
        return createFailedOutcome();
      }

      if (shareResult.status === "shared") {
        return { status: "shared" };
      }
      if (shareResult.status === "cancelled") {
        return { status: "cancelled" };
      }
      if (shareResult.status === "error") {
        return createFailedOutcome("error" in shareResult ? shareResult.error : undefined);
      }
      if (shareResult.status !== "unsupported") {
        return createFailedOutcome();
      }

      try {
        const exported = await exportPolaroid(palette);
        if (exported === true) {
          return { status: "fallback_exported" };
        }
        return createUnsupportedOutcome("error" in shareResult ? shareResult.error : undefined);
      } catch (error) {
        return createUnsupportedOutcome(error);
      }
    } catch (error) {
      return createFailedOutcome(error);
    }
  }

  return {
    exportPalette,
    exportPaletteVerso,
    sharePalette,
  };
}
