// Login form for /admin. Server component — pure HTML, no client JS needed
// (form posts directly to /api/admin/login, which sets the cookie and
// redirects to /admin/access on success). Already-authed visitors are
// bounced to the dashboard via the layout's session check; this page
// reads `?error=1` from the URL when the password was wrong.
export const dynamic = "force-dynamic";

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const hadError = searchParams?.error === "1";
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4">
      <form
        action="/api/admin/login"
        method="POST"
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
      >
        <div>
          <h1 className="text-base font-semibold text-white">Admin sign-in</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Access log dashboard. Authorized users only.
          </p>
        </div>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-slate-400">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-600"
          />
        </label>

        {hadError && (
          <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded px-3 py-2">
            Wrong password — try again.
          </p>
        )}

        <button
          type="submit"
          className="w-full bg-amber-700 hover:bg-amber-600 text-amber-50 text-sm font-medium rounded px-3 py-2 transition-colors"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
