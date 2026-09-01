import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceRoot = resolve(
  repositoryRoot,
  process.env.SOLID_FEATURE_EVIDENCE_ROOT ?? "artifacts/solid-feature-qualification/current",
);

export type BrowserFailures = { consoleErrors: string[]; pageErrors: string[] };

export async function installWorkerMessageAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const messages: Array<{ elapsedMs: number; type: string; requestId?: number; semanticHash?: string; code?: string; category?: string; field?: string; referencedEntityIds?: string[]; recomputeEvaluationOrder?: string[] }> = [];
    const workerUrls: string[] = [];
    const previewDeliveryDistances: number[] = [];
    const planePreviewDeliveryOrigins: number[] = [];
    const acceptedDocuments: string[] = [];
    const postedMessages: Array<{ type: string; requestId?: number; request?: Record<string, unknown>; valueNanometers?: number; direction?: string; source?: Record<string, unknown>; baseDocumentHash?: string; baseRevision?: number }> = [];
    const started = performance.now();
    let workerCount = 0;
    class QualificationWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        const withheldPreviewResponses: Array<Record<string, unknown>> = [];
        const withheldPlanePreviewResponses: Array<Record<string, unknown>> = [];
        let replayingPreviewRace = false;
        workerCount += 1;
        workerUrls.push(String(scriptURL));
        (window as unknown as { __solidFeatureWorkerCount: number }).__solidFeatureWorkerCount = workerCount;
        (window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls = workerUrls;
        this.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
          const value = event.data;
          const recompute = value?.recompute as { evaluationOrder?: unknown } | undefined;
          messages.push({
            elapsedMs: Number((performance.now() - started).toFixed(2)),
            type: typeof value?.type === "string" ? value.type : typeof value,
            ...(typeof value?.requestId === "number" ? { requestId: value.requestId } : {}),
            ...(typeof value?.semanticHash === "string" ? { semanticHash: value.semanticHash } : {}),
            ...(typeof value?.code === "string" ? { code: value.code } : {}),
            ...(typeof value?.category === "string" ? { category: value.category } : {}),
            ...(typeof value?.field === "string" ? { field: value.field } : {}),
            ...(Array.isArray(value?.referencedEntityIds) && value.referencedEntityIds.every((item) => typeof item === "string")
              ? { referencedEntityIds: value.referencedEntityIds as string[] }
              : {}),
            ...(Array.isArray(recompute?.evaluationOrder) && recompute.evaluationOrder.every((item) => typeof item === "string")
              ? { recomputeEvaluationOrder: recompute.evaluationOrder as string[] }
              : {}),
          });
          if (messages.length > 200) messages.splice(0, messages.length - 200);
          if (value?.type === "document" && typeof value.documentJson === "string") {
            acceptedDocuments.push(value.documentJson);
            if (acceptedDocuments.length > 20) acceptedDocuments.splice(0, acceptedDocuments.length - 20);
          }
          if (value?.type === "offset-construction-plane-preview") {
            const origin = (value.frame as { origin_nanometers?: unknown } | undefined)?.origin_nanometers;
            const coordinate = Array.isArray(origin) && typeof origin[2] === "number" ? origin[2] : Number.NaN;
            const raceState = window as unknown as { __solidFeatureReverseNextTwoPlanePreviews?: boolean };
            if (!raceState.__solidFeatureReverseNextTwoPlanePreviews || replayingPreviewRace) {
              if (Number.isFinite(coordinate)) planePreviewDeliveryOrigins.push(coordinate);
              return;
            }
            event.stopImmediatePropagation();
            withheldPlanePreviewResponses.push(value);
            if (withheldPlanePreviewResponses.length !== 2) return;
            raceState.__solidFeatureReverseNextTwoPlanePreviews = false;
            const [first, second] = withheldPlanePreviewResponses;
            replayingPreviewRace = true;
            this.dispatchEvent(new MessageEvent("message", { data: second }));
            setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", { data: first }));
              replayingPreviewRace = false;
            }, 50);
            return;
          }
          if (value?.type !== "extrude-preview") return;
          if (replayingPreviewRace) {
            if (typeof value.distanceNanometers === "number") previewDeliveryDistances.push(value.distanceNanometers);
            return;
          }
          const raceState = window as unknown as { __solidFeatureReverseNextTwoExtrudePreviews?: boolean };
          if (!raceState.__solidFeatureReverseNextTwoExtrudePreviews) {
            if (typeof value.distanceNanometers === "number") previewDeliveryDistances.push(value.distanceNanometers);
            return;
          }
          event.stopImmediatePropagation();
          withheldPreviewResponses.push(value);
          if (withheldPreviewResponses.length !== 2) return;
          raceState.__solidFeatureReverseNextTwoExtrudePreviews = false;
          const [first, second] = withheldPreviewResponses;
          replayingPreviewRace = true;
          this.dispatchEvent(new MessageEvent("message", { data: second }));
          setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", { data: first }));
            replayingPreviewRace = false;
          }, 50);
        });
      }

      override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        const value = message && typeof message === "object" ? message as Record<string, unknown> : undefined;
        const type = typeof value?.type === "string" ? value.type : typeof message;
        postedMessages.push({
          type,
          ...(typeof value?.requestId === "number" ? { requestId: value.requestId } : {}),
          ...((type === "preview-offset-construction-plane" || type === "commit-offset-construction-plane") && value?.request && typeof value.request === "object"
            ? { request: structuredClone(value.request as Record<string, unknown>) }
            : {}),
          ...((type === "preview-extrude" || type === "commit-pad") && typeof value?.valueNanometers === "number"
            ? { valueNanometers: value.valueNanometers }
            : {}),
          ...((type === "preview-extrude" || type === "commit-pad") && typeof value?.direction === "string"
            ? { direction: value.direction }
            : {}),
          ...((type === "preview-extrude" || type === "commit-pad") && value?.source && typeof value.source === "object"
            ? { source: structuredClone(value.source as Record<string, unknown>) }
            : {}),
          ...(type === "commit-pad" && typeof value?.baseDocumentHash === "string" ? { baseDocumentHash: value.baseDocumentHash } : {}),
          ...(type === "commit-pad" && typeof value?.baseRevision === "number" ? { baseRevision: value.baseRevision } : {}),
        });
        if (postedMessages.length > 300) postedMessages.splice(0, postedMessages.length - 300);

        const faultState = window as unknown as {
          __solidFeatureNextPlaneRequestFault?: "missing_base" | "missing_parameter" | "wrong_type";
        };
        const fault = faultState.__solidFeatureNextPlaneRequestFault;
        if (fault && (type === "preview-offset-construction-plane" || type === "commit-offset-construction-plane")) {
          faultState.__solidFeatureNextPlaneRequestFault = undefined;
          if (fault === "missing_base" && value?.request && typeof value.request === "object") {
            const forwarded = structuredClone(value) as Record<string, unknown>;
            forwarded.request = {
              ...(forwarded.request as Record<string, unknown>),
              base_plane_id: "origin-plane:missing:qualification",
            };
            if (Array.isArray(transferOrOptions)) super.postMessage(forwarded, transferOrOptions);
            else super.postMessage(forwarded, transferOrOptions);
            return;
          }
          if (fault === "missing_parameter") {
            if (!value?.request || typeof value.request !== "object") throw new Error("missing-parameter fault requires a construction-plane request");
            const forwarded = structuredClone(value) as Record<string, unknown>;
            forwarded.request = {
              ...(forwarded.request as Record<string, unknown>),
              offset_parameter_id: "parameter:missing:qualification",
            };
            if (Array.isArray(transferOrOptions)) super.postMessage(forwarded, transferOrOptions);
            else super.postMessage(forwarded, transferOrOptions);
            return;
          }
          if (fault === "wrong_type") {
            queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
              type: "operation-error",
              code: "wrong_type_construction_plane_offset_parameter",
              category: "reference",
              field: "construction_plane.offset_parameter",
              referencedEntityIds: ["parameter:wrong-type:qualification"],
              requestId: value?.requestId,
              message: "wrong_type_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced value parameter:wrong-type:qualification must be an exact length parameter",
              recovery: "replace the referenced value with an exact length parameter",
            } })));
            return;
          }
        }
        const extrudeFaultState = window as unknown as { __solidFeatureNextExtrudeCommitSupportFault?: "missing" };
        if (type === "commit-pad" && extrudeFaultState.__solidFeatureNextExtrudeCommitSupportFault === "missing") {
          extrudeFaultState.__solidFeatureNextExtrudeCommitSupportFault = undefined;
          if (!value?.source || typeof value.source !== "object") throw new Error("Extrude commit support fault requires a source");
          const forwarded = structuredClone(value) as Record<string, unknown>;
          forwarded.source = {
            ...(forwarded.source as Record<string, unknown>),
            support: { kind: "construction_plane_reference", plane: "construction-plane:missing-commit-support" },
          };
          if (Array.isArray(transferOrOptions)) super.postMessage(forwarded, transferOrOptions);
          else super.postMessage(forwarded, transferOrOptions);
          return;
        }
        const cutFaultState = window as unknown as {
          __solidFeatureNextCutCommitFault?: "missing_target";
          __solidFeatureNextCutCommitBasisFault?: "stale";
        };
        if (type === "commit-pad" && cutFaultState.__solidFeatureNextCutCommitBasisFault === "stale") {
          cutFaultState.__solidFeatureNextCutCommitBasisFault = undefined;
          const forwarded = structuredClone(value) as Record<string, unknown>;
          forwarded.baseRevision = Number(forwarded.baseRevision ?? 0) - 1;
          if (Array.isArray(transferOrOptions)) super.postMessage(forwarded, transferOrOptions);
          else super.postMessage(forwarded, transferOrOptions);
          return;
        }
        if (type === "commit-pad" && cutFaultState.__solidFeatureNextCutCommitFault === "missing_target") {
          cutFaultState.__solidFeatureNextCutCommitFault = undefined;
          if (!value?.source || typeof value.source !== "object") throw new Error("Cut commit target fault requires a source");
          const missingTarget = "body:missing:qualification-cut-target";
          const forwarded = structuredClone(value) as Record<string, unknown>;
          forwarded.source = {
            ...(forwarded.source as Record<string, unknown>),
            bodyId: missingTarget,
            targetBodyId: missingTarget,
          };
          if (Array.isArray(transferOrOptions)) super.postMessage(forwarded, transferOrOptions);
          else super.postMessage(forwarded, transferOrOptions);
          return;
        }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    }
    window.Worker = QualificationWorker;
    (window as unknown as { __solidFeatureWorkerCount: number }).__solidFeatureWorkerCount = workerCount;
    (window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls = workerUrls;
    (window as unknown as { __solidFeatureWorkerMessages: typeof messages }).__solidFeatureWorkerMessages = messages;
    (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances = previewDeliveryDistances;
    (window as unknown as { __solidFeaturePlanePreviewDeliveryOrigins: number[] }).__solidFeaturePlanePreviewDeliveryOrigins = planePreviewDeliveryOrigins;
    (window as unknown as { __solidFeatureAcceptedDocuments: string[] }).__solidFeatureAcceptedDocuments = acceptedDocuments;
    (window as unknown as { __solidFeaturePostedMessages: typeof postedMessages }).__solidFeaturePostedMessages = postedMessages;
    (window as unknown as { __solidFeatureNextPlaneRequestFault?: "missing_base" | "missing_parameter" | "wrong_type" }).__solidFeatureNextPlaneRequestFault = undefined;
    (window as unknown as { __solidFeatureNextExtrudeCommitSupportFault?: "missing" }).__solidFeatureNextExtrudeCommitSupportFault = undefined;
    (window as unknown as { __solidFeatureNextCutCommitFault?: "missing_target" }).__solidFeatureNextCutCommitFault = undefined;
    (window as unknown as { __solidFeatureNextCutCommitBasisFault?: "stale" }).__solidFeatureNextCutCommitBasisFault = undefined;
    (window as unknown as { __solidFeatureReverseNextTwoExtrudePreviews: boolean }).__solidFeatureReverseNextTwoExtrudePreviews = false;
    (window as unknown as { __solidFeatureReverseNextTwoPlanePreviews: boolean }).__solidFeatureReverseNextTwoPlanePreviews = false;
  });
}

