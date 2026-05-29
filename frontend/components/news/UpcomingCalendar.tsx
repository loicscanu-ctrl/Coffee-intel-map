"use client";
/**
 * "Coming up next 30 days" — upcoming publication calendar.
 *
 * Reads events.json (hand-maintained + built by
 * backend/scripts/build_events_calendar.py), filters to the next 30 days,
 * groups by ISO week (Mon-anchored), and renders a compact vertical
 * timeline. Each row: date · category icon · title · short note · link.
 */
import { useEffect, useState } from "react";

interface CalendarEvent {
  date:     string;            // YYYY-MM-DD
  time?:    string;            // optional HH:MM
  category: string;            // wasde · ico · vietnam_customs · cecafe · fnd · central_bank · other
  title:    string;
  url?:     string;
  notes?:   string;
}

interface EventsDoc {
  _schema?: string;
  events?: CalendarEvent[];
}

const CATEGORY_META: Record<string, { label: string; dot: string; tone: string }> = {
  wasde:           { label: "USDA WASDE",       dot: "bg-blue-400",    tone: "text-blue-300"   },
  ico:             { label: "ICO statistics",   dot: "bg-cyan-400",    tone: "text-cyan-300"   },
  vietnam_customs: { label: "VN customs",       dot: "bg-emerald-400", tone: "text-emerald-300"},
  cecafe:          { label: "Cecafé",           dot: "bg-emerald-400", tone: "text-emerald-300"},
  fnd:             { label: "FND (futures)",    dot: "bg-amber-400",   tone: "text-amber-300"  },
  central_bank:    { label: "Central bank",     dot: "bg-purple-400",  tone: "text-purple-300" },
  other:           { label: "Other",            dot: "bg-slate-400",   tone: "text-slate-300"  },
};

function _isoWeekKey(d: Date): string {
  // ISO week: Monday-anchored. Returns "YYYY-Www".
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;     // 1..7, Mon=1
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function _weekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

function _dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);   // midday to avoid TZ-edge flip
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

export default function UpcomingCalendar() {
  const [doc, setDoc] = useState<EventsDoc | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    fetch(`/data/events.json?_=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error("events 404"); return r.json(); })
      .then(setDoc)
      .catch(() => setError(true));
  }, []);

  if (!now) return null;
  if (error) {
    return <div className="text-xs text-slate-500 italic">Calendar unavailable — events.json missing.</div>;
  }
  if (!doc) return <div className="text-xs text-slate-500 animate-pulse">Reading calendar…</div>;

  const todayIso = now.toISOString().slice(0, 10);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 30);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const all = (doc.events ?? []).slice();
  const upcoming = all
    .filter((e) => e.date >= todayIso && e.date <= horizonIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Coming up · next 30 days</h2>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-500 italic">
          No events scheduled in the next 30 days. Run
          <code className="text-amber-400/80 mx-1">python backend/scripts/build_events_calendar.py --write</code>
          to refresh.
        </div>
      </section>
    );
  }

  // Group by ISO week.
  const groups = new Map<string, { key: string; weekStart: Date; rows: CalendarEvent[] }>();
  for (const ev of upcoming) {
    const d = new Date(`${ev.date}T12:00:00Z`);
    const key = _isoWeekKey(d);
    if (!groups.has(key)) {
      // Monday of the event's week (local-time).
      const ws = new Date(d);
      const offset = (ws.getDay() || 7) - 1;
      ws.setDate(ws.getDate() - offset);
      groups.set(key, { key, weekStart: ws, rows: [] });
    }
    groups.get(key)!.rows.push(ev);
  }
  const orderedWeeks = Array.from(groups.values()).sort((a, b) =>
    a.weekStart.getTime() - b.weekStart.getTime(),
  );

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Coming up
          <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
            · next 30 days · {upcoming.length} events
          </span>
        </h2>
      </div>
      <div className="space-y-3">
        {orderedWeeks.map((w) => (
          <div key={w.key} className="bg-slate-900 border border-slate-700 rounded-lg">
            <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              Week of {_weekLabel(w.weekStart)}
            </div>
            <ul className="divide-y divide-slate-800">
              {w.rows.map((ev, i) => {
                const meta = CATEGORY_META[ev.category] ?? CATEGORY_META.other;
                return (
                  <li key={`${ev.date}-${i}`} className="px-3 py-2 flex items-start gap-3 text-xs">
                    <span className="w-24 shrink-0 font-mono text-slate-400">
                      {_dayLabel(ev.date)}
                      {ev.time && <span className="ml-1 text-[10px] text-slate-500">{ev.time}</span>}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${meta.tone}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 truncate">
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300">
                            {ev.title}
                          </a>
                        ) : (
                          ev.title
                        )}
                      </div>
                      {ev.notes && (
                        <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{ev.notes}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
