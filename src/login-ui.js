import {
  getCurrentCommunitySession,
  logoutCommunity,
  sendCommunityLoginOtp,
  subscribeCommunitySession,
  verifyCommunityLoginOtp,
} from "./community-service.js";
import { buildCommunityUrl } from "./config.js";
import { subscribeLocaleChange, t } from "./i18n.js";
import { clientLog } from "./modules/client-log.js";
import { formatErrorDetails } from "./modules/error-format.js";
import { showToast } from "./modules/toast-ui.js";

let pendingCommunityEmail = "";
let isCommunityAuthBusy = false;

function getCommunityAuthErrorKey(error) {
  switch (error?.code) {
    case "AUTH_EXPIRED":
      return "login.error.authExpired";
    case "MISSING_EMAIL":
      return "login.error.missingEmail";
    case "MISSING_CODE":
      return "login.error.missingCode";
    case "EMAIL_TOO_LONG":
      return "login.error.emailTooLong";
    case "CODE_TOO_LONG":
      return "login.error.codeTooLong";
    case "SESSION_CHANGED":
      return "login.error.sessionChanged";
    default:
      return "";
  }
}

function resolveCommunityAuthErrorMessage(error, fallbackMessage) {
  const apiPayloadMessage = error?.cause?.payload?.message;
  if (typeof apiPayloadMessage === "string" && apiPayloadMessage.trim()) {
    return apiPayloadMessage.trim();
  }

  const errorKey = getCommunityAuthErrorKey(error);
  if (errorKey) {
    return t(errorKey);
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function setCommunityAuthHintMessage(communityAuthHint, message, { isError = false } = {}) {
  if (!communityAuthHint) {
    return;
  }

  if (!message) {
    communityAuthHint.hidden = true;
    communityAuthHint.textContent = "";
    communityAuthHint.classList.remove("is-error");
    return;
  }

  communityAuthHint.hidden = false;
  communityAuthHint.textContent = message;
  communityAuthHint.classList.toggle("is-error", isError);
}

function setCommunityCodeFieldVisible(communityCodeField, shouldShow) {
  if (!communityCodeField) {
    return;
  }

  communityCodeField.hidden = !shouldShow;
}

function setCommunityAuthBusy(refs, nextBusy) {
  isCommunityAuthBusy = Boolean(nextBusy);

  if (refs.communityRequestCodeButton) {
    refs.communityRequestCodeButton.disabled = isCommunityAuthBusy;
  }

  if (refs.communityVerifyCodeButton) {
    refs.communityVerifyCodeButton.disabled = isCommunityAuthBusy;
  }

  if (refs.communityLogoutButton) {
    refs.communityLogoutButton.disabled = isCommunityAuthBusy;
  }
}

function syncCommunitySessionUi(refs, session = getCurrentCommunitySession()) {
  if (!refs.communityAccountState) {
    return;
  }

  const isConnected = Boolean(session?.token);
  const sessionEmail = session?.email || session?.user?.email || "";

  if (isConnected) {
    pendingCommunityEmail = "";
    if (refs.communityEmailInput && sessionEmail) {
      refs.communityEmailInput.value = sessionEmail;
    }
    if (refs.communityCodeInput) {
      refs.communityCodeInput.value = "";
    }
    setCommunityCodeFieldVisible(refs.communityCodeField, false);
    setCommunityAuthHintMessage(refs.communityAuthHint, "");
    refs.communityAccountState.textContent = sessionEmail
      ? t("login.status.connectedWithEmail", { email: sessionEmail })
      : t("login.status.connected");
    refs.communityAccountState.classList.add("is-connected");
  } else {
    refs.communityAccountState.textContent = t("login.status.disconnected");
    refs.communityAccountState.classList.remove("is-connected");
  }

  if (refs.communityEmailField) {
    refs.communityEmailField.hidden = isConnected;
  }

  if (refs.communityLogoutButton) {
    refs.communityLogoutButton.hidden = !isConnected;
  }

  if (refs.communityMyCatchesLink) {
    refs.communityMyCatchesLink.hidden = !isConnected;
  }

  if (refs.communityDeleteAccountButton) {
    refs.communityDeleteAccountButton.hidden = !isConnected;
  }
}

async function requestCommunityCode(refs) {
  if (isCommunityAuthBusy) {
    return;
  }

  const rawEmail = refs.communityEmailInput?.value?.trim() || pendingCommunityEmail;
  if (!rawEmail) {
    setCommunityAuthHintMessage(refs.communityAuthHint, t("login.hint.enterEmail"), {
      isError: true,
    });
    return;
  }

  setCommunityAuthBusy(refs, true);

  try {
    pendingCommunityEmail = await sendCommunityLoginOtp(rawEmail, { signal: refs.requestSignal });
    if (refs.communityEmailInput) {
      refs.communityEmailInput.value = pendingCommunityEmail;
    }

    setCommunityCodeFieldVisible(refs.communityCodeField, true);
    setCommunityAuthHintMessage(refs.communityAuthHint, "");
    refs.communityCodeInput?.focus();
    showToast(t("login.toast.codeSent"), {
      duration: 1400,
    });
  } catch (error) {
    if (error?.code === "REQUEST_CANCELLED") return;
    clientLog("Failed to send login code.", {
      failureCode: error?.code,
      errorName: error?.name ?? "Error",
      status: error?.status,
    });
    setCommunityAuthHintMessage(
      refs.communityAuthHint,
      resolveCommunityAuthErrorMessage(error, t("login.toast.codeSendFailed")),
      { isError: true },
    );
    showToast(t("login.toast.codeSendFailed"), {
      variant: "error",
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setCommunityAuthBusy(refs, false);
  }
}

async function verifyCommunityCode(refs) {
  if (isCommunityAuthBusy) {
    return;
  }

  const rawEmail = refs.communityEmailInput?.value?.trim() || pendingCommunityEmail;
  const code = refs.communityCodeInput?.value?.trim() || "";

  if (!rawEmail) {
    setCommunityAuthHintMessage(refs.communityAuthHint, t("login.hint.enterEmailBeforeCode"), {
      isError: true,
    });
    return;
  }

  if (!code) {
    setCommunityAuthHintMessage(refs.communityAuthHint, t("login.hint.enterCode"), {
      isError: true,
    });
    return;
  }

  setCommunityAuthBusy(refs, true);

  try {
    await verifyCommunityLoginOtp({
      email: rawEmail,
      code,
      signal: refs.requestSignal,
    });
    if (refs.communityCodeInput) {
      refs.communityCodeInput.value = "";
    }
    setCommunityAuthHintMessage(refs.communityAuthHint, t("login.hint.success"));
    showToast(t("login.toast.connected"), {
      duration: 1400,
    });
    syncCommunitySessionUi(refs);
  } catch (error) {
    if (error?.code === "REQUEST_CANCELLED") return;
    clientLog("Failed to verify login code.", {
      failureCode: error?.code,
      errorName: error?.name ?? "Error",
      status: error?.status,
    });
    setCommunityAuthHintMessage(
      refs.communityAuthHint,
      resolveCommunityAuthErrorMessage(error, t("login.toast.invalidCode")),
      { isError: true },
    );
    showToast(t("login.toast.invalidCode"), {
      variant: "error",
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setCommunityAuthBusy(refs, false);
  }
}

function disconnectCommunityAccount(refs) {
  const durableLogoutComplete = logoutCommunity();
  pendingCommunityEmail = "";
  if (refs.communityCodeInput) {
    refs.communityCodeInput.value = "";
  }
  setCommunityCodeFieldVisible(refs.communityCodeField, false);
  setCommunityAuthHintMessage(
    refs.communityAuthHint,
    t(durableLogoutComplete ? "login.hint.loggedOut" : "login.hint.logoutStorageFailed"),
    { isError: !durableLogoutComplete },
  );
  showToast(t(durableLogoutComplete ? "login.toast.loggedOut" : "login.toast.logoutFailed"), {
    variant: durableLogoutComplete ? "default" : "error",
    duration: durableLogoutComplete ? 1400 : 3000,
  });
  syncCommunitySessionUi(refs);
}

export function openLoginPanel() {
  document.dispatchEvent(new CustomEvent("open-settings-panel", { detail: { tab: "login" } }));
}

/** @param {Document | DocumentFragment | Element} [root] */
export function initLoginUi(root = globalThis.document) {
  const lifecycleController = new AbortController();
  const queryById = (id) => root?.querySelector?.(`#${id}`) ?? null;
  const communityAccountState = queryById("communityAccountState");
  const communityEmailField = queryById("communityEmailField");
  const communityEmailInput = /** @type {HTMLInputElement | null} */ (
    queryById("communityEmailInput")
  );
  const communityRequestCodeButton = /** @type {HTMLButtonElement | null} */ (
    queryById("communityRequestCodeButton")
  );
  const communityAuthHint = queryById("communityAuthHint");
  const communityCodeField = queryById("communityCodeField");
  const communityCodeInput = /** @type {HTMLInputElement | null} */ (
    queryById("communityCodeInput")
  );
  const communityVerifyCodeButton = /** @type {HTMLButtonElement | null} */ (
    queryById("communityVerifyCodeButton")
  );
  const communityLogoutButton = /** @type {HTMLButtonElement | null} */ (
    queryById("communityLogoutButton")
  );
  const communityMyCatchesLink = /** @type {HTMLAnchorElement | null} */ (
    queryById("communityMyCatchesLink")
  );
  const communityDeleteAccountButton = /** @type {HTMLButtonElement | null} */ (
    queryById("communityDeleteAccountButton")
  );

  if (communityMyCatchesLink) communityMyCatchesLink.href = buildCommunityUrl("/my/catches");

  const refs = {
    communityAccountState,
    communityEmailField,
    communityEmailInput,
    communityRequestCodeButton,
    communityAuthHint,
    communityCodeField,
    communityCodeInput,
    communityVerifyCodeButton,
    communityLogoutButton,
    communityMyCatchesLink,
    communityDeleteAccountButton,
    requestSignal: lifecycleController.signal,
  };

  const unsubscribeLocale = subscribeLocaleChange(() => {
    syncCommunitySessionUi(refs);
  });

  if (
    !communityEmailInput ||
    !communityRequestCodeButton ||
    !communityCodeInput ||
    !communityVerifyCodeButton
  ) {
    lifecycleController.abort();
    unsubscribeLocale();
    return () => {};
  }

  communityRequestCodeButton.addEventListener(
    "click",
    () => {
      void requestCommunityCode(refs);
    },
    { signal: lifecycleController.signal },
  );

  communityVerifyCodeButton.addEventListener(
    "click",
    () => {
      void verifyCommunityCode(refs);
    },
    { signal: lifecycleController.signal },
  );

  communityLogoutButton?.addEventListener(
    "click",
    () => {
      disconnectCommunityAccount(refs);
    },
    { signal: lifecycleController.signal },
  );

  communityEmailInput.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void requestCommunityCode(refs);
    },
    { signal: lifecycleController.signal },
  );

  communityCodeInput.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void verifyCommunityCode(refs);
    },
    { signal: lifecycleController.signal },
  );

  const unsubscribeSession = subscribeCommunitySession((session) =>
    syncCommunitySessionUi(refs, session),
  );
  syncCommunitySessionUi(refs);

  return () => {
    lifecycleController.abort();
    unsubscribeLocale();
    unsubscribeSession();
  };
}
