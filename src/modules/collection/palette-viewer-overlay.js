import { getAppSettings, subscribeAppSettings } from "../../app-settings.js";
import { findClosestRAL, getRalQualityLabel } from "../color-matching-ral.js";
import { loadImageElementSource } from "../image-element-loader.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosed,
  subscribeSharedPanelClosing,
} from "../panels/panel-manager.js";
import { computeRalPopoverPosition } from "./ral-popover-position.js";

const PRELOAD_BACKWARD_DISTANCE = 1;
const PRELOAD_FORWARD_DISTANCE = 3;

const viewerTrack = document.getElementById("catchDetailsTrack");
const shareButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsShareButton")
);
const exportButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsExportButton")
);
const publishButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsPublishButton")
);
const cameraButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsCameraButton")
);
const deleteButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsDeleteButton")
);
const ralPopover = document.getElementById("ralPopover");
const ralPopoverColor = document.getElementById("ralPopoverColor");
const ralPopoverCode = document.getElementById("ralPopoverCode");
const ralPopoverName = document.getElementById("ralPopoverName");
const ralPopoverQuality = document.getElementById("ralPopoverQuality");
const swatchStripContainer = document.getElementById("catchDetailsSwatchStrip");

let activeRequestId = 0;
let activeSession;
let hasBoundViewerPanelEvents = false;
let isBusy = false;
let pendingTrackAlignmentRaf = 0;
let pendingTrackScrollRaf = 0;

const PUBLISH_BUTTON_COPY = Object.freeze({
  publish: {
    label: "Publier la palette",
    iconName: "publish",
    visibleLabel: "publier",
  },
  unpublish: {
    label: "Dépublier la palette",
    iconName: "unpublish",
    visibleLabel: "dépublier",
  },
});