export function collectBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = { consoleErrors: [], pageErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") failures.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => failures.pageErrors.push(error.stack ?? error.message));
  return failures;
}

export async function waitUntilReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"),
    undefined,
    { timeout: 60_000 },
  );
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
}

export async function createQualifiedSketch(
  page: Page,
  workload: "rectangle" | "annulus",
  idPrefix: string,
  selectProfile = true,
  support: { kind: "origin"; plane: "xy" | "xz" | "yz" } | { kind: "construction"; plane: string } = { kind: "origin", plane: "xy" },
  profileGeometry?: {
    rectangle?: { min: { x_nm: number; y_nm: number }; max: { x_nm: number; y_nm: number } };
    annulus?: { center: { x_nm: number; y_nm: number }; outer_radius_nm: number; inner_radius_nm: number };
  },
): Promise<void> {
  await page.locator("#edit-sketch").click();
  if (support.kind === "construction") await page.evaluate((plane) => window.__crawlerApp.chooseConstructionSketchSupport(plane), support.plane);
  else await page.evaluate((plane) => window.__crawlerApp.chooseOriginSketchSupport(plane), support.plane);
  if (workload === "rectangle") {
    const bounds = profileGeometry?.rectangle ?? { min: { x_nm: 0, y_nm: 0 }, max: { x_nm: 12_000_000, y_nm: 8_000_000 } };
    await page.evaluate(async ({ prefix, bounds }) => window.__crawlerApp.applySketchCommands([{
      kind: "add_geometry",
      entity: {
        id: `${prefix}:outer`,
        geometry: { kind: "rectangle", min: bounds.min, max: bounds.max },
      },
    }]), { prefix: idPrefix, bounds });
  } else {
    const annulus = profileGeometry?.annulus ?? { center: { x_nm: 0, y_nm: 0 }, outer_radius_nm: 12_000_000, inner_radius_nm: 5_000_000 };
    await page.evaluate(async ({ prefix, annulus }) => window.__crawlerApp.applySketchCommands([
      {
        kind: "add_geometry",
        entity: { id: `${prefix}:outer`, geometry: { kind: "circle", center: annulus.center, radius_nm: annulus.outer_radius_nm } },
      },
      {
        kind: "add_geometry",
        entity: { id: `${prefix}:hole`, geometry: { kind: "circle", center: annulus.center, radius_nm: annulus.inner_radius_nm } },
      },
    ]), { prefix: idPrefix, annulus });
  }

  const overlay = page.getByLabel("Editable sketch geometry");
  await expect(overlay.locator("[data-sketch-profile-id]")).toHaveCount(workload === "rectangle" ? 1 : 2, { timeout: 60_000 });
  if (selectProfile) {
    const outer = overlay.locator(`[data-sketch-profile-id][data-profile-geometry-ids*="${idPrefix}:outer"]`);
    await outer.dispatchEvent("pointerdown", { button: 0, pointerId: 401 });
    await expect(outer).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#start-pad")).toBeEnabled();
}

export async function createQualifiedPlanarFaceSketch(
  page: Page,
  idPrefix: string,
  selectProfile = true,
  profileSizeNanometers: { width: number; height: number } = { width: 12_000_000, height: 8_000_000 },
): Promise<{ bodyId: string; faceStableId: string; topologyReferenceId: string; originNanometers: readonly [number, number, number]; xAxisMillionths: readonly [number, number, number]; yAxisMillionths: readonly [number, number, number]; normalMillionths: readonly [number, number, number]; observedFace: import("../src/protocol").TopologyReferenceView }> {
  const currentFace = await currentPositiveZPlanarFace(page);
  const selection = await page.evaluate((stableId) => window.__crawlerApp.selectTopology("face", stableId), currentFace.stable_kernel_id);
  if (!selection || selection.kind !== "face") throw new Error("Qualification body has no selectable planar face");
  await page.locator("#edit-sketch").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchPlane()), { timeout: 60_000 }).toMatchObject({
    source: "planar_face",
    support: { kind: "topology" },
    origin_nanometers: [expect.any(Number), expect.any(Number), expect.any(Number)],
  });
  const plane = await page.evaluate(() => window.__crawlerApp.sketchPlane());
  if (!plane || plane.source !== "planar_face" || plane.support.kind !== "topology") throw new Error("Native planar-face frame did not resolve");
  const expectedBaseHeight = await page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers);
  expect(plane.origin_nanometers).toEqual([0, 0, expectedBaseHeight]);
  expect(plane.normal_millionths).toEqual([0, 0, 1_000_000]);
  await page.evaluate(async ({ prefix, size }) => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: {
      id: `${prefix}:outer`,
      geometry: { kind: "rectangle", min: { x_nm: 1_000_000, y_nm: 1_000_000 }, max: { x_nm: 1_000_000 + size.width, y_nm: 1_000_000 + size.height } },
    },
  }]), { prefix: idPrefix, size: profileSizeNanometers });
  const overlay = page.getByLabel("Editable sketch geometry");
  await expect(overlay.locator("[data-sketch-profile-id]")).toHaveCount(1, { timeout: 60_000 });
  if (selectProfile) {
    const profile = overlay.locator(`[data-sketch-profile-id][data-profile-geometry-ids*="${idPrefix}:outer"]`);
    await profile.dispatchEvent("pointerdown", { button: 0, pointerId: 451 });
    await expect(profile).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#start-pad")).toBeEnabled();
  return {
    bodyId: selection.bodyId,
    faceStableId: selection.stableId,
    topologyReferenceId: plane.support.reference,
    originNanometers: plane.origin_nanometers,
    xAxisMillionths: plane.x_axis_millionths,
    yAxisMillionths: plane.y_axis_millionths,
    normalMillionths: plane.normal_millionths,
    observedFace: currentFace,
  };
}

