import { NextResponse } from "next/server";

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY           = "live_quotes";

export const dynamic = "force-dynamic";   // never cache this route on Vercel
export const revalidate = 0;

export async function GET() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return NextResponse.json({ error: "redis_not_configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${UPSTASH_URL}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "redis_error", status: res.status }, { status: 502 });
    }

    const { result } = await res.json();

    if (result === null || result === undefined) {
      return NextResponse.json({ error: "no_data" }, { status: 404 });
    }

    // Upstash returns the value as a string — parse it
    const data = typeof result === "string" ? JSON.parse(result) : result;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 503 });
  }
}
