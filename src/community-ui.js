import {
  fetchCommunityCollection,
  fetchCommunityFeed,
  setCatchCollected,
} from "./community-api.js";
import { getCommunityAccessToken, subscribeCommunitySession } from "./community-session.js";
import { buildCommunityUrl } from "./config.js";
import { t } from "./i18n.js";
import {
  createCollectionFilterState,
  isPaletteFavorite,
} from "./modules/collection/collection-filter.js";
import { createCollectionLifecycle } from "./modules/collection/collection-lifecycle.js";
import { createCollectionViewerCoordinator } from "./modules/collection/collection-viewer-coordinator.js";
import { createGalleryPresenter } from "./modules/collection/gallery-presenter.js";
import {
  getTappedCardColor,
  setPaletteCardFavoriteState,
} from "./modules/collection/palette-card.js";
import { createSameColorMatcher } from "./modules/collection/spectrum.js";
import { toRgbCss } from "./modules/color-format.js";
import { createCommunityFeedController } from "./modules/community/community-feed-controller.js";
import {
  getCommunityPreviewAsset,
  toCommunityPalette,
} from "./modules/community/community-palette.js";
import { reportAppError } from "./modules/error-reporting.js";
import {
  closeSharedPanel,
  openSharedPanel,
  subscribeSharedPanelClosing,
} from "./modules/panels/panel-manager.js";
import { openLoginPanel } from "./login-ui.js";
import { showToast } from "./modules/toast-ui.js";
import { detentFeedback } from "./modules/ui-feedback.js";

const COMMUNITY_PANEL_NAME = "community";
const FEED_PAGE_SIZE = 24;
/** Start fetching the next page while the reader is still a few screens away. */
const LOAD_MORE_ROOT_MARGIN = "0px 0px 600px 0px";
/** Catches left ahead of the one in the viewer before the next page is fetched. */
const VIEWER_LOAD_MORE_AHEAD = 3;

/**
 * The community feed is the personal collection's gallery shown on someone
 * else's catches: same views, same zoom, same viewer with its flip. What sets
 * it apart is the data (pages of public catches instead of the local database)
 * and the side it slides in from.
 */
const elements = {
  panel: /** @type {(HTMLElement & { panelTitle: string }) | null} */ (
    document.querySelector(".community-panel")
  ),
  grid: document.getElementById("communityGrid"),
  body: document.querySelector(".community-panel .collection-panel-body"),
  status: document.getElementById("communityStatus"),
  statusMessage: document.getElementById("communityStatusMessage"),
  retryButton: document.getElementById("communityRetryButton"),
  sentinel: document.getElementById("communitySentinel"),
  filterColorButton: document.getElementById("communityFilterColorButton"),
  filterCollectedButton: document.getElementById("communityFilterCollectedButton"),
  viewGridButton: document.getElementById("communityViewGridButton"),
  viewBandsButton: document.getElementById("communityViewBandsButton"),
  viewSwatchButton: document.getElementById("communityViewSwatchButton"),
  viewSpectrumButton: document.getElementById("communityViewSpectrumButton"),
  viewRingsButton: document.getElementById("communityViewRingsButton"),
};

/** @typedef {import("./modules/community/community-feed-controller.js").CommunityFeedState} CommunityFeedState */

const lifecycle = createCollectionLifecycle({
  onCleanupError: (error) => {
    reportAppError(error, {
      logMessage: "Failed to release a community resource.",
      includeClientLog: false,
    });
  },
});
const viewerCoordinator = createCollectionViewerCoordinator({
  loadModule: () => import("./modules/collection/palette-viewer-overlay.js"),
});

