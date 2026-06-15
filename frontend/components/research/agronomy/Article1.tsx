"use client";
import { AgronomyCard, H, P, LI } from "./prose";

// ── Article 1: Rain / Supply Shock ────────────────────────────────────────────

function RainfedCycleTimeline() {
  const mx = (m: number) => m * 50;
  const BAR_Y = 8, BAR_H = 26;
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Rainfed farms · No irrigation (blossoming delayed to April)
      </p>
      <svg viewBox="0 0 600 100" className="w-full rounded overflow-hidden">
        <rect width="600" height="100" fill="#0f172a" />
        {/* Dry / Dormancy: Jan–Mar (3 months) */}
        <rect x={mx(0)} y={BAR_Y} width={150} height={BAR_H} fill="#1e3a5f" rx={2} />
        {/* Blossoming: Apr–May */}
        <rect x={mx(3)} y={BAR_Y} width={100} height={BAR_H} fill="#166534" rx={2} />
        {/* Fruit Development: Jun–Dec (fills to edge; harvest wraps to Jan) */}
        <rect x={mx(5)} y={BAR_Y} width={350} height={BAR_H} fill="#14532d" rx={2} />
        {/* Rain trigger marker */}
        <line x1={mx(3)} y1={BAR_Y - 2} x2={mx(3)} y2={BAR_Y + BAR_H + 4}
          stroke="#38bdf8" strokeWidth={1.5} />
        <circle cx={mx(3)} cy={BAR_Y - 4} r={3} fill="#38bdf8" />
        {/* Harvest wraps to next year — arrow + label at right edge */}
        <line x1={570} y1={BAR_Y + BAR_H / 2} x2={595} y2={BAR_Y + BAR_H / 2}
          stroke="#fde68a" strokeWidth={1.5} markerEnd="url(#arr-rainfed)" />
        <defs>
          <marker id="arr-rainfed" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#fde68a" />
          </marker>
        </defs>
        {/* Month labels */}
        {["J","F","M","A","M","J","J","A","S","O","N","D"].map((lbl, i) => (
          <text key={i} x={mx(i) + 25} y={50} textAnchor="middle" fontSize={9} fill="#64748b">{lbl}</text>
        ))}
        {/* Band labels */}
        <text x={75}       y={24} textAnchor="middle" fontSize={7}   fill="#bfdbfe" fontWeight="600">Dry / Dormancy</text>
        <text x={mx(3)+50} y={18} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Blossoming</text>
        <text x={425}      y={24} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Fruit Development</text>
        {/* Below-axis */}
        <text x={mx(3)} y={63} textAnchor="middle" fontSize={7.5} fill="#38bdf8">☔ Rain</text>
        <text x={mx(3)} y={73} textAnchor="middle" fontSize={7.5} fill="#38bdf8">triggers bloom</text>
        <text x={585}   y={63} textAnchor="middle" fontSize={7}   fill="#fde68a">Harvest</text>
        <text x={585}   y={73} textAnchor="middle" fontSize={7}   fill="#fde68a">Jan–Mar</text>
        {/* Legend */}
        <rect x={10}  y={84} width={8} height={6} fill="#1e3a5f" opacity={0.9} rx={1} />
        <text x={21}  y={90} fontSize={7.5} fill="#94a3b8">Dry / Dormancy (3 mo)</text>
        <rect x={155} y={84} width={8} height={6} fill="#14532d" opacity={0.9} rx={1} />
        <text x={166} y={90} fontSize={7.5} fill="#94a3b8">Fruit dev.</text>
        <circle cx={240} cy={87} r={3} fill="#38bdf8" />
        <text x={246} y={90} fontSize={7.5} fill="#38bdf8">Rain trigger (Apr)</text>
        <rect x={380} y={84} width={14} height={6} fill="#fde68a" opacity={0.4} rx={1} />
        <text x={397} y={90} fontSize={7.5} fill="#fde68a">Harvest wraps → next year</text>
      </svg>
    </div>
  );
}

