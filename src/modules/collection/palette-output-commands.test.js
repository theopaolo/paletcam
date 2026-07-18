import { describe, expect, mock, test } from "bun:test";
import { createPaletteOutputCommands } from "./palette-output-commands.js";

/** @type {Palette} */
const palette = {
  id: 42,
  timestamp: "2026-07-15T12:00:00.000Z",
  colors: [
    { r: 12, g: 34, b: 56 },
    { r: 78, g: 90, b: 123 },
  ],
  remoteCatchId: null,
  moderationStatus: null,
  postedAt: null,
  moderationUpdatedAt: null,
  lastModerationCheckAt: null,
};

function createHarness(overrides = {}) {
  const getColorNames = mock(async () => ["Night", "Slate"]);
  const renderVersoBlob = mock(async () => new Blob(["verso"], { type: "image/png" }));
  const exportPolaroid = mock(async () => true);
  const sharePolaroid = mock(async () => ({ status: "shared" }));
  const download = mock(async () => true);
  const loadVersoTools = mock(async () => ({ getColorNames, renderVersoBlob }));
  const dependencies = {
    download,
    exportPolaroid,
    loadVersoTools,
    sharePolaroid,
    ...overrides,
  };

  return {
    commands: createPaletteOutputCommands(dependencies),
    download,
    exportPolaroid,
    getColorNames,
    loadVersoTools,
    renderVersoBlob,
    sharePolaroid,
  };
}

