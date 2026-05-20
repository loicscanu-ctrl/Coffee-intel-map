"use client";
import { useEffect, useRef, useState } from "react";

let _seq = 0;

/** Parse `A -->|label|? B` edges (one per line) in source order. Index of each
 *  returned pair equals Mermaid's edge index, which it embeds in the rendered
 *  DOM ids — letting us map elements back to edges reliably. */
function parseEdges(chart: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /^\s*([A-Za-z0-9_]+)\s*-->(?:\|[^|]*\|)?\s*([A-Za-z0-9_]+)\s*$/;
  for (const line of chart.split("\n")) {
    const m = line.match(re);
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

/** Transitive closure of `start` over `adj` (excludes `start`). */
function closure(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) stack.push(m);
  }
  return seen;
}

/** Wire click-to-trace on the rendered SVG: clicking a node highlights its full
 *  upstream sources and downstream consumers end-to-end and fades the rest.
 *  Returns a cleanup that detaches the listener. */
function setupTrace(container: HTMLDivElement, chart: string): () => void {
  const svg = container.querySelector("svg");
  if (!svg) return () => {};

  const edges = parseEdges(chart);
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const [u, v] of edges) {
    (fwd.get(u) ?? fwd.set(u, []).get(u)!).push(v);
    (rev.get(v) ?? rev.set(v, []).get(v)!).push(u);
  }

  // index -> edge path element (id ends with `_<index>`)
  const pathByIdx = new Map<number, Element>();
  svg.querySelectorAll("g.edgePaths > path").forEach((p) => {
    const m = (p.id || "").match(/_(\d+)$/);
    if (m) pathByIdx.set(Number(m[1]), p);
  });
  // index -> edge label group (inner g.label carries data-id `L_..._<index>`)
  const labelByIdx = new Map<number, Element>();
  svg.querySelectorAll("g.edgeLabels g.label[data-id]").forEach((l) => {
    const m = (l.getAttribute("data-id") || "").match(/_(\d+)$/);
    const grp = l.closest("g.edgeLabel");
    if (m && grp) labelByIdx.set(Number(m[1]), grp);
  });
  // logical id -> node element (id `flowchart-<id>-<n>`)
  const nodeById = new Map<string, Element>();
  const idOfNode = (el: Element): string | null => {
    const m = (el.id || "").match(/flowchart-(.+)-\d+$/);
    return m ? m[1] : null;
  };
  svg.querySelectorAll("g.node").forEach((n) => {
    const id = idOfNode(n);
    if (id) nodeById.set(id, n);
  });

  let selected: string | null = null;
  const clear = () => {
    svg.classList.remove("mmd-sel");
    svg.querySelectorAll(".mmd-on").forEach((e) => e.classList.remove("mmd-on"));
  };
  const select = (id: string) => {
    if (selected === id) { selected = null; clear(); return; }
    selected = id;
    clear();
    const anc = closure(id, rev);
    const desc = closure(id, fwd);
    const up = new Set<string>(anc); up.add(id);
    const down = new Set<string>(desc); down.add(id);
    svg.classList.add("mmd-sel");
    nodeById.get(id)?.classList.add("mmd-on");
    anc.forEach((n) => nodeById.get(n)?.classList.add("mmd-on"));
    desc.forEach((n) => nodeById.get(n)?.classList.add("mmd-on"));
    edges.forEach(([u, v], i) => {
      const onUp = up.has(u) && up.has(v);
      const onDown = down.has(u) && down.has(v);
      if (onUp || onDown) {
        pathByIdx.get(i)?.classList.add("mmd-on");
        labelByIdx.get(i)?.classList.add("mmd-on");
      }
    });
  };

  const onClick = (ev: Event) => {
    const target = ev.target as Element | null;
    const node = target?.closest("g.node");
    if (node) {
      const id = idOfNode(node);
      if (id) { select(id); return; }
    }
    selected = null;
    clear();
  };
  container.addEventListener("click", onClick);
  return () => container.removeEventListener("click", onClick);
}

/** Renders a Mermaid diagram from source text, client-side. Dark theme to
 *  match the dashboard. Shows the raw source in a <details> fallback if the
 *  render fails. When `interactive`, edges rest slightly faded and clicking a
 *  node traces its full upstream/downstream path. */
export default function Mermaid({
  chart,
  className,
  interactive = false,
}: {
  chart: string;
  className?: string;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
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
          if (interactive) detach = setupTrace(ref.current, chart);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; detach?.(); };
  }, [chart, interactive]);

  return (
    <div className={`${className ?? ""}${interactive ? " mmd-interactive" : ""}`}>
      <div ref={ref} className="overflow-x-auto" />
      {interactive && (
        <style>{`
          .mmd-interactive svg .edgePaths > path { opacity: .55; transition: opacity .15s ease, stroke-width .15s ease; }
          .mmd-interactive svg .node { cursor: pointer; transition: opacity .15s ease; }
          .mmd-interactive svg .edgeLabel { transition: opacity .15s ease; }
          .mmd-interactive svg.mmd-sel .edgePaths > path { opacity: .04; }
          .mmd-interactive svg.mmd-sel .node { opacity: .12; }
          .mmd-interactive svg.mmd-sel .edgeLabel { opacity: .08; }
          .mmd-interactive svg.mmd-sel .edgePaths > path.mmd-on { opacity: 1; stroke-width: 2.4px; }
          .mmd-interactive svg.mmd-sel .node.mmd-on { opacity: 1; }
          .mmd-interactive svg.mmd-sel .edgeLabel.mmd-on { opacity: 1; }
        `}</style>
      )}
      {err && (
        <details className="mt-2 text-xs text-amber-400">
          <summary>diagram failed to render — show source</summary>
          <pre className="mt-1 whitespace-pre-wrap text-slate-400">{chart}</pre>
        </details>
      )}
    </div>
  );
}
