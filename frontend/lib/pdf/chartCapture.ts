"use client";
// frontend/lib/pdf/chartCapture.ts
import html2canvas from "./canvasLib";

/**
 * Captures a DOM element as a JPEG data URL for embedding in @react-pdf/renderer.
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
      scale: 1.5,
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

/**
 * Captures the 7 charts needed for the PDF in parallel.
 */
export async function captureAllCharts(refs: {
  macroGross:    React.RefObject<HTMLDivElement>;
  macroNet:      React.RefObject<HTMLDivElement>;
  softsContract: React.RefObject<HTMLDivElement>;
  indPulseNy:    React.RefObject<HTMLDivElement>;
  indPulseLdn:   React.RefObject<HTMLDivElement>;
  dryPowderNy:   React.RefObject<HTMLDivElement>;
  dryPowderLdn:  React.RefObject<HTMLDivElement>;
}): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    Object.entries(refs).map(async ([key, ref]) => [key, await captureChartAsPng(ref)])
  );
  return Object.fromEntries(entries);
}
