import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.E2E_PORT ?? 3100);
const db = process.env.E2E_DATABASE_URL ?? 'postgres://seg:seg@localhost:5432/seg_e2e';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node e2e/reset-db.mjs && node server/dist/index.js',
    cwd: path.resolve(__dirname, '..'),
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      APP_URL: `http://localhost:${port}`,
      DATABASE_URL: db,
      UPLOAD_DIR: path.join(os.tmpdir(), `seg-e2e-${port}`),
      ADMIN_EMAIL: 'admin@e2e.test',
      ADMIN_PASSWORD: 'admin-password-123',
      ADMIN_NAME: 'Farhana Chowdhury',
      RATE_LIMIT_AUTH: '100',
    },
  },
});
