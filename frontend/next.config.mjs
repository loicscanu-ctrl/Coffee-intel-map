import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@react-pdf/renderer"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias["@react-pdf/renderer"] = path.resolve(
        __dirname,
        "node_modules/@react-pdf/renderer/lib/react-pdf.browser.js"
      );
    }
    return config;
  },
};

export default nextConfig;
