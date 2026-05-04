import { afterEach, describe, expect, test } from "bun:test";

import { getColorNames, resetColorNameCacheForTests, toColorNameHex } from "./color-name-api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetColorNameCacheForTests();
});

describe("toColorNameHex", () => {
  test("normalizes RGB channels to uppercase hex", () => {
    expect(toColorNameHex({ r: 11.2, g: 127.6, b: 300 })).toBe("#0B80FF");
  });
});

describe("getColorNames", () => {
  test("returns fetched names in the original color order", async () => {
    const requests = [];

    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            colors: [
              {
                name: "Glacial Haze",
                requestedHex: "#D8E8F2",
              },
              {
                name: "Watermelon Punch",
                requestedHex: "#F45363",
              },
            ],
          };
        },
      };
    };

    const colorNames = await getColorNames([
      { r: 216, g: 232, b: 242 },
      { r: 244, g: 83, b: 99 },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("values=D8E8F2%2CF45363");
    expect(colorNames).toEqual(["Glacial Haze", "Watermelon Punch"]);
  });

  test("falls back to hex labels when the request fails", async () => {
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    await expect(
      getColorNames([
        { r: 216, g: 232, b: 242 },
        { r: 244, g: 83, b: 99 },
      ]),
    ).resolves.toEqual(["#D8E8F2", "#F45363"]);
  });

  test("reuses cached names for repeat colors", async () => {
    let callCount = 0;

    globalThis.fetch = async () => {
      callCount += 1;
      return {
        ok: true,
        async json() {
          return {
            colors: [
              {
                name: "Lime Rickey",
                requestedHex: "#8DCE00",
              },
            ],
          };
        },
      };
    };

    expect(await getColorNames([{ r: 141, g: 206, b: 0 }])).toEqual(["Lime Rickey"]);
    expect(await getColorNames([{ r: 141, g: 206, b: 0 }])).toEqual(["Lime Rickey"]);
    expect(callCount).toBe(1);
  });
});
