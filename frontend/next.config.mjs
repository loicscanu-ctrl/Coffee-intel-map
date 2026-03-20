import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const noopStub         = path.resolve(__dirname, "lib/pdf/react-pdf-noop.js");
const canvas2Stub      = path.resolve(__dirname, "lib/pdf/html2canvas-noop.js");
const chartCaptureNoop = path.resolve(__dirname, "lib/pdf/chartCapture-noop.js");

// Absolute paths to local files that import browser-only packages.
// Aliasing FILE PATHS (not npm package names) is reliable in Next.js 14
// App Router — the server compiler resolves local paths exactly, so these
// aliases are always intercepted before npm resolution.
const pdfEnginePath      = path.resolve(__dirname, "lib/pdf/pdfEngine.ts");
const pdfEnginePathNoExt = path.resolve(__dirname, "lib/pdf/pdfEngine");
const chartCapturePath      = path.resolve(__dirname, "lib/pdf/chartCapture.ts");
const chartCapturePathNoExt = path.resolve(__dirname, "lib/pdf/chartCapture");
const canvasLibPath         = path.resolve(__dirname, "lib/pdf/canvasLib.ts");
const canvasLibPathNoExt    = path.resolve(__dirname, "lib/pdf/canvasLib");

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // Client: point @react-pdf/renderer to the pre-built browser bundle
      config.resolve.alias["@react-pdf/renderer"] = path.resolve(
        __dirname,
        "node_modules/@react-pdf/renderer/lib/react-pdf.browser.js"
      );
    } else {
      // Server: alias pdfEngine.ts (and its extension-less form) to a no-op stub.
      // PdfReport.tsx imports from "./pdfEngine" instead of "@react-pdf/renderer"
      // directly, so this single alias breaks the entire trace chain.
      config.resolve.alias[pdfEnginePath]          = noopStub;
      config.resolve.alias[pdfEnginePathNoExt]     = noopStub;
      config.resolve.alias[chartCapturePath]       = chartCaptureNoop;
      config.resolve.alias[chartCapturePathNoExt]  = chartCaptureNoop;
      config.resolve.alias[canvasLibPath]          = canvas2Stub;
      config.resolve.alias[canvasLibPathNoExt]     = canvas2Stub;
      config.resolve.alias["html2canvas"]          = canvas2Stub;

      // NormalModuleReplacementPlugin catches any remaining browser-only
      // package imports regardless of how they got here (aliases can miss
      // imports that come through dynamic import chains with @/ prefixes).
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@react-pdf(\/.*)?$/,
          noopStub
        )
      );
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^html2canvas$/,
          canvas2Stub
        )
      );
    }
    return config;
  },
};

export default nextConfig;
