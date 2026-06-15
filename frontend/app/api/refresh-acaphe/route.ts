import { NextResponse } from "next/server";

// Triggers a manual GitHub Actions workflow_dispatch on the Acaphe poller,
// so the user can refresh live quotes outside the */15-min cron schedule
// (useful when the cron is throttled or when the user wants intraday data
// during a fast-moving session). The poll itself takes ~60–90s end-to-end
// (Playwright cold start + scrape + Redis write); the frontend polls /api/live
// for fresh data on a short interval after the dispatch.
//
// Requires the GH_DISPATCH_TOKEN env var to be set in Vercel — a fine-grained
// GitHub PAT with `Actions: read+write` permission on this repo only. When the
// token is missing the endpoint returns 503 so the UI can degrade gracefully
// to "data re-fetch" without breaking.

const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
const REPO     = "loicscanu-ctrl/Coffee-intel-map";
const WORKFLOW = "poll-acaphe-quotes.yml";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  if (!GH_TOKEN) {
    return NextResponse.json(
      { error: "not_configured", hint: "set GH_DISPATCH_TOKEN env var" },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
        cache: "no-store",
      },
    );

    if (res.status === 204) {
      return NextResponse.json({ ok: true });
    }
    const body = await res.text();
    return NextResponse.json(
      { error: "github_error", status: res.status, body },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
