import {
  getCurrentCommunitySession,
  logoutCommunity,
  sendCommunityLoginOtp,
  subscribeCommunitySession,
  verifyCommunityLoginOtp,
} from './community-service.js';
import { closePaletteViewerOverlay } from './modules/collection/palette-card.js';
import { clientLog } from './modules/client-log.js';
import { formatErrorDetails } from './modules/error-format.js';
import { showToast } from './modules/toast-ui.js';

const loginPanel = /** @type {HTMLElement | null} */ (document.querySelector('.login-panel'));
const openLoginButton = document.querySelector('.btn-open-login');
const closeLoginButton = document.querySelector('.btn-close-login');
const LOGIN_PANEL_HIDE_DELAY_MS = 380;
let loginPanelHideTimeoutId = 0;
let hasBoundLoginPanelEvents = false;

const communityAccountState = document.getElementById('communityAccountState');
const communityEmailField = document.getElementById('communityEmailField');
const communityEmailInput = /** @type {HTMLInputElement | null} */ (document.getElementById('communityEmailInput'));
const communityRequestCodeButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('communityRequestCodeButton'));
const communityAuthHint = document.getElementById('communityAuthHint');
const communityCodeField = document.getElementById('communityCodeField');
const communityCodeInput = /** @type {HTMLInputElement | null} */ (document.getElementById('communityCodeInput'));
const communityVerifyCodeButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('communityVerifyCodeButton'));
const communityLogoutButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('communityLogoutButton'));
let pendingCommunityEmail = '';
let isCommunityAuthBusy = false;