function CropCycleTimeline() {
  const mx = (m: number) => m * 50;
  const BAR_Y = 8, BAR_H = 26;
  // Irrigation cycles: Mar (#1 bloom trigger), Apr (#2) — rains arrive May
  const IRRIG = [
    { m: 2, label: "#1 bloom", sub: "trigger", r: 3, sw: 1.5 },
    { m: 3, label: "#2",       sub: "",        r: 2, sw: 1   },
  ];
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Robusta seasonal cycle · Central Highlands Vietnam (irrigated farms)
      </p>
      <svg viewBox="0 0 600 112" className="w-full rounded overflow-hidden">
        <rect width="600" height="112" fill="#0f172a" />
        {/* Phase bands */}
        <rect x={mx(1)}  y={BAR_Y} width={100} height={BAR_H} fill="#1e3a5f" rx={2} />
        <rect x={mx(2)}  y={BAR_Y} width={100} height={BAR_H} fill="#166534" rx={2} />
        <rect x={mx(4)}  y={BAR_Y} width={300} height={BAR_H} fill="#14532d" rx={2} />
        <rect x={mx(10)} y={BAR_Y} width={100} height={BAR_H} fill="#78350f" rx={2} />
        {/* Danger overlays */}
        <rect x={mx(11)} y={BAR_Y} width={50} height={BAR_H} fill="#991b1b" opacity={0.6} rx={2} />
        <rect x={mx(1)}  y={BAR_Y} width={50} height={BAR_H} fill="#991b1b" opacity={0.45} rx={2} />
        {/* Irrigation cycles */}
        {IRRIG.map(({ m, r, sw }) => (
          <g key={m}>
            <line x1={mx(m)} y1={BAR_Y - 2} x2={mx(m)} y2={BAR_Y + BAR_H + 4}
              stroke="#93c5fd" strokeWidth={sw} strokeDasharray={m > 2 ? "3 2" : undefined} />
            <circle cx={mx(m)} cy={BAR_Y - 4} r={r} fill="#93c5fd" />
          </g>
        ))}
        {/* Rainy season start marker (May) */}
        <line x1={mx(4)} y1={BAR_Y - 2} x2={mx(4)} y2={BAR_Y + BAR_H + 4}
          stroke="#38bdf8" strokeWidth={1} strokeDasharray="4 2" />
        <text x={mx(4)} y={BAR_Y - 6} textAnchor="middle" fontSize={6.5} fill="#38bdf8">☔ Rain</text>
        {/* Harvest wrap arrow */}
        <defs>
          <marker id="arr-irr" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#fde68a" />
          </marker>
        </defs>
        <line x1={570} y1={BAR_Y + BAR_H / 2} x2={595} y2={BAR_Y + BAR_H / 2}
          stroke="#fde68a" strokeWidth={1.5} markerEnd="url(#arr-irr)" />
        {/* Month labels */}
        {["J","F","M","A","M","J","J","A","S","O","N","D"].map((lbl, i) => (
          <text key={i} x={mx(i) + 25} y={50} textAnchor="middle" fontSize={9} fill="#64748b">{lbl}</text>
        ))}
        {/* Band labels */}
        <text x={mx(1)+50}  y={24} textAnchor="middle" fontSize={7}   fill="#bfdbfe" fontWeight="600">Dry</text>
        <text x={mx(2)+50}  y={18} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Blossoming</text>
        <text x={mx(7)}     y={24} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Fruit Development</text>
        <text x={mx(10)+50} y={18} textAnchor="middle" fontSize={7}   fill="#fde68a" fontWeight="600">Harvest</text>
        <text x={mx(11)+25} y={27} textAnchor="middle" fontSize={6.5} fill="#fca5a5">⚠ Rain risk</text>
        {/* Below-axis annotations */}
        <text x={75}    y={63} textAnchor="middle" fontSize={8} fill="#fca5a5">⚠ Rain</text>
        <text x={75}    y={73} textAnchor="middle" fontSize={8} fill="#fca5a5">risk</text>
        {IRRIG.map(({ m, label, sub }) => (
          <g key={m}>
            <text x={mx(m)} y={63} textAnchor="middle" fontSize={7.5} fill="#93c5fd">💧 {label}</text>
            {sub && <text x={mx(m)} y={73} textAnchor="middle" fontSize={7.5} fill="#93c5fd">{sub}</text>}
          </g>
        ))}
        <text x={mx(4)} y={63} textAnchor="middle" fontSize={7} fill="#38bdf8">Rainy</text>
        <text x={mx(4)} y={73} textAnchor="middle" fontSize={7} fill="#38bdf8">season</text>
        <text x={585}   y={63} textAnchor="middle" fontSize={7} fill="#fde68a">→Jan</text>
        {/* Legend */}
        <rect x={10}  y={96} width={8} height={6} fill="#78350f" opacity={0.9} rx={1} />
        <text x={21}  y={102} fontSize={7.5} fill="#94a3b8">Harvest</text>
        <rect x={75}  y={96} width={8} height={6} fill="#14532d" opacity={0.9} rx={1} />
        <text x={86}  y={102} fontSize={7.5} fill="#94a3b8">Fruit dev.</text>
        <rect x={148} y={96} width={8} height={6} fill="#1e3a5f" opacity={0.9} rx={1} />
        <text x={159} y={102} fontSize={7.5} fill="#94a3b8">Dry / Dormancy</text>
        <rect x={270} y={96} width={8} height={6} fill="#991b1b" opacity={0.7} rx={1} />
        <text x={281} y={102} fontSize={7.5} fill="#fca5a5">Anomalous rain risk</text>
        <circle cx={400} cy={99} r={2.5} fill="#93c5fd" />
        <text x={406} y={102} fontSize={7.5} fill="#93c5fd">Irrig. cycles (25–30d)</text>
      </svg>
    </div>
  );
}

