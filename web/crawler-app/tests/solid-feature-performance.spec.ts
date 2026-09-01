import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  commitExtrude,
  createQualifiedPlanarFaceSketch,
  createQualifiedSketch,
  openExtrudeEdit,
  percentile,
  performanceBudgets,
  startExtrude,
  successScreenshot,
  waitUntilReady,
  writePerformanceEvidence,
} from "./solid-feature-qualification-helpers";
import {
  attributeSolidFeatureLongTasks,
  type SolidFeatureActionInterval,
  type SolidFeatureLongTaskEntry,
  type SolidFeaturePerformancePhase,
  type SolidFeaturePerformanceWorkload,
} from "./solid-feature-performance-audit";

test.describe.configure({ timeout: 1_200_000 });
const representativeRepairCandidateCount = 1;

async function jsHeapUsedBytes(cdp: CDPSession): Promise<number> {
  const metrics = await cdp.send("Performance.getMetrics") as { metrics: Array<{ name: string; value: number }> };
  const heap = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
  if (heap === undefined) throw new Error("Chrome did not expose JSHeapUsedSize for the locked performance profile");
  return heap;
}

type PerformanceAuditWindow = Window & {
  __solidFeatureLongTasks: SolidFeatureLongTaskEntry[];
  __solidFeatureLongTaskObserver?: PerformanceObserver;
  __solidFeatureLongTaskStart: number;
  __solidFeatureActionIntervals: SolidFeatureActionInterval[];
  __solidFeatureActionSequence: number;
  __solidFeatureWorkloadId?: SolidFeaturePerformanceWorkload;
  __solidFeatureBeginAction(phase: SolidFeaturePerformancePhase): { id: number; phase: SolidFeaturePerformancePhase; startTime: number };
  __solidFeatureFinishAction(action: { id: number; phase: SolidFeaturePerformancePhase; startTime: number }): number;
  __solidFeatureAfterStablePaint(predicate: () => boolean): Promise<boolean>;
};

async function measurePreview(page: Page, requestedHeight: number, expectedMaximum?: number): Promise<number> {
  return page.evaluate(async ({ height, expectedMax }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const roundedExpectedMaximum = expectedMax === undefined ? undefined : Math.round(expectedMax * 1_000) / 1_000;
    const action = audit.__solidFeatureBeginAction("preview");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Extrude distance field is absent during performance measurement");
    document.querySelector("#operation-state")?.removeAttribute("data-preview-source");
    input.value = String(height);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(height) }));
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      const boundsHeight = Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000;
      if ((roundedExpectedMaximum === undefined || boundsHeight === roundedExpectedMaximum)
        && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet") {
        const installedPreviewRemainsStable = await audit.__solidFeatureAfterStablePaint(() => {
          const stableHeight = Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000;
          return (roundedExpectedMaximum === undefined || stableHeight === roundedExpectedMaximum)
            && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet";
        });
        if (installedPreviewRemainsStable) return audit.__solidFeatureFinishAction(action);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error(`Extrude preview did not reach ${expectedMax ?? "a native planar-face result"} for ${height} mm distance before the qualification timeout`);
  }, { height: requestedHeight, expectedMax: expectedMaximum });
}

type RepairWorkload = {
  detailFeatureId: string;
  candidateId: string;
  observed: Record<string, unknown>[];
  baseHash: string;
  acceptedBounds: number[];
};

