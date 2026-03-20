// Server-side stub for @react-pdf/renderer.
// The real package is browser-only; this prevents webpack from failing
// when it analyses the server bundle. Event handlers that call pdf() only
// ever run in the browser, where the real alias (react-pdf.browser.js) is used.
module.exports = {};
