/**
 * Locks the in-memory cache contract on lib/api.ts:
 *   - LRU eviction kicks in past 50 entries
 *   - Re-insert on hit makes that entry the most recently used
 *   - clearApiCache empties everything
 *   - TTL expiration falls back to a fresh fetch
 *
 * We exercise the cache through fetchFreight() since it takes no args and
 * goes through the cachedFetch path with a stable URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearApiCache, fetchFreight } from "../api";


type FetchMock = ReturnType<typeof vi.fn>;

function mockJson(body: unknown, ok = true, status = 200) {
  return {
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
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
    await fetchFreight();
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the 5-minute TTL expires", async () => {
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance just under TTL — still a hit
    vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past TTL — refetch
    vi.advanceTimersByTime(2 * 1000);
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clearApiCache forces the next call to refetch", async () => {
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearApiCache();
    await fetchFreight();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when fetch returns non-ok, with status in the error message", async () => {
    fetchMock.mockResolvedValueOnce(mockJson({ error: "boom" }, false, 503));
    await expect(fetchFreight()).rejects.toThrow(/503/);
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
   * Drive distinct cache keys straight through cachedFetchStatic — one entry
   * per unique path — so we exercise the LRU primitive directly. (fetchCot is
   * unsuitable here: it's static-first, so every `after` collapses onto the one
   * shared "/data/cot.json" entry.)
   */
  it("evicts the oldest entry when more than 50 keys are in use", async () => {
    const { cachedFetchStatic } = await import("../api");

    // Fill cache with 50 entries
    for (let i = 0; i < 50; i++) {
      await cachedFetchStatic(`/data/f${i}.json`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(50);

    // The oldest entry (f0) is still cached — and the hit re-inserts it as MRU
    await cachedFetchStatic("/data/f0.json");
    expect(fetchMock).toHaveBeenCalledTimes(50);

    // 51st distinct key triggers eviction of THE oldest (which is now f1
    // because the f0 key was just re-inserted on the previous call).
    await cachedFetchStatic("/data/f50.json");
    expect(fetchMock).toHaveBeenCalledTimes(51);

    // Re-fetching the just-evicted oldest (f1) → cache miss
    await cachedFetchStatic("/data/f1.json");
    expect(fetchMock).toHaveBeenCalledTimes(52);

    // Re-fetching the most-recently-used (f0) → still hit
    await cachedFetchStatic("/data/f0.json");
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });
});
