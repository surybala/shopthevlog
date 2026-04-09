import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: __dirname,
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    env: {
      ENABLE_E2E_AUTH: 'true',
      NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
    },
  },
})
