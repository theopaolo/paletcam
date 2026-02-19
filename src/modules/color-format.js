export function toRgbCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHexColor({ r, g, b }) {
  const red = r.toString(16).padStart(2, "0").toUpperCase();
  const green = g.toString(16).padStart(2, "0").toUpperCase();
  const blue = b.toString(16).padStart(2, "0").toUpperCase();
  return `#${red}${green}${blue}`;
}

export function formatHslColor(color) {
  const normalizedR = color.r / 255;
  const normalizedG = color.g / 255;
  const normalizedB = color.b / 255;
  const maxChannel = Math.max(normalizedR, normalizedG, normalizedB);
  const minChannel = Math.min(normalizedR, normalizedG, normalizedB);
  const delta = maxChannel - minChannel;
  const lightness = (maxChannel + minChannel) / 2;
  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs((2 * lightness) - 1));

  let hue = 0;
  if (delta !== 0) {
    if (maxChannel === normalizedR) {
      hue = ((normalizedG - normalizedB) / delta) % 6;
    } else if (maxChannel === normalizedG) {
      hue = ((normalizedB - normalizedR) / delta) + 2;
    } else {
      hue = ((normalizedR - normalizedG) / delta) + 4;
    }
  }

  const roundedHue = Math.round(hue * 60 < 0 ? (hue * 60) + 360 : hue * 60);
  const roundedSaturation = Math.round(saturation * 100);
  const roundedLightness = Math.round(lightness * 100);

  return `hsl(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%)`;
}