function resolveCommunityAuthErrorMessage(error, fallbackMessage) {
  const apiPayloadMessage = error?.cause?.payload?.message;
  if (typeof apiPayloadMessage === 'string' && apiPayloadMessage.trim()) {
    return apiPayloadMessage.trim();
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function setCommunityAuthHintMessage(message, { isError = false } = {}) {
  if (!communityAuthHint) {
    return;
  }

  if (!message) {
    communityAuthHint.hidden = true;
    communityAuthHint.textContent = '';
    communityAuthHint.classList.remove('is-error');
    return;
  }

  communityAuthHint.hidden = false;
  communityAuthHint.textContent = message;
  communityAuthHint.classList.toggle('is-error', isError);
}

function setCommunityCodeFieldVisible(shouldShow) {
  if (!communityCodeField) {
    return;
  }

  communityCodeField.hidden = !shouldShow;
}

function setCommunityAuthBusy(nextBusy) {
  isCommunityAuthBusy = Boolean(nextBusy);

  if (communityRequestCodeButton) {
    communityRequestCodeButton.disabled = isCommunityAuthBusy;
  }

  if (communityVerifyCodeButton) {
    communityVerifyCodeButton.disabled = isCommunityAuthBusy;
  }

  if (communityLogoutButton) {
    communityLogoutButton.disabled = isCommunityAuthBusy;
  }
}

function syncCommunitySessionUi(session = getCurrentCommunitySession()) {
  if (!communityAccountState) {
    return;
  }

  const isConnected = Boolean(session?.token);
  const sessionEmail = session?.email || session?.user?.email || '';

  if (isConnected) {
    pendingCommunityEmail = '';
    if (communityEmailInput && sessionEmail) {
      communityEmailInput.value = sessionEmail;
    }
    if (communityCodeInput) {
      communityCodeInput.value = '';
    }
    setCommunityCodeFieldVisible(false);
    setCommunityAuthHintMessage('');
    communityAccountState.textContent = sessionEmail
      ? `Connecté en tant que ${sessionEmail}`
      : 'Connecté';
    communityAccountState.classList.add('is-connected');
  } else {
    communityAccountState.textContent = 'Non connecté au compte de publication.';
    communityAccountState.classList.remove('is-connected');
  }

  if (communityEmailField) {
    communityEmailField.hidden = isConnected;
  }

  if (communityLogoutButton) {
    communityLogoutButton.hidden = !isConnected;
  }
}

async function requestCommunityCode() {
  if (isCommunityAuthBusy) {
    return;
  }

  const rawEmail = communityEmailInput?.value?.trim() || pendingCommunityEmail;
  if (!rawEmail) {
    setCommunityAuthHintMessage('Entre ton email pour recevoir un code.', {
      isError: true,
    });
    return;
  }

  setCommunityAuthBusy(true);

  try {
    pendingCommunityEmail = await sendCommunityLoginOtp(rawEmail);
    if (communityEmailInput) {
      communityEmailInput.value = pendingCommunityEmail;
    }

    setCommunityCodeFieldVisible(true);
    setCommunityAuthHintMessage(
      'Tu devrais recevoir un code de connexion par email, saisis-le dans ce champ.',
    );
    communityCodeInput?.focus();
    showToast('Code envoye par email.', {
      duration: 1400,
    });
  } catch (error) {
    clientLog("Failed to send login code.", {
      code: error?.code,
      message: error?.message,
      status: error?.status,
    });
    setCommunityAuthHintMessage(
      resolveCommunityAuthErrorMessage(error, 'Impossible d\'envoyer le code.'),
      { isError: true },
    );
    showToast('Envoi du code échoué.', {
      variant: 'error',
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setCommunityAuthBusy(false);
  }
}

async function verifyCommunityCode() {
  if (isCommunityAuthBusy) {
    return;
  }

  const rawEmail = communityEmailInput?.value?.trim() || pendingCommunityEmail;
  const code = communityCodeInput?.value?.trim() || '';

  if (!rawEmail) {
    setCommunityAuthHintMessage('Entre ton email avant de valider le code.', {
      isError: true,
    });
    return;
  }

  if (!code) {
    setCommunityAuthHintMessage('Entre le code reçu par email.', {
      isError: true,
    });
    return;
  }

  setCommunityAuthBusy(true);

  try {
    await verifyCommunityLoginOtp({
      email: rawEmail,
      code,
    });
    if (communityCodeInput) {
      communityCodeInput.value = '';
    }
    setCommunityAuthHintMessage('Connexion réussie.');
    showToast('Compte connecté.', {
      duration: 1400,
    });
    syncCommunitySessionUi();
  } catch (error) {
    clientLog("Failed to verify login code.", {
      code: error?.code,
      message: error?.message,
      status: error?.status,
    });
    setCommunityAuthHintMessage(
      resolveCommunityAuthErrorMessage(error, 'Vérification du code échouée.'),
      { isError: true },
    );
    showToast('Code invalide ou expiré.', {
      variant: 'error',
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setCommunityAuthBusy(false);
  }
}

function disconnectCommunityAccount() {
  logoutCommunity();
  pendingCommunityEmail = '';
  if (communityCodeInput) {
    communityCodeInput.value = '';
  }
  setCommunityCodeFieldVisible(false);
  setCommunityAuthHintMessage('Compte déconnecté.');
  showToast('Compte déconnecté.', {
    duration: 1400,
  });
  syncCommunitySessionUi();
}

function clearLoginPanelHideTimeout() {
  if (!loginPanelHideTimeoutId) {
    return;
  }

  window.clearTimeout(loginPanelHideTimeoutId);
  loginPanelHideTimeoutId = 0;
}

function finalizeLoginPanelHidden() {
  if (!loginPanel || loginPanel.classList.contains('visible')) {
    return;
  }

  loginPanel.hidden = true;
}

function scheduleLoginPanelHide() {
  clearLoginPanelHideTimeout();
  loginPanelHideTimeoutId = window.setTimeout(() => {
    loginPanelHideTimeoutId = 0;
    finalizeLoginPanelHidden();
  }, LOGIN_PANEL_HIDE_DELAY_MS);
}

export function openLoginPanel() {
  if (!loginPanel) {
    return;
  }

  clearLoginPanelHideTimeout();
  closePaletteViewerOverlay();
  document.querySelector('.collection-panel')?.classList.remove('visible');
  document.querySelector('.settings-panel')?.classList.remove('visible');
  loginPanel.hidden = false;
  loginPanel.setAttribute('aria-hidden', 'false');
  void loginPanel.offsetWidth;
  loginPanel.classList.add('visible');
}

function closeLoginPanel() {
  if (!loginPanel) {
    return;
  }

  loginPanel.classList.remove('visible');
  loginPanel.setAttribute('aria-hidden', 'true');
  loginPanel.scrollTop = 0;
  scheduleLoginPanelHide();
}

function bindLoginPanelEvents() {
  if (!loginPanel || hasBoundLoginPanelEvents) {
    return;
  }
  hasBoundLoginPanelEvents = true;

  loginPanel.hidden = true;
  loginPanel.setAttribute('aria-hidden', 'true');
  loginPanel.classList.remove('visible');

  openLoginButton?.addEventListener('click', openLoginPanel);
  closeLoginButton?.addEventListener('click', closeLoginPanel);

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest('.btn-open-login')) {
      openLoginPanel();
      return;
    }

    if (event.target.closest('.btn-close-login')) {
      closeLoginPanel();
    }
  });

  loginPanel.addEventListener('transitionend', (/** @type {TransitionEvent} */ event) => {
    if (event.target !== loginPanel || event.propertyName !== 'right') {
      return;
    }

    finalizeLoginPanelHidden();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !loginPanel.classList.contains('visible')) {
      return;
    }

    closeLoginPanel();
  });
}

function bindCommunityAuthControls() {
  if (
    !communityEmailInput ||
    !communityRequestCodeButton ||
    !communityCodeInput ||
    !communityVerifyCodeButton
  ) {
    return;
  }

  communityRequestCodeButton.addEventListener('click', () => {
    void requestCommunityCode();
  });

  communityVerifyCodeButton.addEventListener('click', () => {
    void verifyCommunityCode();
  });

  communityLogoutButton?.addEventListener('click', () => {
    disconnectCommunityAccount();
  });

  communityEmailInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    void requestCommunityCode();
  });

  communityCodeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    void verifyCommunityCode();
  });

  subscribeCommunitySession(syncCommunitySessionUi);
  syncCommunitySessionUi();
}

bindLoginPanelEvents();
bindCommunityAuthControls();