async function setupRepairWorkload(
  page: Page,
  supportId: string,
  observedSupportFace: import("../src/protocol").TopologyReferenceView,
): Promise<RepairWorkload> {
  const document = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const expected = document.topology_references?.[supportId];
  if (!expected) throw new Error(`Planar-face repair support ${supportId} is absent`);
  const detailFeatureId = Object.entries(document.features as Record<string, any>)
    .find(([, feature]) => feature.operation?.schema_id === "crawler.operation.sketch"
      && feature.inputs?.support?.id === supportId)?.[0];
  if (!detailFeatureId) throw new Error("Planar-face sketch support feature is absent");
  const broken = structuredClone(document);
  broken.topology_references[supportId].stable_kernel_id = "18446744073709551615";
  broken.topology_references[supportId].stable_token = `${expected.stable_token}:performance-missing`;
  const beforeBrokenHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate((documentValue) => window.__crawlerApp.hydrateDocument(documentValue), broken);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(beforeBrokenHash);
  await expect(page.locator(`[data-feature-id="${detailFeatureId}"]`)).toBeVisible({ timeout: 60_000 });
  await page.locator(`[data-feature-id="${detailFeatureId}"]`).click();
  if (observedSupportFace.body !== expected.body || observedSupportFace.stable_kernel_id !== expected.stable_kernel_id) {
    throw new Error("Captured renderer face does not match the retained support authority");
  }
  const candidateId = `observed:performance-repair:${expected.body}:${expected.stable_kernel_id}`;
  const currentObserved = await page.evaluate(() => window.__crawlerApp.observedTopology()) as unknown as Record<string, any>[];
  const observed = [
    ...currentObserved.filter((candidate) =>
      candidate.kind !== "face"
      || candidate.body !== observedSupportFace.body
      || candidate.stable_kernel_id !== observedSupportFace.stable_kernel_id),
    { ...observedSupportFace, id: candidateId, stable_token: `${observedSupportFace.stable_token}:performance-repair-observed` },
  ];
  return {
    detailFeatureId,
    candidateId,
    observed,
    baseHash: await page.evaluate(() => window.__crawlerApp.durableChecksum()),
    acceptedBounds: await page.evaluate(() => window.__crawlerApp.geometryBounds()),
  };
}

