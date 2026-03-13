function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function loadPhotoImage(blob) {
  if (!(blob instanceof Blob)) {
    return Promise.reject(new Error("Missing photo blob"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const photoUrl = URL.createObjectURL(blob);
    let settled = false;

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };

    const finalize = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      URL.revokeObjectURL(photoUrl);
      callback();
    };

    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        finalize(() => reject(new Error("Photo has invalid dimensions")));
        return;
      }

      finalize(() => resolve(image));
    };
    image.onerror = () => {
      finalize(() => reject(new Error("Unable to decode photo")));
    };
    image.src = photoUrl;
  });
}

function getPreferredPhotoType(photoBlob, preferredType) {
  if (typeof preferredType === "string" && preferredType) {
    return preferredType;
  }

  if (photoBlob?.type === "image/png") {
    return "image/png";
  }

  if (photoBlob?.type === "image/webp") {
    return "image/webp";
  }

  return "image/jpeg";
}

export async function normalizePhotoBlob(
  photoBlob,
  {
    mirror = false,
    preferredType = null,
    quality = 0.92,
  } = {},
) {
  if (!(photoBlob instanceof Blob)) {
    return null;
  }

  const image = await loadPhotoImage(photoBlob);
  const photoCanvas = document.createElement("canvas");
  const photoContext = photoCanvas.getContext("2d");

  if (!photoContext) {
    return null;
  }

  const photoWidth = image.naturalWidth || image.width;
  const photoHeight = image.naturalHeight || image.height;

  if (photoWidth <= 0 || photoHeight <= 0) {
    return null;
  }

  photoCanvas.width = photoWidth;
  photoCanvas.height = photoHeight;
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = "high";

  photoContext.save();
  if (mirror) {
    photoContext.scale(-1, 1);
    photoContext.drawImage(image, -photoWidth, 0, photoWidth, photoHeight);
  } else {
    photoContext.drawImage(image, 0, 0, photoWidth, photoHeight);
  }
  photoContext.restore();

  const targetType = getPreferredPhotoType(photoBlob, preferredType);
  const normalizedBlob = await canvasToBlob(photoCanvas, targetType, quality);

  if (normalizedBlob?.type === targetType) {
    return normalizedBlob;
  }

  if (targetType !== "image/jpeg") {
    return canvasToBlob(photoCanvas, "image/jpeg", quality);
  }

  return normalizedBlob;
}
