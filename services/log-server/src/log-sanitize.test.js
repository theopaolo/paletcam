import { expect, test } from "bun:test";
import { sanitizeLogPayload } from "./log-sanitize.js";

test("rejects unknown and non-string event names", () => {
  expect(sanitizeLogPayload({ message: "private arbitrary message", context: {} })).toBeNull();
  expect(
    sanitizeLogPayload({ message: { value: "metric:session-started" }, context: {} }),
  ).toBeNull();
});

test("keeps a known event and drops every field outside its exact schema", () => {
  const payload = sanitizeLogPayload({
    message: "metric:backup-transfer",
    context: {
      appVersion: "0.1.0",
      category: "invalid-file",
      correlationId: "private-session-id",
      direction: "import",
      durationMs: 1200.6,
      environment: "production",
      filename: "private-camera-backup.json",
      outcome: "failure",
      parserMessage: "private parser detail",
      photo: "data:image/jpeg;base64,private",
      timestamp: "2026-07-15T10:11:12.123Z",
      url: "https://app.test/private?token=secret",
      userAgent: "Raw agent and device details",
    },
  });

  expect(payload).toEqual({
    message: "metric:backup-transfer",
    context: {
      appVersion: "0.1.0",
      category: "invalid-file",
      direction: "import",
      durationMs: 1201,
      environment: "production",
      outcome: "failure",
      timestamp: "2026-07-15T10:11:12.123Z",
    },
  });
  expect(JSON.stringify(payload)).not.toContain("private");
});

test("normalizes high-cardinality error names and rejects malformed metadata", () => {
  expect(
    sanitizeLogPayload({
      message: "Community API request failed.",
      context: {
        clientFamily: "invented-browser",
        commitHash: "not a hash or known fallback",
        errorName: "UserControlledUniqueError_884912",
        failureKind: "http",
        method: "POST",
        status: 503,
        timestamp: "tomorrow",
      },
    }),
  ).toEqual({
    message: "Community API request failed.",
    context: {
      errorName: "OtherError",
      failureKind: "http",
      method: "POST",
      status: 503,
    },
  });
});

test("keeps only a strict ephemeral UUIDv4 correlation identifier", () => {
  const valid = sanitizeLogPayload({
    message: "metric:session-started",
    context: { correlationId: "550E8400-E29B-41D4-A716-446655440000" },
  });
  expect(valid?.context.correlationId).toBe("550e8400-e29b-41d4-a716-446655440000");

  for (const correlationId of [
    "session-123",
    "550e8400-e29b-11d4-a716-446655440000",
    "550e8400-e29b-41d4-1716-446655440000",
    "550e8400-e29b-41d4-a716-446655440000-extra",
  ]) {
    expect(
      sanitizeLogPayload({
        message: "metric:session-started",
        context: { correlationId },
      })?.context,
    ).toEqual({});
  }
});