function getActionIconMarkup(iconName) {
  if (iconName === "export") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM90.34,114.34a8,8,0,0,1,11.32,0L120,132.69V72a8,8,0,0,1,16,0v60.69l18.34-18.35a8,8,0,0,1,11.32,11.32l-32,32a8,8,0,0,1-11.32,0l-32-32A8,8,0,0,1,90.34,114.34ZM208,208H48V168H76.69L96,187.32A15.89,15.89,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z"></path>
      </svg>
    `;
  }

  if (iconName === "share") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#000000" viewBox="0 0 256 256"><path d="M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z"></path></svg>
    `;
  }

  if (iconName === "publish") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM90.34,98.34l32-32a8,8,0,0,1,11.32,0l32,32a8,8,0,0,1-11.32,11.32L136,91.31V152a8,8,0,0,1-16,0V91.31l-18.34,18.35A8,8,0,0,1,90.34,98.34ZM208,208H48V168H76.69L96,187.31A15.86,15.86,0,0,0,107.31,192h41.38A15.86,15.86,0,0,0,160,187.31L179.31,168H208v40Z"></path>
      </svg>
    `;
  }

  if (iconName === "unpublish") {
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

  button.setAttribute("aria-label", label);
  button.innerHTML = `
    ${getActionIconMarkup(iconName)}
    <span class="palette-quick-action-label">${visibleLabel}</span>
  `;
}

function clampIndex(index, length) {
  if (!Number.isFinite(index) || length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(Math.round(index), length - 1));
}

function getActivePalette() {
  if (!activeSession || activeSession.palettes.length === 0) {
    return null;
  }

  return activeSession.palettes[activeSession.activeIndex] ?? null;
}

function getPublishAction(palette = getActivePalette()) {
  if (!palette) {
    return "publish";
  }

  return activeSession?.getPublishAction?.(palette) === "unpublish" ? "unpublish" : "publish";
}

function canPalettePreview(palette) {
  if (!palette || typeof activeSession?.getPreviewAsset !== "function") {
    return false;
  }

  return true;
}

function isRalCapture(palette = getActivePalette()) {
  return palette?.captureMode === "ral";
}

function getCapability(capabilityName, palette = getActivePalette()) {
  if (!palette) {
    return false;
  }

  const capability = activeSession?.[capabilityName];
  return typeof capability === "function" ? Boolean(capability(palette)) : true;
}

function clearPendingTrackAlignment() {
  if (!pendingTrackAlignmentRaf) {
    return;
  }

  window.cancelAnimationFrame(pendingTrackAlignmentRaf);
  pendingTrackAlignmentRaf = 0;
}

function clearPendingTrackScroll() {
  if (!pendingTrackScrollRaf) {
    return;
  }

  window.cancelAnimationFrame(pendingTrackScrollRaf);
  pendingTrackScrollRaf = 0;
}

function hideRalPopover() {
  if (ralPopover) {
    ralPopover.hidden = true;
    ralPopover.style.visibility = "";
  }
}

function clearViewerSwatches() {
  if (swatchStripContainer) {
    swatchStripContainer.innerHTML = "";
    swatchStripContainer.hidden = true;
  }
}

function createViewerSwatch() {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "palette-viewer-swatch";
  return swatch;
}

function showRalPopover(color, anchorElement) {
  const matches = findClosestRAL(color.r, color.g, color.b, 1);
  if (matches.length === 0 || !ralPopover) {
    return;
  }

  const best = matches[0];

  if (ralPopoverColor) {
    ralPopoverColor.style.backgroundColor = `rgb(${best.ral.r}, ${best.ral.g}, ${best.ral.b})`;
  }
  if (ralPopoverCode) {
    ralPopoverCode.textContent = best.ral.code;
  }
  if (ralPopoverName) {
    ralPopoverName.textContent = best.ral.name;
  }
  if (ralPopoverQuality) {
    ralPopoverQuality.textContent = `${getRalQualityLabel(best.deltaE)}`;
  }

  ralPopover.hidden = false;
  ralPopover.style.visibility = "hidden";

  const anchorRect = anchorElement.getBoundingClientRect();
  const popoverRect = ralPopover.getBoundingClientRect();
  const { left, top } = computeRalPopoverPosition(anchorRect, popoverRect, window.innerWidth);

  ralPopover.style.left = `${left}px`;
  ralPopover.style.top = `${top}px`;
  ralPopover.style.visibility = "";
}

function renderViewerSwatches(colors) {
  if (!swatchStripContainer) {
    return;
  }

  swatchStripContainer.innerHTML = "";
  swatchStripContainer.hidden = false;

  colors.forEach((color) => {
    const swatch = createViewerSwatch();
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.setAttribute("aria-label", "Voir correspondance RAL");
    swatch.addEventListener("click", (event) => {
      event.stopPropagation();
      showRalPopover(color, swatch);
    });
    swatchStripContainer.appendChild(swatch);
  });
}

function renderViewerPlaceholderSwatch() {
  if (!swatchStripContainer) {
    return;
  }

  swatchStripContainer.innerHTML = "";
  swatchStripContainer.hidden = false;

  const swatch = createViewerSwatch();
  swatch.classList.add("is-placeholder");
  swatch.disabled = true;
  swatch.tabIndex = -1;
  swatch.setAttribute("aria-hidden", "true");
  swatchStripContainer.appendChild(swatch);
}

function shouldShowViewerSwatches(palette) {
  if (!Array.isArray(palette?.colors) || palette.colors.length === 0) {
    return false;
  }

  return getAppSettings().captureMode === "ral" || palette.captureMode === "ral";
}

function renderActivePaletteSupplementaryUi() {
  const palette = getActivePalette();
  hideRalPopover();
  clearViewerSwatches();

  if (!palette) {
    return;
  }

  if (shouldShowViewerSwatches(palette)) {
    renderViewerSwatches(palette.colors);
    return;
  }

  renderViewerPlaceholderSwatch();
}

function syncPublishButtonCopy() {
  hydrateViewerActionButton(publishButton, PUBLISH_BUTTON_COPY[getPublishAction()]);
}

function syncActionButtons() {
  if (shareButton) {
    shareButton.disabled = isBusy || !getCapability("canShare");
  }

  if (exportButton) {
    const hideExportButton = !getCapability("canExport");
    exportButton.hidden = hideExportButton;
    exportButton.disabled = hideExportButton || isBusy;
  }

  if (publishButton) {
    const hidePublishButton = isRalCapture();
    publishButton.hidden = hidePublishButton;
    publishButton.disabled = hidePublishButton || isBusy || !getCapability("canPublish");
  }

  if (deleteButton) {
    deleteButton.disabled = isBusy || !getCapability("canDelete");
  }
}

function syncViewerChrome() {
  syncPublishButtonCopy();
  syncActionButtons();
  renderActivePaletteSupplementaryUi();
}

function setBusy(nextBusy) {
  isBusy = nextBusy;
  syncActionButtons();
}

function createSlideState(palette, index) {
  const slide = document.createElement("article");
  slide.className = "palette-viewer-slide";
  slide.dataset.index = String(index);

  const image = document.createElement("img");
  image.className = "palette-viewer-image";
  image.alt = "Aperçu de capture";
  image.decoding = "async";
  image.hidden = true;

  const status = document.createElement("p");
  status.className = "palette-viewer-status";
  status.textContent = canPalettePreview(palette) ? "" : "Aperçu indisponible";

  slide.append(image, status);

  return {
    paletteId: palette.id,
    slide,
    image,
    status,
    loadState: canPalettePreview(palette) ? "idle" : "unavailable",
    requestId: 0,
  };
}

function renderViewerTrack() {
  if (!viewerTrack || !activeSession) {
    return;
  }

  viewerTrack.innerHTML = "";
  activeSession.slideStates = activeSession.palettes.map((palette, index) => {
    const slideState = createSlideState(palette, index);
    viewerTrack.appendChild(slideState.slide);
    return slideState;
  });
}

async function loadSlideAsset(index) {
  if (!activeSession) {
    return;
  }

  const palette = activeSession.palettes[index];
  const slideState = activeSession.slideStates[index];
  if (
    !palette ||
    !slideState ||
    slideState.loadState === "loading" ||
    slideState.loadState === "loaded" ||
    slideState.loadState === "unavailable"
  ) {
    return;
  }

  const session = activeSession;
  slideState.loadState = "loading";
  slideState.requestId += 1;
  const requestId = slideState.requestId;
  slideState.status.textContent = "Chargement...";

  try {
    const asset = await session.getPreviewAsset(palette);
    if (
      activeSession !== session ||
      session.slideStates[index] !== slideState ||
      slideState.requestId !== requestId
    ) {
      return;
    }

    await loadImageElementSource(slideState.image, asset.objectUrl);
    if (
      activeSession !== session ||
      session.slideStates[index] !== slideState ||
      slideState.requestId !== requestId
    ) {
      return;
    }

    slideState.image.hidden = false;
    slideState.status.textContent = "";
    slideState.loadState = "loaded";
  } catch (error) {
    if (
      activeSession !== session ||
      session.slideStates[index] !== slideState ||
      slideState.requestId !== requestId
    ) {
      return;
    }

    slideState.image.hidden = true;
    slideState.image.removeAttribute("src");
    slideState.status.textContent = "Aperçu indisponible";
    slideState.loadState = "error";
    console.error(`Failed to load palette viewer preview for palette ${palette.id}:`, error);
  }
}

function preloadNearbySlides() {
  if (!activeSession) {
    return;
  }

  const queue = [activeSession.activeIndex];
  for (let offset = 1; offset <= PRELOAD_FORWARD_DISTANCE; offset += 1) {
    queue.push(activeSession.activeIndex + offset);
  }
  for (let offset = 1; offset <= PRELOAD_BACKWARD_DISTANCE; offset += 1) {
    queue.push(activeSession.activeIndex - offset);
  }

  const visited = new Set();
  queue.forEach((index) => {
    if (visited.has(index)) {
      return;
    }
    visited.add(index);

    if (index < 0 || index >= activeSession.palettes.length) {
      return;
    }

    void loadSlideAsset(index);
  });
}

function scrollToActiveSlide(behavior = "auto") {
  if (!viewerTrack || !activeSession) {
    return;
  }

  const left = viewerTrack.clientWidth * activeSession.activeIndex;
  if (typeof viewerTrack.scrollTo === "function") {
    viewerTrack.scrollTo({ left, behavior });
    return;
  }

  viewerTrack.scrollLeft = left;
}

function scheduleTrackAlignment() {
  clearPendingTrackAlignment();
  pendingTrackAlignmentRaf = window.requestAnimationFrame(() => {
    pendingTrackAlignmentRaf = 0;
    scrollToActiveSlide();
    preloadNearbySlides();
  });
}

function updateActiveIndex(nextIndex) {
  if (!activeSession) {
    return;
  }

  const clampedIndex = clampIndex(nextIndex, activeSession.palettes.length);
  if (clampedIndex === activeSession.activeIndex) {
    return;
  }

  activeSession.activeIndex = clampedIndex;
  syncViewerChrome();
  preloadNearbySlides();
}

function getTrackActiveIndex() {
  if (!viewerTrack || !activeSession || viewerTrack.clientWidth <= 0) {
    return activeSession?.activeIndex ?? 0;
  }

  return clampIndex(
    viewerTrack.scrollLeft / viewerTrack.clientWidth,
    activeSession.palettes.length,
  );
}

function syncSessionPalettes({
  preferredPaletteId = null,
  fallbackIndex = activeSession?.activeIndex ?? 0,
} = {}) {
  if (!activeSession) {
    return false;
  }

  const nextPalettes =
    typeof activeSession.getPalettes === "function"
      ? activeSession.getPalettes()
      : activeSession.palettes;

  if (!Array.isArray(nextPalettes) || nextPalettes.length === 0) {
    closePaletteViewerOverlay();
    return false;
  }

  let nextIndex = clampIndex(fallbackIndex, nextPalettes.length);
  if (preferredPaletteId !== null && preferredPaletteId !== undefined) {
    const preferredIndex = nextPalettes.findIndex((palette) => palette.id === preferredPaletteId);
    if (preferredIndex >= 0) {
      nextIndex = preferredIndex;
    }
  }

  activeSession.palettes = [...nextPalettes];
  activeSession.activeIndex = nextIndex;
  renderViewerTrack();
  syncViewerChrome();
  scheduleTrackAlignment();
  return true;
}

function resetViewerFrame() {
  clearPendingTrackAlignment();
  clearPendingTrackScroll();
  if (viewerTrack) {
    viewerTrack.innerHTML = "";
    viewerTrack.scrollLeft = 0;
  }

  hideRalPopover();
  clearViewerSwatches();
}

async function runAction(actionName) {
  if (isBusy || !activeSession) {
    return;
  }

  const palette = getActivePalette();
  const action = activeSession[actionName];
  const fallbackIndex = activeSession.activeIndex;
  const paletteId = palette?.id ?? null;
  if (!palette || typeof action !== "function") {
    return;
  }

  setBusy(true);
  try {
    await action(palette);
    if (!activeSession) {
      return;
    }

    if (actionName === "onPublish") {
      syncSessionPalettes({
        preferredPaletteId: paletteId,
        fallbackIndex,
      });
      return;
    }

    if (actionName === "onDelete") {
      syncSessionPalettes({
        fallbackIndex,
      });
      return;
    }

    syncViewerChrome();
  } finally {
    if (activeSession) {
      setBusy(false);
    }
  }
}

function handleTrackScroll() {
  hideRalPopover();

  if (pendingTrackScrollRaf) {
    return;
  }

  pendingTrackScrollRaf = window.requestAnimationFrame(() => {
    pendingTrackScrollRaf = 0;
    updateActiveIndex(getTrackActiveIndex());
  });
}

function handleWindowResize() {
  if (!activeSession) {
    return;
  }

  scheduleTrackAlignment();
}

function handleAppSettingsChange() {
  if (!activeSession) {
    return;
  }

  renderActivePaletteSupplementaryUi();
}

function handleViewerPanelClosing() {
  activeRequestId += 1;
  activeSession = undefined;
  setBusy(false);
  document.removeEventListener("click", hideRalPopover);
  hideRalPopover();
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
    label: "Partager la palette",
    iconName: "share",
    visibleLabel: "partager",
  });
  hydrateViewerActionButton(exportButton, {
    label: "Exporter la palette",
    iconName: "export",
    visibleLabel: "télécharger",
  });
  hydrateViewerActionButton(deleteButton, {
    label: "Supprimer la palette",
    iconName: "delete",
    visibleLabel: "supprimer",
  });
  syncPublishButtonCopy();

  shareButton?.addEventListener("click", () => {
    void runAction("onShare");
  });
  exportButton?.addEventListener("click", () => {
    void runAction("onExport");
  });
  publishButton?.addEventListener("click", () => {
    void runAction("onPublish");
  });
  deleteButton?.addEventListener("click", () => {
    void runAction("onDelete");
  });
  cameraButton?.addEventListener("click", () => {
    if (!closeSharedPanel("collection")) {
      closePaletteViewerOverlay();
    }
  });
  viewerTrack?.addEventListener("scroll", handleTrackScroll, { passive: true });
  window.addEventListener("resize", handleWindowResize);
  subscribeAppSettings(handleAppSettingsChange);
  subscribeSharedPanelClosing("catch-details", handleViewerPanelClosing);
  subscribeSharedPanelClosed("catch-details", handleViewerPanelClosed);
}

/** @param {PaletteViewerOpenOptions} options */
export function openPaletteViewerOverlay({
  palettes = [],
  initialIndex = 0,
  getPalettes,
  getPreviewAsset,
  onShare,
  onExport,
  onPublish,
  onDelete,
  getPublishAction,
  canShare,
  canExport,
  canPublish,
  canDelete,
}) {
  bindViewerPanelEvents();

  if (!Array.isArray(palettes) || palettes.length === 0 || typeof getPreviewAsset !== "function") {
    return;
  }

  activeRequestId += 1;
  const requestId = activeRequestId;

  activeSession = {
    requestId,
    palettes: [...palettes],
    activeIndex: clampIndex(initialIndex, palettes.length),
    slideStates: [],
    getPalettes,
    getPreviewAsset,
    onShare,
    onExport,
    onPublish,
    onDelete,
    getPublishAction,
    canShare,
    canExport,
    canPublish,
    canDelete,
  };

  resetViewerFrame();
  renderViewerTrack();
  syncViewerChrome();
  setBusy(false);
  document.addEventListener("click", hideRalPopover);
  openSharedPanel("catch-details", { closeOtherPanels: false });
  scheduleTrackAlignment();
}

export function refreshPaletteViewerOverlay(options = {}) {
  if (!activeSession) {
    return false;
  }

  const currentPalette = getActivePalette();
  return syncSessionPalettes({
    preferredPaletteId: options.preferredPaletteId ?? currentPalette?.id ?? null,
    fallbackIndex: options.fallbackIndex ?? activeSession.activeIndex,
  });
}

export function closePaletteViewerOverlay() {
  closeSharedPanel("catch-details");
}

export function subscribePaletteViewerOverlayClose(listener) {
  return subscribeSharedPanelClosing("catch-details", listener);
}
