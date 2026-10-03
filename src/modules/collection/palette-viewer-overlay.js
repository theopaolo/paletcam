import { getIntlLocale, subscribeLocaleChange, t } from "../../i18n.js";
import { reportAppError } from "../error-reporting.js";
import { loadImageElementBlobSource } from "../image-element-loader.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosed,
  subscribeSharedPanelClosing,
} from "../panels/panel-manager.js";
import { isPaletteFavorite } from "./collection-filter.js";
import { FAVORITE_ICON_MARKUP } from "./favorite-icon.js";
import { getPalettePreviewDebugInfo } from "./palette-preview-assets.js";
import { runSessionBoundAction } from "./session-bound-action.js";

const VIEWER_WINDOW_RADIUS = 2;

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
const favoriteButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsFavoriteButton")
);
const flipButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("catchDetailsFlipButton")
);
const metaContainer = document.getElementById("catchDetailsMeta");
const metaDate = document.getElementById("catchDetailsMetaDate");
const metaPosition = document.getElementById("catchDetailsMetaPosition");

let activeSession;
let hasBoundViewerPanelEvents = false;
let isBusy = false;
let pendingAdjacentPreloadId = 0;
let pendingTrackAlignmentRaf = 0;
let pendingTrackScrollRaf = 0;
let pendingAdjacentPreloadCancel = () => {};
let pendingReturnFocusRaf = 0;
let viewerEventAbortController = null;
let unsubscribeLocaleChange = () => {};
let unsubscribeViewerPanelClosing = () => {};
let unsubscribeViewerPanelClosed = () => {};
let isViewerDestroyed = false;
let versoToolsPromise = null;

function loadVersoTools() {
  if (!versoToolsPromise) {
    versoToolsPromise = Promise.all([import("../color-name-api.js"), import("./palette-verso.js")])
      .then(([colorNames, paletteVerso]) => ({
        getColorNames: colorNames.getColorNames,
        createPaletteVersoElement: paletteVerso.createPaletteVersoElement,
      }))
      .catch((error) => {
        versoToolsPromise = null;
        throw error;
      });
  }
  return versoToolsPromise;
}

function getPublishButtonCopy() {
  return {
    publish: {
      label: t("viewer.action.publishAria"),
      iconName: "publish",
      visibleLabel: t("viewer.action.publishLabel"),
    },
    unpublish: {
      label: t("viewer.action.unpublishAria"),
      iconName: "unpublish",
      visibleLabel: t("viewer.action.unpublishLabel"),
    },
  };
}

function getActionIconMarkup(iconName) {
  if (iconName === "favorite") {
    return FAVORITE_ICON_MARKUP;
  }

  if (iconName === "export") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H72a8,8,0,0,1,0,16H32v64H224V136H184a8,8,0,0,1,0-16h40A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"></path>
      </svg>
    `;
  }

  if (iconName === "share") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z"></path>
      </svg>
    `;
  }

  if (iconName === "publish") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0ZM93.66,77.66,120,51.31V144a8,8,0,0,0,16,0V51.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,77.66Z"></path>
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

