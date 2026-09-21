import { defineConfig } from '@playwright/test';

const sharedUse = {
  viewport: { width: 1440, height: 1000 },
  trace: 'retain-on-failure' as const,
};

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'development',
      use: { ...sharedUse, baseURL: 'http://127.0.0.1:5173/' },
    },
    {
      name: 'production',
      use: { ...sharedUse, baseURL: 'http://127.0.0.1:4173/gateway-api-visualizer/' },
    },
  ],
  webServer: [
    {
      command: 'pnpm run dev --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm run build && pnpm run preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173/gateway-api-visualizer/',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
