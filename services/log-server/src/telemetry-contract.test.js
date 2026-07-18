import { expect, test } from "bun:test";
import {
  classifyClientFamily,
  getTelemetryEventNames,
  isKnownTelemetryEvent,
  isValidTelemetryCorrelationId,
  normalizeTelemetryPayload,
} from "./telemetry-contract.js";

test("registry contains the production operational and failure events", () => {
  const names = getTelemetryEventNames();
  expect(names.length).toBeGreaterThan(40);
  for (const name of [
    "metric:session-started",
    "metric:backup-transfer",
    "uncaught:error",
    "storage:health",
    "Community API request failed.",
    "Failed to render palette gallery preview.",
  ]) {
    expect(isKnownTelemetryEvent(name)).toBe(true);
    expect(names).toContain(name);
  }
  expect(isKnownTelemetryEvent("arbitrary runtime message")).toBe(false);
});

test("each event accepts only its own fields plus closed common metadata", () => {
  expect(
    normalizeTelemetryPayload({
      message: "uncaught:error",
      context: {
        appVersion: "0.1.0",
        clientFamily: "safari",
        colno: 9.4,
        commitHash: "abcdef123456",
        correlationId: "forbidden",
        environment: "preprod",
        filename: "/private/app.js",
        lineno: 12,
        message: "private exception message",
        name: "TypeError",
        stack: "private stack",
        timestamp: "2026-07-15T10:11:12.123Z",
        url: "https://private.test/",
      },
    }),
  ).toEqual({
    message: "uncaught:error",
    context: {
      appVersion: "0.1.0",
      clientFamily: "safari",
      colno: 9,
      commitHash: "abcdef123456",
      environment: "preprod",
      lineno: 12,
      name: "TypeError",
      timestamp: "2026-07-15T10:11:12.123Z",
    },
  });
});

test("classifies user agents into a closed low-cardinality family", () => {
  expect(classifyClientFamily("Mozilla/5.0 Version/18.0 Mobile Safari/604.1")).toBe("safari");
  expect(classifyClientFamily("Mozilla/5.0 Chrome/120.0 Safari/537.36")).toBe("chrome");
  expect(classifyClientFamily("Mozilla/5.0 Edg/120.0 Chrome/120.0")).toBe("edge");
  expect(classifyClientFamily("private experimental agent 984329")).toBe("other");
});

test("accepts only UUIDv4 correlation identifiers", () => {
  expect(isValidTelemetryCorrelationId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  expect(isValidTelemetryCorrelationId("550e8400-e29b-11d4-a716-446655440000")).toBe(false);
  expect(isValidTelemetryCorrelationId("not-a-session-uuid")).toBe(false);
});
