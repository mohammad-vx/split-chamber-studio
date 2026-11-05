// End-to-end tests drive the real Electron app (see tests/e2e).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15 * 60 * 1000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: './test-results',
});
