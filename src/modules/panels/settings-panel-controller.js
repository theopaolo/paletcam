import {
  getAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../../app-settings.js";
import { t } from "../../i18n.js";
import { exportAllPalettes, importAllPalettes } from "../../palette-storage.js";
import { showToast } from "../toast-ui.js";

const TAB_IDS = ["login", "language", "watermark", "data"];

function queryById(root, id) {
  if (!id) {
    return null;
  }

  return root.querySelector(`#${id}`);
}

function getSettingsDom(root) {
  return {
    drawer: queryById(root, "settingsDrawer"),
    polaroidFooterLabelInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsPolaroidFooterLabelInput")
    ),
    localeToggle: /** @type {HTMLElement | null} */ (
      queryById(root, "settingsLocaleToggle")
    ),
    exportButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsExportButton")
    ),
    importInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsImportInput")
    ),
    tabButtons: Array.from(root.querySelectorAll("[data-settings-tab]")),
    tabPanels: Array.from(root.querySelectorAll("[data-settings-tabpanel]")),
  };
}

function syncPolaroidFooterLabelInput(dom, settings) {
  if (!dom.polaroidFooterLabelInput || document.activeElement === dom.polaroidFooterLabelInput) {
    return;
  }

  dom.polaroidFooterLabelInput.value = settings.polaroidFooterLabel;
}

function syncLocaleToggle(dom, settings) {
  if (!dom.localeToggle) {
    return;
  }

  dom.localeToggle.querySelectorAll("[data-locale]").forEach((btn) => {
    const active = btn.getAttribute("data-locale") === settings.locale;
    btn.setAttribute("aria-pressed", String(active));
    btn.classList.toggle("is-active", active);
  });
}

function getNextTabId(currentTabId, direction) {
  const currentIndex = TAB_IDS.indexOf(currentTabId);
  if (currentIndex < 0) {
    return TAB_IDS[0];
  }

  const nextIndex = (currentIndex + direction + TAB_IDS.length) % TAB_IDS.length;
  return TAB_IDS[nextIndex];
}

export function mountSettingsPanel({ root, toggleButton }) {
  const dom = getSettingsDom(root);
  const cleanups = [];
  let activeTabId = "login";
  let isDrawerOpen = false;

  const on = (element, eventName, handler, options) => {
    if (!element) {
      return;
    }

    element.addEventListener(eventName, handler, options);
    cleanups.push(() => {
      element.removeEventListener(eventName, handler, options);
    });
  };

  function syncDrawerState() {
    if (dom.drawer) {
      dom.drawer.hidden = !isDrawerOpen;
      dom.drawer.setAttribute("aria-hidden", String(!isDrawerOpen));
    }

    if (toggleButton) {
      toggleButton.classList.toggle("is-active", isDrawerOpen);
      toggleButton.setAttribute("aria-expanded", String(isDrawerOpen));
    }

    root.classList.toggle("is-open", isDrawerOpen);
    document.dispatchEvent(
      new CustomEvent("settings-drawer-change", { detail: { isOpen: isDrawerOpen } }),
    );
  }

  function setDrawerOpen(nextOpen, { restoreFocus = false } = {}) {
    if (isDrawerOpen === nextOpen) {
      syncDrawerState();
      return;
    }

    isDrawerOpen = nextOpen;
    syncDrawerState();

    if (!isDrawerOpen && restoreFocus && typeof toggleButton?.focus === "function") {
      toggleButton.focus();
    }
  }

  function setActiveTab(nextTabId, { focusButton = false } = {}) {
    activeTabId = TAB_IDS.includes(nextTabId) ? nextTabId : TAB_IDS[0];

    dom.tabButtons.forEach((button) => {
      const tabId = button.getAttribute("data-settings-tab");
      const isActive = tabId === activeTabId;
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
      button.classList.toggle("is-active", isActive);

      if (isActive && focusButton && typeof button.focus === "function") {
        button.focus();
      }
    });

    dom.tabPanels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-settings-tabpanel") !== activeTabId;
    });
  }

  function renderSettingsUi(settings) {
    syncPolaroidFooterLabelInput(dom, settings);
    syncLocaleToggle(dom, settings);
  }

  function bindTabButton(button) {
    on(button, "click", () => {
      const tabId = button.getAttribute("data-settings-tab");
      if (tabId) {
        setActiveTab(tabId);
      }
    });

    on(button, "keydown", (event) => {
      const currentTabId = button.getAttribute("data-settings-tab") || activeTabId;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveTab(getNextTabId(currentTabId, -1), { focusButton: true });
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveTab(getNextTabId(currentTabId, 1), { focusButton: true });
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveTab(TAB_IDS[0], { focusButton: true });
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveTab(TAB_IDS[TAB_IDS.length - 1], { focusButton: true });
      }
    });
  }

  if (toggleButton) {
    toggleButton.setAttribute("aria-controls", "settingsDrawer");
    toggleButton.setAttribute("aria-expanded", "false");
  }

  on(toggleButton, "click", () => {
    setDrawerOpen(!isDrawerOpen);
  });

  on(document, "keydown", (event) => {
    if (event.key === "Escape" && isDrawerOpen) {
      event.preventDefault();
      setDrawerOpen(false, { restoreFocus: true });
    }
  });

  on(document, "open-settings-panel", (event) => {
    const tab = event.detail?.tab;
    setDrawerOpen(true);
    if (tab) {
      setActiveTab(tab);
    }
  });

  dom.tabButtons.forEach(bindTabButton);

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
  on(dom.localeToggle, "click", (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest("[data-locale]");
    if (!btn) {
      return;
    }

    updateAppSettings({ locale: btn.getAttribute("data-locale") });
  });

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
            showToast(t("settings.toast.exportDone"), { duration: 1400 });
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
      showToast(t("settings.toast.exportDone"), { duration: 1400 });
    } catch (error) {
      console.error("Export failed:", error);
      showToast(t("settings.toast.exportFailed"), { duration: 2000 });
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
      const translationKey =
        count === 1 ? "settings.toast.imported.one" : "settings.toast.imported.other";
      showToast(t(translationKey, { count }), { duration: 2000 });
    } catch (error) {
      console.error("Import failed:", error);
      showToast(t("settings.toast.importFailed"), { duration: 2500 });
    } finally {
      dom.importInput.value = "";
      dom.importInput.disabled = false;
    }
  });

  setActiveTab(activeTabId);
  syncDrawerState();
  renderSettingsUi(getAppSettings());
  const unsubscribe = subscribeAppSettings(renderSettingsUi);

  return () => {
    unsubscribe();
    cleanups.forEach((cleanup) => {
      cleanup();
    });
  };
}
