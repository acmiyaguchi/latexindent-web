import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // The wasm cold start is ~25s after fetch, so each Run can take ~30s.
  // Keep timeouts generous.
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: 'http://localhost:8765',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8765',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'app',
      testMatch: /app\.spec\.js$/,
    },
    {
      // The full-matrix project iterates every cataloged (input, variant)
      // pair (~194 tests). Each test reloads the page for a fresh
      // latexindent state, so we run multiple workers in parallel — the
      // browser HTTP cache keeps the wasm warm within a worker.
      name: 'matrix',
      testMatch: /matrix\.spec\.js$/,
      fullyParallel: true,
      workers: process.env.CI ? 2 : 4,
    },
  ],
});
