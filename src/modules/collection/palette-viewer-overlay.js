import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosed,
  subscribeSharedPanelClosing,
} from '../panels/panel-manager.js';
import { getRalQualityLabel } from '../color-matching-ral.js';

const viewerImage = /** @type {HTMLImageElement | null} */ (document.getElementById('catchDetailsImage'));
const viewerStatus = document.getElementById('catchDetailsStatus');
const shareButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('catchDetailsShareButton'));
const exportButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('catchDetailsExportButton'));
const publishButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('catchDetailsPublishButton'));
const deleteButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('catchDetailsDeleteButton'));
const viewerRalSwatch = document.getElementById('catchDetailsRalSwatch');
const viewerRalSwatchColor = document.getElementById('catchDetailsRalSwatchColor');
const viewerRalSwatchCode = document.getElementById('catchDetailsRalSwatchCode');
const viewerRalSwatchName = document.getElementById('catchDetailsRalSwatchName');
const viewerRalSwatchQuality = document.getElementById('catchDetailsRalSwatchQuality');
let activeRequestId = 0;
let activeSession;
let hasBoundViewerPanelEvents = false;
let isBusy = false;

const PUBLISH_BUTTON_COPY = Object.freeze({
  publish: {
    label: 'Publier la palette',
    iconName: 'publish',
    visibleLabel: 'publier',
  },
  unpublish: {
    label: 'Dépublier la palette',
    iconName: 'unpublish',
    visibleLabel: 'dépublier',
  },
});

function getActionIconMarkup(iconName) {
  if (iconName === 'export') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM90.34,114.34a8,8,0,0,1,11.32,0L120,132.69V72a8,8,0,0,1,16,0v60.69l18.34-18.35a8,8,0,0,1,11.32,11.32l-32,32a8,8,0,0,1-11.32,0l-32-32A8,8,0,0,1,90.34,114.34ZM208,208H48V168H76.69L96,187.32A15.89,15.89,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z"></path>
      </svg>
    `;
  }

  if (iconName === 'share') {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#000000" viewBox="0 0 256 256"><path d="M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z"></path></svg>
    `;
  }

  if (iconName === 'publish') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM90.34,98.34l32-32a8,8,0,0,1,11.32,0l32,32a8,8,0,0,1-11.32,11.32L136,91.31V152a8,8,0,0,1-16,0V91.31l-18.34,18.35A8,8,0,0,1,90.34,98.34ZM208,208H48V168H76.69L96,187.31A15.86,15.86,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z"></path>
      </svg>
    `;
  }

  if (iconName === 'unpublish') {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M216,40H40A16,16,0,0,0,24,56V208a8,8,0,0,0,11.58,7.15L64,200.94l28.42,14.21a8,8,0,0,0,7.16,0L128,200.94l28.42,14.21a8,8,0,0,0,7.16,0L192,200.94l28.42,14.21A8,8,0,0,0,232,208V56A16,16,0,0,0,216,40Zm-58.34,98.34a8,8,0,0,1-11.32,11.32L128,131.31l-18.34,18.35a8,8,0,0,1-11.32-11.32L116.69,120,98.34,101.66a8,8,0,0,1,11.32-11.32L128,108.69l18.34-18.35a8,8,0,0,1,11.32,11.32L139.31,120Z"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"></path>
    </svg>
  `;
}

function hydrateViewerActionButton(button, { label, iconName, visibleLabel }) {
  if (!button) {
    return;
  }

  button.setAttribute('aria-label', label);
  button.innerHTML = `
    ${getActionIconMarkup(iconName)}
    <span class="palette-quick-action-label">${visibleLabel}</span>
  `;
}

function syncPublishButtonCopy() {
  const publishAction = activeSession?.publishAction === 'unpublish'
    ? 'unpublish'
    : 'publish';

  hydrateViewerActionButton(publishButton, PUBLISH_BUTTON_COPY[publishAction]);
}

function resetViewerFrame() {
  if (viewerImage) {
    viewerImage.hidden = true;
    viewerImage.removeAttribute('src');
  }

  if (viewerStatus) {
    viewerStatus.textContent = '';
  }

  if (viewerRalSwatch) {
    viewerRalSwatch.hidden = true;
  }
}

function setBusy(nextBusy) {
  isBusy = nextBusy;

  if (shareButton) {
    shareButton.disabled = nextBusy || !activeSession?.canShare;
  }

  if (exportButton) {
    exportButton.disabled = nextBusy || !activeSession?.canExport;
  }

  if (publishButton) {
    publishButton.disabled = nextBusy || !activeSession?.canPublish;
  }

  if (deleteButton) {
    deleteButton.disabled = nextBusy || !activeSession?.canDelete;
  }
}

