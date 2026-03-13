import { describe, expect, test } from "bun:test";

import { buildCommunityCatchPublishPayload } from "./community-publish-payload.js";

describe("buildCommunityCatchPublishPayload", () => {
  test("keeps a RAL capture publish payload aligned with normal captures", () => {
    const payload = buildCommunityCatchPublishPayload(
      {
        timestamp: "2026-03-13T09:30:00.000Z",
        colors: [{ r: 49, g: 111, b: 75 }],
        captureAspectRatio: "4:3",
        captureCropRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
        captureMode: "ral",
        ralMatch: {
          code: "RAL 6001",
          name: "Emerald green",
          r: 49,
          g: 111,
          b: 75,
          deltaE: 0,
        },
      },
      "base64-photo",
    );

    expect(payload).toEqual({
      photoBase64: "base64-photo",
      timestamp: "2026-03-13T09:30:00.000Z",
      colors: [{ r: 49, g: 111, b: 75 }],
      captureAspectRatio: "4:3",
      captureCropRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
    });
    expect(payload).not.toHaveProperty("captureMode");
    expect(payload).not.toHaveProperty("ralMatch");
  });

  test("normalizes channel values and drops invalid colors", () => {
    const payload = buildCommunityCatchPublishPayload(
      {
        timestamp: "2026-03-13T09:30:00.000Z",
        colors: [
          { r: 300.2, g: -10, b: 70.6 },
          { r: "bad", g: 10, b: 20 },
        ],
      },
      "base64-photo",
    );

    expect(payload.colors).toEqual([{ r: 255, g: 0, b: 71 }]);
  });
});
