import { describe, expect, test } from 'bun:test';

import { createPaletteColor, enrichPaletteColors } from './palette-color.js';

describe('palette-color', () => {
  test('returns normalized hsl values and formatted css strings', () => {
    const color = createPaletteColor(255, 0, 0, 12);

    expect(color.population).toBe(12);
    expect(color.hex).toBe('#ff0000');
    expect(color.hsl.h).toBe(0);
    expect(color.hsl.s).toBe(1);
    expect(color.hsl.l).toBe(0.5);
    expect(color.css('hsl')).toBe('hsl(0, 100%, 50%)');
  });

  test('computes readable contrast helpers without leaking fields into spreads', () => {
    const color = createPaletteColor(20, 30, 40);

    expect(color.isDark).toBe(true);
    expect(color.textColor).toBe('#ffffff');
    expect(color.contrast.white).toBeGreaterThan(color.contrast.black);
    expect({ ...color }).toEqual({ r: 20, g: 30, b: 40, population: 0 });
  });

  test('enriches plain palette colors once', () => {
    const enriched = enrichPaletteColors([{ r: 10, g: 20, b: 30 }]);

    expect(enriched[0].hex).toBe('#0a141e');
    expect(enrichPaletteColors(enriched)[0]).toBe(enriched[0]);
  });
});
