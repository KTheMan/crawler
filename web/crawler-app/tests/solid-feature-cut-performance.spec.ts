import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  commitExtrude,
  createQualifiedPlanarFaceSketch,
  createQualifiedSketch,
  installWorkerMessageAudit,
  openExtrudeEdit,
  observedTopologyFingerprint,
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

async function measurePreview(
  page: Page,
  requestedHeight: number,
  acceptedTopologyFingerprint: string,
  expectedMaximum?: number,
): Promise<{ elapsed: number; topologyFingerprint: string }> {
  return page.evaluate(async ({ height, expectedMax, acceptedFingerprint }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const topologyFingerprint = () => window.__crawlerApp.rendererTopologyFingerprint();
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
        && topologyFingerprint() !== acceptedFingerprint
        && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet") {
        const installedPreviewRemainsStable = await audit.__solidFeatureAfterStablePaint(() => {
          const stableHeight = Math.round(window.__crawlerApp.geometryBounds()[5] * 1_000) / 1_000;
          return (roundedExpectedMaximum === undefined || stableHeight === roundedExpectedMaximum)
            && topologyFingerprint() !== acceptedFingerprint
            && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet";
        });
        if (installedPreviewRemainsStable) return { elapsed: audit.__solidFeatureFinishAction(action), topologyFingerprint: topologyFingerprint() };
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error(`Extrude preview did not reach ${expectedMax ?? "a native planar-face result"} for ${height} mm distance before the qualification timeout`);
  }, { height: requestedHeight, expectedMax: expectedMaximum, acceptedFingerprint: acceptedTopologyFingerprint });
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

async function measureCommit(page: Page, acceptedTopologyFingerprint: string, previewTopologyFingerprint: string): Promise<number> {
  return page.evaluate(async ({ acceptedFingerprint, previewFingerprint }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const topologyFingerprint = () => window.__crawlerApp.rendererTopologyFingerprint();
    const action = audit.__solidFeatureBeginAction("recompute");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Extrude distance field is absent during recompute measurement");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      if (document.querySelector("#operation-state")?.getAttribute("data-status") === "committed"
        && topologyFingerprint() === previewFingerprint
        && topologyFingerprint() !== acceptedFingerprint) {
        const measured = window.__crawlerApp.performanceEvidence().timingsMs.recompute;
        if (typeof measured !== "number") throw new Error("Runtime did not publish an Extrude recompute measurement");
        audit.__solidFeatureFinishAction(action);
        return measured;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Extrude recompute did not commit before the qualification timeout");
  }, { acceptedFingerprint: acceptedTopologyFingerprint, previewFingerprint: previewTopologyFingerprint });
}

type CutFailureRecoverySample = {
  elapsed: number;
  refusalElapsed: number;
  acceptedChecksum: string;
  refusedChecksum: string;
  acceptedTopologyFingerprint: string;
  refusedTopologyFingerprint: string;
  retryPreviewTopologyFingerprint: string;
  finalTopologyFingerprint: string;
  diagnostic: {
    code?: string;
    category?: string;
    field?: string;
    referencedEntityIds?: string[];
  };
  workerRefusalObserved: boolean;
  commitRequestCount: number;
  retryCommitted: boolean;
};

/**
 * Measures the failure/recovery path as one recompute action: a generated
 * worker/WASM commit is refused for a missing target, the accepted packet is
 * restored unchanged, and the user reopens the same Cut, repairs the request,
 * previews it, and commits successfully.
 */
async function measureCutFailureRecovery(
  page: Page,
  featureId: string,
  requestedHeight: number,
  expectedAcceptedChecksum: string,
  expectedAcceptedTopologyFingerprint: string,
): Promise<CutFailureRecoverySample> {
  return page.evaluate(async ({ cutFeatureId, height, acceptedChecksum, acceptedFingerprint }) => {
    type WorkerAuditMessage = {
      type?: string;
      code?: string;
      category?: string;
      field?: string;
      referencedEntityIds?: string[];
    };
    type PostedAuditMessage = { type?: string };
    type FailureAuditWindow = PerformanceAuditWindow & {
      __solidFeatureNextCutCommitFault?: "missing_target";
      __solidFeatureWorkerMessages?: WorkerAuditMessage[];
      __solidFeaturePostedMessages?: PostedAuditMessage[];
    };
    const audit = window as unknown as FailureAuditWindow;
    const topologyFingerprint = () => window.__crawlerApp.rendererTopologyFingerprint();
    const workerMessageStart = audit.__solidFeatureWorkerMessages?.length ?? 0;
    const postedMessageStart = audit.__solidFeaturePostedMessages?.length ?? 0;
    const action = audit.__solidFeatureBeginAction("recompute");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Cut distance field is absent before failure/recovery measurement");
    audit.__solidFeatureNextCutCommitFault = "missing_target";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    const deadline = performance.now() + 60_000;
    let refusalElapsed = Number.NaN;
    let refusedChecksum = "";
    let refusedTopologyFingerprint = "";
    while (performance.now() < deadline) {
      const operation = document.querySelector("#operation-state");
      if (operation?.getAttribute("data-error-code") === "missing_cut_target"
        && operation.getAttribute("data-error-category") === "reference"
        && operation.getAttribute("data-error-field") === "participant_bodies.target"
        && window.__crawlerApp.durableChecksum() === acceptedChecksum
        && topologyFingerprint() === acceptedFingerprint) {
        const refusedStateRemainsStable = await audit.__solidFeatureAfterStablePaint(() =>
          window.__crawlerApp.durableChecksum() === acceptedChecksum
          && topologyFingerprint() === acceptedFingerprint);
        if (refusedStateRemainsStable) {
          refusedChecksum = window.__crawlerApp.durableChecksum();
          refusedTopologyFingerprint = topologyFingerprint();
          refusalElapsed = performance.now() - action.startTime;
          break;
        }
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!Number.isFinite(refusalElapsed)) throw new Error("Generated Cut worker refusal did not restore the accepted packet");

    const incomingAfterRefusal = (audit.__solidFeatureWorkerMessages ?? []).slice(workerMessageStart);
    const diagnostic = [...incomingAfterRefusal].reverse().find((message) =>
      message.type === "operation-error" && message.code === "missing_cut_target");
    if (!diagnostic) throw new Error("Cut failure workload did not observe a real worker operation-error response");
    if (audit.__solidFeatureNextCutCommitFault !== undefined) throw new Error("Cut failure hook was not consumed by the generated worker request");

    const featureRow = document.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(cutFeatureId)}"]`);
    if (!featureRow) throw new Error(`Cut feature ${cutFeatureId} is absent after worker refusal`);
    featureRow.click();
    let editButton: HTMLButtonElement | null = null;
    while (performance.now() < deadline) {
      editButton = document.querySelector<HTMLButtonElement>('[data-feature-action="edit-extrude"]');
      if (editButton) break;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!editButton) throw new Error("Cut edit action is absent after worker refusal");
    editButton.click();

    let retryInput: HTMLInputElement | null = null;
    while (performance.now() < deadline) {
      retryInput = document.querySelector<HTMLInputElement>("#pad-length");
      if (retryInput && document.querySelector("#operation-state")?.getAttribute("data-status") === "preview") break;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!retryInput) throw new Error("Cut edit did not reopen for repaired retry");
    document.querySelector("#operation-state")?.removeAttribute("data-preview-source");
    retryInput.value = String(height);
    retryInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(height) }));

    let retryPreviewFingerprint = "";
    while (performance.now() < deadline) {
      const candidate = topologyFingerprint();
      if (candidate !== acceptedFingerprint
        && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet") {
        const previewRemainsStable = await audit.__solidFeatureAfterStablePaint(() =>
          topologyFingerprint() === candidate
          && document.querySelector("#operation-state")?.getAttribute("data-preview-source") === "worker-render-packet");
        if (previewRemainsStable) {
          retryPreviewFingerprint = candidate;
          break;
        }
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!retryPreviewFingerprint) throw new Error("Repaired Cut request did not produce a generated worker preview");
    retryInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    let retryCommitted = false;
    while (performance.now() < deadline) {
      if (document.querySelector("#operation-state")?.getAttribute("data-status") === "committed"
        && topologyFingerprint() === retryPreviewFingerprint
        && window.__crawlerApp.durableChecksum() !== acceptedChecksum) {
        retryCommitted = await audit.__solidFeatureAfterStablePaint(() =>
          document.querySelector("#operation-state")?.getAttribute("data-status") === "committed"
          && topologyFingerprint() === retryPreviewFingerprint
          && window.__crawlerApp.durableChecksum() !== acceptedChecksum);
        if (retryCommitted) break;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!retryCommitted) throw new Error("Repaired Cut retry did not commit its generated worker preview");

    const posted = (audit.__solidFeaturePostedMessages ?? []).slice(postedMessageStart);
    const commitRequestCount = posted.filter((message) => message.type === "commit-pad").length;
    return {
      elapsed: audit.__solidFeatureFinishAction(action),
      refusalElapsed,
      acceptedChecksum,
      refusedChecksum,
      acceptedTopologyFingerprint: acceptedFingerprint,
      refusedTopologyFingerprint,
      retryPreviewTopologyFingerprint: retryPreviewFingerprint,
      finalTopologyFingerprint: topologyFingerprint(),
      diagnostic: {
        ...(diagnostic.code ? { code: diagnostic.code } : {}),
        ...(diagnostic.category ? { category: diagnostic.category } : {}),
        ...(diagnostic.field ? { field: diagnostic.field } : {}),
        ...(diagnostic.referencedEntityIds ? { referencedEntityIds: diagnostic.referencedEntityIds } : {}),
      },
      workerRefusalObserved: diagnostic.type === "operation-error" && diagnostic.code === "missing_cut_target",
      commitRequestCount,
      retryCommitted,
    };
  }, {
    cutFeatureId: featureId,
    height: requestedHeight,
    acceptedChecksum: expectedAcceptedChecksum,
    acceptedFingerprint: expectedAcceptedTopologyFingerprint,
  });
}

