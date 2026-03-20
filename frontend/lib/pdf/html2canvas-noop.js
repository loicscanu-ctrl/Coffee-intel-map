// Server-side stub for html2canvas.
// The real package uses DOM APIs; this prevents webpack from failing
// when it analyses the server bundle. Chart captures only run in the browser.
module.exports = async () => ({ toDataURL: () => null });
module.exports.default = module.exports;
