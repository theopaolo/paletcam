import { afterEach, describe, expect, test } from "bun:test";

import { getColorNames, resetColorNameCacheForTests, toColorNameHex } from "./color-name-api.js";

afterEach(() => {
  resetColorNameCacheForTests();
});

describe("toColorNameHex", () => {
  test("normalizes RGB channels to uppercase hex", () => {
    expect(toColorNameHex({ r: 11.2, g: 127.6, b: 300 })).toBe("#0B80FF");
  });
});

describe("getColorNames", () => {
  test("returns exact offline names in the original color order", async () => {
    const colorNames = await getColorNames([
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 191, b: 0 },
    ]);

    expect(colorNames).toEqual(["White", "Amber"]);
  });

  test("returns nearest offline names for colors without an exact hex match", async () => {
    const colorNames = await getColorNames([{ r: 151, g: 157, b: 26 }]);

    expect(colorNames).toEqual(["Papyrus"]);
  });

  test("reuses cached names for repeat colors", async () => {
    expect(await getColorNames([{ r: 255, g: 255, b: 255 }])).toEqual(["White"]);
    expect(await getColorNames([{ r: 255, g: 255, b: 255 }])).toEqual(["White"]);
  });

  test("returns an empty list for empty input", async () => {
    await expect(getColorNames([])).resolves.toEqual([]);
  });
});
