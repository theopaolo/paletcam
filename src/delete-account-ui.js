import {
  confirmAccountDeletion,
  sendAccountDeletionCode,
  subscribeCommunitySession,
} from "./community-service.js";
import { clientLog } from "./modules/client-log.js";
import { formatErrorDetails } from "./modules/error-format.js";
import { closeSharedPanel, openSharedPanel } from "./modules/panels/panel-manager.js";
import { showToast } from "./modules/toast-ui.js";
import { t } from "./i18n.js";

let isDeleteAccountBusy = false;

function getDeleteAccountErrorKey(error) {
  switch (error?.code) {
    case "AUTH_EXPIRED":
      return "delete.error.authExpired";
    case "MISSING_CODE":
      return "delete.error.missingCode";
    default:
      return "";
  }
}

function resolveDeleteAccountErrorMessage(error, fallbackMessage) {
  const apiPayloadMessage = error?.cause?.payload?.message;
  if (typeof apiPayloadMessage === "string" && apiPayloadMessage.trim()) {
    return apiPayloadMessage.trim();
  }

  const errorKey = getDeleteAccountErrorKey(error);
  if (errorKey) {
    return t(errorKey);
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function setDeleteAccountHintMessage(deleteAccountHint, message, { isError = false } = {}) {
  if (!deleteAccountHint) {
    return;
  }

  if (!message) {
    deleteAccountHint.hidden = true;
    deleteAccountHint.textContent = "";
    deleteAccountHint.classList.remove("is-error");
    return;
  }

  deleteAccountHint.hidden = false;
  deleteAccountHint.textContent = message;
  deleteAccountHint.classList.toggle("is-error", isError);
}

function setDeleteAccountVerifyStepVisible(refs, shouldShow) {
  if (refs.deleteAccountRequestStep) {
    refs.deleteAccountRequestStep.hidden = shouldShow;
  }

  if (refs.deleteAccountVerifyStep) {
    refs.deleteAccountVerifyStep.hidden = !shouldShow;
  }
}

function setDeleteAccountBusy(refs, nextBusy) {
  isDeleteAccountBusy = Boolean(nextBusy);

  if (refs.deleteAccountRequestCodeButton) {
    refs.deleteAccountRequestCodeButton.disabled = isDeleteAccountBusy;
  }

  if (refs.deleteAccountConfirmButton) {
    refs.deleteAccountConfirmButton.disabled = isDeleteAccountBusy;
  }
}

function resetDeleteAccountPanel(refs) {
  setDeleteAccountVerifyStepVisible(refs, false);
  setDeleteAccountHintMessage(refs.deleteAccountHint, "");

  if (refs.deleteAccountCodeInput) {
    refs.deleteAccountCodeInput.value = "";
  }
}

async function requestDeletionCode(refs) {
  if (isDeleteAccountBusy) {
    return;
  }

  setDeleteAccountBusy(refs, true);

  try {
    await sendAccountDeletionCode();
    setDeleteAccountVerifyStepVisible(refs, true);
    setDeleteAccountHintMessage(refs.deleteAccountHint, t("delete.hint.codeSent"));
    refs.deleteAccountCodeInput?.focus();
    showToast(t("delete.toast.codeSent"), { duration: 1400 });
  } catch (error) {
    clientLog("Failed to send account deletion code.", {
      message: error?.message,
      status: error?.status,
    });
    setDeleteAccountHintMessage(
      refs.deleteAccountHint,
      resolveDeleteAccountErrorMessage(error, t("delete.toast.codeSendFailed")),
      { isError: true },
    );
    showToast(t("delete.toast.codeSendFailed"), {
      variant: "error",
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setDeleteAccountBusy(refs, false);
  }
}

async function confirmDeletion(refs) {
  if (isDeleteAccountBusy) {
    return;
  }

  const code = refs.deleteAccountCodeInput?.value?.trim() || "";

  if (!code) {
    setDeleteAccountHintMessage(refs.deleteAccountHint, t("delete.hint.enterCode"), {
      isError: true,
    });
    return;
  }

  setDeleteAccountBusy(refs, true);

  try {
    await confirmAccountDeletion({ code });
    resetDeleteAccountPanel(refs);
    closeSharedPanel("delete-account");
    showToast(t("delete.toast.success"), { duration: 2000 });
  } catch (error) {
    clientLog("Failed to confirm account deletion.", {
      message: error?.message,
      status: error?.status,
    });
    setDeleteAccountHintMessage(
      refs.deleteAccountHint,
      resolveDeleteAccountErrorMessage(error, t("delete.toast.failure")),
      { isError: true },
    );
    showToast(t("delete.toast.failure"), {
      variant: "error",
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setDeleteAccountBusy(refs, false);
  }
}

function syncDeleteAccountButtonVisibility(refs, session) {
  if (!refs.communityDeleteAccountButton) {
    return;
  }

  refs.communityDeleteAccountButton.hidden = !session?.token;
}

export function initDeleteAccountUi() {
  const communityDeleteAccountButton = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("communityDeleteAccountButton")
  );
  const deleteAccountRequestStep = document.getElementById("deleteAccountRequestStep");
  const deleteAccountVerifyStep = document.getElementById("deleteAccountVerifyStep");
  const deleteAccountRequestCodeButton = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("deleteAccountRequestCodeButton")
  );
  const deleteAccountCodeInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("deleteAccountCodeInput")
  );
  const deleteAccountConfirmButton = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("deleteAccountConfirmButton")
  );
  const deleteAccountHint = document.getElementById("deleteAccountHint");

  const refs = {
    communityDeleteAccountButton,
    deleteAccountRequestStep,
    deleteAccountVerifyStep,
    deleteAccountRequestCodeButton,
    deleteAccountCodeInput,
    deleteAccountConfirmButton,
    deleteAccountHint,
  };

  communityDeleteAccountButton?.addEventListener("click", () => {
    resetDeleteAccountPanel(refs);
    openSharedPanel("delete-account");
  });

  deleteAccountRequestCodeButton?.addEventListener("click", () => {
    void requestDeletionCode(refs);
  });

  deleteAccountConfirmButton?.addEventListener("click", () => {
    void confirmDeletion(refs);
  });

  deleteAccountCodeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void confirmDeletion(refs);
  });

  subscribeCommunitySession((session) => syncDeleteAccountButtonVisibility(refs, session));
}
