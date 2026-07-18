import { describe, expect, test } from "bun:test";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

describe("CI workflow policy", () => {
  test("pins and keys the Bun download cache without bypassing frozen installs", async () => {
    const workflow = await Bun.file(workflowUrl).text();

    expect(workflow).toContain(
      "uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4.2.0",
    );
    expect(workflow).toContain("path: ~/.bun/install/cache");
    expect(workflow).toContain("hashFiles('bun.lock', 'services/log-server/bun.lock')");
    expect(workflow).toContain("run: bun install --frozen-lockfile");
    expect(workflow).toContain("run: bun install --frozen-lockfile && bun test");
  });
});
