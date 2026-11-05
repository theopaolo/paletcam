const DEFAULT_PAGE_SIZE = 24;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * @typedef {object} CommunityFeedState
 * @property {"idle" | "loading" | "ready" | "error"} status First-page lifecycle.
 * @property {CommunityFeedItem[]} items Newest first, de-duplicated by id.
 * @property {boolean} hasMore True while the server still has older pages.
 * @property {boolean} isLoadingMore
 * @property {boolean} loadMoreFailed The last "older page" request failed.
 * @property {unknown} error The last first-page error, when status is "error".
 * @property {number} version Bumped by every reload so views can tell "append" from "replace".
 */

/**
 * State machine behind the community feed panel: first page, cursor
 * pagination, retry and staleness. It owns no DOM; the panel renders from
 * `onChange`.
 *
 * @param {object} options
 * @param {(request: { after: string | null, limit: number, signal: AbortSignal }) => Promise<{ items: CommunityFeedItem[], nextCursor: string | null }>} options.fetchPage
 * @param {(state: CommunityFeedState) => void} [options.onChange]
 * @param {number} [options.pageSize]
 * @param {number} [options.staleAfterMs]
 * @param {() => number} [options.now]
 */
export function createCommunityFeedController({
  fetchPage,
  onChange,
  pageSize = DEFAULT_PAGE_SIZE,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now,
}) {
  /** @type {CommunityFeedState} */
  let state = {
    status: "idle",
    items: [],
    hasMore: false,
    isLoadingMore: false,
    loadMoreFailed: false,
    error: null,
    version: 0,
  };
  let cursor = null;
  let lastLoadedAt = 0;
  let requestId = 0;
  let abortController = null;
  let isDestroyed = false;

  function setState(patch) {
    state = { ...state, ...patch };
    onChange?.(state);
  }

  function startRequest() {
    abortController?.abort();
    abortController = new AbortController();
    requestId += 1;
    return { id: requestId, signal: abortController.signal };
  }

  function isCurrent(id) {
    return !isDestroyed && id === requestId;
  }

  async function loadFirstPage() {
    const request = startRequest();
    // Keep what is on screen during a background refresh; only a cold start shows the loader.
    setState({
      status: state.items.length > 0 ? "ready" : "loading",
      isLoadingMore: false,
      loadMoreFailed: false,
      error: null,
    });

    try {
      const page = await fetchPage({ after: null, limit: pageSize, signal: request.signal });
      if (!isCurrent(request.id)) {
        return;
      }
      cursor = page.nextCursor;
      lastLoadedAt = now();
      setState({
        status: "ready",
        items: dedupe(page.items),
        hasMore: page.nextCursor !== null,
        version: state.version + 1,
      });
    } catch (error) {
      if (!isCurrent(request.id)) {
        return;
      }
      // A failed background refresh keeps the stale items on screen.
      setState(
        state.items.length > 0
          ? { status: "ready" }
          : { status: "error", error, hasMore: false, version: state.version + 1 },
      );
    }
  }

  async function loadMore() {
    if (
      isDestroyed ||
      state.status !== "ready" ||
      !state.hasMore ||
      state.isLoadingMore ||
      cursor === null
    ) {
      return;
    }

    const request = startRequest();
    setState({ isLoadingMore: true, loadMoreFailed: false });

    try {
      const page = await fetchPage({ after: cursor, limit: pageSize, signal: request.signal });
      if (!isCurrent(request.id)) {
        return;
      }
      cursor = page.nextCursor;
      setState({
        isLoadingMore: false,
        items: dedupe([...state.items, ...page.items]),
        hasMore: page.nextCursor !== null,
      });
    } catch {
      if (!isCurrent(request.id)) {
        return;
      }
      setState({ isLoadingMore: false, loadMoreFailed: true });
    }
  }

  /** @param {CommunityFeedItem[]} items */
  function dedupe(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }

  /** Loads the feed on first use, retries after an error and refreshes a stale one. */
  function ensureLoaded() {
    if (isDestroyed || state.status === "loading") {
      return Promise.resolve();
    }
    if (state.status === "idle" || state.status === "error") {
      return loadFirstPage();
    }
    if (now() - lastLoadedAt >= staleAfterMs && !state.isLoadingMore) {
      return loadFirstPage();
    }
    return Promise.resolve();
  }

  /** Pull-to-refresh style reload. */
  function refresh() {
    return isDestroyed ? Promise.resolve() : loadFirstPage();
  }

  /** Cancels in-flight requests, e.g. when the panel closes. */
  function cancelPending() {
    if (state.status === "loading" && state.items.length === 0) {
      abortController?.abort();
      requestId += 1;
      setState({ status: "idle" });
    } else if (state.isLoadingMore) {
      abortController?.abort();
      requestId += 1;
      setState({ isLoadingMore: false });
    }
  }

  function destroy() {
    isDestroyed = true;
    requestId += 1;
    abortController?.abort();
    abortController = null;
  }

  return {
    cancelPending,
    destroy,
    ensureLoaded,
    getState: () => state,
    loadMore,
    refresh,
  };
}
