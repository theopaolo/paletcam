import { getAppSettings, subscribeAppSettings, updateAppSettings } from "../../app-settings.js";
import { t } from "../../i18n.js";
import { flushAllLocalData } from "../local-data-reset.js";
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
  const importLabel = /** @type {HTMLLabelElement | null} */ (
    queryById(root, "settingsImportLabel")
  );

  return {
    drawer: queryById(root, "settingsDrawer"),
    polaroidFooterLabelInput: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsPolaroidFooterLabelInput")
    ),
    polaroidColorNamesToggle: /** @type {HTMLInputElement | null} */ (
      queryById(root, "settingsPolaroidColorNamesToggle")
    ),
    localeToggle: /** @type {HTMLElement | null} */ (queryById(root, "settingsLocaleToggle")),
    exportButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "settingsExportButton")),
    exportStatus: /** @type {HTMLParagraphElement | null} */ (
      queryById(root, "settingsDataStatus")
    ),
    flushDataButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsFlushDataButton")
    ),
    importLabel,
    importLabelText: /** @type {HTMLElement | null} */ (
      importLabel?.querySelector(".panel-form-file-label-text") ?? null
    ),
    importInput: /** @type {HTMLInputElement | null} */ (queryById(root, "settingsImportInput")),
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

function syncPolaroidColorNamesToggle(dom, settings) {
  if (!dom.polaroidColorNamesToggle) {
    return;
  }

  dom.polaroidColorNamesToggle.checked = Boolean(settings.polaroidShowColorNames);
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

function formatElapsedDuration(elapsedMs) {
  const totalSeconds = Math.max(0, Math.round(Number(elapsedMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function mountSettingsPanel({ root, toggleButton }) {
  const dom = getSettingsDom(root);
  const cleanups = [];
  let activeTabId = "login";
  let isDrawerOpen = false;
  let isExportInProgress = false;
  let isImportInProgress = false;

  function setExportStatus(message, { isError = false } = {}) {
    if (!dom.exportStatus) {
      return;
    }

    dom.exportStatus.textContent = message || "";
    dom.exportStatus.hidden = !message;
    dom.exportStatus.classList.toggle("is-error", isError);
  }

  function syncExportButtonState(progress = null) {
    if (!dom.exportButton) {
      return;
    }

    dom.exportButton.disabled = isExportInProgress || isImportInProgress;
    dom.exportButton.setAttribute("aria-busy", String(isExportInProgress));

    if (!isExportInProgress) {
      dom.exportButton.textContent = t("settings.data.export");
      return;
    }

    if (progress?.total > 0 && progress?.completed > 0) {
      dom.exportButton.textContent = `${t("settings.data.exportBusy")} ${progress.completed}/${progress.total}`;
      return;
    }

    dom.exportButton.textContent = t("settings.data.exportBusy");
  }

  function syncImportUi() {
    const isImportDisabled = isImportInProgress || isExportInProgress;

    if (dom.importInput) {
      dom.importInput.disabled = isImportDisabled;
    }

    if (dom.importLabel) {
      dom.importLabel.classList.toggle("is-busy", isImportInProgress);
      dom.importLabel.setAttribute("aria-busy", String(isImportInProgress));
      dom.importLabel.setAttribute("aria-disabled", String(isImportDisabled));
    }

    if (dom.importLabelText) {
      dom.importLabelText.textContent = t(
        isImportInProgress ? "settings.data.importBusy" : "settings.data.importLabel",
      );
    }
  }

  function buildExportProgressMessage(progress) {
    const elapsed = formatElapsedDuration(progress?.elapsedMs);

    if (progress?.phase === "finalizing") {
      return t("settings.data.exportFinalizing", { elapsed });
    }

    if (progress?.phase === "serializing") {
      return t("settings.data.exportProgress", {
        completed: progress.completed,
        elapsed,
        total: progress.total,
      });
    }

    return t("settings.data.exportPreparing");
  }

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
    syncPolaroidColorNamesToggle(dom, settings);
    syncLocaleToggle(dom, settings);
    syncExportButtonState();
    syncImportUi();
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
  on(dom.polaroidColorNamesToggle, "change", () => {
    updateAppSettings({
      polaroidShowColorNames: Boolean(dom.polaroidColorNamesToggle?.checked),
    });
  });
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

    isExportInProgress = true;
    syncExportButtonState();
    syncImportUi();
    setExportStatus(t("settings.data.exportPreparing"));

    let latestExportProgress = {
      completed: 0,
      elapsedMs: 0,
      phase: "preparing",
      total: 0,
    };

    try {
      const json = await exportAllPalettes({
        onProgress: (progress) => {
          latestExportProgress = progress;
          syncExportButtonState(progress);
          setExportStatus(buildExportProgressMessage(progress));
        },
      });
      const blob = new Blob([json], { type: "application/json" });
      const filename = `paletcam-export-${new Date().toISOString().slice(0, 10)}.json`;
      const exportDoneTranslationKey =
        latestExportProgress.total === 1
          ? "settings.data.exportDoneStatus.one"
          : "settings.data.exportDoneStatus.other";
      const exportDoneMessage = t(exportDoneTranslationKey, {
        count: latestExportProgress.total,
        elapsed: formatElapsedDuration(latestExportProgress.elapsedMs),
      });

      if (typeof navigator.canShare === "function") {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            setExportStatus(exportDoneMessage);
            showToast(t("settings.toast.exportDone"), { duration: 1400 });
            return;
          } catch (shareError) {
            if (shareError instanceof Error && shareError.name === "AbortError") {
              setExportStatus("");
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
      setExportStatus(exportDoneMessage);
      showToast(t("settings.toast.exportDone"), { duration: 1400 });
    } catch (error) {
      console.error("Export failed:", error);
      setExportStatus(t("settings.data.exportFailedStatus"), { isError: true });
      showToast(t("settings.toast.exportFailed"), { duration: 2000 });
    } finally {
      isExportInProgress = false;
      syncExportButtonState();
      syncImportUi();
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

    isImportInProgress = true;
    syncImportUi();
    syncExportButtonState();
    setExportStatus(t("settings.data.importBusy"));
    try {
      const text = await file.text();
      const count = await importAllPalettes(text);
      const translationKey =
        count === 1 ? "settings.toast.imported.one" : "settings.toast.imported.other";
      setExportStatus(t(translationKey, { count }));
      showToast(t(translationKey, { count }), { duration: 2000 });
    } catch (error) {
      console.error("Import failed:", error);
      setExportStatus(t("settings.toast.importFailed"), { isError: true });
      showToast(t("settings.toast.importFailed"), { duration: 2500 });
    } finally {
      isImportInProgress = false;
      dom.importInput.value = "";
      syncImportUi();
      syncExportButtonState();
    }
  });

  on(dom.flushDataButton, "click", async () => {
    if (!dom.flushDataButton) {
      return;
    }

    const isConfirmed = globalThis.confirm?.(t("settings.data.flushConfirm")) ?? true;
    if (!isConfirmed) {
      return;
    }

    dom.flushDataButton.disabled = true;
    try {
      await flushAllLocalData();
      globalThis.location?.reload();
    } catch (error) {
      console.error("Flush data failed:", error);
      showToast(t("settings.toast.flushFailed"), {
        variant: "error",
        duration: 2500,
      });
      dom.flushDataButton.disabled = false;
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
