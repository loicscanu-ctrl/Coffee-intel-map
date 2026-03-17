// frontend/lib/pdf/chartCapture.ts
import html2canvas from "html2canvas";

/**
 * Captures a DOM element (typically a Recharts ResponsiveContainer wrapper)
 * as a PNG data URL suitable for embedding in @react-pdf/renderer.
 * Returns null if the ref is not mounted.
 */
export async function captureChartAsPng(
  containerRef: React.RefObject<HTMLDivElement>,
  bgColor = "#0f172a"
): Promise<string | null> {
  if (!containerRef.current) return null;
  try {
    const canvas = await html2canvas(containerRef.current, {
      backgroundColor: bgColor,
      scale: 2,          // 2× for retina-quality in PDF
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Captures all six charts in parallel. Any failed capture returns null
 * (the PDF page will show a placeholder instead of crashing).
 */
export async function captureAllCharts(refs: {
  globalFlow:    React.RefObject<HTMLDivElement>;
  structural:    React.RefObject<HTMLDivElement>;
  counterparty:  React.RefObject<HTMLDivElement>;
  industryPulse: React.RefObject<HTMLDivElement>;
  dryPowder:     React.RefObject<HTMLDivElement>;
  obosMatrix:    React.RefObject<HTMLDivElement>;
}): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    Object.entries(refs).map(async ([key, ref]) => [key, await captureChartAsPng(ref)])
  );
  return Object.fromEntries(entries);
}