function hydrateViewerActionButton(button, { label, iconName, visibleLabel = "" }) {
  if (!button) {
    return;
  }

  button.setAttribute("aria-label", label);
  const labelMarkup = visibleLabel
    ? `<span class="palette-action-label">${visibleLabel}</span>`
    : "";
  button.innerHTML = `${getActionIconMarkup(iconName)}${labelMarkup}`;
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

function getActiveSlideState() {
  if (!activeSession) {
    return null;
  }

  return activeSession.slideStates.get(activeSession.activeIndex) ?? null;
}

function getPublishAction(palette = getActivePalette()) {
  if (!palette) {
    return "publish";
  }

  return activeSession?.getPublishAction?.(palette) === "unpublish" ? "unpublish" : "publish";
}

// Previews only need a palette and a session that can supply the asset; the
// per-slide load state tracks whether fetching it actually succeeds.
function canLoadPreview(palette) {
  return Boolean(palette) && typeof activeSession?.getPreviewAsset === "function";
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

function clearPendingAdjacentPreload() {
  pendingAdjacentPreloadId += 1;
  pendingAdjacentPreloadCancel();
  pendingAdjacentPreloadCancel = () => {};
}

function clearPendingReturnFocus() {
  if (!pendingReturnFocusRaf) {
    return;
  }

  window.cancelAnimationFrame(pendingReturnFocusRaf);
  pendingReturnFocusRaf = 0;
}

function syncPublishButtonGlow() {
  if (!publishButton) {
    return;
  }

  const colors = getActivePalette()?.colors;
  if (!Array.isArray(colors) || colors.length === 0) {
    publishButton.style.removeProperty("--publish-glow-gradient");
    return;
  }

  const stops = colors.map((color) => `rgb(${color.r} ${color.g} ${color.b})`);
  stops.push(stops[0]);
  publishButton.style.setProperty(
    "--publish-glow-gradient",
    `linear-gradient(90deg, ${stops.join(", ")})`,
  );
}

function syncPublishButtonCopy() {
  const action = getPublishAction();
  hydrateViewerActionButton(publishButton, getPublishButtonCopy()[action]);
  publishButton?.setAttribute("data-publish-state", action);
  syncPublishButtonGlow();
}

function syncFavoriteButton() {
  if (!favoriteButton) {
    return;
  }

  const isFavorite = isPaletteFavorite(getActivePalette());
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  hydrateViewerActionButton(favoriteButton, {
    label: isFavorite ? t("viewer.action.unfavoriteAria") : t("viewer.action.favoriteAria"),
    iconName: "favorite",
  });
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

  if (favoriteButton) {
    const hideFavoriteButton = typeof activeSession?.onToggleFavorite !== "function";
    favoriteButton.hidden = hideFavoriteButton;
    favoriteButton.disabled = hideFavoriteButton || isBusy;
  }
}

function formatPaletteTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function syncViewerMeta() {
  if (!metaContainer) {
    return;
  }

  const palette = getActivePalette();
  if (!activeSession || !palette) {
    metaContainer.hidden = true;
    return;
  }

  metaContainer.hidden = false;

  if (metaDate) {
    const dateLabel = formatPaletteTimestamp(palette.timestamp);
    const publishedLabel =
      getPublishAction(palette) === "unpublish" ? t("viewer.meta.published") : "";
    metaDate.textContent = [dateLabel, publishedLabel].filter(Boolean).join(" · ");
  }

  if (metaPosition) {
    const total = activeSession.palettes.length;
    const current = activeSession.activeIndex + 1;
    metaPosition.hidden = total <= 1;
    metaPosition.textContent = total > 1 ? `${current} / ${total}` : "";
    metaPosition.setAttribute("aria-label", t("viewer.meta.positionAria", { current, total }));
  }
}

/* One flip control drives whichever slide is on screen; it mirrors that
   slide's state, and hides for captures that have no verso (RAL, mono). */
function syncFlipButton() {
  if (!flipButton) {
    return;
  }

  const slideState = getActiveSlideState();
  const canFlip = typeof slideState?.toggleFlip === "function";
  flipButton.hidden = !canFlip;
  flipButton.disabled = !canFlip;
  flipButton.setAttribute("aria-pressed", String(Boolean(slideState?.isFlipped)));
}

function syncViewerChrome() {
  syncPublishButtonCopy();
  syncFavoriteButton();
  syncActionButtons();
  syncFlipButton();
  syncViewerMeta();
}

function setBusy(nextBusy) {
  isBusy = nextBusy;
  syncActionButtons();
}

function canPaletteFlip(palette) {
  return !isRalCapture(palette) && Array.isArray(palette?.colors) && palette.colors.length >= 2;
}

async function buildSlideVerso(slideState, palette) {
  if (slideState.versoBuildState !== "idle") {
    return;
  }

  slideState.versoBuildState = "building";
  let names = [];
  let createPaletteVersoElement;
  try {
    const versoTools = await loadVersoTools();
    createPaletteVersoElement = versoTools.createPaletteVersoElement;
    names = await versoTools.getColorNames(palette.colors);
  } catch (_error) {
    names = [];
  }

  if (
    slideState.versoBuildState !== "building" ||
    activeSession?.slideStates?.get(slideState.index) !== slideState
  ) {
    return;
  }

  const verso = createPaletteVersoElement?.(palette, names);
  if (verso) {
    slideState.versoFace.replaceChildren(verso);
  }
  slideState.versoBuildState = "built";
}

/* Restart the dip that pulls the card back while it turns; dropping the class
   and reading a layout box in between makes back-to-back taps replay it. */
function playFlipDip(flip) {
  flip.classList.remove("is-turning");
  void flip.offsetWidth;
  flip.classList.add("is-turning");
}

function setSlideFlipped(slideState, isFlipped) {
  slideState.isFlipped = isFlipped;
  slideState.flip.classList.toggle("is-flipped", isFlipped);
  slideState.flip.setAttribute("aria-pressed", String(isFlipped));
  if (slideState === getActiveSlideState()) {
    syncFlipButton();
  }
}

function createSlideState(palette, index) {
  const slide = document.createElement("article");
  slide.className = "palette-viewer-slide";
  slide.dataset.index = String(index);

  const image = document.createElement("img");
  image.className = "palette-viewer-image";
  image.alt = t("viewer.previewAlt");
  image.decoding = "async";
  image.hidden = true;

  const status = document.createElement("p");
  status.className = "palette-viewer-status";
  status.textContent = canLoadPreview(palette) ? "" : t("viewer.previewUnavailable");

  const flip = document.createElement("button");
  flip.type = "button";
  flip.className = "palette-viewer-flip";
  flip.setAttribute("aria-pressed", "false");
  flip.setAttribute("aria-label", t("viewer.flipAria"));

  const rectoFace = document.createElement("div");
  rectoFace.className = "palette-viewer-face palette-viewer-face--recto";
  rectoFace.append(image, status);

  const versoFace = document.createElement("div");
  versoFace.className = "palette-viewer-face palette-viewer-face--verso";

  flip.append(rectoFace, versoFace);
  slide.appendChild(flip);

  const slideState = {
    index,
    paletteId: palette.id,
    slide,
    flip,
    versoFace,
    image,
    status,
    isFlipped: false,
    versoBuildState: canPaletteFlip(palette) ? "idle" : "unavailable",
    loadState: canLoadPreview(palette) ? "idle" : "unavailable",
    requestId: 0,
    /** @type {(() => void) | null} set only when the palette has a verso */
    toggleFlip: null,
  };

  if (canPaletteFlip(palette)) {
    slideState.toggleFlip = () => {
      flip.classList.remove("is-peeking");
      playFlipDip(flip);
      void buildSlideVerso(slideState, palette);
      setSlideFlipped(slideState, !slideState.isFlipped);
    };
    flip.addEventListener("click", slideState.toggleFlip);
  } else {
    flip.disabled = true;
  }

  return slideState;
}

function disposeSlideState(slideState) {
  slideState.requestId += 1;
  slideState.versoBuildState = "disposed";
  slideState.image.removeAttribute("src");
}

function createViewerSpacer(slideCount) {
  const spacer = document.createElement("div");
  spacer.className = "palette-viewer-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.setProperty("--viewer-spacer-width", `${Math.max(0, slideCount) * 100}%`);
  return spacer;
}

function renderViewerWindow({ reset = false } = {}) {
  if (!viewerTrack || !activeSession) {
    return;
  }

  const session = activeSession;
  const firstIndex = Math.max(0, session.activeIndex - VIEWER_WINDOW_RADIUS);
  const lastIndex = Math.min(
    session.palettes.length - 1,
    session.activeIndex + VIEWER_WINDOW_RADIUS,
  );
  const previousStates = reset ? new Map() : session.slideStates;
  if (reset) {
    session.slideStates.forEach(disposeSlideState);
  }
  const nextStates = new Map();
  const children = [createViewerSpacer(firstIndex)];

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const palette = session.palettes[index];
    const previous = previousStates.get(index);
    const slideState =
      previous?.paletteId === palette?.id ? previous : createSlideState(palette, index);
    if (previous && previous !== slideState) {
      disposeSlideState(previous);
    }
    nextStates.set(index, slideState);
    children.push(slideState.slide);
  }

  previousStates.forEach((slideState, index) => {
    if (!nextStates.has(index)) {
      disposeSlideState(slideState);
    }
  });

  children.push(createViewerSpacer(session.palettes.length - lastIndex - 1));
  session.slideStates = nextStates;
  viewerTrack.replaceChildren(...children);
}

async function loadSlideAsset(index) {
  if (!activeSession) {
    return;
  }

  const palette = activeSession.palettes[index];
  const slideState = activeSession.slideStates.get(index);
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
  slideState.status.textContent = t("viewer.loading");
  let previewAsset = null;

  try {
    const asset = await session.getPreviewAsset(palette);
    previewAsset = asset;
    if (
      activeSession !== session ||
      session.slideStates.get(index) !== slideState ||
      slideState.requestId !== requestId
    ) {
      return;
    }

    await loadImageElementBlobSource(slideState.image, asset.blob);
    if (
      activeSession !== session ||
      session.slideStates.get(index) !== slideState ||
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
      session.slideStates.get(index) !== slideState ||
      slideState.requestId !== requestId
    ) {
      return;
    }

    slideState.image.hidden = true;
    slideState.image.removeAttribute("src");
    slideState.status.textContent = t("viewer.previewUnavailable");
    slideState.loadState = "error";
    reportAppError(error, {
      logMessage: "Failed to load palette viewer preview.",
      consoleMessage: `Failed to load palette viewer preview for palette ${palette.id}:`,
      clientLogKey: "preview-viewer-failure",
      clientLogThrottleMs: 15000,
      context: getPalettePreviewDebugInfo(palette, previewAsset, "viewer"),
    });
  }
}

function syncSlideCopy() {
  activeSession?.slideStates?.forEach((slideState) => {
    slideState.image.alt = t("viewer.previewAlt");
    slideState.flip.setAttribute("aria-label", t("viewer.flipAria"));

    if (slideState.loadState === "loading") {
      slideState.status.textContent = t("viewer.loading");
      return;
    }

    if (slideState.loadState === "unavailable" || slideState.loadState === "error") {
      slideState.status.textContent = t("viewer.previewUnavailable");
    }
  });
}

/* Build the back face while the slide sits idle. Left to the first tap, the
   verso module import and the color-name lookup would land in the middle of
   the turn and cost it frames. */
function warmActiveVerso() {
  const session = activeSession;
  const slideState = getActiveSlideState();
  const palette = getActivePalette();
  if (!slideState || !palette || slideState.versoBuildState !== "idle") {
    return;
  }

  const runWarmup = () => {
    if (activeSession !== session || getActiveSlideState() !== slideState) {
      return;
    }

    void buildSlideVerso(slideState, palette);
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(runWarmup, { timeout: 500 });
    return;
  }

  window.setTimeout(runWarmup, 0);
}

function preloadNearbySlides() {
  if (!activeSession) {
    return;
  }

  const session = activeSession;
  const activeIndex = session.activeIndex;
  const activeLoad = loadSlideAsset(activeIndex);
  const nextIndex = activeIndex + 1;
  const previousIndex = activeIndex - 1;
  clearPendingAdjacentPreload();
  const preloadId = pendingAdjacentPreloadId;

  void activeLoad.finally(() => {
    if (activeSession !== session || pendingAdjacentPreloadId !== preloadId) {
      return;
    }

    warmActiveVerso();
    if (nextIndex < session.palettes.length) {
      void loadSlideAsset(nextIndex);
    }
  });

  if (previousIndex < 0) {
    return;
  }

  const runPreviousPreload = () => {
    pendingAdjacentPreloadCancel = () => {};
    if (activeSession !== session || pendingAdjacentPreloadId !== preloadId) {
      return;
    }

    void loadSlideAsset(previousIndex);
  };

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(runPreviousPreload, { timeout: 200 });
    pendingAdjacentPreloadCancel = () => window.cancelIdleCallback?.(idleId);
    return;
  }

  const timeoutId = window.setTimeout(runPreviousPreload, 0);
  pendingAdjacentPreloadCancel = () => window.clearTimeout(timeoutId);
}

