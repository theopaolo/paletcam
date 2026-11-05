import { describe, expect, test } from "bun:test";
import { getCommunityPreviewAsset, hexToRgb, toCommunityPalette } from "./community-palette.js";

const item = {
  id: "01J0000000000000000000000A",
  userName: "nuagelait",
  caughtAt: "2026-11-05T10:00:00.000Z",
  colors: ["#ffc800", "#000000", "#112233"],
  squareUrl: "https://colorcatchers.co/catch/square/1",
  polaroidUrl: "https://colorcatchers.co/catch/polaroid/1",
  url: "/c/1",
};

describe("community palette", () => {
  test("reads hex colors as rgb", () => {
    expect(hexToRgb("#ffc800")).toEqual({ r: 255, g: 200, b: 0 });
    expect(hexToRgb("#112233")).toEqual({ r: 17, g: 34, b: 51 });
  });

  test("dresses a feed item as a palette the gallery can draw", () => {
    const palette = toCommunityPalette(item);
    expect(palette.id).toBe(item.id);
    expect(palette.timestamp).toBe(item.caughtAt);
    expect(palette.colors).toEqual([
      { r: 255, g: 200, b: 0 },
      { r: 0, g: 0, b: 0 },
      { r: 17, g: 34, b: 51 },
    ]);
    expect(palette.community.userName).toBe("nuagelait");
  });

  test("previews come as a url, never pixels", async () => {
    expect(await getCommunityPreviewAsset(toCommunityPalette(item))).toEqual({
      url: item.polaroidUrl,
    });
    await expect(getCommunityPreviewAsset({ id: "x" })).rejects.toThrow();
  });
});