async function measureRepairPreview(page: Page, setup: RepairWorkload): Promise<number> {
  return page.evaluate(async ({ observed, candidateId }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const action = audit.__solidFeatureBeginAction("preview");
    window.__crawlerApp.inspectRepair(observed as any);
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      const repair = window.__crawlerApp.historyServices().repair;
      if (repair?.status === "evaluation_blocked"
        && repair.preview.candidates[0]?.candidate.id === candidateId
        && document.querySelector(`[data-repair-candidate="${CSS.escape(candidateId)}"]`)) {
        document.querySelector<HTMLButtonElement>(`[data-repair-candidate="${CSS.escape(candidateId)}"]`)!.click();
        break;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    while (performance.now() < deadline) {
      const preview = window.__crawlerApp.topologyRebindPreview();
      if (preview?.phase === "ready" && preview.selected === candidateId
        && preview.baseDocumentHash === window.__crawlerApp.durableChecksum()
        && document.querySelector('[data-repair-preview-state="ready"]')) {
        if (await audit.__solidFeatureAfterStablePaint(() => window.__crawlerApp.topologyRebindPreview()?.phase === "ready")) {
          return audit.__solidFeatureFinishAction(action);
        }
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Planar-face repair preview did not produce native replacement geometry");
  }, { observed: setup.observed, candidateId: setup.candidateId });
}

async function measureRepairCommit(page: Page, setup: RepairWorkload): Promise<number> {
  return page.evaluate(async ({ candidateId, baseHash }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const action = audit.__solidFeatureBeginAction("recompute");
    const button = document.querySelector<HTMLButtonElement>("[data-apply-repair]");
    if (!button || window.__crawlerApp.topologyRebindPreview()?.selected !== candidateId) throw new Error("Basis-bound native repair apply button is absent");
    button.click();
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      if (window.__crawlerApp.durableChecksum() !== baseHash && document.querySelector("#timeline-status")?.textContent?.includes("Rebound explicitly")) {
        if (await audit.__solidFeatureAfterStablePaint(() => window.__crawlerApp.durableChecksum() !== baseHash)) return audit.__solidFeatureFinishAction(action);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Explicit planar-face repair did not commit");
  }, { candidateId: setup.candidateId, baseHash: setup.baseHash });
}

async function measureRepairCancellation(page: Page, setup: RepairWorkload): Promise<number> {
  return page.evaluate(async ({ acceptedBounds, baseHash }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const action = audit.__solidFeatureBeginAction("cancel");
    const button = document.querySelector<HTMLButtonElement>("[data-cancel-repair]");
    if (!button) throw new Error("Explicit repair cancellation control is absent");
    button.click();
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      const bounds = window.__crawlerApp.geometryBounds();
      if (window.__crawlerApp.topologyRebindPreview() === undefined
        && !document.querySelector("[data-repair-preview-state]")
        && window.__crawlerApp.durableChecksum() === baseHash
        && JSON.stringify(bounds) === JSON.stringify(acceptedBounds)) {
        if (await audit.__solidFeatureAfterStablePaint(() =>
          window.__crawlerApp.topologyRebindPreview() === undefined
          && window.__crawlerApp.durableChecksum() === baseHash
          && JSON.stringify(window.__crawlerApp.geometryBounds()) === JSON.stringify(acceptedBounds))) {
          return audit.__solidFeatureFinishAction(action);
        }
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Explicit planar-face repair cancellation did not restore the accepted packet");
  }, { acceptedBounds: setup.acceptedBounds, baseHash: setup.baseHash });
}

async function measureCommit(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audit = window as unknown as PerformanceAuditWindow;
    const action = audit.__solidFeatureBeginAction("recompute");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Extrude distance field is absent during recompute measurement");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      if (document.querySelector("#operation-state")?.getAttribute("data-status") === "committed") {
        const measured = window.__crawlerApp.performanceEvidence().timingsMs.recompute;
        if (typeof measured !== "number") throw new Error("Runtime did not publish an Extrude recompute measurement");
        audit.__solidFeatureFinishAction(action);
        return measured;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Extrude recompute did not commit before the qualification timeout");
  });
}

async function measureCancellation(page: Page, expectedAcceptedHeight: number): Promise<number> {
  return page.evaluate(async (acceptedHeight) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const action = audit.__solidFeatureBeginAction("cancel");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Extrude distance field is absent during cancellation measurement");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const deadline = action.startTime + 60_000;
    while (performance.now() < deadline) {
      const boundsHeight = Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000;
      if (document.querySelector("#operation-state")?.getAttribute("data-status") === "cancelled" && boundsHeight === acceptedHeight) {
        const restoredPacketRemainsStable = await audit.__solidFeatureAfterStablePaint(() => {
          const stableHeight = Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000;
          return document.querySelector("#operation-state")?.getAttribute("data-status") === "cancelled"
            && stableHeight === acceptedHeight;
        });
        if (restoredPacketRemainsStable) return audit.__solidFeatureFinishAction(action);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Extrude cancellation did not complete before the qualification timeout");
  }, expectedAcceptedHeight);
}

test("locked production profile satisfies preview, recompute, cancellation, long-task, and memory budgets", async ({ browser }, testInfo) => {
  const budgetProfile = await performanceBudgets();
  const results: Array<Record<string, unknown>> = [];
  const baseURL = String(testInfo.project.use.baseURL ?? "");
  if (!baseURL) throw new Error("Production performance qualification requires a configured baseURL");

  for (const workloadBudget of budgetProfile.workloads) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Storage.clearDataForOrigin", { origin: new URL(baseURL).origin, storageTypes: "all" });
    const workload = workloadBudget.id.endsWith("annulus") ? "annulus" as const : "rectangle" as const;
    const planarFaceWorkload = workloadBudget.id === "extrude-planar-face-rectangle" || workloadBudget.id === "planar-face-support-repair";
    const repairWorkload = workloadBudget.id === "planar-face-support-repair";
    const failures = collectBrowserFailures(page);
    await page.addInitScript(() => {
      const measurements: SolidFeatureLongTaskEntry[] = [];
      const audit = window as unknown as PerformanceAuditWindow;
      audit.__solidFeatureLongTasks = measurements;
      audit.__solidFeatureLongTaskStart = Number.POSITIVE_INFINITY;
      audit.__solidFeatureActionIntervals = [];
      audit.__solidFeatureActionSequence = 0;
      audit.__solidFeatureBeginAction = (phase) => ({
        id: ++audit.__solidFeatureActionSequence,
        phase,
        startTime: performance.now(),
        ...(audit.__solidFeatureWorkloadId ? { workload_id: audit.__solidFeatureWorkloadId } : {}),
      });
      audit.__solidFeatureFinishAction = (action) => {
        const endTime = performance.now();
        audit.__solidFeatureActionIntervals.push({ ...action, endTime });
        return endTime - action.startTime;
      };
      audit.__solidFeatureAfterStablePaint = async (predicate) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return predicate();
      };
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        audit.__solidFeatureLongTaskObserver = new PerformanceObserver((list) => measurements.push(...list.getEntries()
          .filter((entry) => entry.startTime >= audit.__solidFeatureLongTaskStart)
          .map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))));
        audit.__solidFeatureLongTaskObserver.observe({ entryTypes: ["longtask"] });
      }
    });
    await page.goto(planarFaceWorkload ? `${baseURL}?qualificationReferencePart=1` : baseURL);
    await waitUntilReady(page);
    await page.evaluate((workloadId) => { (window as unknown as PerformanceAuditWindow).__solidFeatureWorkloadId = workloadId; }, workloadBudget.id as SolidFeaturePerformanceWorkload);
    expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("longtask")), "locked Chrome profile must expose Long Tasks API").toBe(true);
    let constructionPlaneId: string | undefined;
    if (workloadBudget.id.includes("offset-plane")) {
      await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
      await page.locator("#create-offset-plane").first().click();
      await page.locator("#construction-plane-offset").fill("5.000001");
      await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
      await page.locator("#apply-construction-plane").click();
      await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
      constructionPlaneId = await page.evaluate(() => window.__crawlerApp.constructionPlanes()[0]?.id);
      expect(constructionPlaneId, "offset-plane workload must create a durable datum before sketching").toBeTruthy();
    }
    const planarSupport = planarFaceWorkload
      ? await createQualifiedPlanarFaceSketch(page, `performance:${workloadBudget.id}`)
      : undefined;
    if (!planarSupport) await createQualifiedSketch(
        page,
        workload,
        `performance:${workloadBudget.id}`,
        true,
        constructionPlaneId ? { kind: "construction", plane: constructionPlaneId } : { kind: "origin", plane: "xy" },
      );
    await startExtrude(page, 10);
    await commitExtrude(page);
    const repair = repairWorkload ? await setupRepairWorkload(page, planarSupport!.topologyReferenceId, planarSupport!.observedFace) : undefined;

    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = await jsHeapUsedBytes(cdp);
    await page.evaluate(() => {
      const audit = window as unknown as PerformanceAuditWindow;
      audit.__solidFeatureLongTasks.length = 0;
      audit.__solidFeatureLongTaskStart = performance.now();
      audit.__solidFeatureActionIntervals.length = 0;
      audit.__solidFeatureActionSequence = 0;
    });
    const previewSamples: number[] = [];
    const recomputeSamples: number[] = [];
    const cancellationSamples: number[] = [];
    const repairRankings: string[][] = [];
    const totalSamples = budgetProfile.warm_up_samples + budgetProfile.measured_samples;

    if (repair) {
      for (let sample = 0; sample < totalSamples; sample += 1) {
        const previewElapsed = await measureRepairPreview(page, repair);
        repairRankings.push(await page.evaluate(() => {
          const inspection = window.__crawlerApp.historyServices().repair;
          return inspection?.status === "evaluation_blocked" ? inspection.preview.candidates.map((candidate) => candidate.candidate.id) : [];
        }));
        const recomputeElapsed = await measureRepairCommit(page, repair);
        if (sample >= budgetProfile.warm_up_samples) {
          previewSamples.push(previewElapsed);
          recomputeSamples.push(recomputeElapsed);
        }
        await page.keyboard.press("Control+z");
        await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(repair.baseHash);
        await page.locator(`[data-feature-id="${repair.detailFeatureId}"]`).click();
      }
      for (let cycle = 0; cycle < workloadBudget.preview_edit_cancel_cycles; cycle += 1) {
        await measureRepairPreview(page, repair);
        repairRankings.push(await page.evaluate(() => {
          const inspection = window.__crawlerApp.historyServices().repair;
          return inspection?.status === "evaluation_blocked" ? inspection.preview.candidates.map((candidate) => candidate.candidate.id) : [];
        }));
        cancellationSamples.push(await measureRepairCancellation(page, repair));
      }
    } else {
      for (let sample = 0; sample < totalSamples; sample += 1) {
        await openExtrudeEdit(page);
        const nextDistance = 11 + (sample % 5);
        const expectedMaximum = constructionPlaneId ? nextDistance + 5.000001 : planarFaceWorkload ? undefined : nextDistance;
        const previewElapsed = await measurePreview(page, nextDistance, expectedMaximum);
        const recomputeElapsed = await measureCommit(page);
        await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
        if (sample >= budgetProfile.warm_up_samples) {
          previewSamples.push(previewElapsed);
          recomputeSamples.push(recomputeElapsed);
        }
      }

      for (let cycle = 0; cycle < workloadBudget.preview_edit_cancel_cycles; cycle += 1) {
        const acceptedHeight = await page.evaluate(() => Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000);
        await openExtrudeEdit(page);
        const nextDistance = 17 + (cycle % 3);
        await measurePreview(page, nextDistance, constructionPlaneId ? nextDistance + 5.000001 : planarFaceWorkload ? undefined : nextDistance);
        cancellationSamples.push(await measureCancellation(page, acceptedHeight));
      }
    }

    const audit = await page.evaluate(() => {
      const state = window as unknown as PerformanceAuditWindow;
      const pending = state.__solidFeatureLongTaskObserver?.takeRecords() ?? [];
      state.__solidFeatureLongTasks.push(...pending
        .filter((entry) => entry.startTime >= state.__solidFeatureLongTaskStart)
        .map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
      return { entries: state.__solidFeatureLongTasks, intervals: state.__solidFeatureActionIntervals };
    });
    const longTasks = attributeSolidFeatureLongTasks(audit.entries, audit.intervals);
    // Forced GC is qualification instrumentation, not workload time. Capture
    // long tasks first, then normalize heap measurements with the same forced
    // collection used before the workflow.
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await jsHeapUsedBytes(cdp);
    const memoryGrowthBytes = Math.max(0, heapAfter - heapBefore);
    const observed = {
      preview_p50_ms: percentile(previewSamples, 0.5),
      preview_p95_ms: percentile(previewSamples, 0.95),
      recompute_p50_ms: percentile(recomputeSamples, 0.5),
      recompute_p95_ms: percentile(recomputeSamples, 0.95),
      cancellation_latency_ms_max: Math.max(...cancellationSamples),
      main_thread_long_task_ms_max: Math.max(0, ...longTasks.map((entry) => entry.duration)),
      memory_growth_bytes: memoryGrowthBytes,
    };
    const representativeRanking = repairRankings[0] ?? [];
    const repairRankingDeterministic = repairRankings.every((ranking) => JSON.stringify(ranking) === JSON.stringify(representativeRanking));
    const repairCandidateCount = representativeRanking.length;

    const measurementEvidence = JSON.stringify({ workload: workloadBudget.id, observed, longTasks, actionIntervals: audit.intervals });
    const violations = [
      ...(observed.preview_p50_ms > workloadBudget.preview_p50_ms_max ? [`preview p50 ${observed.preview_p50_ms} ms exceeds ${workloadBudget.preview_p50_ms_max} ms`] : []),
      ...(observed.preview_p95_ms > workloadBudget.preview_p95_ms_max ? [`preview p95 ${observed.preview_p95_ms} ms exceeds ${workloadBudget.preview_p95_ms_max} ms`] : []),
      ...(observed.recompute_p50_ms > workloadBudget.recompute_p50_ms_max ? [`recompute p50 ${observed.recompute_p50_ms} ms exceeds ${workloadBudget.recompute_p50_ms_max} ms`] : []),
      ...(observed.recompute_p95_ms > workloadBudget.recompute_p95_ms_max ? [`recompute p95 ${observed.recompute_p95_ms} ms exceeds ${workloadBudget.recompute_p95_ms_max} ms`] : []),
      ...(observed.cancellation_latency_ms_max > workloadBudget.cancellation_latency_ms_max ? [`cancellation max ${observed.cancellation_latency_ms_max} ms exceeds ${workloadBudget.cancellation_latency_ms_max} ms`] : []),
      ...(observed.main_thread_long_task_ms_max > workloadBudget.main_thread_long_task_ms_max ? [`long task max ${observed.main_thread_long_task_ms_max} ms exceeds ${workloadBudget.main_thread_long_task_ms_max} ms`] : []),
      ...(observed.memory_growth_bytes > workloadBudget.memory_growth_bytes_max ? [`memory growth ${observed.memory_growth_bytes} bytes exceeds ${workloadBudget.memory_growth_bytes_max} bytes`] : []),
      ...(repair && repairCandidateCount !== representativeRepairCandidateCount ? [`repair inspection produced ${repairCandidateCount} candidates; declared representative count is ${representativeRepairCandidateCount}`] : []),
      ...(repair && representativeRanking[0] !== repair.candidateId ? [`repair selected ${representativeRanking[0] ?? "none"} instead of ${repair.candidateId}`] : []),
      ...(repair && !repairRankingDeterministic ? ["repair candidate ranking changed across repeated previews"] : []),
      ...failures.consoleErrors.map((message) => `console error: ${message}`),
      ...failures.pageErrors.map((message) => `page error: ${message}`),
    ];
    results.push({
      workload_id: workloadBudget.id,
      status: violations.length ? "failed" : "passed",
      samples: { warm_up: budgetProfile.warm_up_samples, measured: budgetProfile.measured_samples, preview_edit_cancel_cycles: cancellationSamples.length },
      observed,
      budgets: workloadBudget,
      long_tasks: longTasks,
      action_intervals: audit.intervals,
      ...(constructionPlaneId ? { construction_plane_id: constructionPlaneId, construction_plane_offset_nanometers: 5_000_001 } : {}),
      ...(planarSupport ? { planar_face_body_id: planarSupport.bodyId, planar_face_stable_id: planarSupport.faceStableId, topology_reference_id: planarSupport.topologyReferenceId } : {}),
      ...(repair ? {
        repair_candidate_id: repair.candidateId,
        repaired_feature_id: repair.detailFeatureId,
        declared_representative_candidate_count: representativeRepairCandidateCount,
        candidate_count: repairCandidateCount,
        representative_ranking: representativeRanking,
        ranking_deterministic: repairRankingDeterministic,
        ranking_observation_count: repairRankings.length,
      } : {}),
      violations,
    });
    // Persist measured observations before any fail-closed assertion. A failed
    // qualification must retain machine-readable evidence of what exceeded
    // the frozen budget instead of leaving a missing or stale results file.
    await writePerformanceEvidence({
      schema_version: 1,
      profile_id: budgetProfile.profile_id,
      status: violations.length ? "failed" : (results.length === budgetProfile.workloads.length ? "passed" : "measuring"),
      recorded_at: new Date().toISOString(),
      runtime_build_id: process.env.SOLID_FEATURE_RUNTIME_BUILD_ID,
      runtime_wasm_sha256: process.env.SOLID_FEATURE_WASM_SHA256,
      workloads: results,
    });
    expect(observed.preview_p50_ms, measurementEvidence).toBeLessThanOrEqual(workloadBudget.preview_p50_ms_max);
    expect(observed.preview_p95_ms, measurementEvidence).toBeLessThanOrEqual(workloadBudget.preview_p95_ms_max);
    expect(observed.recompute_p50_ms, measurementEvidence).toBeLessThanOrEqual(workloadBudget.recompute_p50_ms_max);
    expect(observed.recompute_p95_ms, measurementEvidence).toBeLessThanOrEqual(workloadBudget.recompute_p95_ms_max);
    expect(observed.cancellation_latency_ms_max, measurementEvidence).toBeLessThanOrEqual(workloadBudget.cancellation_latency_ms_max);
    expect(observed.main_thread_long_task_ms_max, measurementEvidence).toBeLessThanOrEqual(workloadBudget.main_thread_long_task_ms_max);
    expect(observed.memory_growth_bytes, measurementEvidence).toBeLessThanOrEqual(workloadBudget.memory_growth_bytes_max);
    if (repair) {
      expect(repairCandidateCount, measurementEvidence).toBe(representativeRepairCandidateCount);
      expect(representativeRanking[0], measurementEvidence).toBe(repair.candidateId);
      expect(repairRankingDeterministic, measurementEvidence).toBe(true);
      expect(repairRankings, measurementEvidence).toHaveLength(totalSamples + workloadBudget.preview_edit_cancel_cycles);
    }
    expect(failures.consoleErrors, `${workloadBudget.id} console errors`).toEqual([]);
    expect(failures.pageErrors, `${workloadBudget.id} page errors`).toEqual([]);
    await successScreenshot(page, `performance-${workloadBudget.id}-passed.png`);
    await cdp.detach();
    await context.close();
  }

  await writePerformanceEvidence({
    schema_version: 1,
    profile_id: budgetProfile.profile_id,
    status: "passed",
    recorded_at: new Date().toISOString(),
    runtime_build_id: process.env.SOLID_FEATURE_RUNTIME_BUILD_ID,
    runtime_wasm_sha256: process.env.SOLID_FEATURE_WASM_SHA256,
    workloads: results,
  });
});
