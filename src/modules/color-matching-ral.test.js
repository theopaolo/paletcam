import { describe, expect, test } from 'bun:test';

import { setLocale } from '../i18n.js';
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
  test('returns similarity percentage based on deltaE', () => {
    setLocale('en', { force: true });
    expect(getRalQualityLabel(0)).toBe('RAL match 100%');
    expect(getRalQualityLabel(5)).toBe('RAL match 50%');
    expect(getRalQualityLabel(10)).toBe('RAL match 0%');
  });

  test('clamps at 0% for high deltaE', () => {
    setLocale('en', { force: true });
    expect(getRalQualityLabel(15)).toBe('RAL match 0%');
  });

  test('returns empty string for non-finite values', () => {
    setLocale('en', { force: true });
    expect(getRalQualityLabel(NaN)).toBe('');
    expect(getRalQualityLabel(Infinity)).toBe('');
  });
});
