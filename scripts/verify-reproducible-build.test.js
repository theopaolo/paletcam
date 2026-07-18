import { describe, expect, test } from "bun:test";
import { assertMatchingBuildSnapshots } from "./verify-reproducible-build.js";

describe("reproducible production builds", () => {
  test("accepts identical sorted file lists and content hashes", () => {
    expect(() =>
      assertMatchingBuildSnapshots(
        { files: ["app.js", "index.html"], sha256: "same" },
        { files: ["app.js", "index.html"], sha256: "same" },
      ),
    ).not.toThrow();
  });

  test("rejects byte or file-set drift", () => {
    expect(() =>
      assertMatchingBuildSnapshots(
        { files: ["app.js"], sha256: "first" },
        { files: ["app.js"], sha256: "second" },
      ),
    ).toThrow("not reproducible");
    expect(() =>
      assertMatchingBuildSnapshots(
        { files: ["app.js"], sha256: "same" },
        { files: ["app.js", "index.html"], sha256: "same" },
      ),
    ).toThrow("file lists differ");
  });
});
