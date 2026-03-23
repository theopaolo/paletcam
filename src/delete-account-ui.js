import {
  confirmAccountDeletion,
  sendAccountDeletionCode,
  subscribeCommunitySession,
} from './community-service.js';
import { clientLog } from './modules/client-log.js';
import { formatErrorDetails } from './modules/error-format.js';
import {
  closeSharedPanel,
  openSharedPanel,
} from './modules/panels/panel-manager.js';
import { showToast } from './modules/toast-ui.js';

const communityDeleteAccountButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('communityDeleteAccountButton'));
const deleteAccountRequestStep = document.getElementById('deleteAccountRequestStep');
const deleteAccountVerifyStep = document.getElementById('deleteAccountVerifyStep');
const deleteAccountRequestCodeButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('deleteAccountRequestCodeButton'));
const deleteAccountCodeInput = /** @type {HTMLInputElement | null} */ (document.getElementById('deleteAccountCodeInput'));
const deleteAccountConfirmButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('deleteAccountConfirmButton'));
const deleteAccountHint = document.getElementById('deleteAccountHint');

let isDeleteAccountBusy = false;

function resolveDeleteAccountErrorMessage(error, fallbackMessage) {
  const apiPayloadMessage = error?.cause?.payload?.message;
  if (typeof apiPayloadMessage === 'string' && apiPayloadMessage.trim()) {
    return apiPayloadMessage.trim();
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function setDeleteAccountHintMessage(message, { isError = false } = {}) {
  if (!deleteAccountHint) {
    return;
  }

  if (!message) {
    deleteAccountHint.hidden = true;
    deleteAccountHint.textContent = '';
    deleteAccountHint.classList.remove('is-error');
    return;
  }

  deleteAccountHint.hidden = false;
  deleteAccountHint.textContent = message;
  deleteAccountHint.classList.toggle('is-error', isError);
}

function setDeleteAccountVerifyStepVisible(shouldShow) {
  if (deleteAccountRequestStep) {
    deleteAccountRequestStep.hidden = shouldShow;
  }

  if (deleteAccountVerifyStep) {
    deleteAccountVerifyStep.hidden = !shouldShow;
  }
}

function setDeleteAccountBusy(nextBusy) {
  isDeleteAccountBusy = Boolean(nextBusy);

  if (deleteAccountRequestCodeButton) {
    deleteAccountRequestCodeButton.disabled = isDeleteAccountBusy;
  }

  if (deleteAccountConfirmButton) {
    deleteAccountConfirmButton.disabled = isDeleteAccountBusy;
  }
}

function resetDeleteAccountPanel() {
  setDeleteAccountVerifyStepVisible(false);
  setDeleteAccountHintMessage('');

  if (deleteAccountCodeInput) {
    deleteAccountCodeInput.value = '';
  }
}

async function requestDeletionCode() {
  if (isDeleteAccountBusy) {
    return;
  }

  setDeleteAccountBusy(true);

  try {
    await sendAccountDeletionCode();
    setDeleteAccountVerifyStepVisible(true);
    setDeleteAccountHintMessage('Tu devrais recevoir un code par email, saisis-le dans ce champ.');
    deleteAccountCodeInput?.focus();
    showToast('Code de suppression envoyé.', { duration: 1400 });
  } catch (error) {
    clientLog('Failed to send account deletion code.', {
      message: error?.message,
      status: error?.status,
    });
    setDeleteAccountHintMessage(
      resolveDeleteAccountErrorMessage(error, 'Impossible d\'envoyer le code.'),
      { isError: true },
    );
    showToast('Envoi du code échoué.', {
      variant: 'error',
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setDeleteAccountBusy(false);
  }
}

async function confirmDeletion() {
  if (isDeleteAccountBusy) {
    return;
  }

  const code = deleteAccountCodeInput?.value?.trim() || '';

  if (!code) {
    setDeleteAccountHintMessage('Entre le code reçu par email.', { isError: true });
    return;
  }

  setDeleteAccountBusy(true);

  try {
    await confirmAccountDeletion({ code });
    resetDeleteAccountPanel();
    closeSharedPanel('delete-account');
    showToast('Compte supprimé.', { duration: 2000 });
  } catch (error) {
    clientLog('Failed to confirm account deletion.', {
      message: error?.message,
      status: error?.status,
    });
    setDeleteAccountHintMessage(
      resolveDeleteAccountErrorMessage(error, 'Code invalide ou expiré.'),
      { isError: true },
    );
    showToast('Suppression échouée.', {
      variant: 'error',
      duration: 3000,
      details: formatErrorDetails(error),
    });
  } finally {
    setDeleteAccountBusy(false);
  }
}

function syncDeleteAccountButtonVisibility(session) {
  if (!communityDeleteAccountButton) {
    return;
  }

  communityDeleteAccountButton.hidden = !session?.token;
}

function bindDeleteAccountPanelEvents() {
  communityDeleteAccountButton?.addEventListener('click', () => {
    resetDeleteAccountPanel();
    openSharedPanel('delete-account');
  });

  deleteAccountRequestCodeButton?.addEventListener('click', () => {
    void requestDeletionCode();
  });

  deleteAccountConfirmButton?.addEventListener('click', () => {
    void confirmDeletion();
  });

  deleteAccountCodeInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    void confirmDeletion();
  });

  subscribeCommunitySession(syncDeleteAccountButtonVisibility);
}

bindDeleteAccountPanelEvents();
