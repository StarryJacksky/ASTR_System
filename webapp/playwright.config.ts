import { defineConfig, devices } from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:3100";
const MOCK_CORE_ORIGIN = "http://127.0.0.1:18300";
const coreMode = process.env.ASTR_E2E_CORE_MODE === "real" ? "real" : "mock";
const externalServers = process.env.ASTR_E2E_EXTERNAL_SERVERS === "1";
const coreOrigin =
  coreMode === "real"
    ? process.env.ASTR_REAL_CORE_URL ?? "http://127.0.0.1:8300"
    : MOCK_CORE_ORIGIN;

const servers = [
  ...(coreMode === "mock"
    ? [
        {
          command: "node e2e/support/mock-core.mjs",
          url: `${MOCK_CORE_ORIGIN}/_test/health`,
          timeout: 30_000,
          reuseExistingServer: false,
          env: {
            ...process.env,
            ASTR_MOCK_CORE_HOST: "127.0.0.1",
            ASTR_MOCK_CORE_PORT: "18300",
            ASTR_MOCK_ALLOWED_ORIGIN: APP_ORIGIN,
          },
        },
      ]
    : []),
  {
    command: "node node_modules/next/dist/bin/next start -p 3100",
    url: APP_ORIGIN,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ASTR_CORE_URL: coreOrigin,
      NEXT_PUBLIC_ASTR_CORE: coreOrigin,
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  testMatch:
    coreMode === "real"
      ? /presence-real-smoke\.spec\.ts/
      : /presence(?:-[\w-]+)?\.spec\.ts/,
  testIgnore:
    coreMode === "real" ? undefined : /presence-real-smoke\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  timeout: 35_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/presence",
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: APP_ORIGIN,
    locale: "zh-CN",
    timezoneId: "Asia/Taipei",
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalServers ? undefined : servers,
});

export { APP_ORIGIN, MOCK_CORE_ORIGIN };
