import { describe, expect, test } from "bun:test";

import { irisBladePaths } from "./iris-shutter.js";

/** First and last coordinate pairs of an SVG path (the arc flags in between break pairing). */
function ends(d) {
  const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number);
  return { first: numbers.slice(0, 2), last: numbers.slice(-2) };
}

describe("irisBladePaths", () => {
  test("cuts count x perColor closed blades, grouped by color", () => {
    const blades = irisBladePaths({ count: 4, perColor: 3, aperture: 5 });

    expect(blades).toHaveLength(12);
    expect(blades.every(({ d }) => d.startsWith("M") && d.endsWith("Z"))).toBe(true);
    expect(blades.map(({ colorIndex }) => colorIndex)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
  });

  test("neighbouring blades share the aperture vertex between them", () => {
    const blades = irisBladePaths({ count: 5, perColor: 2, aperture: 6, bend: 0.2 });
    blades.forEach((blade, i) => {
      const next = blades[(i + 1) % blades.length];
      expect(ends(blade.d).last).toEqual(ends(next.d).first);
    });
  });

  test("a closed aperture brings every blade to the center", () => {
    const blades = irisBladePaths({ count: 6, perColor: 2, aperture: 0 });

    expect(blades.every(({ d }) => ends(d).first.join() === "32,32")).toBe(true);
  });

  test("fewer than three blades draws nothing", () => {
    expect(irisBladePaths({ count: 2, perColor: 1, aperture: 5 })).toEqual([]);
  });
});
