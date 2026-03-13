function normalizeColor(color) {
  if (!color || typeof color !== "object") {
    return null;
  }

  const r = Number(color.r);
  const g = Number(color.g);
  const b = Number(color.b);

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

export function normalizeColorsForApi(colors) {
  return Array.isArray(colors)
    ? colors.map((color) => normalizeColor(color)).filter(Boolean)
    : [];
}

export function getPaletteTimestamp(palette) {
  const parsedDate = new Date(palette?.timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString();
  }

  return parsedDate.toISOString();
}

export function buildCommunityCatchPublishPayload(palette, photoBase64) {
  return {
    photoBase64,
    timestamp: getPaletteTimestamp(palette),
    colors: normalizeColorsForApi(palette?.colors),
    captureAspectRatio: palette?.captureAspectRatio || null,
    captureCropRect: palette?.captureCropRect || null,
  };
}
