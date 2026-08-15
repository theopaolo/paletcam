import { describe, expect, test } from "bun:test";

import {
  alignPaletteToReference,
  labConfigFromSearchParams,
  normalizeLabConfig,
  PIPELINES,
  writeLabConfigToSearchParams,
} from "./extraction-lab-model.js";

describe("extraction lab model", () => {
  test("exposes the two Grid experiments as distinct reproducible pipelines", () => {
    expect(PIPELINES.map((pipeline) => pipeline.id)).toEqual([
      "before",
      "after",
      "grid",
      "grid-lab",
      "grid-hybrid",
    ]);
  });

  test("normalizes shared configurations to supported control steps", () => {
    expect(
      normalizeLabConfig({
        swatchCount: 99,
        poolSize: 23.7,
        maxPixels: 13111,
        repulsion: 0.063,
        variety: -4,
        tone: 52.4,
        auto: false,
      }),
    ).toEqual({
      swatchCount: 12,
      poolSize: 24,
      maxPixels: 14000,
      repulsion: 0.065,
      variety: 0,
      tone: 52,
      neutralBalance: "balanced",
      auto: false,
      smooth: true,
    });
  });

  test("round-trips a reproducible configuration through URL parameters", () => {
    const source = normalizeLabConfig({
      poolSize: 48,
      maxPixels: 60000,
      tone: 25,
      neutralBalance: "neutrals",
      smooth: false,
    });
    const params = writeLabConfigToSearchParams(source);
    expect(labConfigFromSearchParams(params)).toEqual(source);
  });

  test("aligns another algorithm to production by perceptual proximity", () => {
    const reference = [{ rgb: { r: 240, g: 30, b: 20 } }, { rgb: { r: 20, g: 40, b: 230 } }];
    const reversed = [
      { name: "blue", rgb: { r: 25, g: 45, b: 225 } },
      { name: "red", rgb: { r: 235, g: 35, b: 25 } },
    ];

    expect(alignPaletteToReference(reference, reversed).map((entry) => entry.name)).toEqual([
      "red",
      "blue",
    ]);
  });
});
