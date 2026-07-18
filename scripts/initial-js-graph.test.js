import { describe, expect, test } from "bun:test";
import { collectInitialJsFiles, extractStaticImportSpecifiers } from "./initial-js-graph.js";

test("extracts static imports without treating dynamic imports as initial", () => {
  expect(
    extractStaticImportSpecifiers(
      'import "./shell.js";import{a}from"./shared.js";export{b}from"./foundation.js";const lazy=import("./collection.js");',
    ),
  ).toEqual(["./shell.js", "./shared.js", "./foundation.js"]);
});

describe("initial JavaScript graph", () => {
  test("walks shared static chunks once and excludes lazy chunks", async () => {
    const sources = new Map([
      ["app.js", 'import "./chunk/shared.js";import("./chunk/collection.js");'],
      ["pwa-install.js", 'import "./chunk/shared.js";'],
      ["chunk/shared.js", 'import "./foundation.js";'],
      ["chunk/foundation.js", "export const ready=true;"],
      ["chunk/collection.js", "export const lazy=true;"],
    ]);
    const files = await collectInitialJsFiles({
      entrypoints: ["app.js", "pwa-install.js"],
      hasFile: async (file) => sources.has(file),
      readSource: async (file) => sources.get(file),
    });
    expect([...files].sort()).toEqual(
      ["app.js", "chunk/foundation.js", "chunk/shared.js", "pwa-install.js"].sort(),
    );
  });
});
