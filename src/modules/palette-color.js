/**
 * Rich PaletteColor wrapper.
 *
 * Returns a plain object with enumerable { r, g, b, population } so existing
 * code that spreads / clones colors ({ ...color }) keeps working unchanged.
 *
 * Extra capabilities (hex, hsl, oklch, isDark, contrast, css) are attached as
 * non-enumerable getters/methods so they don't leak into spreads or JSON but
 * are available for any new code that wants richer color info.
 */

import { rgbToHsl } from './color-math.js';
import {
  rgbToOklch,
  relativeLuminance,
  contrastRatio,
} from './color-space-oklch.js';

/**
 * @param {number} r  0-255
 * @param {number} g  0-255
 * @param {number} b  0-255
 * @param {number} [population]  pixel count from quantizer
 * @returns {PaletteColor}
 */
export function createPaletteColor(r, g, b, population = 0) {
  const color = { r, g, b, population };

  // Lazy caches (closure-scoped, invisible to consumers)
  let _hsl = null;
  let _oklch = null;
  let _luminance = null;
  let _hex = null;

  Object.defineProperties(color, {
    // ---- Computed color representations ----

    hex: {
      get() {
        if (!_hex) {
          const toHex = (n) => n.toString(16).padStart(2, '0');
          _hex = `#${toHex(this.r)}${toHex(this.g)}${toHex(this.b)}`;
        }
        return _hex;
      },
      enumerable: false,
    },

    hsl: {
      get() {
        if (!_hsl) _hsl = rgbToHsl(this.r, this.g, this.b);
        return _hsl;
      },
      enumerable: false,
    },

    oklch: {
      get() {
        if (!_oklch) _oklch = rgbToOklch(this.r, this.g, this.b);
        return _oklch;
      },
      enumerable: false,
    },

    // ---- Luminance & contrast ----

    luminance: {
      get() {
        if (_luminance === null) {
          _luminance = relativeLuminance(this.r, this.g, this.b);
        }
        return _luminance;
      },
      enumerable: false,
    },

    isDark: {
      get() {
        return this.luminance <= 0.179;
      },
      enumerable: false,
    },

    isLight: {
      get() {
        return !this.isDark;
      },
      enumerable: false,
    },

    textColor: {
      get() {
        return this.isDark ? '#ffffff' : '#000000';
      },
      enumerable: false,
    },

    contrast: {
      get() {
        const lum = this.luminance;
        const white = contrastRatio(lum, 1);
        const black = contrastRatio(lum, 0);
        return {
          white: Math.round(white * 100) / 100,
          black: Math.round(black * 100) / 100,
        };
      },
      enumerable: false,
    },

    // ---- CSS output ----

    css: {
      value(format = 'rgb') {
        switch (format) {
          case 'hsl': {
            const { h, s, l } = this.hsl;
            return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
          }
          case 'oklch': {
            const { l, c, h } = this.oklch;
            return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
          }
          case 'hex':
            return this.hex;
          default:
            return `rgb(${this.r}, ${this.g}, ${this.b})`;
        }
      },
      enumerable: false,
    },

    toString: {
      value() {
        return this.hex;
      },
      enumerable: false,
    },
  });

  return color;
}

/**
 * Enrich an array of plain { r, g, b } colors into PaletteColors.
 * Safe to call on colors that are already PaletteColors (returns as-is).
 *
 * @param {Array<{ r: number, g: number, b: number, population?: number }>} colors
 * @returns {PaletteColor[]}
 */
export function enrichPaletteColors(colors) {
  return colors.map((c) =>
    // Skip if already enriched (has non-enumerable hex getter)
    Object.getOwnPropertyDescriptor(c, 'hex')
      ? c
      : createPaletteColor(c.r, c.g, c.b, c.population ?? 0)
  );
}