export async function currentPositiveZPlanarFace(page: Page): Promise<import("../src/protocol").TopologyReferenceView> {
  return page.evaluate(() => {
    const faces = window.__crawlerApp.observedTopology().filter((candidate) => candidate.kind === "face");
    const candidates = faces.filter((candidate) => {
      const centroid = candidate.fallback_signature.centroid_nanometers;
      const normal = candidate.fallback_signature.normal_millionths;
      return Array.isArray(centroid) && centroid.length === 3 && centroid.every(Number.isSafeInteger)
        && Array.isArray(normal) && normal.length === 3
        && normal[0] === 0 && normal[1] === 0 && normal[2] === 1_000_000;
    }).sort((left, right) => {
      const leftCentroid = left.fallback_signature.centroid_nanometers as number[];
      const rightCentroid = right.fallback_signature.centroid_nanometers as number[];
      const zDelta = Number(rightCentroid?.[2] ?? Number.NEGATIVE_INFINITY) - Number(leftCentroid?.[2] ?? Number.NEGATIVE_INFINITY);
      if (zDelta) return zDelta;
      const leftId = BigInt(left.stable_kernel_id);
      const rightId = BigInt(right.stable_kernel_id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    const current = candidates[0];
    if (!current) throw new Error("Current renderer packet contains no positive-Z planar face");
    return current;
  });
}

/** Read-only fingerprint of the complete geometry packet currently installed
 * in the renderer, including uncommitted worker-owned previews. */
export async function observedTopologyFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => window.__crawlerApp.rendererTopologyFingerprint());
}

export async function startExtrude(page: Page, distanceMillimeters: number): Promise<void> {
  await page.locator("#start-pad").click();
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
  await expect(distance).toBeVisible();
  await distance.fill(String(distanceMillimeters));
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
}

export async function openExtrudeEdit(page: Page): Promise<void> {
  await page.locator("[data-feature-id]").last().click();
  const edit = page.locator('[data-feature-action="edit-extrude"]');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
  await expect(page.locator("#pad-length")).toBeFocused();
}

export async function commitExtrude(page: Page): Promise<void> {
  await page.getByRole("spinbutton", { name: "Extrude distance in millimeters" }).press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 }).catch(async () => {
    const evidence = await page.evaluate(() => ({
      operation: document.querySelector("#operation-state")?.textContent,
      diagnostics: document.querySelector("#diagnostics")?.textContent,
      storage: document.querySelector("#storage-status")?.textContent,
      durableChecksum: window.__crawlerApp.durableChecksum(),
      workerMessages: (window as unknown as { __solidFeatureWorkerMessages?: unknown }).__solidFeatureWorkerMessages,
      safeMode: window.__crawlerApp.safeMode(),
      readiness: window.__crawlerApp.readiness(),
    }));
    throw new Error(`Extrude commit did not complete: ${JSON.stringify(evidence)}`);
  });
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
}

