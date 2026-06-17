// Upstash REST helpers used by the admin dashboard. The middleware writes
// directly via fetch (no shared module — it lives at the edge and we keep
// the dependency surface minimal there); these helpers read back.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function authHeaders() {
  return {
    Authorization: `Bearer ${UPSTASH_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export function upstashConfigured(): boolean {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

export async function upstashPipeline<T = unknown[]>(
  commands: (string | number)[][],
): Promise<T | null> {
  if (!upstashConfigured()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Pipeline shape: [{result: ...}, {result: ...}, ...]
    return (Array.isArray(json)
      ? json.map((r: { result?: unknown }) => r.result)
      : null) as T | null;
  } catch {
    return null;
  }
}
