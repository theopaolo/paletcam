export function isIOSDevice({
  userAgent = globalThis.navigator?.userAgent,
  platform = globalThis.navigator?.platform,
  maxTouchPoints = globalThis.navigator?.maxTouchPoints,
} = {}) {
  const ua = String(userAgent || "");
  const navigatorPlatform = String(platform || "");
  const touchPoints = Number(maxTouchPoints) || 0;

  return (
    /iPad|iPhone|iPod/.test(ua) ||
    ((/Macintosh/.test(ua) || /MacIntel/.test(navigatorPlatform)) && touchPoints > 1)
  );
}
