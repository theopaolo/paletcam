let viewerOverlayController;
const viewerOverlayCloseListeners = new Set();

function notifyViewerOverlayClosed() {
  viewerOverlayCloseListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("Palette viewer close listener failed:", error);
    }
  });
}

function getActionIconMarkup(iconName) {
  if (iconName === "export") {
    return `
      <svg viewBox="0 0 256 256" aria-hidden="true">
        <path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"></path>
      </svg>
    `;
  }

  if (iconName === "share") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#000000" viewBox="0 0 256 256"><path d="M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z"></path></svg>
    `;
  }

  return `
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"></path>
    </svg>
  `;
}

function createViewerActionButton({ className, label, iconName, visibleLabel }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `palette-quick-action ${className}`;
  button.setAttribute("aria-label", label);
  button.innerHTML = `
    ${getActionIconMarkup(iconName)}
    ${
    visibleLabel
      ? `<span class="palette-quick-action-label">${visibleLabel}</span>`
      : ""
  }
  `;
  return button;
}

function createPaletteViewerOverlayController() {
  const overlay = document.createElement("div");
  overlay.className = "palette-viewer-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const topbar = document.createElement("div");
  topbar.className = "palette-viewer-topbar";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "palette-viewer-close";
  closeButton.setAttribute("aria-label", "Fermer l'aperçu");
  closeButton.textContent = "×";

  const imageFrame = document.createElement("div");
  imageFrame.className = "palette-viewer-frame";

  const image = document.createElement("img");
  image.className = "palette-viewer-image";
  image.alt = "Aperçu de palette";
  image.hidden = true;
  image.decoding = "async";

  const status = document.createElement("p");
  status.className = "palette-viewer-status";

  const actions = document.createElement("div");
  actions.className = "palette-viewer-actions";

  const shareButton = createViewerActionButton({
    className: "palette-action-share",
    label: "Partager la palette",
    iconName: "share",
    visibleLabel: "partager",
  });
  const exportButton = createViewerActionButton({
    className: "palette-action-export",
    label: "Exporter la palette",
    iconName: "export",
    visibleLabel: "exporter",
  });
  const deleteButton = createViewerActionButton({
    className: "palette-action-delete",
    label: "Supprimer la palette",
    iconName: "delete",
    visibleLabel: "supprimer",
  });

  topbar.append(closeButton);
  imageFrame.append(image, status);
  actions.append(shareButton, exportButton, deleteButton);
  overlay.append(topbar, imageFrame, actions);
  document.body.append(overlay);

  let activeRequestId = 0;
  let activeSession;
  let isBusy = false;

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    shareButton.disabled = nextBusy || !activeSession?.canShare;
    exportButton.disabled = nextBusy || !activeSession?.canExport;
    deleteButton.disabled = nextBusy || !activeSession?.canDelete;
    overlay.classList.toggle("is-busy", nextBusy);
  }

  function close() {
    const wasOpen = !overlay.hidden;
    activeRequestId += 1;
    activeSession = undefined;
    image.hidden = true;
    image.removeAttribute("src");
    status.textContent = "";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    setBusy(false);

    if (wasOpen) {
      notifyViewerOverlayClosed();
    }
  }

  async function runAction(actionName) {
    if (isBusy || !activeSession) {
      return;
    }

    const action = activeSession[actionName];
    if (typeof action !== "function") {
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

  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    close();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  imageFrame.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  [topbar, actions].forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || overlay.hidden) {
      return;
    }

    event.preventDefault();
    close();
  });

  shareButton.addEventListener("click", () => {
    void runAction("onShare");
  });
  exportButton.addEventListener("click", () => {
    void runAction("onExport");
  });
  deleteButton.addEventListener("click", () => {
    void runAction("onDelete");
  });

  return {
    close,
    async open({
      getPreviewAsset,
      onShare,
      onExport,
      onDelete,
      canShare = true,
      canExport = true,
      canDelete = true,
    }) {
      activeRequestId += 1;
      const requestId = activeRequestId;

      activeSession = {
        onShare,
        onExport,
        onDelete,
        canShare,
        canExport,
        canDelete,
      };

      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      image.hidden = true;
      image.removeAttribute("src");
      status.textContent = canExport ? "Chargement..." : "Aperçu indisponible";
      setBusy(false);

      if (!canExport || typeof getPreviewAsset !== "function") {
        return;
      }

      try {
        const asset = await getPreviewAsset();
        if (requestId !== activeRequestId || !activeSession) {
          return;
        }

        image.src = asset.objectUrl;
        image.hidden = false;
        status.textContent = "";
      } catch (error) {
        if (requestId !== activeRequestId || !activeSession) {
          return;
        }

        status.textContent = "Aperçu indisponible";
        console.error("Failed to load palette viewer preview:", error);
      }
    },
  };
}

function getPaletteViewerOverlayController() {
  viewerOverlayController ??= createPaletteViewerOverlayController();
  return viewerOverlayController;
}

export function openPaletteViewerOverlay(options) {
  return getPaletteViewerOverlayController().open(options);
}

export function closePaletteViewerOverlay() {
  viewerOverlayController?.close();
}

export function subscribePaletteViewerOverlayClose(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  viewerOverlayCloseListeners.add(listener);

  return () => {
    viewerOverlayCloseListeners.delete(listener);
  };
}
