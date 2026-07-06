import { getAppSettings, subscribeAppSettings, updateAppSettings } from "../../app-settings.js";
import { t } from "../../i18n.js";
import { exportAllPalettesBlob, importAllPalettes } from "../../palette-storage.js";
import { flushAllLocalData } from "../local-data-reset.js";
import { isIOSDevice } from "../platform.js";
import { showToast } from "../toast-ui.js";

const TAB_IDS = ["login", "language", "watermark", "data"];
const SETTINGS_TOGGLE_CLOSE_ICON_SRC = "icons/close.svg";

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
    versionButton: /** @type {HTMLButtonElement | null} */ (
      root.querySelector(".panel-form-version")
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

function getAvailableTabIds(dom) {
  const tabIds = dom.tabButtons
    .map((button) => button.getAttribute("data-settings-tab"))
    .filter((tabId) => TAB_IDS.includes(tabId));

  return tabIds.length > 0 ? tabIds : TAB_IDS;
}

function getNextTabId(currentTabId, direction, tabIds = TAB_IDS) {
  const currentIndex = tabIds.indexOf(currentTabId);
  if (currentIndex < 0) {
    return tabIds[0];
  }

  const nextIndex = (currentIndex + direction + tabIds.length) % tabIds.length;
  return tabIds[nextIndex];
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

function buildExportFilename({ exportedAt = new Date(), paletteCount = 0 } = {}) {
  const timestamp = exportedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:]/g, "-");
  const count = Math.max(0, Number(paletteCount) || 0);
  const imageLabel = count === 1 ? "1-image" : `${count}-images`;

  return `colorcatches-${timestamp}-${imageLabel}.json`;
}

function isEventInsideElement(event, element) {
  if (!element) {
    return false;
  }

  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (eventPath.includes(element)) {
    return true;
  }

  return Boolean(
    event.target && typeof element.contains === "function" && element.contains(event.target),
  );
}

export function mountSettingsPanel({ root, toggleButton }) {
  const dom = getSettingsDom(root);
  const availableTabIds = getAvailableTabIds(dom);
  const toggleButtonIcon = /** @type {HTMLImageElement | null} */ (
    toggleButton?.querySelector("img") ?? null
  );
  const toggleButtonOpenIconSrc = toggleButtonIcon?.getAttribute("src") || "icons/menu.svg";
  const toggleButtonOpenLabelKey =
    toggleButton?.getAttribute("data-i18n-aria-label") || "header.settingsOpen";
  const cleanups = [];
  let activeTabId = availableTabIds[0] ?? TAB_IDS[0];
  let isDrawerOpen = false;
  let isExportInProgress = false;
  let isImportInProgress = false;
  let versionClickCount = 0;

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

    if (progress?.phase === "saving") {
      return t("settings.data.exportSaving", { elapsed });
    }

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

    if (progress?.phase === "preparing" && progress?.total > 0) {
      return t("settings.data.exportPreparingProgress", {
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

  function syncSettingsToggleButton() {
    if (!toggleButton) {
      return;
    }

    toggleButton.classList.toggle("is-active", isDrawerOpen);
    toggleButton.setAttribute("aria-expanded", String(isDrawerOpen));
    toggleButton.setAttribute(
      "aria-label",
      t(isDrawerOpen ? "settings.panelClose" : toggleButtonOpenLabelKey),
    );

    if (toggleButtonIcon) {
      const nextIconSrc = isDrawerOpen ? SETTINGS_TOGGLE_CLOSE_ICON_SRC : toggleButtonOpenIconSrc;
      if (toggleButtonIcon.getAttribute("src") !== nextIconSrc) {
        toggleButtonIcon.setAttribute("src", nextIconSrc);
      }
    }
  }

  function syncDrawerState() {
    if (dom.drawer) {
      dom.drawer.hidden = !isDrawerOpen;
      dom.drawer.setAttribute("aria-hidden", String(!isDrawerOpen));
    }

    syncSettingsToggleButton();

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
    activeTabId = availableTabIds.includes(nextTabId) ? nextTabId : availableTabIds[0];

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
    syncSettingsToggleButton();
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
        setActiveTab(getNextTabId(currentTabId, -1, availableTabIds), { focusButton: true });
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveTab(getNextTabId(currentTabId, 1, availableTabIds), { focusButton: true });
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveTab(availableTabIds[0], { focusButton: true });
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveTab(availableTabIds[availableTabIds.length - 1], { focusButton: true });
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

  on(document, "pointerdown", (event) => {
    if (
      !isDrawerOpen ||
      isEventInsideElement(event, root) ||
      isEventInsideElement(event, toggleButton)
    ) {
      return;
    }

    setDrawerOpen(false);
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
      const blob = await exportAllPalettesBlob({
        onProgress: (progress) => {
          latestExportProgress = progress;
          syncExportButtonState(progress);
          setExportStatus(buildExportProgressMessage(progress));
        },
      });
      latestExportProgress = {
        ...latestExportProgress,
        phase: "saving",
      };
      setExportStatus(buildExportProgressMessage(latestExportProgress));
      const filename = buildExportFilename({
        paletteCount: latestExportProgress.total,
      });
      const exportDoneTranslationKey =
        latestExportProgress.total === 1
          ? "settings.data.exportDoneStatus.one"
          : "settings.data.exportDoneStatus.other";
      const exportDoneMessage = t(exportDoneTranslationKey, {
        count: latestExportProgress.total,
        elapsed: formatElapsedDuration(latestExportProgress.elapsedMs),
      });

      const isIOS = isIOSDevice();
      const shareMimeCandidates = isIOS ? ["application/json", "text/plain"] : ["application/json"];
      const reportExportSuccess = () => {
        setExportStatus(exportDoneMessage);
        showToast(t("settings.toast.exportDone"), { duration: 1400 });
      };
      const canShareFile = (file) => {
        if (typeof navigator.canShare !== "function") {
          return true;
        }
        try {
          return navigator.canShare({ files: [file] });
        } catch {
          return false;
        }
      };

      if (typeof navigator.share === "function") {
        for (const mimeType of shareMimeCandidates) {
          const file = new File([blob], filename, { type: mimeType });
          if (!canShareFile(file)) {
            continue;
          }

          try {
            await navigator.share({ files: [file], title: filename });
            reportExportSuccess();
            return;
          } catch (shareError) {
            if (shareError instanceof Error && shareError.name === "AbortError") {
              setExportStatus("");
              return;
            }
            console.warn("Palette export share failed", { mimeType, shareError });
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const revokeUrlLater = () => {
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60000);
      };

      if (isIOS) {
        window.open(url, "_blank");
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
      }
      revokeUrlLater();
      reportExportSuccess();
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

  on(dom.versionButton, "click", () => {
    versionClickCount += 1;
    if (versionClickCount >= 4) {
      versionClickCount = 0;
      document.dispatchEvent(new CustomEvent("toggle-performance-hud"));
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
