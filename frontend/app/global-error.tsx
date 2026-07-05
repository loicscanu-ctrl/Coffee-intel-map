"use client";

// Last-resort boundary for errors thrown in the ROOT layout itself (app/error.tsx
// only catches errors below the layout). It must render its own <html>/<body>
// because it replaces the root layout when it fires.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#030712",
          color: "#e2e8f0",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#fbbf24",
            }}
          >
            The app failed to load
          </div>
          <p style={{ marginTop: 12, fontSize: 14, color: "#cbd5e1" }}>
            An unexpected error stopped the page from rendering. Reloading usually
            fixes it.
          </p>
          {error?.digest && (
            <p
              style={{
                marginTop: 8,
                fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                fontSize: 11,
                color: "#64748b",
              }}
            >
              ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              borderRadius: 6,
              border: "none",
              background: "#4f46e5",
              color: "#fff",
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
