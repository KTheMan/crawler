import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "vite --host 127.0.0.1 --port 4174",
    port: 4174,
    reuseExistingServer: true,
  },
  reporter: [["line"]],
});