async function measureCancellation(page: Page, expectedAcceptedChecksum: string, expectedAcceptedTopologyFingerprint: string): Promise<number> {
  return page.evaluate(async ({ acceptedChecksum, acceptedFingerprint }) => {
    const audit = window as unknown as PerformanceAuditWindow;
    const topologyFingerprint = () => window.__crawlerApp.rendererTopologyFingerprint();
    const action = audit.__solidFeatureBeginAction("cancel");
    const input = document.querySelector<HTMLInputElement>("#pad-length");
    if (!input) throw new Error("Extrude distance field is absent during cancellation measurement");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const deadline = action.startTime + 60_000;
    while (performance.now() < deadline) {
      const checksum = window.__crawlerApp.durableChecksum();
      if (document.querySelector("#operation-state")?.getAttribute("data-status") === "cancelled"
        && checksum === acceptedChecksum && topologyFingerprint() === acceptedFingerprint) {
        const restoredPacketRemainsStable = await audit.__solidFeatureAfterStablePaint(() => {
          return document.querySelector("#operation-state")?.getAttribute("data-status") === "cancelled"
            && window.__crawlerApp.durableChecksum() === acceptedChecksum
            && topologyFingerprint() === acceptedFingerprint;
        });
        if (restoredPacketRemainsStable) return audit.__solidFeatureFinishAction(action);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Extrude cancellation did not complete before the qualification timeout");
  }, { acceptedChecksum: expectedAcceptedChecksum, acceptedFingerprint: expectedAcceptedTopologyFingerprint });
}

test("locked single-target Cut profile satisfies preview, recompute, cancellation, long-task, and memory budgets", async ({ browser }, testInfo) => {
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
    const planarFaceWorkload = false;
    const topologyRepairWorkload = false;
    const repairWorkload = workloadBudget.id === "cut-single-target-failure-recovery";
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
    await installWorkerMessageAudit(page);
    const workloadUrl = new URL(baseURL);
    workloadUrl.searchParams.set("qualificationReferencePart", "1");
    await page.goto(workloadUrl.toString());
    await waitUntilReady(page);
    const tourExit = page.locator("#tour-exit");
    if (await tourExit.isVisible()) await tourExit.click();
    await expect(page.locator("#onboarding"), "onboarding must not perturb locked performance actions").toBeHidden();
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
        workload === "rectangle"
          ? { rectangle: { min: { x_nm: 2_000_000, y_nm: 1_000_000 }, max: { x_nm: 8_000_000, y_nm: 5_000_000 } } }
          : { annulus: { center: { x_nm: 5_000_000, y_nm: 3_000_000 }, outer_radius_nm: 2_000_000, inner_radius_nm: 1_000_000 } },
      );
    const seedTopologyFingerprint = await observedTopologyFingerprint(page);
    await startExtrude(page, 2);
    const targetBodyId = await page.evaluate(() => {
      const durable = window.__crawlerApp.durableDocument() as { bodies?: Record<string, { suppressed?: boolean }> };
      const current = Object.entries(durable.bodies ?? {}).filter(([, body]) => !body.suppressed).map(([bodyId]) => bodyId);
      if (current.length !== 1) throw new Error(`Single-target Cut performance setup expected one current body, got ${current.length}`);
      return current[0]!;
    });
    await page.locator("#extrude-result-mode").selectOption("cut");
    await expect(page.locator("#extrude-normalization-status")).toContainText("Select one current target body for Cut");
    await page.locator("#extrude-target-body").selectOption(targetBodyId);
    await expect(page.locator("#operation-state")).toHaveAttribute("data-result-mode", "cut", { timeout: 60_000 });
    await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId);
    await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(seedTopologyFingerprint);
    const initialPreviewTopologyFingerprint = await observedTopologyFingerprint(page);
    await commitExtrude(page);
    await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(initialPreviewTopologyFingerprint);
    await expect.poll(() => page.evaluate((expectedTarget) => {
      const durable = window.__crawlerApp.durableDocument() as { feature_definitions_v2?: Record<string, { result?: { mode?: string }; participant_bodies?: { role?: string; body?: string }[] }> };
      return Object.values(durable.feature_definitions_v2 ?? {}).some((definition) =>
        definition.result?.mode === "cut"
        && definition.participant_bodies?.length === 1
        && definition.participant_bodies[0]?.role === "target"
        && definition.participant_bodies[0]?.body === expectedTarget);
    }, targetBodyId), { timeout: 60_000 }).toBe(true);
    const cutFeatureId = await page.evaluate((expectedTarget) => {
      const durable = window.__crawlerApp.durableDocument() as { feature_definitions_v2?: Record<string, { result?: { mode?: string }; participant_bodies?: { role?: string; body?: string }[] }> };
      return Object.entries(durable.feature_definitions_v2 ?? {}).find(([, definition]) =>
        definition.result?.mode === "cut"
        && definition.participant_bodies?.length === 1
        && definition.participant_bodies[0]?.role === "target"
        && definition.participant_bodies[0]?.body === expectedTarget)?.[0];
    }, targetBodyId);
    expect(cutFeatureId, "performance workload must retain the accepted Cut feature identity").toBeTruthy();
    const repair = topologyRepairWorkload ? await setupRepairWorkload(page, planarSupport!.topologyReferenceId, planarSupport!.observedFace) : undefined;

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
    const topologyTransitions: Array<{ phase: "recompute" | "cancel"; accepted: string; preview: string; final: string }> = [];
    const repairRankings: string[][] = [];
    const failureRecoverySamples: CutFailureRecoverySample[] = [];
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
        const acceptedChecksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
        const acceptedTopologyFingerprint = await observedTopologyFingerprint(page);
        await openExtrudeEdit(page);
        const nextDistance = 1 + ((sample % 5) * 0.5);
        const expectedMaximum = undefined;
        const preview = await measurePreview(page, nextDistance, acceptedTopologyFingerprint, expectedMaximum);
        const failureRecovery = repairWorkload
          ? await measureCutFailureRecovery(page, cutFeatureId!, nextDistance, acceptedChecksum, acceptedTopologyFingerprint)
          : undefined;
        const recomputeElapsed = failureRecovery?.elapsed
          ?? await measureCommit(page, acceptedTopologyFingerprint, preview.topologyFingerprint);
        if (failureRecovery) failureRecoverySamples.push(failureRecovery);
        topologyTransitions.push({
          phase: "recompute",
          accepted: acceptedTopologyFingerprint,
          preview: failureRecovery?.retryPreviewTopologyFingerprint ?? preview.topologyFingerprint,
          final: await observedTopologyFingerprint(page),
        });
        await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
        if (sample >= budgetProfile.warm_up_samples) {
          previewSamples.push(preview.elapsed);
          recomputeSamples.push(recomputeElapsed);
        }
      }

      for (let cycle = 0; cycle < workloadBudget.preview_edit_cancel_cycles; cycle += 1) {
        const acceptedChecksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
        const acceptedTopologyFingerprint = await observedTopologyFingerprint(page);
        await openExtrudeEdit(page);
        const nextDistance = 1.25 + ((cycle % 3) * 0.5);
        const preview = await measurePreview(page, nextDistance, acceptedTopologyFingerprint, undefined);
        cancellationSamples.push(await measureCancellation(page, acceptedChecksum, acceptedTopologyFingerprint));
        topologyTransitions.push({ phase: "cancel", accepted: acceptedTopologyFingerprint, preview: preview.topologyFingerprint, final: await observedTopologyFingerprint(page) });
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
    const workerRefusalCount = failureRecoverySamples.filter((sample) => sample.workerRefusalObserved).length;
    const repairRetryCount = failureRecoverySamples.filter((sample) => sample.retryCommitted).length;
    const refusalStatePreservedCount = failureRecoverySamples.filter((sample) =>
      sample.refusedChecksum === sample.acceptedChecksum
      && sample.refusedTopologyFingerprint === sample.acceptedTopologyFingerprint).length;
    const exactFailureDiagnosticCount = failureRecoverySamples.filter((sample) =>
      sample.diagnostic.code === "missing_cut_target"
      && sample.diagnostic.category === "reference"
      && sample.diagnostic.field === "participant_bodies.target"
      && JSON.stringify(sample.diagnostic.referencedEntityIds) === JSON.stringify(["body:missing:qualification-cut-target"])).length;
    const exactFailureRequestPairCount = failureRecoverySamples.filter((sample) => sample.commitRequestCount === 2).length;
    const invalidTopologyTransitions = topologyTransitions.filter((transition) => transition.preview === transition.accepted
      || (transition.phase === "recompute" ? transition.final !== transition.preview : transition.final !== transition.accepted));

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
      ...(repairWorkload && failureRecoverySamples.length !== totalSamples ? [`failure/recovery workload produced ${failureRecoverySamples.length} samples; expected ${totalSamples}`] : []),
      ...(repairWorkload && workerRefusalCount !== totalSamples ? [`generated worker refusal observed in ${workerRefusalCount}/${totalSamples} samples`] : []),
      ...(repairWorkload && repairRetryCount !== totalSamples ? [`repaired Cut retry committed in ${repairRetryCount}/${totalSamples} samples`] : []),
      ...(repairWorkload && refusalStatePreservedCount !== totalSamples ? [`accepted state remained exact after ${refusalStatePreservedCount}/${totalSamples} refusals`] : []),
      ...(repairWorkload && exactFailureDiagnosticCount !== totalSamples ? [`structured missing-target diagnostic matched in ${exactFailureDiagnosticCount}/${totalSamples} refusals`] : []),
      ...(repairWorkload && exactFailureRequestPairCount !== totalSamples ? [`exact refusal/retry commit pair observed in ${exactFailureRequestPairCount}/${totalSamples} samples`] : []),
      ...(initialPreviewTopologyFingerprint === seedTopologyFingerprint ? ["initial Cut worker preview did not change target topology"] : []),
      ...(invalidTopologyTransitions.length > 0 ? [`${invalidTopologyTransitions.length} Cut topology transition(s) failed preview/commit/cancel geometry checks`] : []),
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
      initial_seed_topology_fingerprint: seedTopologyFingerprint,
      initial_cut_topology_fingerprint: initialPreviewTopologyFingerprint,
      topology_transitions: topologyTransitions,
      repair_workload: repairWorkload,
      ...(repairWorkload ? {
        worker_refusal_count: workerRefusalCount,
        repair_retry_count: repairRetryCount,
        accepted_state_preserved_count: refusalStatePreservedCount,
        exact_failure_diagnostic_count: exactFailureDiagnosticCount,
        exact_failure_request_pair_count: exactFailureRequestPairCount,
        failure_recovery_samples: failureRecoverySamples,
      } : {}),
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
    expect(invalidTopologyTransitions, `${workloadBudget.id} invalid renderer topology transitions`).toEqual([]);
    if (repair) {
      expect(repairCandidateCount, measurementEvidence).toBe(representativeRepairCandidateCount);
      expect(representativeRanking[0], measurementEvidence).toBe(repair.candidateId);
      expect(repairRankingDeterministic, measurementEvidence).toBe(true);
      expect(repairRankings, measurementEvidence).toHaveLength(totalSamples + workloadBudget.preview_edit_cancel_cycles);
    }
    if (repairWorkload) {
      expect(failureRecoverySamples, measurementEvidence).toHaveLength(totalSamples);
      expect(workerRefusalCount, measurementEvidence).toBe(totalSamples);
      expect(repairRetryCount, measurementEvidence).toBe(totalSamples);
      expect(refusalStatePreservedCount, measurementEvidence).toBe(totalSamples);
      expect(exactFailureDiagnosticCount, measurementEvidence).toBe(totalSamples);
      expect(exactFailureRequestPairCount, measurementEvidence).toBe(totalSamples);
    }
    expect(failures.consoleErrors, `${workloadBudget.id} console errors`).toEqual([]);
    expect(failures.pageErrors, `${workloadBudget.id} page errors`).toEqual([]);
    expect(violations, `${workloadBudget.id} qualification violations`).toEqual([]);
    await successScreenshot(page, `performance-${workloadBudget.id}-passed.png`);
    await cdp.detach();
    await context.close();
  }

  const failedResults = results.filter((result) => result.status !== "passed");
  const allWorkloadsMeasured = results.length === budgetProfile.workloads.length;
  await writePerformanceEvidence({
    schema_version: 1,
    profile_id: budgetProfile.profile_id,
    status: allWorkloadsMeasured && failedResults.length === 0 ? "passed" : "failed",
    recorded_at: new Date().toISOString(),
    runtime_build_id: process.env.SOLID_FEATURE_RUNTIME_BUILD_ID,
    runtime_wasm_sha256: process.env.SOLID_FEATURE_WASM_SHA256,
    workloads: results,
  });
  expect(results, "every declared Cut performance workload must be measured").toHaveLength(budgetProfile.workloads.length);
  expect(failedResults, "no Cut performance workload may retain violations").toEqual([]);
});
