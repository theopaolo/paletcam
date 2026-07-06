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
  return Array.isArray(colors) ? colors.map((color) => normalizeColor(color)).filter(Boolean) : [];
}

export function getPaletteTimestamp(palette) {
  const parsedDate = new Date(palette?.timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString();
  }

  return parsedDate.toISOString();
}

function normalizeRalCode(code) {
  if (typeof code !== "string") {
    return null;
  }

  const normalized = code.trim();
  return normalized ? normalized : null;
}

function normalizeRalProximity(ralMatch) {
  const deltaE = Number(ralMatch?.deltaE);
  if (!Number.isFinite(deltaE)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(100 - deltaE * 10)));
}

function getRalPublishMetadata(palette) {
  if (
    palette?.captureMode !== "ral" ||
    !palette?.ralMatch ||
    typeof palette.ralMatch !== "object"
  ) {
    return {};
  }

  const ralCode = normalizeRalCode(palette.ralMatch.code);
  const ralProximity = normalizeRalProximity(palette.ralMatch);

  return {
    ...(ralCode ? { ralCode } : {}),
    ...(ralProximity !== null ? { ralProximity } : {}),
  };
}

export function buildCommunityCatchPublishPayload(palette, photoBase64) {
  return {
    photoBase64,
    timestamp: getPaletteTimestamp(palette),
    colors: normalizeColorsForApi(palette?.colors),
    captureAspectRatio: palette?.captureAspectRatio || null,
    captureCropRect: palette?.captureCropRect || null,
    ...getRalPublishMetadata(palette),
  };
}
