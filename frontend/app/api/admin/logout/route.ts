import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, destroySession } from "@/lib/adminAuth";

// POST /api/admin/logout — clears the cookie and removes the session token
// from Upstash so it can't be replayed even if the cookie leaks.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (token) await destroySession(token);
  const res = NextResponse.redirect(new URL("/admin/login", req.url), { status: 303 });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: 0,
  });
  return res;
}
