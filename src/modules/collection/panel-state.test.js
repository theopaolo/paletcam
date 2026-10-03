import { describe, expect, test } from "bun:test";

import { buildCollectionPanelTitle } from "./panel-state.js";

describe("collection panel state", () => {
  test("builds the capture title with the total count", () => {
    expect(buildCollectionPanelTitle(0)).toBe("Captures (0)");
    expect(buildCollectionPanelTitle(12)).toBe("Captures (12)");
  });
});
