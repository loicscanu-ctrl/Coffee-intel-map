"use client";
// Single entry point for @react-pdf/renderer.
// On the server, next.config.mjs aliases THIS file to react-pdf-noop.js.
// On the client, the normal webpack alias points @react-pdf/renderer to the browser build,
// so this static re-export resolves correctly.
export { pdf, Document, Page, View, Text, Image } from "@react-pdf/renderer";
