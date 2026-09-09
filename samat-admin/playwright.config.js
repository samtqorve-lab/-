import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './smoke-tests',
  timeout: 30000,
  reporter: [['list'], ['github']],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: 'http://localhost:4174',
  },
});