/** Which list the gallery shows: every public catch, or the reader's collected ones. @type {"all" | "collected"} */
let view = "all";
/** @type {Map<string, Palette>} */
const palettesById = new Map();
/** Items whose server-side collected flag is already on their palette; a later page or an optimistic change must not be overwritten by a stale one. */
let appliedItems = new WeakSet();
/** Ids with a collect or uncollect request in flight. */
const collectingIds = new Set();
let lastToken = getCommunityAccessToken();
/** How many catches the reader collected, from the server; null until it has said. @type {number | null} */
let collectedCount = null;
/** The session changed while the panel was closed: reload when it opens. */
let needsReload = false;
/** @type {Palette[]} */
let palettes = [];
let renderedSignature = "";
let renderedCount = 0;
let loadMoreObserver = null;
/** Set by a tap on a color: narrows the loaded catches to those holding it. @type {((palette: Palette) => boolean) | null} */
let colorFilterMatch = null;
const filters = createCollectionFilterState({
  color: (palette) => colorFilterMatch?.(palette) ?? false,
});

function hasRequiredElements() {
  return Object.values(elements).every(Boolean);
}

/** @param {CommunityFeedState} state */
function getFeedMessage(state) {
  if (state.status === "error") {
    return navigator.onLine === false ? t("community.offline") : t("community.error");
  }
  if (state.status === "ready") {
    return t(view === "collected" ? "community.collectedEmpty" : "community.empty");
  }
  return t("community.loading");
}

function getDisplayPalettes() {
  return filters.apply(palettes);
}

function getEmptyMessage() {
  return palettes.length > 0
    ? t("collection.emptyFiltered")
    : getFeedMessage(activeController().getState());
}

