"use client";

// Route-level error boundary. Without this, any render throw in a page/panel
// (e.g. an unguarded .toFixed on a missing scraped field) white-screens the whole
// route. Next.js renders this in place of the segment and offers a recovery.
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it in the console for debugging; wire to a reporter here if added.
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 bg-gray-950">
      <div className="max-w-md w-full rounded-lg border border-slate-700 bg-slate-900 p-6 text-center">
        <div className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
          Something broke on this page
        </div>
        <p className="mt-3 text-sm text-slate-300">
          A panel failed to render. The rest of the app is fine — you can retry
          this view or head back to the map.
        </p>
        {error?.digest && (
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            ref: {error.digest}
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Back to map
          </a>
        </div>
      </div>
    </div>
  );
}
