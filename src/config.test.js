import { describe, expect, test } from "bun:test";

import { isPreprodBranch } from "./config.js";

describe("isPreprodBranch", () => {
  test("matches the preprod branch name case-insensitively", () => {
    expect(isPreprodBranch("preprod")).toBe(true);
    expect(isPreprodBranch("PreProd")).toBe(true);
    expect(isPreprodBranch("  preprod  ")).toBe(true);
    expect(isPreprodBranch("pwa/preprod")).toBe(true);
  });

  test("rejects production and empty branch names", () => {
    expect(isPreprodBranch("prod")).toBe(false);
    expect(isPreprodBranch("production")).toBe(false);
    expect(isPreprodBranch("pwa/prod")).toBe(false);
    expect(isPreprodBranch("main")).toBe(false);
    expect(isPreprodBranch("")).toBe(false);
  });
});
