const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 60000,  // scale tests need up to 60 s
  use: {
    trace: 'on-first-retry',
    electron: {
      args: [path.join(__dirname, '..', 'src', 'main.js')],
    },
  },
});
