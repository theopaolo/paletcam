import { rgbToOklab, rgbToOklch } from "../color-space-oklch.js";

/** Below this OKLCh chroma a catch has no color worth sorting by hue. */
const NEUTRAL_CHROMA = 0.05;
/** OKLab distance under which two colors read as the same color. */
const SAME_COLOR_DISTANCE = 0.05;
/** The hue wheel is cut here so the reds sit in one run at the start. */
const HUE_START_DEG = 350;
/** Upper bound of each hue family, in degrees past HUE_START_DEG. @type {ReadonlyArray<[number, string]>} */
const HUE_FAMILIES = Object.freeze([
  [50, "red"],
  [85, "orange"],
  [120, "yellow"],
  [185, "green"],
  [235, "teal"],
  [300, "blue"],
  [360, "purple"],
]);

/**
 * The color a catch is sorted by: its most chromatic one, so a blue poster on a
 * beige wall files the catch under blue.
 * @param {Palette} palette
 */
export function getPaletteKeyColor(palette) {
  const colors = palette?.colors ?? [];
  let keyIndex = 0;
  let keyChroma = -1;
  let keyHue = 0;
  let lightnessSum = 0;

  colors.forEach((color, index) => {
    const { l, c, h } = rgbToOklch(color.r, color.g, color.b);
    lightnessSum += l;
    if (c > keyChroma) {
      keyIndex = index;
      keyChroma = c;
      keyHue = h;
    }
  });

  return {
    index: keyIndex,
    color: colors[keyIndex] ?? { r: 74, g: 74, b: 74 },
    isNeutral: keyChroma < NEUTRAL_CHROMA,
    hue: (keyHue - HUE_START_DEG + 360) % 360,
    lightness: colors.length > 0 ? lightnessSum / colors.length : 0,
  };
}

/**
 * Orders catches around the hue wheel, neutrals last from light to dark. Each
 * entry carries its colors with the key color first, so the top bands of a
 * wall of chips read as one spectrum.
 * @param {Palette[]} palettes
 * @returns {{ palette: Palette, family: string, color: {r: number, g: number, b: number}, colors: Palette["colors"] }[]}
 */
export function orderPalettesBySpectrum(palettes) {
  const keyed = palettes.map((palette) => ({ palette, key: getPaletteKeyColor(palette) }));
  const chromatic = keyed.filter(({ key }) => !key.isNeutral).sort((a, b) => a.key.hue - b.key.hue);
  const neutral = keyed
    .filter(({ key }) => key.isNeutral)
    .sort((a, b) => b.key.lightness - a.key.lightness);

  return [...chromatic, ...neutral].map(({ palette, key }) => ({
    palette,
    family: key.isNeutral ? "neutral" : (HUE_FAMILIES.find(([end]) => key.hue < end)?.[1] ?? "red"),
    color: key.color,
    colors: [key.color, ...palette.colors.filter((_, index) => index !== key.index)],
  }));
}

/**
 * A filter for the catches holding a color that reads as the target one.
 * ponytail: fixed tolerance; make it adjustable if searches feel too strict.
 * @param {RgbColor} target
 * @returns {(palette: Palette) => boolean}
 */
export function createSameColorMatcher(target) {
  const goal = rgbToOklab(target.r, target.g, target.b);
  return (palette) =>
    (palette?.colors ?? []).some((color) => {
      const lab = rgbToOklab(color.r, color.g, color.b);
      return Math.hypot(lab.L - goal.L, lab.a - goal.a, lab.b - goal.b) < SAME_COLOR_DISTANCE;
    });
}