function playFlipPeekHint() {
  const slideState = getActiveSlideState();
  if (!slideState || slideState.flip.disabled || slideState.isFlipped) {
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  slideState.flip.classList.add("is-peeking");
  slideState.flip.addEventListener(
    "animationend",
    () => slideState.flip.classList.remove("is-peeking"),
    { once: true },
  );
}

/** @param {ScrollBehavior} [behavior] */
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
  renderViewerWindow();
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
  renderViewerWindow({ reset: true });
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

  syncFlipButton();
  syncViewerMeta();
}

async function runAction(actionName) {
  if (isBusy || !activeSession) {
    return;
  }

  const palette = getActivePalette();
  const session = activeSession;
  const action = session[actionName];
  const fallbackIndex = session.activeIndex;
  const paletteId = palette?.id ?? null;
  if (!palette || typeof action !== "function") {
    return;
  }

  setBusy(true);
  await runSessionBoundAction({
    isCurrent: () => activeSession === session,
    run: () => action(palette),
    onCurrentSuccess: () => {
      if (actionName === "onPublish") {
        syncSessionPalettes({
          preferredPaletteId: paletteId,
          fallbackIndex,
        });
        return;
      }

      if (actionName === "onDelete") {
        syncSessionPalettes({ fallbackIndex });
        return;
      }

      syncViewerChrome();
    },
    onCurrentFinally: () => setBusy(false),
  });
}

