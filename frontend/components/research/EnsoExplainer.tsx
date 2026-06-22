"use client";
import { useState, useRef, useEffect } from "react";

// ── Typography helpers (dark theme, mirrors ResearchView) ───────────────────
function SectionH({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-bold text-slate-100 mt-7 mb-2 pb-1 border-b border-slate-700">{children}</h3>;
}
function SubH({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
// Monospace variable chip (a, b, c …) — red, like the source article.
function V({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-px rounded bg-slate-800 text-red-300 text-[11px] font-mono">{children}</code>;
}
function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border-l-4 border-amber-400/70 rounded-r p-3 my-3 text-xs text-slate-300 italic leading-relaxed">
      {children}
    </div>
  );
}

// ── Interactive equatorial-Pacific cross-section ────────────────────────────
// Slider drives trade-wind strength (0 = collapsed → El Niño, 1 = strong →
// Normal/La Niña); the canvas redraws the warm pool, sea-level tilt,
// thermocline slope, rainfall position and cold upwelling accordingly.
const SIM_W = 800;
const SIM_H = 450;

function stateInfo(s: number): { label: string; cls: string; body: string } {
  if (s > 0.7) return {
    label: "Normal / La Niña", cls: "text-emerald-400",
    body: "Strong trade winds blow east → west, piling warm water toward Asia (sea level there sits ~50 cm higher) and letting cold, nutrient-rich water upwell along the Americas.",
  };
  if (s > 0.3) return {
    label: "Transition", cls: "text-amber-400",
    body: "Trade winds weaken. The warm-water pool begins to slosh back toward the central/eastern Pacific under gravity, and the cold upwelling in the east slows down.",
  };
  return {
    label: "El Niño", cls: "text-red-400",
    body: "Trade winds collapse. The warm-water mass surges back toward South America, the thermocline flattens and cold upwelling stops — torrential rain shifts eastward while Asia dries out.",
  };
}

function EnsoSimulator() {
  const [wind, setWind] = useState(100);   // 0..100
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const s = wind / 100;
  const info = stateInfo(s);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, SIM_W, SIM_H);

    // Calculated variables -------------------------------------------------
    const warmPoolCenter = 400 - s * 250;        // pushed west when winds strong
    const seaLevelLeft   = 180 - s * 30;         // higher on the Asian side
    const seaLevelRight  = 180 + s * 15;
    const thermoLeft     = 320 + s * 80;         // deep in the west
    const thermoRight     = 320 - s * 130;       // shallow in the east

    // A. Ocean surface base
    ctx.beginPath();
    ctx.moveTo(0, seaLevelLeft);
    ctx.lineTo(SIM_W, seaLevelRight);
    ctx.lineTo(SIM_W, SIM_H);
    ctx.lineTo(0, SIM_H);
    ctx.fillStyle = "#0f5e9c";
    ctx.fill();

    // B. Thermocline & deep cold water
    ctx.beginPath();
    ctx.moveTo(0, thermoLeft);
    ctx.bezierCurveTo(SIM_W * 0.4, thermoLeft, SIM_W * 0.6, thermoRight, SIM_W, thermoRight);
    ctx.lineTo(SIM_W, SIM_H);
    ctx.lineTo(0, SIM_H);
    ctx.fillStyle = "#0a3a6a";
    ctx.fill();

    // C. Warm surface-water mass
    const grad = ctx.createRadialGradient(warmPoolCenter, 180, 0, warmPoolCenter, 180, 350);
    grad.addColorStop(0, "rgba(255, 69, 0, 0.75)");
    grad.addColorStop(1, "rgba(255, 69, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, seaLevelLeft);
    ctx.lineTo(SIM_W, seaLevelRight);
    ctx.lineTo(SIM_W, 350);
    ctx.lineTo(0, 350);
    ctx.fill();

    // D. Precipitation (clouds + rain follow the warm water)
    const cloudX = warmPoolCenter - 50;
    const cloudY = 60;
    ctx.fillStyle = "#64748b";
    ctx.beginPath();
    ctx.arc(cloudX, cloudY, 35, 0, Math.PI * 2);
    ctx.arc(cloudX + 45, cloudY - 10, 45, 0, Math.PI * 2);
    ctx.arc(cloudX + 90, cloudY, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(cloudX - 10 + i * 18, cloudY + 30);
      ctx.lineTo(cloudX - 20 + i * 18, cloudY + 80);
      ctx.stroke();
    }

    // E. Cold upwelling on the right (fades as winds drop)
    if (s > 0.3) {
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 3;
      ctx.globalAlpha = (s - 0.3) / 0.7;
      for (let i = 0; i < 4; i++) {
        const ax = SIM_W - 60 - i * 45;
        ctx.beginPath();
        ctx.moveTo(ax, thermoRight + 60);
        ctx.lineTo(ax, thermoRight - 20);
        ctx.lineTo(ax - 10, thermoRight - 10);
        ctx.moveTo(ax, thermoRight - 20);
        ctx.lineTo(ax + 10, thermoRight - 10);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // F. Trade-winds arrow (thickness scales with strength)
    if (s > 0.1) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2 + s * 6;
      const x0 = SIM_W / 2 + 120;
      const x1 = SIM_W / 2 - 120;
      ctx.beginPath();
      ctx.moveTo(x0, 100);
      ctx.lineTo(x1, 100);
      ctx.lineTo(x1 + 20, 85);
      ctx.moveTo(x1, 100);
      ctx.lineTo(x1 + 20, 115);
      ctx.stroke();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("Trade Winds", SIM_W / 2 - 45, 80);
    }

    // G. Theoretical thermocline baseline
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 320);
    ctx.lineTo(SIM_W, 320);
    ctx.stroke();
    ctx.setLineDash([]);

    // H. Geographic labels
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("Indonesia / Asia", 20, 35);
    ctx.fillText("Peru / Americas", SIM_W - 170, 35);
  }, [s]);

  return (
    <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-3 text-center">
        Interactive equatorial-Pacific cross-section
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 mb-3 text-[11px] font-semibold">
        <span className="text-red-400">Weak (El Niño)</span>
        <input
          type="range" min={0} max={100} value={wind}
          onChange={e => setWind(Number(e.target.value))}
          aria-label="Trade winds strength"
          className="w-full max-w-sm cursor-pointer accent-sky-500"
        />
        <span className="text-emerald-400">Strong (Normal / La Niña)</span>
      </div>

      <div className="rounded-md overflow-hidden border border-slate-700">
        <canvas
          ref={canvasRef}
          width={SIM_W}
          height={SIM_H}
          className="block w-full h-auto"
          style={{ background: "linear-gradient(to bottom, #87CEEB 0%, #e0f6ff 100%)" }}
        />
      </div>

      <div className="mt-3 bg-slate-800/60 border-l-4 border-sky-500 rounded-r p-3 text-xs text-slate-300 leading-relaxed">
        <strong>Current state: <span className={info.cls}>{info.label}</span>.</strong> {info.body}
      </div>
    </div>
  );
}