export default function Article1() {
  return (
    <AgronomyCard
      kicker="Agronomy · Supply Risk"
      title="When does rain become a supply shock?"
      briefing={
        <span>
          The mandatory 2–3 month dry period following harvest is a physiological
          requirement for floral dormancy — not a weather preference. Anomalous
          rainfall during November–January disrupts bud development, causing
          asynchronous blossoming and cascading harvest complications that persist
          for the entire subsequent season. The Central Highlands floods of
          November 2025 are the most recent example.
        </span>
      }
    >
      <H>The physiology of floral induction</H>
      <P>
        Coffee flowers will not bloom unless a period of water deficit breaks
        bud dormancy. For Robusta, this requires 2–3 months of dry conditions
        after harvest. When rainfall interrupts this window — even briefly — a
        cascade follows:
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          Buds at different developmental stages respond unevenly to the water
          stimulus, triggering staggered blooms across the plantation.
        </LI>
        <LI>
          Asynchronous blossoming means cherries ripen on wildly different
          schedules — multiple expensive harvest passes, degraded cup quality.
        </LI>
        <LI>
          A year-round food source for the Coffee Berry Borer (
          <em>Hypothenemus hampei</em>) drives population explosions in the
          following season.
        </LI>
      </ul>

      <H>Irrigation trigger rule</H>
      <P>
        The first irrigation must be delayed until{" "}
        <strong>75–80% of buds have developed to the outermost branch nodes</strong>.
        Premature watering — even by a week — causes heterogeneous blooming.
        Waiting past the threshold induces mass floral abortion as soil moisture
        drops below the permanent wilting point (~27% in basaltic soils).
      </P>

      <H>Key physiological thresholds</H>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-6">Parameter</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-6">Robusta</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Arabica</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            <tr>
              <td className="py-1.5 pr-6">Optimal temp range</td>
              <td className="py-1.5 pr-6">24–26°C</td>
              <td className="py-1.5">15–24°C</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Stomatal shutdown</td>
              <td className="py-1.5 pr-6">&gt;30°C</td>
              <td className="py-1.5">&gt;30°C</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Annual rainfall required</td>
              <td className="py-1.5 pr-6">1,200–1,800 mm</td>
              <td className="py-1.5">1,200–1,500 mm</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Optimal humidity</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>70–85%</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Rust outbreak threshold</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>Sustained humidity &gt;85%</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Mandatory dry period</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>2–3 months post-harvest (Nov–Feb)</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Water per irrigation cycle</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>400–600 litres / tree</td>
            </tr>
          </tbody>
        </table>
      </div>

      <CropCycleTimeline />

      <H>Rainfed farms: a different cycle</H>
      <P>
        Farms without irrigation wait for natural rains — the same water stimulus,
        delivered by the sky in late April/May instead of a pump in January. The
        physiological cascade is identical, but the calendar shifts ~3 months:
        blossoming in May, cherries maturing January–March. This is why Vietnamese
        Robusta export volumes have a secondary tail into Q1 — not just late-ripening
        clones (TR14/TR15), but also unirrigated smallholders running on a rain-cycle
        harvest. Traders modelling monthly Vietnamese supply should disaggregate the
        two populations.
      </P>
      <RainfedCycleTimeline />
    </AgronomyCard>
  );
}

