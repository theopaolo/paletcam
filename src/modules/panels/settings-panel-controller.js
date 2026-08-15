import { getAppSettings, subscribeAppSettings, updateAppSettings } from "../../app-settings.js";
import { t } from "../../i18n.js";
import { exportAllPalettesBlob, importAllPalettes } from "../../palette-storage.js";
import {
  PaletteBackupSizeLimitError,
  PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES,
} from "../../palette-storage/json-transfer.js";
import {
  BACKUP_TRANSFER_CATEGORIES,
  classifyBackupTransferError,
} from "../../palette-storage/backup-transfer-errors.js";
import { flushAllLocalData } from "../local-data-reset.js";
import {
  beginCriticalOperation,
  tryBeginExclusiveCriticalOperation,
} from "../critical-operation.js";
import { isIOSDevice } from "../platform.js";
import { inspectStorageHealth } from "../storage-health.js";
import { recordOperationalMetric } from "../operational-metrics.js";
import { showToast } from "../toast-ui.js";
import { createSettingsBackupOperationCoordinator } from "./settings-backup-operation.js";

const TAB_IDS = ["login", "language", "watermark", "data"];
const SETTINGS_TOGGLE_CLOSE_ICON_SRC = "icons/close.svg";

const EXPORT_FAILURE_PRESENTATIONS = Object.freeze({
  [BACKUP_TRANSFER_CATEGORIES.database]: [
    "settings.data.exportStorageStatus",
    "settings.toast.exportStorage",
    3500,
  ],
  [BACKUP_TRANSFER_CATEGORIES.fileHandoff]: [
    "settings.data.exportHandoffStatus",
    "settings.toast.exportHandoff",
    3500,
  ],
  [BACKUP_TRANSFER_CATEGORIES.integrity]: [
    "settings.data.exportIntegrityStatus",
    "settings.toast.exportIntegrity",
    3500,
  ],
  [BACKUP_TRANSFER_CATEGORIES.quota]: [
    "settings.data.exportStorageStatus",
    "settings.toast.exportStorage",
    3500,
  ],
  [BACKUP_TRANSFER_CATEGORIES.serialization]: [
    "settings.data.exportSerializationStatus",
    "settings.toast.exportSerialization",
    3500,
  ],
  [BACKUP_TRANSFER_CATEGORIES.sizeLimit]: [
    "settings.data.exportTooLargeStatus",
    "settings.toast.exportTooLarge",
    3500,
  ],
});

const IMPORT_FAILURE_PRESENTATIONS = Object.freeze({
  [BACKUP_TRANSFER_CATEGORIES.conflict]: ["settings.toast.importConflict", 3500],
  [BACKUP_TRANSFER_CATEGORIES.database]: ["settings.toast.importStorage", 4000],
  [BACKUP_TRANSFER_CATEGORIES.integrity]: ["settings.toast.importInvalid", 3500],
  [BACKUP_TRANSFER_CATEGORIES.interrupted]: ["settings.toast.importInterrupted", 4000],
  [BACKUP_TRANSFER_CATEGORIES.invalidFile]: ["settings.toast.importInvalid", 3500],
  [BACKUP_TRANSFER_CATEGORIES.quota]: ["settings.toast.importStorageFull", 4000],
  [BACKUP_TRANSFER_CATEGORIES.sizeLimit]: ["settings.toast.importTooLarge", 3500],
});

