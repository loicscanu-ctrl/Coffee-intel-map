"use client";
import { useEffect, useRef, useState } from "react";

let _seq = 0;

/** Renders a Mermaid diagram from source text, client-side. Dark theme to
 *  match the dashboard, straight (linear) edges. Shows the raw source in a
 *  <details> fallback if the render fails. */
export default function Mermaid({ chart, className }: { chart: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          flowchart: { curve: "linear" },
          themeVariables: {
            fontSize: "13px",
            darkMode: true,
          },
        });
        const id = `mmd-${++_seq}-${Date.now()}`;
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          // make the SVG responsive
          const el = ref.current.querySelector("svg");
          if (el) {
            el.removeAttribute("width");
            el.setAttribute("style", "max-width:100%;height:auto;");
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div className={className}>
      <div ref={ref} className="overflow-x-auto" />
      {err && (
        <details className="mt-2 text-xs text-amber-400">
          <summary>diagram failed to render — show source</summary>
          <pre className="mt-1 whitespace-pre-wrap text-slate-400">{chart}</pre>
        </details>
      )}
    </div>
  );
}