function handleTrackScroll() {
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

function handleViewerPanelClosing() {
  clearPendingAdjacentPreload();
  clearPendingReturnFocus();
  const returnFocusTarget = activeSession?.returnFocusTarget;
  const connectedReturnFocusTarget = returnFocusTarget?.isConnected
    ? returnFocusTarget
    : returnFocusTarget?.id
      ? document.getElementById(returnFocusTarget.id)
      : null;
  activeSession = undefined;
  setBusy(false);
  if (connectedReturnFocusTarget) {
    pendingReturnFocusRaf = window.requestAnimationFrame(() => {
      pendingReturnFocusRaf = 0;
      connectedReturnFocusTarget.focus({ preventScroll: true });
    });
  }
}

function handleViewerPanelClosed() {
  resetViewerFrame();
}

function handleLocaleChange() {
  hydrateViewerActionButton(shareButton, {
    label: t("viewer.action.shareAria"),
    iconName: "share",
  });
  hydrateViewerActionButton(exportButton, {
    label: t("viewer.action.exportAria"),
    iconName: "export",
  });
  hydrateViewerActionButton(deleteButton, {
    label: t("viewer.action.deleteAria"),
    iconName: "delete",
  });
  flipButton?.setAttribute("aria-label", t("viewer.flipAria"));
  syncPublishButtonCopy();
  syncFavoriteButton();
  syncSlideCopy();
  syncViewerMeta();
}

function bindViewerPanelEvents() {
  if (hasBoundViewerPanelEvents || isViewerDestroyed) {
    return;
  }

  hasBoundViewerPanelEvents = true;
  viewerEventAbortController = new AbortController();
  const { signal } = viewerEventAbortController;
  handleLocaleChange();

  shareButton?.addEventListener(
    "click",
    () => {
      void runAction("onShare");
    },
    { signal },
  );
  exportButton?.addEventListener(
    "click",
    () => {
      const slideState = getActiveSlideState();
      if (slideState?.isFlipped && typeof activeSession?.onExportVerso === "function") {
        void runAction("onExportVerso");
        return;
      }

      void runAction("onExport");
    },
    { signal },
  );
  publishButton?.addEventListener(
    "click",
    () => {
      void runAction("onPublish");
    },
    { signal },
  );
  deleteButton?.addEventListener(
    "click",
    () => {
      void runAction("onDelete");
    },
    { signal },
  );
  favoriteButton?.addEventListener(
    "click",
    () => {
      void runAction("onToggleFavorite");
    },
    { signal },
  );
  flipButton?.addEventListener(
    "click",
    () => {
      getActiveSlideState()?.toggleFlip?.();
    },
    { signal },
  );
  cameraButton?.addEventListener(
    "click",
    () => {
      closePaletteViewerOverlay();
      closeSharedPanel("collection");
    },
    { signal },
  );
  viewerTrack?.addEventListener("scroll", handleTrackScroll, { passive: true, signal });
  window.addEventListener("resize", handleWindowResize, { signal });
  unsubscribeLocaleChange = subscribeLocaleChange(handleLocaleChange);
  unsubscribeViewerPanelClosing = subscribeSharedPanelClosing(
    "catch-details",
    handleViewerPanelClosing,
  );
  unsubscribeViewerPanelClosed = subscribeSharedPanelClosed(
    "catch-details",
    handleViewerPanelClosed,
  );
}

/** @param {PaletteViewerOpenOptions} options */
export function openPaletteViewerOverlay({
  palettes = [],
  initialIndex = 0,
  getPalettes,
  getPreviewAsset,
  onShare,
  onExport,
  onExportVerso,
  onPublish,
  onDelete,
  onToggleFavorite,
  getPublishAction,
  canShare,
  canExport,
  canPublish,
  canDelete,
  returnFocusTarget: requestedReturnFocusTarget,
}) {
  if (isViewerDestroyed) {
    return false;
  }

  const returnFocusTarget =
    requestedReturnFocusTarget instanceof HTMLElement
      ? requestedReturnFocusTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  bindViewerPanelEvents();

  if (!Array.isArray(palettes) || palettes.length === 0 || typeof getPreviewAsset !== "function") {
    return;
  }

  activeSession = {
    palettes: [...palettes],
    activeIndex: clampIndex(initialIndex, palettes.length),
    slideStates: new Map(),
    getPalettes,
    getPreviewAsset,
    onShare,
    onExport,
    onExportVerso,
    onPublish,
    onDelete,
    onToggleFavorite,
    getPublishAction,
    canShare,
    canExport,
    canPublish,
    canDelete,
    returnFocusTarget,
  };

  resetViewerFrame();
  renderViewerWindow();
  syncViewerChrome();
  setBusy(false);
  openSharedPanel("catch-details", { closeOtherPanels: false, returnFocusTarget });
  scheduleTrackAlignment();
  playFlipPeekHint();
  return true;
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

export function destroyPaletteViewerOverlay() {
  if (isViewerDestroyed) {
    return false;
  }

  isViewerDestroyed = true;
  clearPendingAdjacentPreload();
  clearPendingTrackAlignment();
  clearPendingTrackScroll();
  clearPendingReturnFocus();
  activeSession?.slideStates?.forEach((slideState) => {
    slideState.requestId += 1;
    slideState.versoBuildState = "disposed";
  });
  activeSession = undefined;
  isBusy = false;
  viewerEventAbortController?.abort();
  viewerEventAbortController = null;
  unsubscribeLocaleChange();
  unsubscribeViewerPanelClosing();
  unsubscribeViewerPanelClosed();
  unsubscribeLocaleChange = () => {};
  unsubscribeViewerPanelClosing = () => {};
  unsubscribeViewerPanelClosed = () => {};
  hasBoundViewerPanelEvents = false;
  closeSharedPanel("catch-details");
  resetViewerFrame();
  return true;
}

export function subscribePaletteViewerOverlayClose(listener) {
  return subscribeSharedPanelClosing("catch-details", listener);
}
