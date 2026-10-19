import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.E2E_PORT ?? 3100);
const db = process.env.E2E_DATABASE_URL ?? 'postgres://seg:seg@localhost:5432/seg_e2e';
const mockPort = Number(process.env.E2E_MOCK_AI_PORT ?? 3199);

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
  webServer: [{
    // Stands in for OpenRouter so AI features can be tested without a real key or model.
    command: 'node e2e/mock-openrouter.mjs',
    cwd: path.resolve(__dirname, '..'),
    url: `http://localhost:${mockPort}/health`,
    reuseExistingServer: false,
    env: { MOCK_PORT: String(mockPort) },
  }, {
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
      OPENROUTER_API_KEY: 'sk-or-e2e',
      AI_BASE_URL: `http://localhost:${mockPort}/api/v1`,
      AI_MODEL: 'anthropic/claude-haiku-5.5',
    },
  }],
});