function getElapsedOperationMs(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

function recordBackupTransfer(direction, outcome, startedAtMs, category) {
  recordOperationalMetric("backup-transfer", {
    category,
    direction,
    durationMs: getElapsedOperationMs(startedAtMs),
    outcome,
  });
}

async function runReloadSensitiveOperation(name, operation) {
  const releaseCriticalOperation = beginCriticalOperation(name);
  try {
    return await operation();
  } finally {
    releaseCriticalOperation();
  }
}

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
    localeToggle: /** @type {HTMLElement | null} */ (queryById(root, "settingsLocaleToggle")),
    exportButton: /** @type {HTMLButtonElement | null} */ (queryById(root, "settingsExportButton")),
    exportStatus: /** @type {HTMLParagraphElement | null} */ (
      queryById(root, "settingsDataStatus")
    ),
    flushDataButton: /** @type {HTMLButtonElement | null} */ (
      queryById(root, "settingsFlushDataButton")
    ),
    storageStatus: /** @type {HTMLParagraphElement | null} */ (
      queryById(root, "settingsStorageStatus")
    ),
    storageHint: /** @type {HTMLParagraphElement | null} */ (
      queryById(root, "settingsStorageHint")
    ),
    lastBackupStatus: /** @type {HTMLParagraphElement | null} */ (
      queryById(root, "settingsLastBackupStatus")
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

function formatLastBackupDate(isoString, locale) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function syncLastBackupStatus(dom, settings) {
  if (!dom.lastBackupStatus) {
    return;
  }

  dom.lastBackupStatus.textContent = settings.lastBackupAt
    ? t("settings.data.lastBackup", {
        date: formatLastBackupDate(settings.lastBackupAt, settings.locale),
      })
    : t("settings.data.lastBackupNever");
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

export function mountSettingsPanel({ root, toggleButton, backupOperations = null }) {
  const ownsBackupOperations = backupOperations === null;
  const backupOperationCoordinator = backupOperations ?? createSettingsBackupOperationCoordinator();
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
  let backupOperationSnapshot = backupOperationCoordinator.getSnapshot();
  let previousBackupOperationToken = null;
  let isMounted = true;
  let versionClickCount = 0;
  const locallyOwnedBackupOperationTokens = new Set();

  function setExportStatus(message, { isError = false } = {}) {
    if (!isMounted || !dom.exportStatus) {
      return;
    }

    dom.exportStatus.textContent = message || "";
    dom.exportStatus.hidden = !message;
    dom.exportStatus.classList.toggle("is-error", isError);
  }

  function syncExportButtonState(progress = null) {
    if (!isMounted || !dom.exportButton) {
      return;
    }

    const isExportInProgress = backupOperationSnapshot.kind === "export";
    const isImportInProgress = backupOperationSnapshot.kind === "import";
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
    if (!isMounted) {
      return;
    }

    const isExportInProgress = backupOperationSnapshot.kind === "export";
    const isImportInProgress = backupOperationSnapshot.kind === "import";
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
    syncLocaleToggle(dom, settings);
    syncLastBackupStatus(dom, settings);
    syncExportButtonState();
    syncImportUi();
    syncSettingsToggleButton();
  }

  const unsubscribeBackupOperations = backupOperationCoordinator.subscribe((snapshot) => {
    const completedOperationToken = snapshot.token === null ? previousBackupOperationToken : null;
    backupOperationSnapshot = snapshot;
    syncExportButtonState(snapshot.progress);
    syncImportUi();

    if (snapshot.kind === "export") {
      setExportStatus(buildExportProgressMessage(snapshot.progress));
    } else if (snapshot.kind === "import") {
      setExportStatus(t("settings.data.importBusy"));
    } else if (
      completedOperationToken &&
      !locallyOwnedBackupOperationTokens.has(completedOperationToken)
    ) {
      setExportStatus("");
    }

    previousBackupOperationToken = snapshot.token;
  });

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
  on(dom.localeToggle, "click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-locale]") : null;
    if (!btn) {
      return;
    }

    const locale = btn.getAttribute("data-locale");
    if (locale === "fr" || locale === "en") {
      updateAppSettings({ locale });
    }
  });

  on(dom.exportButton, "click", async () => {
    if (!dom.exportButton) {
      return;
    }

    const backupOperation = backupOperationCoordinator.begin("export");
    if (!backupOperation) {
      return;
    }
    locallyOwnedBackupOperationTokens.add(backupOperation.token);
    const transferStartedAtMs = Date.now();
    /** @type {"transfer" | "file-handoff"} */
    let exportPhase = "transfer";
    let outcomeRecorded = false;
    const recordExportOutcome = (outcome, category) => {
      if (outcomeRecorded) {
        return;
      }
      outcomeRecorded = true;
      recordBackupTransfer("export", outcome, transferStartedAtMs, category);
    };

    let latestExportProgress = {
      completed: 0,
      elapsedMs: 0,
      phase: "preparing",
      total: 0,
    };

    try {
      await runReloadSensitiveOperation("backup-export", async () => {
        const blob = await exportAllPalettesBlob({
          onProgress: (progress) => {
            latestExportProgress = progress;
            backupOperation.setProgress(progress);
          },
        });
        if (!backupOperation.isActive()) {
          return;
        }
        latestExportProgress = {
          ...latestExportProgress,
          phase: "saving",
        };
        backupOperation.setProgress(latestExportProgress);
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

        exportPhase = "file-handoff";
        const isIOS = isIOSDevice();
        const shareMimeCandidates = isIOS
          ? ["application/json", "text/plain"]
          : ["application/json"];
        const reportExportSuccess = () => {
          recordExportOutcome("success");
          updateAppSettings({ lastBackupAt: new Date().toISOString() });
          if (!isMounted) {
            return;
          }
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
                recordExportOutcome("cancelled", BACKUP_TRANSFER_CATEGORIES.cancelled);
                setExportStatus("");
                return;
              }
              console.warn("Palette export share failed", { mimeType, shareError });
            }
          }
        }

        const url = backupOperation.createObjectUrl(blob);
        if (!url) {
          throw new Error("The browser could not create the backup file download.");
        }

        if (isIOS) {
          const exportWindow = window.open(url, "_blank");
          if (!exportWindow) {
            throw new Error("The browser blocked the backup download window.");
          }
        } else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
        }
        reportExportSuccess();
      });
    } catch (error) {
      console.error("Export failed:", error);
      const category = classifyBackupTransferError(error, {
        operation: "export",
        phase: exportPhase,
      });
      recordExportOutcome(
        category === BACKUP_TRANSFER_CATEGORIES.cancelled ? "cancelled" : "failure",
        category,
      );
      if (!backupOperation.isActive()) {
        return;
      }
      if (category === BACKUP_TRANSFER_CATEGORIES.cancelled) {
        setExportStatus("");
        return;
      }
      const [statusKey, toastKey, duration] = EXPORT_FAILURE_PRESENTATIONS[category] ?? [
        "settings.data.exportFailedStatus",
        "settings.toast.exportFailed",
        2500,
      ];
      setExportStatus(t(statusKey), { isError: true });
      if (isMounted) {
        showToast(t(toastKey), { duration });
      }
    } finally {
      backupOperation.finish();
      locallyOwnedBackupOperationTokens.delete(backupOperation.token);
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

    const backupOperation = backupOperationCoordinator.begin("import");
    if (!backupOperation) {
      dom.importInput.value = "";
      return;
    }
    locallyOwnedBackupOperationTokens.add(backupOperation.token);
    const transferStartedAtMs = Date.now();
    try {
      if (!Number.isSafeInteger(file.size) || file.size > PALETTE_IMPORT_MAX_STREAMING_JSON_BYTES) {
        throw new PaletteBackupSizeLimitError("Palette backup exceeds the import size limit.");
      }
      const count = await runReloadSensitiveOperation("backup-import", () =>
        importAllPalettes(file),
      );
      recordBackupTransfer("import", "success", transferStartedAtMs);
      if (!backupOperation.isActive()) {
        return;
      }
      const translationKey =
        count === 1 ? "settings.toast.imported.one" : "settings.toast.imported.other";
      setExportStatus(t(translationKey, { count }));
      if (isMounted) {
        showToast(t(translationKey, { count }), { duration: 2000 });
      }
    } catch (error) {
      console.error("Import failed:", error);
      const category = classifyBackupTransferError(error, { operation: "import" });
      recordBackupTransfer(
        "import",
        category === BACKUP_TRANSFER_CATEGORIES.cancelled ? "cancelled" : "failure",
        transferStartedAtMs,
        category,
      );
      if (!backupOperation.isActive()) {
        return;
      }
      if (category === BACKUP_TRANSFER_CATEGORIES.cancelled) {
        setExportStatus("");
        return;
      }
      const [messageKey, duration] = IMPORT_FAILURE_PRESENTATIONS[category] ?? [
        "settings.toast.importFailed",
        3000,
      ];
      setExportStatus(t(messageKey), { isError: true });
      if (isMounted) {
        showToast(t(messageKey), { duration });
      }
    } finally {
      if (isMounted) {
        dom.importInput.value = "";
      }
      backupOperation.finish();
      locallyOwnedBackupOperationTokens.delete(backupOperation.token);
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

    const releaseExclusiveOperation = tryBeginExclusiveCriticalOperation("local-data-flush");
    if (!releaseExclusiveOperation) {
      showToast(t("settings.toast.flushBusy"), {
        variant: "error",
        duration: 2500,
      });
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
    } finally {
      releaseExclusiveOperation();
    }
  });

  on(dom.versionButton, "click", () => {
    versionClickCount += 1;
    if (versionClickCount >= 4) {
      versionClickCount = 0;
      document.dispatchEvent(new CustomEvent("toggle-performance-hud"));
    }
  });

  async function refreshStorageProtectionStatus() {
    if (!dom.storageStatus) {
      return;
    }

    const health = await inspectStorageHealth();
    if (!isMounted) {
      return;
    }

    const isProtected = health.persisted === true;
    dom.storageStatus.textContent = t(
      isProtected ? "settings.data.storageProtected" : "settings.data.storageBestEffort",
    );
    dom.storageStatus.classList.toggle("is-protected", isProtected);
    dom.storageStatus.hidden = false;
    if (dom.storageHint) {
      dom.storageHint.hidden = isProtected;
    }
  }

  setActiveTab(activeTabId);
  syncDrawerState();
  renderSettingsUi(getAppSettings());
  void refreshStorageProtectionStatus();
  const unsubscribe = subscribeAppSettings(renderSettingsUi);

  return () => {
    isMounted = false;
    unsubscribeBackupOperations();
    if (ownsBackupOperations) {
      backupOperationCoordinator.destroy();
    }
    unsubscribe();
    cleanups.forEach((cleanup) => {
      cleanup();
    });
  };
}
