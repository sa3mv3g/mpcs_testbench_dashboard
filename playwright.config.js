const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 60000,  // scale tests need up to 60 s
  use: {
    trace: 'on-first-retry',
  },
});
