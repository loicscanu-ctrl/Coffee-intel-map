"use client";
/**
 * ReportCanvas — the printable column.
 *
 * Rendered VISIBLY on screen (it doubles as the live preview) and used as the
 * react-to-print target. Visibility matters: printing a `display:none` node
 * makes width-measuring charts (e.g. Recharts ResponsiveContainer) collapse to
 * 0px and render blank, so the canvas is always laid out at an explicit width.
 *
 * Each selected visual gets a card + an executive-summary box beneath it. The
 * box is an editable <textarea> on screen and a static <div> in print — cloned
 * <textarea> values don't survive react-to-print, so we swap via Tailwind's
 * `print:` variants instead.
 */
import { forwardRef } from "react";
import { REPORT_BY_ID } from "@/lib/report/registry";
import { useReportStore } from "@/lib/report/store";
import Markdown from "@/lib/report/markdown";

const PRINT_DATE = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/**
 * A single executive-summary box: editable <textarea> on screen, static rendered
 * Markdown in print (cloned textarea values don't survive react-to-print). An
 * optional label distinguishes split notes (e.g. "NY" vs "London"); in print the
 * label is hidden when the note is empty so blank halves leave no orphaned title.
 */
function NoteField({ noteId, label }: { noteId: string; label?: string }) {
  const note = useReportStore((s) => s.comments[noteId] ?? "");
  const setComment = useReportStore((s) => s.setComment);
  return (
    <div>
      {label && (
        <div className={`text-[9px] uppercase tracking-wider text-slate-500 mb-1 ${note.trim() ? "" : "print:hidden"}`}>
          {label}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setComment(noteId, e.target.value)}
        placeholder="Add your executive summary… Markdown supported: **bold**, *italic*, `code`, - bullets"
        rows={3}
        className="print:hidden w-full resize-y rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5
                   text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
      />
      {note.trim() && (
        // Rendered Markdown — live preview on screen, the only note shown in
        // print (the editable textarea is print:hidden).
        <Markdown className="text-xs text-slate-200 leading-relaxed space-y-1 mt-2 print:mt-0">
          {note}
        </Markdown>
      )}
    </div>
  );
}

const ReportCanvas = forwardRef<HTMLDivElement>(function ReportCanvas(_props, ref) {
  const selectedIds = useReportStore((s) => s.selectedIds);

  return (
    <div ref={ref} id="report-canvas" className="bg-slate-950 text-slate-100 mx-auto w-[700px] max-w-full">
      {/* Auto-injected briefing header */}
      <header className="border-b border-slate-700 pb-2 mb-3">
        <h1 className="text-base font-semibold text-amber-400">Coffee Intel Map — Market Briefing</h1>
        <p className="text-[10px] text-slate-400">{PRINT_DATE()}</p>
      </header>

      {selectedIds.length === 0 ? (
        <div className="text-xs text-slate-500 italic border border-dashed border-slate-700 rounded-lg px-3 py-10 text-center">
          Tick visuals on the left to build your briefing. Each one appears here with a note box.
        </div>
      ) : (
        <div className="space-y-3">
          {selectedIds.map((id) => {
            const def = REPORT_BY_ID[id];
            if (!def) return null;
            const Visual = def.Component;
            const splitNotes = def.notes && def.notes.length > 1 ? def.notes : null;
            return (
              // break-inside-avoid keeps a chart + its note on one printed page.
              <section
                key={id}
                className="rounded-lg border border-slate-700 bg-slate-900/60 overflow-hidden"
                style={{ breakInside: "avoid" }}
              >
                <div className="px-2 py-1 border-b border-slate-800">
                  <h2 className="text-xs font-semibold text-slate-100">{def.label}</h2>
                </div>
                <div className="p-2 overflow-x-auto">
                  <Visual isReportMode />
                </div>
                <div className="px-3 pb-3">
                  {splitNotes ? (
                    // One note per sub-chart, laid out to align under the chart's
                    // columns (the multi-part visuals render their parts 2-up).
                    <div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: `repeat(${splitNotes.length}, minmax(0,1fr))` }}
                    >
                      {splitNotes.map((n) => (
                        <NoteField key={n.key} noteId={`${id}__${n.key}`} label={n.label} />
                      ))}
                    </div>
                  ) : (
                    <NoteField noteId={id} />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ReportCanvas;
