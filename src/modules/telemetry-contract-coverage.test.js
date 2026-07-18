import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownTelemetryEvent } from "../../services/log-server/src/telemetry-contract.js";

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function listRuntimeSources(directory = SOURCE_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listRuntimeSources(path);
    return entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") ? [path] : [];
  });
}

function collectMatches(source, expression, prefix = "") {
  return [...source.matchAll(expression)].map((match) => `${prefix}${match[1]}`);
}

test("every statically declared outbound event exists in the shared registry", () => {
  const declaredEvents = new Set([
    // These two alternatives are selected by an app.js conditional expression.
    "Failed to load collection viewer.",
    "Failed to load collection.",
  ]);

  for (const path of listRuntimeSources()) {
    const source = readFileSync(path, "utf8");
    for (const event of collectMatches(source, /clientLog(?:WithOptions)?\(\s*"([^"]+)"/g)) {
      declaredEvents.add(event);
    }
    for (const event of collectMatches(source, /logMessage\s*:\s*"([^"]+)"/g)) {
      declaredEvents.add(event);
    }
    for (const event of collectMatches(
      source,
      /(?:recordOperationalMetric|recordMetric)\(\s*"([^"]+)"/g,
      "metric:",
    )) {
      declaredEvents.add(event);
    }
  }

  expect([...declaredEvents].filter((event) => !isKnownTelemetryEvent(event))).toEqual([]);
});
