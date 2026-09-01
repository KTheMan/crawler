import { expect, test } from "@playwright/test";
import {
  collectBrowserFailures,
  fixtureDescriptor,
  installWorkerMessageAudit,
  sha256,
  successScreenshot,
  waitUntilReady,
  writeBrowserFixtureEvidence,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 180_000 });

test("production preview runs the manifest-locked build and release WASM", async ({ page }, testInfo) => {
  const descriptor = await fixtureDescriptor("production-runtime-identity");
  expect(descriptor.input).toEqual({ schema_version: 2, kind: "browser_runtime_identity", payload: { mock_worker: false, mode: "production_preview" } });
  const candidateBuildId = process.env.SOLID_FEATURE_RUNTIME_BUILD_ID;
  const candidateWasmSha256 = process.env.SOLID_FEATURE_WASM_SHA256;
  expect(candidateBuildId, "SOLID_FEATURE_RUNTIME_BUILD_ID must be manifest-locked").toBeTruthy();
  expect(candidateWasmSha256, "SOLID_FEATURE_WASM_SHA256 must be manifest-locked").toMatch(/^[a-f0-9]{64}$/);

  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  const runtimeWasmResponses: Promise<Buffer>[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (/crawler_part_runtime_bg(?:-[a-zA-Z0-9_-]+)?\.wasm$/.test(pathname)) {
      expect(response.ok(), `release runtime WASM returned HTTP ${response.status()}`).toBe(true);
      runtimeWasmResponses.push(response.body());
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await waitUntilReady(page);
  await expect.poll(() => runtimeWasmResponses.length, { timeout: 60_000 }).toBe(1);
  const runtimeWasm = await runtimeWasmResponses[0];
  expect(runtimeWasm.byteLength).toBeGreaterThan(0);
  const responseHash = sha256(runtimeWasm);
  expect(responseHash).toBe(candidateWasmSha256);

  const runtimeIdentity = await page.evaluate(() => ({
    cacheVersion: window.__crawlerApp.pwaStatus().cacheVersion,
    readiness: window.__crawlerApp.readiness(),
    safeMode: window.__crawlerApp.safeMode(),
  }));
  expect(runtimeIdentity.cacheVersion).toBe(`crawler-alpha-${candidateBuildId}`);
  expect(runtimeIdentity.readiness).toEqual({ ui: "ready", wasm: "ready", worker: "ready", renderer: "ready" });
  expect(runtimeIdentity.safeMode).toBe(false);
  expect(testInfo.config.metadata.candidateBuildId).toBe(candidateBuildId);
  expect(testInfo.config.metadata.candidateWasmSha256).toBe(candidateWasmSha256);
  const workerUrls = await page.evaluate(() => (window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls);
  expect(workerUrls.filter((url) => url.includes("model.worker")).length, JSON.stringify(workerUrls)).toBe(1);
  expect(failures.consoleErrors, "production console errors").toEqual([]);
  expect(failures.pageErrors, "production page errors").toEqual([]);
  await successScreenshot(page, "production-runtime-identity-passed.png");
  await writeBrowserFixtureEvidence(
    "production-runtime-identity",
    "production-runtime-identity",
    { kind: "success", result: { runtime_identity_matches_manifest: true } },
    {
      source_spec: "tests/solid-feature-runtime-identity.spec.ts",
      manifest_build_id: candidateBuildId,
      served_wasm_sha256: responseHash,
      mock_worker: false,
      production_preview: true,
      model_worker_count: 1,
      console_errors: failures.consoleErrors.length,
      page_errors: failures.pageErrors.length,
    },
  );
});
