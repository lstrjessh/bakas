type CacheEntry<T> = {
  expiresAt: number;
  value: T | undefined;
  inFlight: Promise<T> | null;
};

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Drop entries whose TTL has elapsed and which no request is waiting on.
 * Without this the module-level map grows once per distinct key ever used.
 */
function sweepExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (!entry.inFlight && now >= entry.expiresAt) {
      cache.delete(key);
    }
  }
}

/**
 * Get a value from cache, or fetch it once and share the in-flight request
 * between concurrent callers (dedupe). Entries expire after `ttlMs`.
 */
export async function cachedGet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  sweepExpired(now);
  const existing = cache.get(key) as CacheEntry<T> | undefined;

  if (existing) {
    if (existing.value !== undefined && now < existing.expiresAt) {
      return existing.value;
    }
    if (existing.inFlight) {
      return existing.inFlight;
    }
  }

  const promise = fetcher().then(
    (value) => {
      cache.set(key, { expiresAt: now + ttlMs, value, inFlight: null });
      return value;
    },
    (error) => {
      cache.delete(key);
      throw error;
    },
  );

  cache.set(key, { expiresAt: 0, value: undefined, inFlight: promise });
  return promise;
}

/**
 * Remove cached entries whose key starts with `prefix`.
 * Used to force a fresh fetch after a mutation (e.g. verifying a report).
 */
export function invalidateApiCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/** Test-only: number of entries currently held (expired or not). */
export function apiCacheSizeForTests(): number {
  return cache.size;
}
