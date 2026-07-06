export function dataUrlToBlob(dataUrl) {
  const [header, content] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);

  if (!mimeMatch) {
    throw new Error("Invalid data URL format.");
  }

  const mimeType = mimeMatch[1];
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);

  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
