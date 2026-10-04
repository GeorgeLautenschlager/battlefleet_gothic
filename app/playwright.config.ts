import { defineConfig } from "@playwright/test";

// CHROMIUM_PATH points at a preinstalled Chromium (e.g. a cloud dev container); CI uses `playwright install`.
const executablePath = process.env["CHROMIUM_PATH"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    viewport: { width: 1400, height: 900 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: { command: "npm run build && npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: !process.env["CI"] },
});
