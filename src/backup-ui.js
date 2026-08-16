import {
  clearBackupCredentials,
  formatBackupRecoveryCode,
  getBackupCredentials,
  parseBackupRecoveryCode,
  subscribeBackupCredentials,
} from "./backup-credentials.js";
import {
  connectBackupAccount,
  getBackupStatusSnapshot,
  requestBackupFlush,
  subscribeBackupStatus,
} from "./backup-service.js";
import { t } from "./i18n.js";
import { showToast } from "./modules/toast-ui.js";

const ERROR_MESSAGE_KEYS = Object.freeze({
  unauthorized: "settings.backup.errorUnauthorized",
  network: "settings.backup.errorNetwork",
  quota_exceeded: "settings.backup.errorQuota",
});

function getBackupErrorMessage(errorCode) {
  return t(ERROR_MESSAGE_KEYS[errorCode] ?? "settings.backup.errorGeneric");
}

/** @param {ParentNode} root */
export function initBackupUi(root) {
  const statusLine = /** @type {HTMLElement | null} */ (
    root.querySelector("#settingsBackupStatus")
  );
  const progressLine = /** @type {HTMLElement | null} */ (
    root.querySelector("#settingsBackupProgress")
  );
  const connectField = root.querySelector("#settingsBackupConnectField");
  const codeInput = /** @type {HTMLInputElement | null} */ (
    root.querySelector("#settingsBackupCodeInput")
  );
  const connectButton = /** @type {HTMLButtonElement | null} */ (
    root.querySelector("#settingsBackupConnectButton")
  );
  const actionsRow = root.querySelector("#settingsBackupActions");
  const backupNowButton = root.querySelector("#settingsBackupNowButton");
  const copyCodeButton = root.querySelector("#settingsBackupCopyCodeButton");
  const disconnectButton = root.querySelector("#settingsBackupDisconnectButton");

  let isConnecting = false;

  function render() {
    const credentials = getBackupCredentials();
    const status = getBackupStatusSnapshot();
    const paired = credentials !== null;

    if (statusLine) {
      statusLine.textContent = !paired
        ? t("settings.backup.statusOff")
        : status.phase === "flushing"
          ? t("settings.backup.statusBusy")
          : t("settings.backup.statusOn");
      statusLine.classList.toggle("is-protected", paired && !status.errorCode);
    }

    if (progressLine) {
      if (paired && status.errorCode) {
        progressLine.textContent = getBackupErrorMessage(status.errorCode);
        progressLine.hidden = false;
      } else if (paired && status.progress) {
        progressLine.textContent = t("settings.backup.progress", {
          backedUp: status.progress.backedUp,
          total: status.progress.total,
        });
        progressLine.hidden = false;
      } else {
        progressLine.hidden = true;
      }
    }

    if (connectField instanceof HTMLElement) {
      connectField.hidden = paired;
    }
    if (actionsRow instanceof HTMLElement) {
      actionsRow.hidden = !paired;
    }
    if (connectButton) {
      connectButton.disabled = isConnecting;
      connectButton.textContent = isConnecting
        ? t("settings.backup.connectBusy")
        : t("settings.backup.connect");
    }
    if (backupNowButton instanceof HTMLButtonElement) {
      backupNowButton.disabled = status.phase === "flushing";
    }
  }

  async function handleConnect() {
    if (isConnecting) {
      return;
    }

    const credentials = parseBackupRecoveryCode(codeInput?.value ?? "");
    if (!credentials) {
      showToast(t("settings.backup.invalidCode"), { variant: "error", duration: 2500 });
      return;
    }

    isConnecting = true;
    render();
    try {
      await connectBackupAccount(credentials);
      if (codeInput) {
        codeInput.value = "";
      }
      showToast(t("settings.backup.connected"), { duration: 2000 });
    } catch (error) {
      const errorCode = typeof error?.code === "string" ? error.code : "unknown";
      showToast(getBackupErrorMessage(errorCode), { variant: "error", duration: 3000 });
    } finally {
      isConnecting = false;
      render();
    }
  }

  async function handleCopyCode() {
    const credentials = getBackupCredentials();
    if (!credentials) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatBackupRecoveryCode(credentials));
      showToast(t("settings.backup.codeCopied"), { duration: 2500 });
    } catch {
      showToast(t("settings.backup.copyFailed"), { variant: "error", duration: 2500 });
    }
  }

  function handleDisconnect() {
    const isConfirmed = globalThis.confirm?.(t("settings.backup.disconnectConfirm")) ?? true;
    if (!isConfirmed) {
      return;
    }
    clearBackupCredentials();
    render();
  }

  const handleBackupNow = () => void requestBackupFlush({ immediate: true });

  connectButton?.addEventListener("click", handleConnect);
  backupNowButton?.addEventListener("click", handleBackupNow);
  copyCodeButton?.addEventListener("click", handleCopyCode);
  disconnectButton?.addEventListener("click", handleDisconnect);
  const unsubscribeStatus = subscribeBackupStatus(render);
  const unsubscribeCredentials = subscribeBackupCredentials(render);
  render();

  return () => {
    connectButton?.removeEventListener("click", handleConnect);
    backupNowButton?.removeEventListener("click", handleBackupNow);
    copyCodeButton?.removeEventListener("click", handleCopyCode);
    disconnectButton?.removeEventListener("click", handleDisconnect);
    unsubscribeStatus();
    unsubscribeCredentials();
  };
}
