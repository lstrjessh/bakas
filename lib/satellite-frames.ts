/** Bounded browser cache shared by displayed frames and background preloads. */
export function createFrameLoader(
  fetcher: typeof fetch = fetch,
  capacity = 10,
) {
  const cache = new Map<string, Promise<Blob>>();
  return function load(stamp: string): Promise<Blob> {
    if (!/^\d{14}$/.test(stamp))
      return Promise.reject(new Error("Invalid satellite timestamp"));
    const existing = cache.get(stamp);
    if (existing) {
      cache.delete(stamp);
      cache.set(stamp, existing);
      return existing;
    }
    const pending = fetcher(`/api/satellite?time=${stamp}`, {
      signal: AbortSignal.timeout(55_000),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Satellite frame unavailable. Try another frame.");
        return response.blob();
      })
      .catch((error) => {
        if (cache.get(stamp) === pending) cache.delete(stamp);
        throw error;
      });
    cache.set(stamp, pending);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return pending;
  };
}

export const loadSatelliteFrame = createFrameLoader();

/** Warm a small queue without competing with the initial displayed frame. */
export async function preloadSatelliteFrames(
  stamps: string[],
  signal: AbortSignal,
) {
  const queue = [...new Set(stamps)];
  await Promise.all(
    [0, 1].map(async () => {
      while (!signal.aborted && queue.length) {
        const stamp = queue.shift()!;
        try {
          await loadSatelliteFrame(stamp);
        } catch {
          /* Foreground loads report errors and can retry. */
        }
      }
    }),
  );
}
