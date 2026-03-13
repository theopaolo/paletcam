import { describe, expect, test } from 'bun:test';

import { computeRalPopoverPosition } from './ral-popover-position.js';

describe('computeRalPopoverPosition', () => {
  test('positions the popover above the anchor using its measured height', () => {
    const position = computeRalPopoverPosition(
      { bottom: 140, left: 120, top: 100, width: 48 },
      { height: 56, width: 140 },
      360,
    );

    expect(position).toEqual({ left: 74, top: 36 });
  });

  test('flips below the anchor when there is not enough room above', () => {
    const position = computeRalPopoverPosition(
      { bottom: 42, left: 20, top: 12, width: 48 },
      { height: 64, width: 140 },
      320,
    );

    expect(position).toEqual({ left: 8, top: 50 });
  });
});
