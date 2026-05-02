/**
 * Locks the in-memory cache contract on lib/api.ts:
 *   - LRU eviction kicks in past 50 entries
 *   - Re-insert on hit makes that entry the most recently used
 *   - clearApiCache empties everything
 *   - TTL expiration falls back to a fresh fetch
 *
 * We exercise the cache through fetchStocks() since it goes through the
 * cachedFetch path with a stable URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearApiCache, fetchStocks } from "../api";


type FetchMock = ReturnType<typeof vi.fn>;

function mockJson(body: any, ok = true, status = 200) {
  return {
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}


describe("lib/api cache", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => mockJson([{ date: "2026-01", value: 1 }]));
    // @ts-expect-error overriding global fetch for the test
    globalThis.fetch = fetchMock;
    clearApiCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearApiCache();
  });

  it("hits the network on a cache miss and reuses the response on hit", async () => {
    await fetchStocks();
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the 5-minute TTL expires", async () => {
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance just under TTL — still a hit
    vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past TTL — refetch
    vi.advanceTimersByTime(2 * 1000);
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clearApiCache forces the next call to refetch", async () => {
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearApiCache();
    await fetchStocks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when fetch returns non-ok, with status in the error message", async () => {
    fetchMock.mockResolvedValueOnce(mockJson({ error: "boom" }, false, 503));
    await expect(fetchStocks()).rejects.toThrow(/503/);
  });
});


describe("lib/api LRU cap", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => mockJson({ url }));
    // @ts-expect-error overriding global fetch
    globalThis.fetch = fetchMock;
    clearApiCache();
  });

  afterEach(() => clearApiCache());

  /**
   * Use fetchCot(after=) to inject many distinct cache keys without needing
   * 50 separate exported helpers. Each unique `after` value is a separate
   * cache entry under cachedFetch's internal Map.
   */
  it("evicts the oldest entry when more than 50 keys are in use", async () => {
    const { fetchCot } = await import("../api");

    // Fill cache with 50 entries
    for (let i = 0; i < 50; i++) {
      await fetchCot(`2026-01-${String(i + 1).padStart(2, "0")}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(50);

    // The oldest entry (i=0) is still cached
    await fetchCot("2026-01-01");
    expect(fetchMock).toHaveBeenCalledTimes(50);

    // 51st distinct key triggers eviction of THE oldest (which is now date 02
    // because the i=0 key was just re-inserted on the previous call).
    await fetchCot("2026-02-01");
    expect(fetchMock).toHaveBeenCalledTimes(51);

    // Re-fetching the just-evicted oldest (date 02) → cache miss
    await fetchCot("2026-01-02");
    expect(fetchMock).toHaveBeenCalledTimes(52);

    // Re-fetching the most-recently-used (date 01) → still hit
    await fetchCot("2026-01-01");
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });
});
