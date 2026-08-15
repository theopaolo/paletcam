function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

/**
 * Creates a bounded sliding-window per-key rate limiter. Buckets are stored in
 * least-recently-used order. Expired buckets are removed before capacity
 * eviction, and the oldest live bucket is evicted when every slot is occupied.
 *
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.maxRequests
 * @param {number} options.maxBuckets
 * @param {number} options.bucketTtlMs
 * @param {() => number} [options.now]
 */
export function createIpRateLimiter({
  windowMs,
  maxRequests,
  maxBuckets,
  bucketTtlMs,
  now = Date.now,
}) {
  assertPositiveInteger(windowMs, "windowMs");
  assertPositiveInteger(maxRequests, "maxRequests");
  assertPositiveInteger(maxBuckets, "maxBuckets");
  assertPositiveInteger(bucketTtlMs, "bucketTtlMs");
  if (bucketTtlMs < windowMs) {
    throw new RangeError("bucketTtlMs must be at least windowMs.");
  }

  /** @type {Map<string, {lastSeenAt: number, timestamps: number[]}>} */
  const buckets = new Map();

  function readNow() {
    const value = Number(now());
    if (!Number.isFinite(value)) {
      throw new TypeError("now() must return a finite number.");
    }
    return value;
  }

  function touch(key, bucket) {
    buckets.delete(key);
    buckets.set(key, bucket);
  }

  function pruneAt(currentTime) {
    const cutoff = currentTime - bucketTtlMs;
    let removedCount = 0;
    for (const [key, bucket] of buckets) {
      if (bucket.lastSeenAt > cutoff) {
        continue;
      }
      buckets.delete(key);
      removedCount += 1;
    }
    return removedCount;
  }

  function makeRoom(currentTime) {
    if (buckets.size < maxBuckets) {
      return;
    }
    pruneAt(currentTime);
    while (buckets.size >= maxBuckets) {
      const oldestKey = buckets.keys().next().value;
      buckets.delete(oldestKey);
    }
  }

  function isRateLimited(rawKey) {
    const currentTime = readNow();
    const key = String(rawKey || "unknown");
    let bucket = buckets.get(key);
    if (!bucket) {
      makeRoom(currentTime);
      bucket = { lastSeenAt: currentTime, timestamps: [] };
    }

    const windowCutoff = currentTime - windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > windowCutoff);
    bucket.lastSeenAt = currentTime;
    const limited = bucket.timestamps.length >= maxRequests;
    if (!limited) {
      bucket.timestamps.push(currentTime);
    }
    touch(key, bucket);
    return limited;
  }

  return {
    hasBucket: (key) => buckets.has(String(key)),
    isRateLimited,
    prune: () => pruneAt(readNow()),
    size: () => buckets.size,
  };
}