export async function successScreenshot(page: Page, name: string): Promise<string> {
  const path = resolve(evidenceRoot, "browser/screenshots", name);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  return path;
}

export async function writePerformanceEvidence(value: unknown): Promise<string> {
  const path = resolve(evidenceRoot, "performance/results.json");
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

export async function fixtureDescriptor(fixtureId: string): Promise<{
  input: { schema_version: number; kind: string; payload: Record<string, unknown> };
  expected: Record<string, unknown>;
  lifecycle_steps: string[];
}> {
  return JSON.parse(await readFile(resolve(repositoryRoot, `contracts/solid-feature-candidate/fixtures/${fixtureId}.json`), "utf8"));
}

export async function writeBrowserFixtureEvidence(
  fixtureId: string,
  sourceId: string,
  result: Record<string, unknown>,
  assertions: Record<string, unknown>,
): Promise<string> {
  const manifestPath = process.env.SOLID_FEATURE_CANDIDATE_MANIFEST;
  if (!manifestPath) throw new Error("SOLID_FEATURE_CANDIDATE_MANIFEST is required when writing candidate evidence");
  const manifestBytes = await readFile(resolve(repositoryRoot, manifestPath));
  const candidate = JSON.parse(manifestBytes.toString("utf8")) as { candidate_id: string; revision: number };
  const descriptorBytes = await readFile(resolve(repositoryRoot, `contracts/solid-feature-candidate/fixtures/${fixtureId}.json`));
  const descriptor = JSON.parse(descriptorBytes.toString("utf8")) as { input: Record<string, unknown>; expected: Record<string, unknown> };
  expect(result, `${fixtureId} result must equal its descriptor expectation`).toEqual(descriptor.expected);
  const value = {
    schema_version: 1,
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.revision,
    manifest_sha256: sha256(manifestBytes),
    fixture_id: fixtureId,
    descriptor_sha256: sha256(descriptorBytes),
    status: "passed",
    source_kind: "browser_suite",
    source_id: sourceId,
    input: descriptor.input,
    result,
    assertions,
  };
  const destination = resolve(evidenceRoot, `fixtures/${fixtureId}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return destination;
}

export async function mergeBrowserFixtureAssertions(
  fixtureId: string,
  assertions: Record<string, unknown>,
): Promise<string> {
  const destination = resolve(evidenceRoot, `fixtures/${fixtureId}.json`);
  const existing = JSON.parse(await readFile(destination, "utf8")) as {
    status?: string;
    fixture_id?: string;
    assertions?: Record<string, unknown>;
  };
  expect(existing.status, `${fixtureId} browser evidence must already be passed before augmentation`).toBe("passed");
  expect(existing.fixture_id).toBe(fixtureId);
  existing.assertions = { ...(existing.assertions ?? {}), ...assertions };
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return destination;
}

export async function performanceBudgets(): Promise<{
  schema_version: number;
  profile_id: string;
  warm_up_samples: number;
  measured_samples: number;
  allowed_run_to_run_variance_percent: number;
  workloads: Array<{
    id: string;
    preview_p50_ms_max: number;
    preview_p95_ms_max: number;
    recompute_p50_ms_max: number;
    recompute_p95_ms_max: number;
    cancellation_latency_ms_max: number;
    main_thread_long_task_ms_max: number;
    preview_edit_cancel_cycles: number;
    memory_growth_bytes_max: number;
  }>;
}> {
  const profile = JSON.parse(await readFile(resolve(repositoryRoot, "contracts/solid-feature-candidate/performance-budgets.v1.json"), "utf8")) as Awaited<ReturnType<typeof performanceBudgets>>;
  const activeManifest = process.env.SOLID_FEATURE_CANDIDATE_MANIFEST;
  if (!activeManifest) return profile;
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, activeManifest), "utf8")) as { performance_workload_ids?: string[] };
  const requested = manifest.performance_workload_ids ?? [];
  const requestedSet = new Set(requested);
  const workloads = profile.workloads.filter((workload) => requestedSet.has(workload.id));
  const found = new Set(workloads.map((workload) => workload.id));
  const missing = requested.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`Candidate manifest names unknown performance workloads: ${missing.join(", ")}`);
  return { ...profile, workloads };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) throw new Error("Cannot calculate a percentile without samples");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
