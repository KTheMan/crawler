import { defineConfig } from "@playwright/test";

const port = 4186;
const buildId = process.env.SOLID_FEATURE_RUNTIME_BUILD_ID;
const wasmSha256 = process.env.SOLID_FEATURE_WASM_SHA256;

if (!buildId || !wasmSha256?.match(/^[a-f0-9]{64}$/)) {
  throw new Error("Production solid-feature qualification requires manifest-locked SOLID_FEATURE_RUNTIME_BUILD_ID and SOLID_FEATURE_WASM_SHA256.");
}

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  globalSetup: "./scripts/solid-feature-qualification-server.mjs",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  reporter: [
    ["line"],
    ["junit", { outputFile: process.env.SOLID_FEATURE_BROWSER_JUNIT ?? "../../artifacts/solid-feature-qualification/current/browser/junit.xml" }],
  ],
  outputDir: process.env.SOLID_FEATURE_BROWSER_OUTPUT ?? "../../artifacts/solid-feature-qualification/current/browser/results",
  metadata: { candidateBuildId: buildId, candidateWasmSha256: wasmSha256 },
});