async function runAction(actionName) {
  if (isBusy || !activeSession) {
    return;
  }

  const action = activeSession[actionName];
  if (typeof action !== 'function') {
    return;
  }

  setBusy(true);
  try {
    await action();
  } finally {
    if (activeSession) {
      setBusy(false);
    }
  }
}

function handleViewerPanelClosing() {
  activeRequestId += 1;
  activeSession = undefined;
  setBusy(false);
}

function handleViewerPanelClosed() {
  resetViewerFrame();
}

function bindViewerPanelEvents() {
  if (hasBoundViewerPanelEvents) {
    return;
  }

  hasBoundViewerPanelEvents = true;
  hydrateViewerActionButton(shareButton, {
    label: 'Partager la palette',
    iconName: 'share',
    visibleLabel: 'partager',
  });
  hydrateViewerActionButton(exportButton, {
    label: 'Exporter la palette',
    iconName: 'export',
    visibleLabel: 'télécharger',
  });
  syncPublishButtonCopy();
  hydrateViewerActionButton(deleteButton, {
    label: 'Supprimer la palette',
    iconName: 'delete',
    visibleLabel: 'supprimer',
  });
  shareButton?.addEventListener('click', () => {
    void runAction('onShare');
  });
  exportButton?.addEventListener('click', () => {
    void runAction('onExport');
  });
  publishButton?.addEventListener('click', () => {
    void runAction('onPublish');
  });
  deleteButton?.addEventListener('click', () => {
    void runAction('onDelete');
  });
  subscribeSharedPanelClosing('catch-details', handleViewerPanelClosing);
  subscribeSharedPanelClosed('catch-details', handleViewerPanelClosed);
}

/** @param {PaletteViewerOpenOptions} options */
export async function openPaletteViewerOverlay({
  colors = [],
  captureMode,
  ralMatch,
  getPreviewAsset,
  onShare,
  onExport,
  onPublish,
  publishAction = 'publish',
  onDelete,
  canShare = true,
  canExport = true,
  canPublish = true,
  canDelete = true,
}) {
  bindViewerPanelEvents();
  activeRequestId += 1;
  const requestId = activeRequestId;

  activeSession = {
    onShare,
    onExport,
    onPublish,
    publishAction,
    onDelete,
    canShare,
    canExport,
    canPublish,
    canDelete,
  };
  syncPublishButtonCopy();

  resetViewerFrame();

  const isRalCapture = captureMode === 'ral' && ralMatch;
  if (viewerRalSwatch) {
    viewerRalSwatch.hidden = !isRalCapture;
  }

  if (isRalCapture && ralMatch) {
    if (viewerRalSwatchColor) {
      viewerRalSwatchColor.style.backgroundColor = `rgb(${ralMatch.r}, ${ralMatch.g}, ${ralMatch.b})`;
    }
    if (viewerRalSwatchCode) viewerRalSwatchCode.textContent = ralMatch.code;
    if (viewerRalSwatchName) viewerRalSwatchName.textContent = ralMatch.name;
    if (viewerRalSwatchQuality) {
      viewerRalSwatchQuality.textContent = `${getRalQualityLabel(ralMatch.deltaE)} · ΔE ${ralMatch.deltaE.toFixed(1)}`;
    }
  }

  if (viewerStatus) {
    viewerStatus.textContent = canExport ? 'Chargement...' : 'Aperçu indisponible';
  }
  setBusy(false);
  openSharedPanel('catch-details', { closeOtherPanels: false });

  if (!canExport || typeof getPreviewAsset !== 'function') {
    return;
  }

  try {
    const asset = await getPreviewAsset();
    if (requestId !== activeRequestId || !activeSession) {
      return;
    }

    if (viewerImage) {
      viewerImage.src = asset.objectUrl;
      viewerImage.hidden = false;
    }
    if (viewerStatus) {
      viewerStatus.textContent = '';
    }
  } catch (error) {
    if (requestId !== activeRequestId || !activeSession) {
      return;
    }

    if (viewerStatus) {
      viewerStatus.textContent = 'Aperçu indisponible';
    }
    console.error('Failed to load palette viewer preview:', error);
  }
}

export function closePaletteViewerOverlay() {
  closeSharedPanel('catch-details');
}

export function subscribePaletteViewerOverlayClose(listener) {
  return subscribeSharedPanelClosing('catch-details', listener);
}
