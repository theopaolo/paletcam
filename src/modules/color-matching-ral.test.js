import { describe, expect, test } from 'bun:test';

import { findClosestRAL, getRalQualityLabel, matchPaletteToRAL } from './color-matching-ral.js';

describe('color-matching-ral', () => {
  test('returns the exact RAL entry as the closest match for known palette colors', () => {
    const green = findClosestRAL(49, 111, 75, 1)[0];
    const yellow = findClosestRAL(249, 168, 0, 1)[0];

    expect(green.ral.code).toBe('RAL 6001');
    expect(green.ral.name).toBe('Emerald green');
    expect(green.deltaE).toBeLessThan(0.1);

    expect(yellow.ral.code).toBe('RAL 1003');
    expect(yellow.ral.name).toBe('Signal yellow');
    expect(yellow.deltaE).toBeLessThan(0.1);
  });

  test('matches each palette color independently and preserves order', () => {
    const result = matchPaletteToRAL([
      { r: 41, g: 134, b: 184 },
      { r: 236, g: 236, b: 231 },
    ], 1);

    expect(result).toHaveLength(2);
    expect(result[0].matches[0].ral.code).toBe('RAL 5012');
    expect(result[1].matches[0].ral.code).toBe('RAL 9003');
  });
});

describe('getRalQualityLabel', () => {
  test('returns Très proche for deltaE <= 2', () => {
    expect(getRalQualityLabel(0)).toBe('Très proche');
    expect(getRalQualityLabel(1.5)).toBe('Très proche');
    expect(getRalQualityLabel(2)).toBe('Très proche');
  });

  test('returns Proche for deltaE <= 5', () => {
    expect(getRalQualityLabel(2.1)).toBe('Proche');
    expect(getRalQualityLabel(5)).toBe('Proche');
  });

  test('returns Bonne piste for deltaE <= 10', () => {
    expect(getRalQualityLabel(5.1)).toBe('Bonne piste');
    expect(getRalQualityLabel(10)).toBe('Bonne piste');
  });

  test('returns Approximation for deltaE > 10', () => {
    expect(getRalQualityLabel(10.1)).toBe('Approximation');
    expect(getRalQualityLabel(50)).toBe('Approximation');
  });

  test('returns empty string for non-finite values', () => {
    expect(getRalQualityLabel(NaN)).toBe('');
    expect(getRalQualityLabel(Infinity)).toBe('');
  });
});
