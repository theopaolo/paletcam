export function createPhotoOutputController(photoOutput) {
  let currentPhotoObjectUrl = "";

  function revokeObjectUrl() {
    if (!currentPhotoObjectUrl) {
      return;
    }

    URL.revokeObjectURL(currentPhotoObjectUrl);
    currentPhotoObjectUrl = "";
  }

  function clear() {
    revokeObjectUrl();
    photoOutput?.removeAttribute("src");
    photoOutput?.removeAttribute("data-palette-id");
    if (photoOutput) {
      photoOutput.hidden = true;
    }
  }

  function setBlob(blob) {
    if (!(blob instanceof Blob) || !photoOutput) {
      return;
    }

    revokeObjectUrl();
    currentPhotoObjectUrl = URL.createObjectURL(blob);
    photoOutput.hidden = true;
    photoOutput.setAttribute("src", currentPhotoObjectUrl);
  }

  function getPaletteId() {
    const paletteId = Number(photoOutput?.dataset.paletteId);
    return Number.isFinite(paletteId) ? paletteId : null;
  }

  function clearPaletteId() {
    photoOutput?.removeAttribute("data-palette-id");
  }

  function hasPhoto() {
    return Boolean(photoOutput?.getAttribute("src"));
  }

  function setPaletteId(paletteId) {
    if (!photoOutput) {
      return;
    }

    if (paletteId !== undefined && paletteId !== null) {
      photoOutput.dataset.paletteId = String(paletteId);
      return;
    }

    clearPaletteId();
  }

  return {
    clear,
    clearPaletteId,
    getPaletteId,
    hasPhoto,
    setBlob,
    setPaletteId,
  };
}
