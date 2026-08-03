import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./pages-tests",
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175/crawler/",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "vite preview --mode pages --host 127.0.0.1 --port 4175",
    port: 4175,
    reuseExistingServer: false,
  },
  reporter: [["line"]],
});