function syncChrome() {
  galleryPresenter.syncHeader();
  const collectedButton = elements.filterCollectedButton;
  if (collectedButton instanceof HTMLButtonElement) {
    // Collecting needs an account: without one there is no collection to show.
    // Like the favourites chip, it appears once there is something to show, and
    // stays while its list is open so the reader can leave it.
    collectedButton.hidden =
      !getCommunityAccessToken() ||
      collectedCount === null ||
      (collectedCount === 0 && view !== "collected");
    collectedButton.dataset.count = String(collectedCount ?? 0);
    collectedButton.classList.toggle("is-active", view === "collected");
    collectedButton.setAttribute("aria-pressed", String(view === "collected"));
  }
  const button = elements.filterColorButton;
  if (button instanceof HTMLButtonElement) {
    const isActive = filters.isActive("color");
    button.hidden = !isActive;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

/**
 * @param {string | number} paletteId
 * @param {HTMLElement | null} [returnFocusTarget]
 */
async function openCatchViewer(paletteId, returnFocusTarget = null) {
  const isSpectrum = galleryPresenter.isSpectrum();
  const viewerPalettes = galleryPresenter.getViewerPalettes();
  const initialIndex = viewerPalettes.findIndex((palette) => palette.id === paletteId);
  if (initialIndex < 0) {
    return;
  }

  try {
    await viewerCoordinator.open(
      {
        palettes: viewerPalettes,
        initialIndex,
        startOnVerso: isSpectrum,
        getPalettes: galleryPresenter.getViewerPalettes,
        getPreviewAsset: getCommunityPreviewAsset,
        readOnly: true,
        // The star is "collect" here: it puts the catch in the reader's collection.
        onToggleFavorite: toggleCollected,
        getFavoriteLabels: () => ({
          favorite: t("community.collect"),
          unfavorite: t("community.uncollect"),
        }),
        showPosition: false,
        getAttribution: (palette) =>
          palette.community
            ? {
                label: palette.community.userName,
                href: buildCommunityUrl(`/u/${encodeURIComponent(palette.community.userName)}`),
              }
            : null,
        // Page in older catches before the reader reaches the last one loaded.
        onActiveIndexChange: (index, total) => {
          if (index >= total - VIEWER_LOAD_MORE_AHEAD) {
            void activeController().loadMore();
          }
        },
        returnFocusTarget,
      },
      { canOpen: () => Boolean(elements.panel?.classList.contains("visible")) },
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    reportAppError(error, { logMessage: "Failed to load palette viewer." });
    showToast(t("community.loadErrorToast"), { variant: "error", duration: 1800 });
  }
}

const galleryPresenter = createGalleryPresenter({
  panel: elements.panel,
  grid: /** @type {HTMLElement} */ (elements.grid),
  viewOptions: [
    { mode: "grid", button: elements.viewGridButton },
    { mode: "bands", button: elements.viewBandsButton },
    { mode: "swatch", button: elements.viewSwatchButton },
    { mode: "spectrum", button: elements.viewSpectrumButton },
    { mode: "rings", button: elements.viewRingsButton },
  ],
  lifecycle,
  columnsKey: "communityColumns",
  getDisplayPalettes,
  getEmptyMessage,
  getCardOptions: () => ({
    onOpenViewer: openCatchViewer,
    // The pictures live on the community server: cards take its URL as it is.
    previewSource: {
      getAsset: getCommunityPreviewAsset,
      getCachedAsset: () => null,
      refreshAsset: () => {},
    },
  }),
  syncChrome,
  afterRender: () => viewerCoordinator.refresh(),
  refreshViewer: () => viewerCoordinator.refresh(),
});

/** @param {CommunityFeedState} state */
function getStatus(state) {
  if (state.items.length === 0) {
    return { message: "", canRetry: state.status === "error" };
  }
  if (state.loadMoreFailed) {
    return { message: t("community.loadMoreError"), canRetry: true };
  }
  if (state.isLoadingMore) {
    return { message: t("community.loadingMore"), canRetry: false };
  }
  return { message: "", canRetry: false };
}

function setStatus({ message, canRetry }) {
  elements.status.hidden = !message && !canRetry;
  elements.statusMessage.textContent = message;
  elements.statusMessage.hidden = !message;
  elements.retryButton.hidden = !canRetry;
}

/**
 * Observes the end-of-grid sentinel while older pages remain. Re-observing
 * after each render matters: a short page can leave the sentinel in view, and
 * an observer only reports changes.
 * @param {CommunityFeedState} state
 */
function watchSentinel(state) {
  loadMoreObserver?.disconnect();
  if (state.status !== "ready" || !state.hasMore || state.isLoadingMore || state.loadMoreFailed) {
    return;
  }
  loadMoreObserver?.observe(elements.sentinel);
}

/**
 * Puts the server's collected flag on a palette, once per item: a later page or
 * a change the reader just made must not be overwritten by an older answer.
 * @param {CommunityFeedItem} item
 */
function toPalette(item) {
  let palette = palettesById.get(item.id);
  if (!palette) {
    palette = toCommunityPalette(item);
    palettesById.set(item.id, palette);
  }
  if (item.collected !== undefined && !appliedItems.has(item)) {
    appliedItems.add(item);
    if (!collectingIds.has(item.id)) {
      setCollected(palette, item.collected);
    }
  }
  return palette;
}

/**
 * A collected catch carries `favoritedAt`, like a starred capture, so the cards'
 * gold frame and the viewer's star read it without a second notion of "kept".
 * @param {Palette} palette @param {boolean} collected
 */
function setCollected(palette, collected) {
  palette.favoritedAt = collected ? (palette.favoritedAt ?? new Date().toISOString()) : null;
}

/** @param {CommunityFeedState} state */
function renderFeed(state) {
  if (lifecycle.isDestroyed()) {
    return;
  }

  palettes = state.items.map(toPalette);

  // An empty list redraws as it moves between loading, error and empty; a
  // filled one only when its catches change.
  const signature = `${view}:${state.version}:${state.items.length}:${state.items.length === 0 ? state.status : ""}`;
  if (signature !== renderedSignature) {
    const isOlderPage =
      renderedCount > 0 &&
      state.items.length > renderedCount &&
      renderedSignature.startsWith(`${view}:${state.version}:`);
    renderedSignature = signature;
    renderedCount = state.items.length;
    if (isOlderPage) {
      galleryPresenter.renderKeepingScroll();
    } else {
      galleryPresenter.render();
    }
  }

  elements.grid.setAttribute("aria-busy", String(state.status === "loading"));
  setStatus(getStatus(state));
  watchSentinel(state);
}

/**
 * Takes the collected total off a page the server just sent. Skipped while a
 * collect is in flight: the page may predate it, and the change below is exact.
 * @template {{ collectedCount?: number }} T
 * @param {T} page
 * @returns {T}
 */
function noteCollectedCount(page) {
  if (typeof page.collectedCount === "number" && collectingIds.size === 0) {
    collectedCount = page.collectedCount;
    syncChrome();
  }
  return page;
}

/** @param {"all" | "collected"} owner */
function renderWhenActive(owner) {
  return (/** @type {CommunityFeedState} */ state) => {
    if (view === owner) {
      renderFeed(state);
    }
  };
}

const feedController = createCommunityFeedController({
  // A token only adds the collected flags; the feed itself needs no account.
  fetchPage: ({ after, limit, signal }) =>
    fetchCommunityFeed({ after, limit, signal, token: getCommunityAccessToken() }).then(
      noteCollectedCount,
    ),
  onChange: renderWhenActive("all"),
  pageSize: FEED_PAGE_SIZE,
});
const collectionController = createCommunityFeedController({
  fetchPage: ({ after, limit, signal }) =>
    fetchCommunityCollection({ after, limit, signal, token: getCommunityAccessToken() }).then(
      noteCollectedCount,
    ),
  onChange: renderWhenActive("collected"),
  pageSize: FEED_PAGE_SIZE,
});

function activeController() {
  return view === "collected" ? collectionController : feedController;
}

function renderActive() {
  renderFeed(activeController().getState());
}

/** @param {"all" | "collected"} nextView */
function setView(nextView) {
  if (nextView === view) {
    return;
  }

  view = nextView;
  renderedSignature = "";
  renderedCount = 0;
  syncChrome();
  elements.body?.scrollTo({ top: 0 });
  // The collection is read fresh each time it is opened, so what was collected
  // elsewhere (the site, another device) is there, and what was just removed is gone.
  void (nextView === "collected" ? collectionController.refresh() : feedController.ensureLoaded());
  renderActive();
}

function showCollectAuthToast() {
  showToast(t("community.collectAuth"), {
    variant: "error",
    duration: 3500,
    actionLabel: t("login.verifyCode"),
    onAction: () => {
      viewerCoordinator.close();
      openLoginPanel();
    },
  });
}

/**
 * Collects the catch, or takes it out of the collection. The change shows once
 * the server has confirmed it, so a failed request never leaves a star lit.
 * In the collected view an uncollected catch stays listed (its star off) until
 * the view is left, so the list does not jump under the reader's finger.
 * @param {Palette} palette
 */
async function toggleCollected(palette) {
  const token = getCommunityAccessToken();
  if (!token) {
    showCollectAuthToast();
    return;
  }
  const id = String(palette.id);
  if (collectingIds.has(id)) {
    return;
  }

  collectingIds.add(id);
  try {
    const wasCollected = isPaletteFavorite(palette);
    const { collected } = await setCatchCollected({
      token,
      catchId: id,
      collected: !wasCollected,
    });
    setCollected(palette, collected);
    if (collectedCount !== null && collected !== wasCollected) {
      collectedCount = Math.max(0, collectedCount + (collected ? 1 : -1));
    }
    syncChrome();
    setPaletteCardFavoriteState(galleryPresenter.findCard(palette.id), collected);
    detentFeedback("analyze", true);
  } catch (error) {
    if (error?.status === 401) {
      showCollectAuthToast();
      return;
    }
    reportAppError(error, {
      logMessage: "Failed to update the community collection.",
      includeClientLog: false,
    });
    showToast(t("community.collectError"), { variant: "error", duration: 2500 });
  } finally {
    collectingIds.delete(id);
  }
}

/** Sign-in or sign-out changes which catches are the reader's: redraw with fresh flags. */
function handleCommunitySessionChange() {
  const token = getCommunityAccessToken();
  if (token === lastToken) {
    return;
  }

  lastToken = token;
  collectedCount = null;
  palettesById.clear();
  appliedItems = new WeakSet();
  renderedSignature = "";
  if (!token && view === "collected") {
    view = "all";
  }
  syncChrome();
  if (elements.panel?.classList.contains("visible")) {
    void (view === "collected" ? collectionController.refresh() : feedController.refresh());
    renderActive();
  } else {
    needsReload = true;
  }
}

/**
 * Narrows the loaded catches to the ones holding a color that reads as the
 * tapped one. A tap on another color while filtered moves the search there.
 * @param {RgbColor} color
 */
function findCatchesWithColor(color) {
  colorFilterMatch = createSameColorMatcher(color);
  elements.filterColorButton?.style.setProperty("--filter-color", toRgbCss(color));
  if (!filters.isActive("color")) {
    filters.toggle("color");
  }
  detentFeedback("analyze", true);
  galleryPresenter.render();
  elements.body?.scrollTo({ top: 0 });
}

function handleRetryClick() {
  const controller = activeController();
  void (controller.getState().status === "error" ? controller.refresh() : controller.loadMore());
}

function handleBackOnline() {
  const controller = activeController();
  if (elements.panel?.classList.contains("visible") && controller.getState().status === "error") {
    void controller.refresh();
  }
}

function handleCommunityPanelClosing() {
  viewerCoordinator.close();
  feedController.cancelPending();
  collectionController.cancelPending();
  galleryPresenter.destroyVirtualizer();
}

function bindCommunityUiEvents() {
  if (!hasRequiredElements()) {
    return;
  }

  const listen = (target, eventName, listener, options = {}) =>
    target.addEventListener(eventName, listener, { ...options, signal: lifecycle.signal });

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void activeController().loadMore();
      }
    },
    { root: elements.body, rootMargin: LOAD_MORE_ROOT_MARGIN },
  );
  lifecycle.registerCleanup(() => loadMoreObserver?.disconnect());

  galleryPresenter.bind();

  // A tap on a color searches by it; only the photo opens the viewer. A spectrum
  // chip has no photo, so the whole chip opens the viewer. Capture runs this
  // before the card's own click handler.
  listen(
    elements.grid,
    "click",
    (event) => {
      const color =
        event.target instanceof Element && !event.target.closest(".palette-card--chip")
          ? getTappedCardColor(event.target)
          : null;
      if (!color) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      findCatchesWithColor(color);
    },
    { capture: true },
  );
  listen(elements.filterColorButton, "click", () => {
    filters.toggle("color");
    colorFilterMatch = null;
    galleryPresenter.render();
  });
  listen(elements.filterCollectedButton, "click", () => {
    setView(view === "collected" ? "all" : "collected");
  });
  lifecycle.registerCleanup(subscribeCommunitySession(handleCommunitySessionChange));
  listen(elements.retryButton, "click", handleRetryClick);
  listen(window, "online", handleBackOnline);
  lifecycle.registerCleanup(
    subscribeSharedPanelClosing(COMMUNITY_PANEL_NAME, handleCommunityPanelClosing),
  );
  syncChrome();
}

bindCommunityUiEvents();

export async function openCommunityPanel() {
  if (lifecycle.isDestroyed() || !hasRequiredElements()) {
    return false;
  }

  if (!openSharedPanel(COMMUNITY_PANEL_NAME)) {
    return false;
  }

  // Closing stops the virtualizer, which empties the days it had mounted, so
  // the cards already loaded are drawn again before anything is fetched.
  if (palettes.length > 0) {
    galleryPresenter.render();
  }
  syncChrome();
  if (needsReload) {
    needsReload = false;
    void (view === "collected" ? collectionController.refresh() : feedController.refresh());
  } else {
    void activeController().ensureLoaded();
  }
  return true;
}

export function destroyCommunityUi() {
  if (lifecycle.isDestroyed()) {
    return false;
  }

  closeSharedPanel(COMMUNITY_PANEL_NAME);
  feedController.destroy();
  collectionController.destroy();
  viewerCoordinator.close();
  palettesById.clear();
  palettes = [];
  return lifecycle.destroy();
}
