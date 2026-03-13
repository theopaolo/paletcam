function blobToImage(blob) {
  if (!(blob instanceof Blob)) {
    return Promise.reject(new Error("Missing photo blob"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to decode photo"));
    };
    image.src = objectUrl;
  });
}

export async function normalizePhotoBlob(photoBlob, quality = 0.92) {
  if (!(photoBlob instanceof Blob)) {
    return null;
  }

  const image = await blobToImage(photoBlob);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null;
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}
