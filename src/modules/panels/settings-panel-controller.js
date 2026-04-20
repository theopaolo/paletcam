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
    captureModeButtons: Array.from(root.querySelectorAll("[data-settings-capture-mode]")),
    oneMoreColorButtons: Array.from(root.querySelectorAll("[data-settings-one-more-color]")),
    paletteModeGroup: queryById(root, "settingsPaletteModeGroup"),
    exportButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsExportButton")
    ),
    importInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsImportInput")
    ),
  };
}

function syncCaptureModeButtons(dom, activeMode) {
  dom.captureModeButtons.forEach((button) => {
    const buttonMode = button.getAttribute("data-settings-capture-mode");
    button.setAttribute("aria-pressed", String(buttonMode === activeMode));
  });
}

function syncOneMoreColorButtons(dom, isEnabled) {
  dom.oneMoreColorButtons.forEach((button) => {
    const nextValue = button.getAttribute("data-settings-one-more-color");
    const shouldBeActive = (nextValue === "on") === Boolean(isEnabled);
    button.setAttribute("aria-pressed", String(shouldBeActive));
  });
}

function syncPaletteModeGroupVisibility(dom, captureMode) {
  if (dom.paletteModeGroup) {
    dom.paletteModeGroup.hidden = captureMode === "ral";
  }
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
    syncCaptureModeButtons(dom, settings.captureMode);
    syncOneMoreColorButtons(dom, settings.oneMoreColor);
    syncPaletteModeGroupVisibility(dom, settings.captureMode);
  }

  on(openButton, "click", () => {
    openSharedPanel("settings");
  });

  dom.captureModeButtons.forEach((button) => {
    on(button, "click", () => {
      const nextMode = button.getAttribute("data-settings-capture-mode");
      if (nextMode === "palette" || nextMode === "ral") {
        updateAppSettings({ captureMode: nextMode });
      }
    });
  });

  dom.oneMoreColorButtons.forEach((button) => {
    on(button, "click", () => {
      const nextValue = button.getAttribute("data-settings-one-more-color");
      if (nextValue !== "on" && nextValue !== "off") {
        return;
      }

      updateAppSettings({
        oneMoreColor: nextValue === "on",
      });
    });
  });

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
