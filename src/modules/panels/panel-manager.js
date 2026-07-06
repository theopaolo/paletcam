import "./shared-panel.js";

function getAllSharedPanels() {
  return Array.from(document.querySelectorAll("shared-panel[data-panel-name]"));
}

function getSharedPanel(panelName) {
  return /** @type {HTMLElement | null} */ (
    document.querySelector(`shared-panel[data-panel-name="${panelName}"]`)
  );
}

function getOpenSharedPanels() {
  return getAllSharedPanels().filter((panel) => panel.classList.contains("visible"));
}

function getPanelStackLevel(panel) {
  const zIndexValue = Number.parseInt(window.getComputedStyle(panel).zIndex || "0", 10);
  return Number.isFinite(zIndexValue) ? zIndexValue : 0;
}

function getTopOpenSharedPanel() {
  return (
    getOpenSharedPanels().sort(
      (leftPanel, rightPanel) => getPanelStackLevel(rightPanel) - getPanelStackLevel(leftPanel),
    )[0] || null
  );
}

function subscribeToSharedPanelEvent(panelName, eventName, listener) {
  const panel = getSharedPanel(panelName);
  if (!panel || typeof listener !== "function") {
    return () => {};
  }

  const handleEvent = (event) => {
    if (event.target !== panel) {
      return;
    }

    listener(event);
  };

  panel.addEventListener(eventName, handleEvent);
  return () => {
    panel.removeEventListener(eventName, handleEvent);
  };
}

function getDeepActiveElement() {
  let activeElement = document.activeElement;

  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }

  return activeElement instanceof HTMLElement ? activeElement : null;
}

function closePanelElement(panel, options) {
  panel?.closePanel?.(options);
}

export function closeAllSharedPanels({ exceptPanelName = "", restoreFocus = true } = {}) {
  getOpenSharedPanels().forEach((panel) => {
    if (panel.dataset.panelName === exceptPanelName) {
      return;
    }

    closePanelElement(panel, { restoreFocus });
  });
}

export function openSharedPanel(panelName, { closeOtherPanels = true } = {}) {
  const panel = getSharedPanel(panelName);
  if (!panel) {
    return false;
  }

  const returnFocusTarget = getDeepActiveElement();

  if (closeOtherPanels) {
    closeAllSharedPanels({ exceptPanelName: panelName, restoreFocus: false });
  }

  panel.openPanel?.(returnFocusTarget);
  return true;
}

export function closeSharedPanel(panelName) {
  const panel = getSharedPanel(panelName);
  if (!panel) {
    return false;
  }

  closePanelElement(panel);
  return true;
}

export function isSharedPanelOpen(panelName) {
  return Boolean(getSharedPanel(panelName)?.classList.contains("visible"));
}

export function subscribeSharedPanelClosing(panelName, listener) {
  return subscribeToSharedPanelEvent(panelName, "shared-panel-closing", listener);
}

export function subscribeSharedPanelClosed(panelName, listener) {
  return subscribeToSharedPanelEvent(panelName, "shared-panel-closed", listener);
}

if (!window.__sharedPanelEscapeHandlerBound) {
  window.__sharedPanelEscapeHandlerBound = true;

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    const topOpenPanel = getTopOpenSharedPanel();
    if (!topOpenPanel) {
      return;
    }

    event.preventDefault();
    closePanelElement(topOpenPanel);
  });
}
