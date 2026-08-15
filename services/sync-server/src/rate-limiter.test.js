import { describe, expect, test } from "bun:test";
import { createIpRateLimiter } from "./rate-limiter.js";

function createHarness(overrides = {}) {
  let time = 0;
  const limiter = createIpRateLimiter({
    bucketTtlMs: 50,
    maxBuckets: 3,
    maxRequests: 2,
    now: () => time,
    windowMs: 10,
    ...overrides,
  });
  return {
    advance: (duration) => {
      time += duration;
    },
    limiter,
  };
}

describe("bounded IP rate limiter", () => {
  test("enforces the request window and releases capacity after it passes", () => {
    const { advance, limiter } = createHarness();

    expect(limiter.isRateLimited("ip-a")).toBe(false);
    expect(limiter.isRateLimited("ip-a")).toBe(false);
    expect(limiter.isRateLimited("ip-a")).toBe(true);
    advance(10);
    expect(limiter.isRateLimited("ip-a")).toBe(false);
  });

  test("evicts the least recently used live bucket at capacity", () => {
    const { advance, limiter } = createHarness({ maxBuckets: 2, maxRequests: 1 });

    limiter.isRateLimited("ip-a");
    advance(1);
    limiter.isRateLimited("ip-b");
    advance(1);
    expect(limiter.isRateLimited("ip-a")).toBe(true);
    advance(1);
    limiter.isRateLimited("ip-c");

    expect(limiter.hasBucket("ip-a")).toBe(true);
    expect(limiter.hasBucket("ip-b")).toBe(false);
    expect(limiter.hasBucket("ip-c")).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  test("prunes expired buckets before evicting a live bucket", () => {
    const { advance, limiter } = createHarness({ bucketTtlMs: 10, maxBuckets: 2 });

    limiter.isRateLimited("expired");
    advance(5);
    limiter.isRateLimited("live");
    advance(5);
    limiter.isRateLimited("new");

    expect(limiter.hasBucket("expired")).toBe(false);
    expect(limiter.hasBucket("live")).toBe(true);
    expect(limiter.hasBucket("new")).toBe(true);
  });

  test("never grows beyond the configured bucket cap", () => {
    const { limiter } = createHarness({ maxBuckets: 2 });

    for (let index = 0; index < 100; index += 1) {
      limiter.isRateLimited(`ip-${index}`);
      expect(limiter.size()).toBeLessThanOrEqual(2);
    }
  });

  test("expires an idle bucket at the exact TTL boundary", () => {
    const { advance, limiter } = createHarness();

    limiter.isRateLimited("idle");
    advance(49);
    expect(limiter.prune()).toBe(0);
    expect(limiter.hasBucket("idle")).toBe(true);
    advance(1);
    expect(limiter.prune()).toBe(1);
    expect(limiter.hasBucket("idle")).toBe(false);
  });

  test("rejects invalid lifecycle bounds", () => {
    expect(() =>
      createIpRateLimiter({
        bucketTtlMs: 5,
        maxBuckets: 1,
        maxRequests: 1,
        windowMs: 10,
      }),
    ).toThrow("bucketTtlMs must be at least windowMs");
  });
});
