// Server-side stub for chartCapture.ts.
// Chart captures only run in the browser; the server never calls these.
module.exports = {
  captureChartAsPng: async () => null,
  captureAllCharts:  async () => ({}),
};
