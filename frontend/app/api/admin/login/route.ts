import { NextResponse } from "next/server";
import { ADMIN_COOKIE, SESSION_TTL_SECONDS, createSession, upstashConfigured } from "@/lib/adminAuth";

// POST /api/admin/login
//   Body: form-encoded `password=…` or JSON `{ "password": "…" }`.
//   On success: opaque session token written to Upstash with TTL, returned as
//   an HttpOnly cookie scoped to /admin. The password is never echoed back
//   and never leaves the server.
//
// Constant-time compare to deny timing-side-channel attempts against
// ADMIN_PASSWORD. Returns 503 if Upstash is unreachable so we don't lock
// the operator out of their own admin page on a Redis hiccup.

export const dynamic = "force-dynamic";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function extractPassword(req: Request): Promise<string> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const body = (await req.json()) as { password?: unknown };
      return typeof body.password === "string" ? body.password : "";
    } catch {
      return "";
    }
  }
  // Form-encoded — the login page submits a plain <form>.
  try {
    const form = await req.formData();
    const v = form.get("password");
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "admin_password_unset" },
      { status: 503 },
    );
  }
  if (!upstashConfigured()) {
    return NextResponse.json(
      { error: "session_store_unavailable" },
      { status: 503 },
    );
  }

  const submitted = await extractPassword(req);
  if (!submitted || !constantTimeEquals(submitted, expected)) {
    // Redirect back to the form with an error marker — UX for the form-
    // POST path; JSON callers see the status code regardless.
    const url = new URL("/admin/login", req.url);
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, { status: 303 });
  }

  const token = await createSession();
  if (!token) {
    return NextResponse.json(
      { error: "session_create_failed" },
      { status: 503 },
    );
  }

  // Redirect to the dashboard with the session cookie set. /admin scope
  // keeps the cookie off public routes; HttpOnly blocks JS access; Secure
  // requires HTTPS (Vercel always serves HTTPS in production); SameSite=Lax
  // is enough — admin nav happens via same-site form post + GETs.
  const res = NextResponse.redirect(new URL("/admin/access", req.url), { status: 303 });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
