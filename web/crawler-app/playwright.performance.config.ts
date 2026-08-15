import { defineConfig } from "@playwright/test";

const port = Number(process.env.SKETCH_PERF_PORT ?? 4177);

export default defineConfig({
  grep: process.env.SKETCH_PERF_TEST_GREP ? new RegExp(process.env.SKETCH_PERF_TEST_GREP) : undefined,
  testDir: "./tests",
  timeout: 15 * 60_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    headless: process.env.SKETCH_PERF_HEADED !== "1",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
  reporter: [["line"]],
});
