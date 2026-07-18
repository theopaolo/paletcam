import { afterEach, describe, expect, mock, test } from "bun:test";

const clientLogModuleUrl = new URL("./client-log.js", import.meta.url).href;
const errorReportingModuleUrl = new URL("./error-reporting.js", import.meta.url).href;

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
  mock.restore();
});

describe("reportAppError", () => {
  test("logs structured console context and forwards throttle options to client log", async () => {
    const clientLogWithOptions = mock(() => true);
    mock.module(clientLogModuleUrl, () => ({
      clientLogWithOptions,
      sanitizeTelemetryContext: (context) => context,
    }));

    const consoleError = mock(() => {});
    console.error = consoleError;

    const module = await import(`${errorReportingModuleUrl}?test=${Math.random()}`);
    const error = new Error("Unable to load preview image element");
    error.sourceKind = "original";
    error.sourceAttempts = ["reader-data-url", "canvas-data-url", "original"];

    module.reportAppError(error, {
      logMessage: "Failed to render palette gallery preview.",
      consoleMessage: "Failed to render preview for palette 49:",
      clientLogKey: "preview-gallery-failure",
      clientLogThrottleMs: 15000,
      context: { paletteId: 49, variant: "gallery" },
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toBe("Failed to render preview for palette 49:");
    expect(consoleError.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        details: "ERR Error — Unable to load preview image element",
        message: "Unable to load preview image element",
        paletteId: 49,
        sourceAttempts: ["reader-data-url", "canvas-data-url", "original"],
        sourceKind: "original",
        variant: "gallery",
      }),
    );
    expect(consoleError.mock.calls[0][1].stack).toContain("Unable to load preview image element");
    expect(clientLogWithOptions).toHaveBeenCalledWith(
      "Failed to render palette gallery preview.",
      expect.objectContaining({
        errorName: "Error",
        sourceAttempts: ["reader-data-url", "canvas-data-url", "original"],
        sourceKind: "original",
        variant: "gallery",
      }),
      {
        key: "preview-gallery-failure",
        throttleMs: 15000,
      },
    );
    const telemetryContext = clientLogWithOptions.mock.calls[0][1];
    expect(telemetryContext).not.toHaveProperty("paletteId");
    expect(telemetryContext).not.toHaveProperty("message");
    expect(telemetryContext).not.toHaveProperty("details");
    expect(telemetryContext).not.toHaveProperty("stack");
  });
});
