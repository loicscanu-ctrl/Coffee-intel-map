// Session helpers for /admin/* — shared between the login route and the
// dashboard page so the cookie name + Upstash key shape live in one place.
//
// Auth model: opaque random session tokens stored in Upstash with a TTL.
// Login → mint a token, set HttpOnly cookie scoped to /admin, write the
// token to Redis with EX matching the cookie's Max-Age. Each admin page
// load reads the cookie, EXISTS-checks the token in Redis, and rejects
// otherwise. Rotation = delete the Redis key (or just rotate
// ADMIN_PASSWORD).

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const ADMIN_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function authHeaders() {
  return {
    Authorization: `Bearer ${UPSTASH_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export function upstashConfigured(): boolean {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function upstashCmd<T = unknown>(cmd: (string | number)[]): Promise<T | null> {
  if (!upstashConfigured()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(cmd),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return (result ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function upstashPipeline<T = unknown[]>(commands: (string | number)[][]): Promise<T | null> {
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
    // Pipeline returns [{result: ...}, {result: ...}, ...]
    return (Array.isArray(json) ? json.map((r: { result?: unknown }) => r.result) : null) as T | null;
  } catch {
    return null;
  }
}

// Web Crypto random token — 32 random bytes hex-encoded, ~256 bits.
// Edge-runtime safe (no Node `crypto` needed).
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(): Promise<string | null> {
  const token = randomToken();
  const stored = await upstashCmd<string>([
    "SET", `admin:session:${token}`, "1", "EX", SESSION_TTL_SECONDS,
  ]);
  return stored ? token : null;
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await upstashCmd(["DEL", `admin:session:${token}`]);
}

export async function isValidSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  // Hex-only sanity check before paying for an Upstash round-trip — keeps
  // junk cookie values from showing up as failed lookups in Upstash logs.
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const exists = await upstashCmd<number>(["EXISTS", `admin:session:${token}`]);
  return exists === 1;
}
