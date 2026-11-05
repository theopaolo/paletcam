import {
  clearBackupCredentials,
  formatBackupRecoveryCode,
  getBackupCredentials,
  parseBackupRecoveryCode,
  subscribeBackupCredentials,
} from "./backup-credentials.js";
import { pairBackupAccount } from "./backup-api.js";
import {
  connectBackupAccount,
  getBackupStatusSnapshot,
  removeBackupAccount,
  requestBackupFlush,
  subscribeBackupStatus,
} from "./backup-service.js";
import { t } from "./i18n.js";
import { showToast } from "./modules/toast-ui.js";

const ERROR_MESSAGE_KEYS = Object.freeze({
  unauthorized: "settings.backup.errorUnauthorized",
  network: "settings.backup.errorNetwork",
  quota_exceeded: "settings.backup.errorQuota",
  rate_limited: "settings.backup.errorRateLimited",
  pairing_disabled: "settings.backup.errorPairingDisabled",
});

function getBackupErrorMessage(errorCode) {
  return t(ERROR_MESSAGE_KEYS[errorCode] ?? "settings.backup.errorGeneric");
}

/** Known codes get their own message, others the action's failure line plus the code. */
function getBackupActionErrorMessage(error, failedKey) {
  const errorCode = typeof error?.code === "string" ? error.code : "unknown";
  return ERROR_MESSAGE_KEYS[errorCode]
    ? getBackupErrorMessage(errorCode)
    : `${t(failedKey)} (${errorCode})`;
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
  const createRow = root.querySelector("#settingsBackupCreateRow");
  const createButton = /** @type {HTMLButtonElement | null} */ (
    root.querySelector("#settingsBackupCreateButton")
  );
  const newCodeBlock = root.querySelector("#settingsBackupNewCode");
  const newCodeValue = root.querySelector("#settingsBackupNewCodeValue");
  const actionsRow = root.querySelector("#settingsBackupActions");
  const backupNowButton = root.querySelector("#settingsBackupNowButton");
  const copyCodeButton = root.querySelector("#settingsBackupCopyCodeButton");
  const disconnectButton = root.querySelector("#settingsBackupDisconnectButton");
  const deleteAccountButton = /** @type {HTMLButtonElement | null} */ (
    root.querySelector("#settingsBackupDeleteAccountButton")
  );

  let isConnecting = false;
  let isCreating = false;
  let isDeletingAccount = false;
  // The code of an account created in this session. It stays on screen until
  // the backup is disconnected or deleted, so the user has time to save it.
  /** @type {string | null} */
  let createdRecoveryCode = null;

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
      if (paired && status.pullProgress) {
        const { phase, fetched, total } = status.pullProgress;
        progressLine.textContent = t(
          phase === "preparing"
            ? "settings.backup.restorePreparing"
            : "settings.backup.restoreProgress",
          { fetched, total },
        );
        progressLine.hidden = false;
      } else if (paired && status.errorCode) {
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

    if (newCodeBlock instanceof HTMLElement) {
      newCodeBlock.hidden = createdRecoveryCode === null;
    }
    if (newCodeValue) {
      newCodeValue.textContent = createdRecoveryCode ?? "";
    }
    if (createRow instanceof HTMLElement) {
      createRow.hidden = paired;
    }
    if (createButton) {
      createButton.disabled = isCreating || isConnecting;
      createButton.textContent = isCreating
        ? t("settings.backup.createBusy")
        : t("settings.backup.create");
    }
    if (connectField instanceof HTMLElement) {
      connectField.hidden = paired;
    }
    if (actionsRow instanceof HTMLElement) {
      actionsRow.hidden = !paired;
    }
    if (connectButton) {
      connectButton.disabled = isConnecting || isCreating;
      connectButton.textContent = isConnecting
        ? t("settings.backup.connectBusy")
        : t("settings.backup.connect");
    }
    if (backupNowButton instanceof HTMLButtonElement) {
      backupNowButton.disabled = status.phase === "flushing";
    }
    if (deleteAccountButton) {
      deleteAccountButton.disabled = status.phase === "flushing" || isDeletingAccount;
      deleteAccountButton.classList.toggle("is-busy", isDeletingAccount);
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

  /**
   * The code is on screen before the connect step runs. If that step fails,
   * the account exists but is not connected, and the code in the input lets
   * the user retry with Connect instead of minting another account.
   */
  async function handleCreate() {
    if (isCreating || isConnecting) {
      return;
    }

    isCreating = true;
    render();
    try {
      const credentials = await pairBackupAccount();
      createdRecoveryCode = formatBackupRecoveryCode(credentials);
      render();
      try {
        await connectBackupAccount(credentials);
      } catch (error) {
        if (codeInput) {
          codeInput.value = createdRecoveryCode;
        }
        throw error;
      }
      showToast(t("settings.backup.created"), { duration: 2500 });
    } catch (error) {
      const message =
        error?.code === "rate_limited"
          ? t("settings.backup.errorPairRateLimited")
          : getBackupActionErrorMessage(error, "settings.backup.createFailed");
      showToast(message, { variant: "error", duration: 4000 });
    } finally {
      isCreating = false;
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
    createdRecoveryCode = null;
    clearBackupCredentials();
    render();
  }

  const handleBackupNow = () => void requestBackupFlush({ immediate: true });

  async function handleDeleteAccount() {
    if (isDeletingAccount) {
      return;
    }
    const isConfirmed = globalThis.confirm?.(t("settings.backup.deleteAccountConfirm")) ?? true;
    if (!isConfirmed) {
      return;
    }

    isDeletingAccount = true;
    render();
    try {
      await removeBackupAccount();
      createdRecoveryCode = null;
      showToast(t("settings.backup.accountDeleted"), { duration: 2500 });
    } catch (error) {
      showToast(getBackupActionErrorMessage(error, "settings.backup.deleteAccountFailed"), {
        variant: "error",
        duration: 4000,
      });
    } finally {
      isDeletingAccount = false;
      render();
    }
  }

  createButton?.addEventListener("click", handleCreate);
  connectButton?.addEventListener("click", handleConnect);
  backupNowButton?.addEventListener("click", handleBackupNow);
  copyCodeButton?.addEventListener("click", handleCopyCode);
  disconnectButton?.addEventListener("click", handleDisconnect);
  deleteAccountButton?.addEventListener("click", handleDeleteAccount);
  const unsubscribeStatus = subscribeBackupStatus(render);
  const unsubscribeCredentials = subscribeBackupCredentials(render);
  render();

  return () => {
    createButton?.removeEventListener("click", handleCreate);
    connectButton?.removeEventListener("click", handleConnect);
    backupNowButton?.removeEventListener("click", handleBackupNow);
    copyCodeButton?.removeEventListener("click", handleCopyCode);
    disconnectButton?.removeEventListener("click", handleDisconnect);
    deleteAccountButton?.removeEventListener("click", handleDeleteAccount);
    unsubscribeStatus();
    unsubscribeCredentials();
  };
}