describe("palette output commands", () => {
  test("normalizes front-export success, refusal, and rejection", async () => {
    const success = createHarness();
    await expect(success.commands.exportPalette(palette)).resolves.toEqual({ status: "exported" });
    expect(success.exportPolaroid).toHaveBeenCalledWith(palette);

    const refusal = createHarness({ exportPolaroid: mock(async () => false) });
    await expect(refusal.commands.exportPalette(palette)).resolves.toEqual({ status: "failed" });

    const error = new Error("renderer unavailable");
    const rejection = createHarness({
      exportPolaroid: mock(async () => {
        throw error;
      }),
    });
    await expect(rejection.commands.exportPalette(palette)).resolves.toEqual({
      status: "failed",
      error,
    });
  });

  test("loads verso tools lazily and preserves the exact operation order and filename", async () => {
    const order = [];
    const blob = new Blob(["verso"], { type: "image/png" });
    const getColorNames = mock(async (colors) => {
      order.push("names");
      expect(colors).toBe(palette.colors);
      return ["Night", "Slate"];
    });
    const renderVersoBlob = mock(async (receivedPalette, names) => {
      order.push("render");
      expect(receivedPalette).toBe(palette);
      expect(names).toEqual(["Night", "Slate"]);
      return blob;
    });
    const download = mock(async (receivedBlob, filename) => {
      order.push("download");
      expect(receivedBlob).toBe(blob);
      expect(filename).toBe("palette-42-verso.png");
      return true;
    });
    const loadVersoTools = mock(async () => {
      order.push("load");
      return { getColorNames, renderVersoBlob };
    });
    const { commands } = createHarness({ download, loadVersoTools });

    expect(loadVersoTools).not.toHaveBeenCalled();
    await expect(commands.exportPaletteVerso(palette)).resolves.toEqual({ status: "exported" });
    expect(order).toEqual(["load", "names", "render", "download"]);
  });

  test.each([
    "load",
    "names",
    "render",
    "download",
  ])("contains a verso %s failure and stops later adapters", async (failurePoint) => {
    const error = new Error(`${failurePoint} failed`);
    const getColorNames = mock(async () => {
      if (failurePoint === "names") throw error;
      return ["Night", "Slate"];
    });
    const renderVersoBlob = mock(async () => {
      if (failurePoint === "render") throw error;
      return new Blob(["verso"]);
    });
    const download = mock(async () => {
      if (failurePoint === "download") throw error;
      return true;
    });
    const loadVersoTools = mock(async () => {
      if (failurePoint === "load") throw error;
      return { getColorNames, renderVersoBlob };
    });
    const { commands } = createHarness({ download, loadVersoTools });

    await expect(commands.exportPaletteVerso(palette)).resolves.toEqual({
      status: "failed",
      error,
    });
    expect(download).toHaveBeenCalledTimes(failurePoint === "download" ? 1 : 0);
    if (failurePoint === "load") {
      expect(getColorNames).not.toHaveBeenCalled();
    }
    if (failurePoint === "load" || failurePoint === "names") {
      expect(renderVersoBlob).not.toHaveBeenCalled();
    }
  });

  test("normalizes a refused download and malformed verso adapters", async () => {
    const refusal = createHarness({ download: mock(async () => false) });
    await expect(refusal.commands.exportPaletteVerso(palette)).resolves.toEqual({
      status: "failed",
    });

    const malformedTools = createHarness({ loadVersoTools: mock(async () => ({})) });
    const malformedToolsResult = await malformedTools.commands.exportPaletteVerso(palette);
    expect(malformedToolsResult.status).toBe("failed");
    expect("error" in malformedToolsResult ? malformedToolsResult.error : null).toBeInstanceOf(
      TypeError,
    );
    expect(malformedTools.download).not.toHaveBeenCalled();

    const malformedNames = createHarness({
      loadVersoTools: mock(async () => ({
        getColorNames: async () => ["Night", null],
        renderVersoBlob: async () => new Blob(["verso"]),
      })),
    });
    const malformedNamesResult = await malformedNames.commands.exportPaletteVerso(palette);
    expect(malformedNamesResult.status).toBe("failed");
    expect("error" in malformedNamesResult ? malformedNamesResult.error : null).toBeInstanceOf(
      TypeError,
    );
    expect(malformedNames.download).not.toHaveBeenCalled();
  });

  test.each([
    "shared",
    "cancelled",
  ])("forwards the %s share outcome without exporting a fallback", async (status) => {
    const sharePolaroid = mock(async () => ({ status }));
    const { commands, exportPolaroid } = createHarness({ sharePolaroid });

    await expect(commands.sharePalette(palette)).resolves.toEqual({ status });
    expect(exportPolaroid).not.toHaveBeenCalled();
  });

  test("attempts exactly one export only for an unsupported share", async () => {
    const exported = createHarness({
      sharePolaroid: mock(async () => ({ status: "unsupported" })),
    });
    await expect(exported.commands.sharePalette(palette)).resolves.toEqual({
      status: "fallback_exported",
    });
    expect(exported.exportPolaroid).toHaveBeenCalledTimes(1);
    expect(exported.exportPolaroid).toHaveBeenCalledWith(palette);

    const refusedExport = mock(async () => false);
    const unsupported = createHarness({
      exportPolaroid: refusedExport,
      sharePolaroid: mock(async () => ({ status: "unsupported" })),
    });
    await expect(unsupported.commands.sharePalette(palette)).resolves.toEqual({
      status: "unsupported",
    });
    expect(refusedExport).toHaveBeenCalledTimes(1);
  });

  test("contains a rejected unsupported fallback without changing its outcome category", async () => {
    const error = new Error("fallback failed");
    const exportPolaroid = mock(async () => {
      throw error;
    });
    const { commands } = createHarness({
      exportPolaroid,
      sharePolaroid: mock(async () => ({ status: "unsupported" })),
    });

    await expect(commands.sharePalette(palette)).resolves.toEqual({
      status: "unsupported",
      error,
    });
    expect(exportPolaroid).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ status: "error" }, { status: "failed" }],
    [{ status: "unknown" }, { status: "failed" }],
    [null, { status: "failed" }],
  ])("normalizes malformed or failed share result %# without fallback", async (result, expected) => {
    const sharePolaroid = mock(async () => result);
    const { commands, exportPolaroid } = createHarness({ sharePolaroid });

    await expect(commands.sharePalette(palette)).resolves.toEqual(expected);
    expect(exportPolaroid).not.toHaveBeenCalled();
  });

  test("preserves an adapter share error and contains synchronous throws", async () => {
    const reportedError = new Error("share failed");
    const failed = createHarness({
      sharePolaroid: mock(async () => ({ status: "error", error: reportedError })),
    });
    await expect(failed.commands.sharePalette(palette)).resolves.toEqual({
      status: "failed",
      error: reportedError,
    });
    expect(failed.exportPolaroid).not.toHaveBeenCalled();

    const thrownError = new Error("synchronous failure");
    const thrown = createHarness({
      sharePolaroid: () => {
        throw thrownError;
      },
    });
    await expect(thrown.commands.sharePalette(palette)).resolves.toEqual({
      status: "failed",
      error: thrownError,
    });
  });

  test("front export and share do not load the lazy verso tools", async () => {
    const { commands, loadVersoTools } = createHarness();

    await commands.exportPalette(palette);
    await commands.sharePalette(palette);

    expect(loadVersoTools).not.toHaveBeenCalled();
  });
});
