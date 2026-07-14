import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{js,mjs,ts}",
      "e2e/support/**/*.test.ts",
    ],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/lib/**/*.ts",
        "src/components/system/**/*.tsx",
        "src/features/mobile/**/*.{ts,tsx}",
        "src/features/studio/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.test-*.*",
        "**/*.spec.*",
        "**/*.spec-*.*",
        "**/*.d.ts",
        "**/__tests__/**",
        "**/{test,tests,fixture,fixtures}/**",
        "**/__snapshots__/**",
        "**/*.snap",
      ],
      thresholds: {
        "src/features/mobile/**/*.{ts,tsx}": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 85,
        },
        "src/features/mobile/authority/loopback-authority.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/features/mobile/tasks/{local-task-draft,local-task-draft-storage}.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/features/mobile/safety/mobile-safety-client.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/features/mobile/safety/create-mobile-safety-controller.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/features/studio/**/*.{ts,tsx}": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95,
        },
      },
    },
  },
});
