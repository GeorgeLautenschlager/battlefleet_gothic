import { defineConfig } from "@playwright/test";

// CHROMIUM_PATH points at a preinstalled Chromium (e.g. a cloud dev container); CI uses `playwright install`.
const executablePath = process.env["CHROMIUM_PATH"];
// E2E_SERVER_URL + E2E_ENGINE_BUILD: run against a deployed game server instead of a local one (a smoke test).
const remoteServer = process.env["E2E_SERVER_URL"];
const server = remoteServer ?? "http://127.0.0.1:8787";
const engineBuild = remoteServer ? (process.env["E2E_ENGINE_BUILD"] ?? "dev") : "dev";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: [
    ...(remoteServer ? [] : [{
      // The game server, locally in workerd (network play).
      command: "npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to .wrangler/e2e",
      cwd: "../server",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    }]),
    {
      command: "npm run build && npx vite preview --port 4173 --strictPort",
      env: { VITE_SERVER_URL: server, VITE_ENGINE_BUILD: engineBuild },
      port: 4173,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
