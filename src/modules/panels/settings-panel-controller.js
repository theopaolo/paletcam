import {
  getAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { exportAllPalettes, importAllPalettes } from "../../palette-storage.js";
import { showToast } from "../toast-ui.js";
import { openSharedPanel } from "./panel-manager.js";
import { createRangeControl } from "./settings-range-control.js";

function queryById(root, id) {
  if (!id) {
    return null;
  }

  return root.querySelector(`#${id}`);
}

function getSettingsDom(root) {
  return {
    polaroidFooterLabelInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsPolaroidFooterLabelInput")
    ),
    exportButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsExportButton")
    ),
    importInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsImportInput")
    ),
  };
}

function syncPolaroidFooterLabelInput(dom, settings) {
  if (!dom.polaroidFooterLabelInput || document.activeElement === dom.polaroidFooterLabelInput) {
    return;
  }

  dom.polaroidFooterLabelInput.value = settings.polaroidFooterLabel;
}

export function mountSettingsPanel({ root, openButton }) {
  const dom = getSettingsDom(root);
  const cleanups = [];

  const on = (element, eventName, handler, options) => {
    if (!element) {
      return;
    }

    element.addEventListener(eventName, handler, options);
    cleanups.push(() => {
      element.removeEventListener(eventName, handler, options);
    });
  };

  const photoQualityControl = createRangeControl({
    root,
    shellId: "settingsPhotoQualitySlider",
    inputId: "settingsPhotoQualityRange",
    displaySelector: "[data-settings-quality-display]",
    getValueFromSettings: (settings) =>
      Math.round((settings.photoExportQuality || 0) * 100),
    onValueInput: (percentValue) => {
      updateAppSettings({
        photoExportQuality: percentValue / 100,
      });
    },
    getAriaLabel: (value) => `Qualité d'image : ${value}%`,
    formatInlineValue: (value) => `${value}%`,
    formatDisplayValue: (value) => `${value}%`,
  });

  function renderSettingsUi(settings) {
    photoQualityControl?.renderFromSettings(settings);
    syncPolaroidFooterLabelInput(dom, settings);
  }

  on(openButton, "click", () => {
    openSharedPanel("settings");
  });

  const commitPolaroidFooterLabel = () => {
    if (!dom.polaroidFooterLabelInput) {
      return;
    }

    updateAppSettings({
      polaroidFooterLabel: dom.polaroidFooterLabelInput.value,
    });
  };

  on(dom.polaroidFooterLabelInput, "change", commitPolaroidFooterLabel);
  on(dom.polaroidFooterLabelInput, "blur", commitPolaroidFooterLabel);

  photoQualityControl?.bindEvents(on);

  on(dom.exportButton, "click", async () => {
    if (!dom.exportButton) {
      return;
    }

    dom.exportButton.disabled = true;
    try {
      const json = await exportAllPalettes();
      const blob = new Blob([json], { type: "application/json" });
      const filename = `paletcam-export-${new Date().toISOString().slice(0, 10)}.json`;

      if (typeof navigator.canShare === "function") {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            showToast("Export terminé.", { duration: 1400 });
            return;
          } catch (shareError) {
            if (shareError instanceof Error && shareError.name === "AbortError") {
              return;
            }
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("Export terminé.", { duration: 1400 });
    } catch (error) {
      console.error("Export failed:", error);
      showToast("Erreur lors de l'export.", { duration: 2000 });
    } finally {
      if (dom.exportButton) {
        dom.exportButton.disabled = false;
      }
    }
  });

  on(dom.importInput, "change", async () => {
    if (!dom.importInput) {
      return;
    }

    const file = dom.importInput.files?.[0];
    if (!file) {
      return;
    }

    dom.importInput.disabled = true;
    try {
      const text = await file.text();
      const count = await importAllPalettes(text);
      showToast(
        `${count} palette${count > 1 ? "s" : ""} importée${count > 1 ? "s" : ""}.`,
        { duration: 2000 },
      );
    } catch (error) {
      console.error("Import failed:", error);
      showToast("Erreur lors de l'import. Vérifiez le fichier.", { duration: 2500 });
    } finally {
      dom.importInput.value = "";
      dom.importInput.disabled = false;
    }
  });

  renderSettingsUi(getAppSettings());
  const unsubscribe = subscribeAppSettings(renderSettingsUi);

  return () => {
    unsubscribe();
    cleanups.forEach((cleanup) => {
      cleanup();
    });
  };
}