// ── Article ─────────────────────────────────────────────────────────────────
export default function EnsoExplainer() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">
        Weather · Climate driver
      </div>
      <h3 className="text-xl font-bold text-slate-100 leading-tight mb-1">The Climate Pendulum</h3>
      <P>
        An interactive guide to the <strong>ENSO cycle</strong> — El Niño, La Niña, and the oceanic mechanics that
        dictate global weather, and with it the supply risk that runs through every coffee origin.
      </P>

      <EnsoSimulator />

      <SectionH>The engine: Earth&rsquo;s rotation and the trade winds</SectionH>
      <P>
        To understand El Niño, first look at what happens when the planet behaves &ldquo;normally.&rdquo; The
        fundamental engine of our climate is the Earth&rsquo;s rotation. Through the <strong>Coriolis effect</strong>,
        rotation deflects air masses and creates the consistent, powerful equatorial winds we call the{" "}
        <strong>trade winds</strong>.
      </P>
      <P>
        Blowing steadily from east to west across the Pacific, these winds act like a giant invisible broom: they
        continuously sweep sun-warmed surface water from the coast of South America all the way to Indonesia and
        Australia, building a massive <strong>warm pool</strong> in the Western Pacific that shapes global weather.
      </P>

      <SectionH>The three phases of the pendulum</SectionH>
      <P>
        The El Niño–Southern Oscillation (ENSO) is not a series of random events but a continuous, <em>asymmetric</em>{" "}
        pendulum swinging between three states.
      </P>

      <SubH>1 · The normal state (the &ldquo;recharge&rdquo; phase)</SubH>
      <P>Under normal conditions the system is wound up like a spring. Five variables define it:</P>
      <ul className="space-y-1 mb-2">
        <LI><strong>Trade winds <V>a</V></strong> — blowing strongly westward.</LI>
        <LI><strong>Warm-water mass <V>b</V></strong> — pushed consistently toward Asia.</LI>
        <LI><strong>Sea level <V>c</V></strong> — the pile-up leaves Indonesia roughly 50 cm higher than Peru.</LI>
        <LI><strong>Precipitation <V>d</V></strong> — the western warm pool evaporates, building towering clouds and
          heavy rain over Southeast Asia.</LI>
        <LI><strong>Upwelling <V>e</V></strong> — in the east, the void left behind is filled by freezing,
          nutrient-rich water drawn up from the deep ocean.</LI>
      </ul>

      <SubH>2 · El Niño — the discharge (9–12 months)</SubH>
      <P>
        The normal state can&rsquo;t last because the system pushes toward its own breaking point. The trigger is
        usually a <strong>Westerly Wind Burst</strong> — an intense local storm in the Western Pacific that briefly
        blows <em>against</em> the trade winds.
      </P>
      <P>
        Once the trade winds weaken enough, gravity takes over: the hill of warm water piled up in Asia collapses and
        sloshes back east across the Pacific. This is <strong>El Niño</strong> — a rapid &ldquo;discharge&rdquo; in
        which the ocean releases enormous stored heat into the atmosphere. The result is a global inversion of
        extremes: Asia, stripped of its warm water and evaporation, suffers drought, while the warm water arriving in
        the Eastern Pacific brings torrential rain and flooding to the normally arid coasts of South America.
      </P>

      <SubH>3 · La Niña — the rebound (1–3 years)</SubH>
      <P>
        Because El Niño violently evacuates the ocean&rsquo;s stored heat, it destroys its own fuel in under a year.
        The depleted, cooler ocean contracts the air above it, pressure rises, and the trade winds roar back with a
        vengeance. This overcompensation is <strong>La Niña</strong> — the &ldquo;hangover&rdquo; of El Niño: unusually
        strong trade winds pushing even more warm water west and drawing up even more cold water in the east.
      </P>

      <Highlight>
        <strong>The asymmetry of ENSO.</strong> El Niño is a fast, gravity-driven collapse (~1 year); La Niña is a slow
        accumulation — the ocean can store heat for a long time without spilling over. That is why a La Niña can get
        stuck in a &ldquo;double-dip&rdquo; or &ldquo;triple-dip,&rdquo; lasting up to three consecutive years, waiting
        for the right atmospheric spark to trigger the next El Niño.
      </Highlight>

      <SectionH>Predicting the unpredictable: how we model ENSO</SectionH>
      <P>
        From surface variables alone (winds, rain, sea-surface temperature) El Niño would be impossible to forecast.
        The secret lies beneath the surface, in the <strong>thermocline</strong> — the sharp underwater boundary
        separating the warm surface layer from the freezing abyss. In normal phases it is pushed deep in the west
        (~150 m) and slopes upward to nearly touch the surface in the east.
      </P>
      <P>
        Modern forecasts rely on the <strong>delayed-oscillator theory</strong>. As the system destabilises, the
        shifting thermocline launches slow underwater <strong>Kelvin waves</strong>; because water is far denser than
        air, they take 2–3 months to cross the Pacific. By tracking these waves, scientists can flag an El Niño
        <strong> 6–9 months</strong> before the warm water ever surfaces off South America.
      </P>

      <SubH>Tracking the data</SubH>
      <P>Global agencies (NOAA, Australia&rsquo;s BOM) monitor the system in real time and publish open data:</P>
      <ul className="space-y-1 mb-2">
        <LI><strong>Niño 3.4 index</strong> — sea-surface-temperature anomaly in the central-eastern Pacific; a
          sustained reading above <strong>+0.5&nbsp;°C</strong> officially marks an El Niño (below −0.5&nbsp;°C, a La
          Niña).</LI>
        <LI><strong>Southern Oscillation Index (SOI)</strong> — the air-pressure difference between Tahiti and Darwin,
          a direct read on trade-wind strength.</LI>
        <LI><strong>TAO array</strong> — dozens of deep-sea buoys anchored across the equator tracking thermocline
          depth and sub-surface heat long before it reaches the surface.</LI>
      </ul>

      <SectionH>Why it matters for coffee</SectionH>
      <P>
        ENSO is the single biggest seasonal swing factor across coffee origins — tendencies, not certainties, but ones
        the market trades on. <strong>El Niño</strong> typically dries and overheats Southeast Asia (Vietnam and
        Indonesian Robusta) and can wet East Africa, while leaving Brazil mixed. <strong>La Niña</strong> tends to soak
        Southeast Asia and has historically aligned with Brazilian dryness and a widened frost window in the southern
        Arabica belt. Because the ocean signal leads the weather by months, a developing phase is an early read on the
        next crop.
      </P>
      <P className="text-[11px] text-slate-500">
        The app&rsquo;s <strong>ENSO tab</strong> turns this into live tools — the current Niño 3.4 state, the forecast
        plume and an origin risk map — while the <strong>Weather</strong> research above covers the frost tail-risk
        this cycle modulates.
      </P>
    </div>
  );
}
