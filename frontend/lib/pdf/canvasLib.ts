"use client";
// Wrapper so chartCapture.ts imports html2canvas via a local file.
// The server webpack aliases THIS file to html2canvas-noop.js,
// while the client build resolves it normally to the real package.
export { default } from "html2canvas";
