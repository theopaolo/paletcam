import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { verifyVendoredDependency } from "./vendor-provenance.js";

const provenance = JSON.parse(
  await readFile(new URL("../src/vendor/dexie.provenance.json", import.meta.url), "utf8"),
);
const vendoredBytes = await readFile(new URL("../src/vendor/dexie.mjs", import.meta.url));

describe("vendored dependency provenance", () => {
  test("verifies the recorded Dexie artifact", () => {
    expect(verifyVendoredDependency(provenance, vendoredBytes)).toEqual({
      package: "dexie",
      sha256: provenance.sha256,
      vendoredPath: "src/vendor/dexie.mjs",
      version: "4.3.0",
    });
  });

  test("rejects content and canonical-source drift", () => {
    expect(() =>
      verifyVendoredDependency(provenance, new TextEncoder().encode("modified")),
    ).toThrow("checksum mismatch");
    expect(() =>
      verifyVendoredDependency(
        { ...provenance, sourceArchiveUrl: "https://example.com/dexie.tgz" },
        vendoredBytes,
      ),
    ).toThrow("canonical versioned npm archive URL");
  });
});
