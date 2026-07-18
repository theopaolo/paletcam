import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";

function splitCommands(script) {
  return String(script || "")
    .split("&&")
    .map((command) => command.trim())
    .filter(Boolean);
}

describe("release command policy", () => {
  test("the single release gate verifies preprod before rebuilding production", () => {
    expect(splitCommands(packageJson.scripts["verify:preprod-release"])).toEqual([
      "bun run build:preprod",
      "bun run verify:preprod",
      "bun run test:pwa:preprod",
    ]);

    const releaseCommands = splitCommands(packageJson.scripts["verify:release"]);
    expect(releaseCommands[0]).toBe("bun run verify:preprod-release");
    expect(releaseCommands.indexOf("bun run verify")).toBeGreaterThan(0);
    expect(releaseCommands.at(-1)).toBe("bun run verify:build");
  });
});
