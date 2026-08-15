import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SKETCH_CREATION_VARIANTS } from "../src/sketch-creation";
import { SKETCH_TOOL_MANIFEST } from "../src/sketch-tool-manifest";

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

type RelativePoint = readonly [number, number];
type Summary = { count: number; samples: number[]; p50: number | null; p95: number | null; max: number | null };
type ProbeRecord = {
  label: string;
  semanticMs: number;
  stablePaintMs: number;
  actionStartedAt: number;
  stablePaintAt: number;
  actionLongTasks: { startTime: number; duration: number }[];
};
type SketchContext = { canvas: Locator; overlay: Locator; box: { x: number; y: number; width: number; height: number } };
type ShapeCase = {
  name: string;
  tool: string;
  points: readonly RelativePoint[];
  expectedAdded: number;
  variant?: string;
  polygonSides?: number;
  operandCount?: number;
  text?: string;
  suppressInference?: boolean;
};
type ShapeResult = {
  name: string;
  status: "passed" | "failed";
  error?: string;
  geometryKinds: string[];
  geometryCount: number;
  constraintCount: number;
  svgNodes: number;
  markupBytes: number;
  creationMs: number;
  hoverMs: Summary;
  selectionMs: Summary;
  snapMs: Summary;
  longTaskMaxMs: number;
  budgetViolations: string[];
  probeRecords: ProbeRecord[];
};
type CombinationResult = {
  name: string;
  status: "passed" | "timed_out" | "failed";
  error?: string;
  combinationCreationMs: number;
  geometryCount: number;
  constraintCount: number;
  svgNodes: number;
  markupBytes: number;
  coldHoverMs: number;
  warmHoverMs: Summary;
  additiveSelectionMs: Summary;
  snapMs: Summary;
  smartDimensionActivationMs: number;
  longTaskMaxMs: number;
  budgetViolations: string[];
  probeRecords: ProbeRecord[];
};
type ConstraintCombinationResult = {
  name: string;
  actionMs: Summary;
  geometryCount: number;
  constraintCount: number;
  svgNodes: number;
  markupBytes: number;
  longTaskMaxMs: number;
  budgetViolations: string[];
  probeRecords: ProbeRecord[];
};

const BUDGETS = {
  creationMs: 1_500,
  hoverP95Ms: 250,
  selectionP95Ms: 250,
  snapP95Ms: 250,
  longTaskMaxMs: 100,
} as const;

const MEASURED_REPETITIONS = Math.max(1, Number.parseInt(process.env.SKETCH_PERF_REPETITIONS ?? "5", 10) || 5);
const WARMUP_REPETITIONS = Math.max(0, Number.parseInt(process.env.SKETCH_PERF_WARMUPS ?? "1", 10) || 0);
const SCENARIO_FILTER = process.env.SKETCH_PERF_SCENARIO?.toLowerCase();

async function persistArtifact(testInfo: TestInfo, name: string, payload: unknown): Promise<void> {
  const envelope = { runId: process.env.SKETCH_PERF_RUN_ID ?? "unmanaged", test: testInfo.title, payload };
  const body = JSON.stringify(envelope, null, 2);
  await testInfo.attach(`${name}.json`, { body: Buffer.from(body), contentType: "application/json" });
  const directory = process.env.SKETCH_PERF_ARTIFACT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const safeName = name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  const file = path.join(directory, `${safeName}-${process.pid}.json`);
  await writeFile(file, body, "utf8");
  await writeFile(`${file}.sha256`, `${createHash("sha256").update(body).digest("hex")}  ${path.basename(file)}\n`, "utf8");
}

const SHAPES: readonly ShapeCase[] = [
  { name: "line", tool: "line", points: [[.38, .58], [.62, .46]], expectedAdded: 1 },
  { name: "native point", tool: "point", points: [[.50, .50]], expectedAdded: 1 },
  { name: "control-point spline", tool: "spline", points: [[.34, .60], [.43, .38], [.55, .66], [.68, .46]], expectedAdded: 1 },
  { name: "fit-point spline", tool: "fit-spline", points: [[.34, .60], [.43, .38], [.55, .66], [.68, .46]], expectedAdded: 1 },
  { name: "ellipse", tool: "ellipse", points: [[.50, .50], [.63, .50], [.50, .59]], expectedAdded: 1 },
  { name: "elliptical arc", tool: "elliptical-arc", points: [[.50, .50], [.63, .50], [.50, .59], [.63, .50], [.50, .59]], expectedAdded: 1 },
  { name: "conic", tool: "conic", points: [[.36, .60], [.50, .34], [.66, .60]], expectedAdded: 1 },
  { name: "sketch text", tool: "text", text: "PERF", points: [[.39, .55]], expectedAdded: 20 },

  { name: "rectangle / two point", tool: "rect", variant: "two_point", points: [[.38, .42], [.63, .64]], expectedAdded: 4 },
  { name: "rectangle / three point", tool: "rect", variant: "three_point", points: [[.36, .48], [.62, .48], [.36, .62]], expectedAdded: 4 },
  { name: "rectangle / center", tool: "rect", variant: "center", points: [[.50, .52], [.63, .65]], expectedAdded: 6 },

  { name: "circle / center diameter", tool: "circle", variant: "center_diameter", points: [[.50, .50], [.61, .50]], expectedAdded: 1 },
  { name: "circle / two point", tool: "circle", variant: "two_point", points: [[.40, .50], [.62, .50]], expectedAdded: 1 },
  { name: "circle / three point", tool: "circle", variant: "three_point", points: [[.40, .54], [.50, .40], [.61, .54]], expectedAdded: 1 },
  { name: "circle / two tangent", tool: "circle", variant: "two_tangent", operandCount: 2, points: [[.50, .52]], expectedAdded: 1 },
  { name: "circle / three tangent", tool: "circle", variant: "three_tangent", operandCount: 3, points: [[.50, .52]], expectedAdded: 1 },

  { name: "arc / center point", tool: "arc", variant: "center_point", points: [[.50, .52], [.62, .52], [.50, .40]], expectedAdded: 1 },
  { name: "arc / three point", tool: "arc", variant: "three_point", points: [[.39, .56], [.50, .39], [.62, .56]], expectedAdded: 1 },
  { name: "arc / tangent", tool: "arc", variant: "tangent", operandCount: 1, points: [[.40, .50], [.58, .42]], expectedAdded: 1 },

  { name: "polygon / inscribed", tool: "polygon", variant: "inscribed", polygonSides: 6, points: [[.50, .52], [.62, .52]], expectedAdded: 6 },
  { name: "polygon / circumscribed", tool: "polygon", variant: "circumscribed", polygonSides: 6, points: [[.50, .52], [.62, .52]], expectedAdded: 6 },
  { name: "polygon / edge", tool: "polygon", variant: "edge", polygonSides: 6, points: [[.40, .58], [.60, .58]], expectedAdded: 6 },

  { name: "slot / center to center", tool: "slot", variant: "center_to_center", points: [[.39, .52], [.62, .52], [.39, .45]], expectedAdded: 4 },
  { name: "slot / overall", tool: "slot", variant: "overall", points: [[.36, .52], [.65, .52], [.36, .47]], expectedAdded: 4 },
  { name: "slot / center point", tool: "slot", variant: "center_point", points: [[.50, .52], [.63, .52], [.50, .42]], expectedAdded: 4 },
  { name: "slot / three point arc", tool: "slot", variant: "three_point_arc", points: [[.38, .57], [.50, .39], [.63, .57], [.50, .44]], expectedAdded: 4 },
] as const;

function assertCatalogCoverage(): void {
  const ribbonKey: Record<string, string> = { rectangle: "rect", fit_spline: "fit-spline", elliptical_arc: "elliptical-arc" };
  const missingTools = Object.entries(SKETCH_TOOL_MANIFEST)
    .filter(([, contract]) => contract.family === "draw")
    .map(([tool]) => ribbonKey[tool] ?? tool)
    .filter((tool) => !SHAPES.some((shape) => shape.tool === tool));
  const missingVariants = Object.entries(SKETCH_CREATION_VARIANTS).flatMap(([tool, variants]) => {
    const key = ribbonKey[tool] ?? tool;
    return variants.flatMap(([variant]) => SHAPES.some((shape) => shape.tool === key && shape.variant === variant) ? [] : [`${tool}/${variant}`]);
  });
  expect(missingTools, "every shipped draw tool must have a performance scenario").toEqual([]);
  expect(missingVariants, "every shipped creation variant must have a performance scenario").toEqual([]);
}

function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

function summarize(values: readonly number[]): Summary {
  const samples = values.map((value) => Number(value.toFixed(2)));
  const p50 = percentile(samples, .5);
  const p95 = percentile(samples, .95);
  return {
    count: samples.length,
    samples,
    p50: p50 === null ? null : Number(p50.toFixed(2)),
    p95: p95 === null ? null : Number(p95.toFixed(2)),
    max: samples.length ? Number(Math.max(...samples).toFixed(2)) : null,
  };
}

function mergeSummaries(...summaries: readonly Summary[]): Summary {
  return summarize(summaries.flatMap((summary) => summary.samples));
}

async function withWallClockTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms wall-clock watchdog`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function newMeasuredPage(browser: Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    type ProbeOptions = {
      label: string;
      eventType: "pointermove" | "pointerdown" | "keydown";
      selector?: string;
      className?: string;
      attributeName?: string;
      attributeValue?: string;
      expectedSelectorCount?: number;
      expectedGeometryCount?: number;
      expectedConstraintCount?: number;
      expectedConstraintKind?: string;
      expectedOperandIds?: string[];
      expectedOperationCount?: number;
      expectedOperationKind?: string;
    };
    type LongTaskInterval = { startTime: number; duration: number };
    type ProbeResult = ProbeRecord & { semanticProof: string };
    const state = window as typeof window & {
      __sketchPerfLongTasks?: LongTaskInterval[];
      __sketchPerfProbeResult?: ProbeResult;
      __sketchPerfProbeHistory?: ProbeResult[];
      __sketchPerfProbeCleanup?: () => void;
      __armSketchPerfProbe?: (options: ProbeOptions) => void;
    };
    state.__sketchPerfLongTasks = [];
    state.__sketchPerfProbeHistory = [];
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        state.__sketchPerfLongTasks!.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
      }).observe({ entryTypes: ["longtask"] });
    }
    state.__armSketchPerfProbe = (options) => {
      state.__sketchPerfProbeCleanup?.();
      state.__sketchPerfProbeResult = undefined;
      let eventAt: number | undefined;
      let completed = false;
      const initialGeometryIds = new Set(Array.from(document.querySelectorAll<SVGElement>("#sketch-overlay [data-sketch-geometry]"), (element) => element.dataset.sketchGeometry));
      const initialConstraintIds = new Set(Object.keys(window.__crawlerApp?.sketchDraft()?.constraints ?? {}));
      const initialOperationIds = new Set(Object.keys(window.__crawlerApp?.sketchDraft()?.operations ?? {}));
      const ready = (): string | undefined => {
        if (options.expectedGeometryCount !== undefined) {
          const ids = new Set(Array.from(document.querySelectorAll<SVGElement>("#sketch-overlay [data-sketch-geometry]"), (element) => element.dataset.sketchGeometry));
          const added = [...ids].filter((id) => id && !initialGeometryIds.has(id));
          if (ids.size < options.expectedGeometryCount || added.length === 0) return undefined;
          return `geometry-added:${added.join(",")}`;
        }
        if (options.expectedConstraintCount !== undefined) {
          const constraints = window.__crawlerApp?.sketchDraft()?.constraints ?? {};
          const ids = new Set(Object.keys(constraints));
          const added = [...ids].filter((id) => !initialConstraintIds.has(id));
          if (ids.size < options.expectedConstraintCount || added.length === 0) return undefined;
          const match = added.find((id) => {
            const constraint = constraints[id];
            if (!constraint || (options.expectedConstraintKind && constraint.kind !== options.expectedConstraintKind)) return false;
            const serialized = JSON.stringify(constraint);
            return (options.expectedOperandIds ?? []).every((operand) => serialized.includes(JSON.stringify(operand)));
          });
          return match ? `constraint-added:${match}:${constraints[match].kind}` : undefined;
        }
        if (options.expectedOperationCount !== undefined) {
          const operations = window.__crawlerApp?.sketchDraft()?.operations ?? {};
          const ids = new Set(Object.keys(operations));
          const added = [...ids].filter((id) => !initialOperationIds.has(id));
          if (ids.size < options.expectedOperationCount || added.length === 0) return undefined;
          const match = added.find((id) => {
            const operation = operations[id];
            if (!operation || (options.expectedOperationKind && operation.kind !== options.expectedOperationKind)) return false;
            const serialized = JSON.stringify(operation);
            return (options.expectedOperandIds ?? []).every((operand) => serialized.includes(JSON.stringify(operand)));
          });
          return match ? `operation-added:${match}:${operations[match].kind}` : undefined;
        }
        if (options.selector && options.expectedSelectorCount !== undefined) {
          const count = document.querySelectorAll(options.selector).length;
          return count >= options.expectedSelectorCount ? `selector-count:${count}` : undefined;
        }
        const exactMembers = options.selector ? document.querySelectorAll(options.selector) : undefined;
        const exactMember = exactMembers?.length === 1 ? exactMembers[0] : undefined;
        if (exactMember && options.className) return exactMember.classList.contains(options.className) ? `exact-member-class:${options.className}` : undefined;
        if (exactMember && options.attributeName) {
          const value = exactMember.getAttribute(options.attributeName);
          return value === options.attributeValue ? `exact-member-attribute:${options.attributeName}=${value}` : undefined;
        }
        return undefined;
      };
      const cleanup = () => {
        document.removeEventListener(options.eventType, onInput, true);
        observer.disconnect();
      };
      const finish = () => {
        const semanticProof = ready();
        if (completed || eventAt === undefined || !semanticProof) return;
        completed = true;
        const semanticAt = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const stablePaintAt = performance.now();
          const result: ProbeResult = {
            label: options.label,
            semanticMs: semanticAt - eventAt!,
            stablePaintMs: stablePaintAt - eventAt!,
            actionStartedAt: eventAt!,
            stablePaintAt,
            semanticProof,
            actionLongTasks: state.__sketchPerfLongTasks!.filter((entry) => entry.startTime < stablePaintAt && entry.startTime + entry.duration > eventAt!),
          };
          state.__sketchPerfProbeResult = result;
          state.__sketchPerfProbeHistory!.push(result);
          cleanup();
        }));
      };
      const onInput = (event: Event) => { eventAt = event.timeStamp; queueMicrotask(finish); };
      const observer = new MutationObserver(finish);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      document.addEventListener(options.eventType, onInput, true);
      state.__sketchPerfProbeCleanup = cleanup;
    };
  });
  return { context, page: await context.newPage() };
}

async function openSketch(page: Page): Promise<SketchContext> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  return { canvas, box, overlay: page.getByLabel("Editable sketch geometry") };
}

async function invokeDrawTool(page: Page, key: string): Promise<void> {
  const direct = page.locator(`[data-workbench-ribbon="Sketcher"] [data-ribbon-tool="${key}"]`);
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.locator('[data-workbench-ribbon="Sketcher"] [data-ribbon-flyout="draw"]').click();
  await page.locator(`[data-workbench-ribbon="Sketcher"] [data-ribbon-run="${key}"]`).click();
}

async function clickRelativePoints(context: SketchContext, points: readonly RelativePoint[], suppressInference = true): Promise<void> {
  for (const [x, y] of points) {
    // Keep controlled creation independent of nearby geometry. As with the
    // additive-selection helper below, drive the modifier as keyboard state:
    // coordinate-click modifier options have not been reliable in the Chrome
    // version used by the production qualification runner.
    if (suppressInference) await context.canvas.page().keyboard.down("Alt");
    try {
      await context.canvas.click({ force: true, position: { x: context.box.width * x, y: context.box.height * y } });
    } finally {
      if (suppressInference) await context.canvas.page().keyboard.up("Alt");
    }
  }
}

async function geometryIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.geometry ?? {}));
}

async function assertHealthyAutomaticConstraints(page: Page, label: string): Promise<void> {
  const snapshot = await page.evaluate(() => ({
    solve: window.__crawlerApp.sketchSolve(),
    audit: window.__crawlerApp.sketchAutoConstraintAudit(),
  }));
  const invalidBatches = snapshot.audit.filter((entry) => {
    const emitted = new Set(entry.emittedConstraints.map((constraint) => constraint.id));
    return entry.solveState === "conflicting"
      || entry.solveState === "over_constrained"
      || entry.redundantConstraints.some((id) => emitted.has(id))
      || entry.conflicts.some((conflict) => conflict.constraints.some((id) => emitted.has(id)));
  });
  if (snapshot.solve?.state === "conflicting" || snapshot.solve?.state === "over_constrained" || invalidBatches.length) {
    throw new Error(`${label} produced an unhealthy automatic constraint solve: ${JSON.stringify({ solve: snapshot.solve, invalidBatches })}`);
  }
}

async function prepareOperandLines(page: Page, context: SketchContext): Promise<string[]> {
  const before = new Set(await geometryIds(page));
  const lines: readonly (readonly [RelativePoint, RelativePoint])[] = [
    [[.28, .70], [.28, .30]], [[.28, .30], [.72, .30]], [[.72, .30], [.72, .70]],
  ];
  for (const points of lines) {
    await invokeDrawTool(page, "line");
    await clickRelativePoints(context, points);
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => geometryIds(page)).toHaveLength(3);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const ids = (await geometryIds(page)).filter((id) => !before.has(id));
  // Creation may leave its last entity selected. Operand variants must begin
  // from an explicit empty selection or their first scripted click can
  // correctly advance from one retained operand to two.
  await page.locator("#sketch-select-tool").click();
  await page.keyboard.press("Escape");
  await expect(context.overlay.locator(".sketch-entity.selected")).toHaveCount(0);
  return ids;
}

async function createShape(page: Page, context: SketchContext, shape: ShapeCase): Promise<{ creationMs: number; ids: string[] }> {
  const operandIds = shape.operandCount ? await prepareOperandLines(page, context) : [];
  const before = new Set(await geometryIds(page));
  const beforeConstraintIds = shape.operandCount ? await page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.constraints ?? {})) : [];
  console.log(`sketch-shape stage: ${shape.name} invoke start`);
  await invokeDrawTool(page, shape.tool);
  console.log(`sketch-shape stage: ${shape.name} invoke complete`);
  if (shape.variant) {
    await page.locator("#sketch-creation-variant").selectOption(shape.variant);
    // Variant changes rebuild the active-tool inspector. Wait for the
    // authoritative point contract before placing anything so a dense scene
    // cannot race the previous/default variant and consume too few points.
    const requiredPoints = shape.operandCount ? 0 : shape.points.length;
    if (requiredPoints) await expect(page.locator("#active-tool-point-progress")).toContainText(`0 / ${requiredPoints} points set`);
  }
  if (shape.polygonSides) {
    await page.locator("#sketch-polygon-sides").fill(String(shape.polygonSides));
    await page.locator("#sketch-polygon-sides").press("Tab");
  }
  if (shape.text) await page.locator("#sketch-text-value").fill(shape.text);
  if (shape.operandCount) {
    for (let index = 0; index < shape.operandCount; index += 1) {
      await context.overlay.locator(`.sketch-entity[data-sketch-geometry="${operandIds[index]}"]`).first().click({ force: true });
      await expect(page.locator("#active-tool-point-progress")).toContainText(`${index + 1} / ${shape.operandCount} curves`);
    }
    await expect(page.locator("#active-tool-point-progress")).toContainText(`${shape.operandCount} / ${shape.operandCount} curves`);
  }
  const beforeUniqueRendered = await context.overlay.locator("[data-sketch-geometry]").evaluateAll((elements) => new Set(elements.map((element) => (element as SVGElement).dataset.sketchGeometry)).size);
  const expectedUniqueRendered = beforeUniqueRendered + shape.expectedAdded;
  for (const [index, point] of shape.points.slice(0, -1).entries()) {
    console.log(`sketch-shape stage: ${shape.name} point ${index + 1} start`);
    await clickRelativePoints(context, [point], shape.suppressInference ?? true);
    const placed = index + 1;
    const progress = shape.operandCount
      ? `${shape.operandCount} / ${shape.operandCount} curves · ${placed} / ${shape.points.length} points set`
      : `${placed} / ${shape.points.length} points set`;
    await expect(page.locator("#active-tool-point-progress")).toContainText(progress);
    console.log(`sketch-shape stage: ${shape.name} point ${index + 1} complete`);
  }
  await armProbe(page, { eventType: "pointerdown", expectedGeometryCount: expectedUniqueRendered });
  console.log(`sketch-shape stage: ${shape.name} final point start`);
  await clickRelativePoints(context, shape.points.slice(-1), shape.suppressInference ?? true);
  console.log(`sketch-shape stage: ${shape.name} final point complete`);
  let creationMs: number;
  try {
    creationMs = await readProbe(page, 10_000);
  } catch (error) {
    const debug = await page.evaluate(() => ({
      geometry: Object.values(window.__crawlerApp.sketchDraft()?.geometry ?? {}).map((entity) => entity.geometry.kind),
      solver: document.querySelector("#active-tool-solver-state")?.textContent,
      error: document.querySelector("#action-error")?.textContent,
      errorReason: document.querySelector("#action-error-reason")?.textContent,
      errorNext: document.querySelector("#action-error-next")?.textContent,
      inlineFields: Array.from(document.querySelectorAll<HTMLInputElement>("[data-inline-creation-field]")).map((input) => ({ field: input.dataset.inlineCreationField, value: input.value })),
      pointProgress: document.querySelector("#active-tool-point-progress")?.textContent,
      bridge: window.__crawlerApp.sketchBridgePerformance().slice(-8),
    }));
    throw new Error(`${shape.name} did not reach its expected rendered count: ${JSON.stringify(debug)}`, { cause: error });
  }
  await expect.poll(async () => context.overlay.locator("[data-sketch-geometry]").evaluateAll((elements) => new Set(elements.map((element) => (element as SVGElement).dataset.sketchGeometry)).size)).toBe(expectedUniqueRendered);
  const ids = (await geometryIds(page)).filter((id) => !before.has(id));
  if (shape.operandCount) {
    if (ids.length !== 1) throw new Error(`${shape.name} created ${ids.length} entities; expected one tangent result`);
    const proof = await page.evaluate(({ prior, operands, created }) => {
      const draft = window.__crawlerApp.sketchDraft();
      const priorIds = new Set(prior);
      const added = Object.entries(draft?.constraints ?? {}).filter(([id]) => !priorIds.has(id));
      const tangentPairs = added.map(([id, constraint]) => ({
        id,
        kind: constraint.kind,
        first: constraint.kind === "tangent" ? constraint.first : undefined,
        second: constraint.kind === "tangent" ? constraint.second : undefined,
      }));
      const valid = tangentPairs.length === operands.length
        && operands.every((operand) => tangentPairs.some((constraint) => constraint.kind === "tangent" && constraint.first === operand && constraint.second === created));
      return { valid, tangentPairs };
    }, { prior: beforeConstraintIds, operands: operandIds.slice(0, shape.operandCount), created: ids[0] });
    if (!proof.valid) throw new Error(`${shape.name} did not retain exact tangent operand relationships: ${JSON.stringify(proof.tangentPairs)}`);
  }
  await assertHealthyAutomaticConstraints(page, shape.name);
  return { creationMs, ids };
}

async function armProbe(page: Page, options: {
  label?: string;
  eventType: "pointermove" | "pointerdown" | "keydown";
  selector?: string;
  className?: string;
  attributeName?: string;
  attributeValue?: string;
  expectedSelectorCount?: number;
  expectedGeometryCount?: number;
  expectedConstraintCount?: number;
  expectedConstraintKind?: string;
  expectedOperandIds?: string[];
  expectedOperationCount?: number;
  expectedOperationKind?: string;
}): Promise<void> {
  const value = { label: options.label ?? `${options.eventType}:${options.selector ?? "semantic-mutation"}`, ...options };
  await page.evaluate((value) => {
    const state = window as typeof window & { __armSketchPerfProbe?: (options: typeof value) => void };
    state.__armSketchPerfProbe?.(value);
  }, value);
}

async function exactMemberSelector(member: Locator): Promise<string> {
  return member.evaluate((element) => {
    const geometry = element.getAttribute("data-sketch-geometry");
    if (!geometry) throw new Error("performance target has no stable geometry identity");
    const segment = element.getAttribute("data-sketch-segment");
    const segmentSelector = segment === null ? ":not([data-sketch-segment])" : `[data-sketch-segment="${CSS.escape(segment)}"]`;
    return `${element.tagName.toLowerCase()}.sketch-entity[data-sketch-geometry="${CSS.escape(geometry)}"]${segmentSelector}`;
  });
}

async function readProbe(page: Page, timeout = 2_000): Promise<number> {
  await page.waitForFunction(() => Boolean((window as typeof window & { __sketchPerfProbeResult?: unknown }).__sketchPerfProbeResult), undefined, { timeout });
  return page.evaluate(() => (window as typeof window & { __sketchPerfProbeResult: { stablePaintMs: number } }).__sketchPerfProbeResult.stablePaintMs);
}

async function probeHistory(page: Page): Promise<ProbeRecord[]> {
  return page.evaluate(() => ((window as typeof window & { __sketchPerfProbeHistory?: ProbeRecord[] }).__sketchPerfProbeHistory ?? []).map((record) => ({ ...record })));
}

function actionLongTaskMax(records: readonly ProbeRecord[]): number {
  return Math.max(0, ...records.flatMap((record) => record.actionLongTasks).map((task) => task.duration));
}

async function screenPointForGeometry(overlay: Locator, id: string): Promise<{ x: number; y: number }> {
  const geometry = overlay.locator(`[data-sketch-geometry="${id}"]`).first();
  await expect(geometry).toBeAttached();
  return geometry.evaluate((element) => {
    const value = element as SVGGeometryElement;
    const length = typeof value.getTotalLength === "function" ? value.getTotalLength() : 0;
    const local = typeof value.getPointAtLength === "function"
      ? value.getPointAtLength(length * .37)
      : { x: Number(value.getAttribute("cx")), y: Number(value.getAttribute("cy")) } as DOMPoint;
    const screen = local.matrixTransform(value.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
}

async function screenPointNearGeometry(overlay: Locator, id: string): Promise<{ x: number; y: number }> {
  const geometry = overlay.locator(`[data-sketch-geometry="${id}"]`).first();
  await expect(geometry).toBeAttached();
  return geometry.evaluate((element) => {
    const value = element as SVGGeometryElement;
    const length = typeof value.getTotalLength === "function" ? value.getTotalLength() : 0;
    const at = (fraction: number) => {
      const local = typeof value.getPointAtLength === "function"
        ? value.getPointAtLength(length * fraction)
        : { x: Number(value.getAttribute("cx")), y: Number(value.getAttribute("cy")) } as DOMPoint;
      return local.matrixTransform(value.getScreenCTM()!);
    };
    const point = at(.37); const ahead = at(Math.min(.99, .37 + (length ? Math.min(.02, 2 / length) : 0)));
    const dx = ahead.x - point.x; const dy = ahead.y - point.y; const magnitude = Math.hypot(dx, dy) || 1;
    return { x: point.x - dy / magnitude * 9, y: point.y + dx / magnitude * 9 };
  });
}

async function clickScreenPoint(page: Page, point: { x: number; y: number }, additive = false): Promise<void> {
  // Drive the keyboard state explicitly. Coordinate-level Mouse.click
  // modifier options have not produced ctrlKey consistently across the
  // Chrome/Playwright versions used by the qualified runner, which silently
  // turned additive selection into replacement selection.
  if (additive) await page.keyboard.down("Control");
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    if (additive) await page.keyboard.up("Control");
  }
}

async function measureHover(page: Page, context: SketchContext, id: string, repetitions = MEASURED_REPETITIONS): Promise<Summary> {
  const target = context.overlay.locator(`.sketch-entity[data-sketch-geometry="${id}"]`).first();
  const point = await screenPointForGeometry(context.overlay, id);
  const away = { x: context.box.x + context.box.width * .13, y: context.box.y + context.box.height * .84 };
  const samples: number[] = [];
  for (let index = 0; index < repetitions + WARMUP_REPETITIONS; index += 1) {
    await page.mouse.move(away.x, away.y);
    await expect(target).not.toHaveClass(/(^|\s)preselected(\s|$)/);
    const selector = await exactMemberSelector(target);
    await armProbe(page, { label: `hover:${id}`, eventType: "pointermove", selector, className: "preselected" });
    await page.mouse.move(point.x, point.y);
    const sample = await readProbe(page);
    if (index >= WARMUP_REPETITIONS) samples.push(sample);
  }
  return summarize(samples);
}

async function measureSelection(page: Page, context: SketchContext, id: string, repetitions = MEASURED_REPETITIONS): Promise<Summary> {
  const target = context.overlay.locator(`.sketch-entity[data-sketch-geometry="${id}"]`).first();
  const kind = await page.evaluate((geometry) => window.__crawlerApp.sketchDraft()?.geometry[geometry]?.geometry.kind, id);
  const point = kind === "sketch_point"
    ? await context.overlay.locator(`[data-geometry="${id}"][data-anchor="position"]`).evaluate((element) => {
      const value = element as SVGCircleElement; const local = new DOMPoint(value.cx.baseVal.value, value.cy.baseVal.value).matrixTransform(value.getScreenCTM()!); return { x: local.x, y: local.y };
    })
    : await screenPointForGeometry(context.overlay, id);
  const samples: number[] = [];
  // Segment selection is a rendered-member property, not a geometry-kind
  // property. Lines and rectangle members carry data-sketch-segment while a
  // native arc is one selectable path and therefore receives `.selected`.
  const selectionClass = await target.getAttribute("data-sketch-segment") !== null ? "segment-selected" : "selected";
  for (let index = 0; index < repetitions + WARMUP_REPETITIONS; index += 1) {
    await restoreNeutralSelection(page, context);
    await expect(target).not.toHaveClass(new RegExp(`(^|\\s)${selectionClass}(\\s|$)`));
    const selector = await exactMemberSelector(target);
    await armProbe(page, { label: `selection:${id}`, eventType: "pointerdown", selector, className: selectionClass });
    if (kind === "line") await target.click({ force: true });
    else await page.mouse.click(point.x, point.y);
    const sample = await readProbe(page);
    if (index >= WARMUP_REPETITIONS) samples.push(sample);
  }
  await page.keyboard.press("Escape");
  return summarize(samples);
}

async function measureSnap(page: Page, context: SketchContext, id: string, repetitions = MEASURED_REPETITIONS): Promise<Summary> {
  const target = context.overlay.locator(`.sketch-entity[data-sketch-geometry="${id}"]`).first();
  const kind = await page.evaluate((geometry) => window.__crawlerApp.sketchDraft()?.geometry[geometry]?.geometry.kind, id);
  const point = kind === "arc" ? await screenPointForGeometry(context.overlay, id) : await screenPointNearGeometry(context.overlay, id);
  const away = { x: context.box.x + context.box.width * .18, y: context.box.y + context.box.height * .82 };
  await invokeDrawTool(page, "line");
  await context.canvas.click({ force: true, position: { x: context.box.width * .20, y: context.box.height * .78 } });
  const samples: number[] = [];
  for (let index = 0; index < repetitions + WARMUP_REPETITIONS; index += 1) {
    await page.mouse.move(away.x + index, away.y + index);
    await page.waitForTimeout(35);
    const selector = await exactMemberSelector(target);
    await armProbe(page, { label: `snap:${id}`, eventType: "pointermove", selector, className: "inference-target" });
    await page.mouse.move(point.x + index * .15, point.y + index * .15);
    try {
      const sample = await readProbe(page);
      if (index >= WARMUP_REPETITIONS) samples.push(sample);
    } catch { /* dense overlaps can assign inference to a neighboring entity */ }
  }
  await page.keyboard.press("Escape");
  await restoreNeutralSelection(page, context);
  return summarize(samples);
}

async function measureColdHover(page: Page, context: SketchContext, id: string): Promise<number> {
  const selector = await exactMemberSelector(context.overlay.locator(`.sketch-entity[data-sketch-geometry="${id}"]`).first());
  const point = await screenPointForGeometry(context.overlay, id);
  await armProbe(page, { label: `cold-hover:${id}`, eventType: "pointermove", selector, className: "preselected" });
  await page.mouse.move(point.x, point.y);
  return readProbe(page);
}

async function measureAdditiveSelection(page: Page, context: SketchContext, ids: readonly string[]): Promise<Summary> {
  await restoreNeutralSelection(page, context);
  const samples: number[] = [];
  const accumulated: string[] = [];
  const accumulatedMemberSelectors: string[] = [];
  for (const id of ids) {
    const target = context.overlay.locator(`[data-sketch-geometry="${id}"]`).first();
    if (await target.evaluate((element) => element.classList.contains("selected"))) continue;
    const point = await screenPointForGeometry(context.overlay, id);
    const selector = await exactMemberSelector(target);
    accumulated.push(id);
    accumulatedMemberSelectors.push(`${selector}.selected`);
    const selectedSelector = accumulatedMemberSelectors.join(",");
    await armProbe(page, { label: `additive-selection:${accumulated.join("+")}`, eventType: "pointerdown", selector: selectedSelector, expectedSelectorCount: accumulated.length });
    await clickScreenPoint(page, point, true);
    samples.push(await readProbe(page));
    await expect.poll(async () => context.overlay.locator(selectedSelector).count()).toBe(accumulated.length);
  }
  await page.keyboard.press("Escape");
  return summarize(samples);
}

async function measureSmartDimensionActivation(page: Page, context: SketchContext): Promise<number> {
  await restoreNeutralSelection(page, context);
  const selector = '#sketch-overlay [data-sketch-handle][data-anchor^="parameter:"]';
  const before = await context.overlay.locator('[data-sketch-handle][data-anchor^="parameter:"]').count();
  await armProbe(page, { eventType: "pointerdown", selector, expectedSelectorCount: before + 1 });
  await page.locator("#smart-sketch-dimension").click();
  const result = await readProbe(page);
  await page.keyboard.press("Escape");
  return result;
}

async function createConstructionLine(page: Page, context: SketchContext, points: readonly [RelativePoint, RelativePoint]): Promise<string> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const before = new Set(await geometryIds(page));
  await invokeDrawTool(page, "line");
  await page.locator('[data-sketch-tool="construction"]').click();
  await clickRelativePoints(context, points);
  await expect.poll(async () => (await geometryIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await geometryIds(page)).find((candidate) => !before.has(candidate));
  if (!id) throw new Error("construction line was not created");
  await page.locator('[data-sketch-tool="construction"]').click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  return id;
}

async function sketchSizeSnapshot(page: Page): Promise<{ geometryCount: number; constraintCount: number; svgNodes: number; markupBytes: number; longTaskMaxMs: number }> {
  return page.evaluate(() => {
    const draft = window.__crawlerApp.sketchDraft();
    const overlay = document.querySelector<SVGElement>("#sketch-overlay")!;
    const longTasks = (window as typeof window & { __sketchPerfLongTasks?: { startTime: number; duration: number }[] }).__sketchPerfLongTasks ?? [];
    return {
      geometryCount: Object.keys(draft?.geometry ?? {}).length,
      constraintCount: Object.keys(draft?.constraints ?? {}).length,
      svgNodes: overlay.querySelectorAll("*").length,
      markupBytes: new TextEncoder().encode(overlay.innerHTML).length,
      longTaskMaxMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    };
  });
}

async function checkpointCombination(page: Page, context: SketchContext, name: string, coldTarget: string, warmTarget: string, selectionIds: readonly string[]): Promise<CombinationResult> {
  const coldHoverMs = await measureColdHover(page, context, coldTarget);
  const warmHoverMs = await measureHover(page, context, warmTarget, 2);
  const additiveSelectionMs = await measureAdditiveSelection(page, context, selectionIds.slice(0, 3));
  const snapMs = await measureSnap(page, context, warmTarget, 2);
  const smartDimensionActivationMs = await measureSmartDimensionActivation(page, context);
  await page.waitForTimeout(250);
  const size = await sketchSizeSnapshot(page);
  const records = await probeHistory(page);
  const actionLongMax = actionLongTaskMax(records);
  const budgetViolations = [
    ...(warmHoverMs.count === 0 ? ["warm hover produced no samples"] : []),
    ...(additiveSelectionMs.count !== Math.min(3, selectionIds.length) ? [`additive selection proved ${additiveSelectionMs.count} / ${Math.min(3, selectionIds.length)} accumulated members`] : []),
    ...(snapMs.count === 0 ? ["snap produced no samples"] : []),
    ...(coldHoverMs > BUDGETS.hoverP95Ms ? [`cold hover ${coldHoverMs.toFixed(1)} ms > ${BUDGETS.hoverP95Ms} ms`] : []),
    ...(warmHoverMs.p95 !== null && warmHoverMs.p95 > BUDGETS.hoverP95Ms ? [`warm hover p95 ${warmHoverMs.p95.toFixed(1)} ms > ${BUDGETS.hoverP95Ms} ms`] : []),
    ...(additiveSelectionMs.p95 !== null && additiveSelectionMs.p95 > BUDGETS.selectionP95Ms ? [`additive selection p95 ${additiveSelectionMs.p95.toFixed(1)} ms > ${BUDGETS.selectionP95Ms} ms`] : []),
    ...(snapMs.p95 !== null && snapMs.p95 > BUDGETS.snapP95Ms ? [`snap p95 ${snapMs.p95.toFixed(1)} ms > ${BUDGETS.snapP95Ms} ms`] : []),
    ...(smartDimensionActivationMs > BUDGETS.selectionP95Ms ? [`Smart Dimension activation ${smartDimensionActivationMs.toFixed(1)} ms > ${BUDGETS.selectionP95Ms} ms`] : []),
    ...(actionLongMax > BUDGETS.longTaskMaxMs ? [`action-overlapping long task ${actionLongMax.toFixed(1)} ms > ${BUDGETS.longTaskMaxMs} ms`] : []),
  ];
  return { name, status: "passed", combinationCreationMs: 0, ...size, coldHoverMs: Number(coldHoverMs.toFixed(2)), warmHoverMs, additiveSelectionMs, snapMs, smartDimensionActivationMs: Number(smartDimensionActivationMs.toFixed(2)), budgetViolations, probeRecords: records };
}

async function creationOnlyCombination(page: Page, name: string, creationMs: number): Promise<CombinationResult> {
  await page.waitForTimeout(250);
  const size = await sketchSizeSnapshot(page);
  const records = await probeHistory(page);
  const actionLongMax = actionLongTaskMax(records);
  const budgetViolations = [
    ...(creationMs > BUDGETS.creationMs ? [`combined creation ${creationMs.toFixed(1)} ms > ${BUDGETS.creationMs} ms`] : []),
    ...(actionLongMax > BUDGETS.longTaskMaxMs ? [`action-overlapping long task ${actionLongMax.toFixed(1)} ms > ${BUDGETS.longTaskMaxMs} ms`] : []),
  ];
  return { name, status: "passed", combinationCreationMs: Number(creationMs.toFixed(2)), ...size, coldHoverMs: 0, warmHoverMs: summarize([]), additiveSelectionMs: summarize([]), snapMs: summarize([]), smartDimensionActivationMs: 0, budgetViolations, probeRecords: records };
}

function failedCombination(name: string, error: unknown): CombinationResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name,
    status: message.includes("wall-clock watchdog") ? "timed_out" : "failed",
    error: message,
    combinationCreationMs: 0,
    geometryCount: 0,
    constraintCount: 0,
    svgNodes: 0,
    markupBytes: 0,
    coldHoverMs: 0,
    warmHoverMs: summarize([]),
    additiveSelectionMs: summarize([]),
    snapMs: summarize([]),
    smartDimensionActivationMs: 0,
    longTaskMaxMs: 0,
    budgetViolations: [message],
    probeRecords: [],
  };
}

async function restoreNeutralSelection(page: Page, context: SketchContext): Promise<void> {
  if (await context.overlay.locator(".sketch-entity.selected").count()) {
    await page.locator("#sketch-select-tool").click();
    // Escape clears selection only after the active drawing/constraint tool is
    // cleared, matching the sketcher's documented user interaction.
    await page.keyboard.press("Escape");
  }
  await expect(context.overlay.locator(".sketch-entity.selected")).toHaveCount(0);
}

async function leaveToolAndClearSelection(page: Page, context: SketchContext): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function selectGeometryIds(page: Page, context: SketchContext, ids: readonly string[]): Promise<void> {
  await leaveToolAndClearSelection(page, context);
  for (let index = 0; index < ids.length; index += 1) {
    const point = await screenPointForGeometry(context.overlay, ids[index]);
    await clickScreenPoint(page, point, index > 0);
  }
}

async function measureConstraintApplication(page: Page, key: string, operandIds: readonly string[]): Promise<number> {
  await page.locator('[data-ribbon-flyout="constrain"]').click();
  const selector = `[data-ribbon-run="${key}"]`;
  const button = page.locator(selector);
  await expect(button).toBeEnabled();
  const before = await page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.constraints ?? {}).length);
  await armProbe(page, { label: `constraint:${key}`, eventType: "pointerdown", expectedConstraintCount: before + 1, expectedConstraintKind: key.replaceAll("-", "_"), expectedOperandIds: [...operandIds] });
  await button.click();
  try {
    return await readProbe(page, 5_000);
  } catch (error) {
    const debug = await page.evaluate(() => ({
      constraints: window.__crawlerApp.sketchDraft()?.constraints ?? {},
      selectedGeometry: Array.from(document.querySelectorAll<SVGElement>("#sketch-overlay .sketch-entity.selected"), (element) => element.dataset.sketchGeometry),
      selectedHandles: Array.from(document.querySelectorAll<SVGElement>("#sketch-overlay [data-sketch-handle].selected"), (element) => ({ geometry: element.dataset.geometry, anchor: element.dataset.anchor })),
      guidance: document.querySelector("#sketch-command-guidance")?.textContent,
      actionError: document.querySelector("#action-error")?.textContent,
    }));
    throw new Error(`${key} did not produce the expected semantic constraint: ${JSON.stringify(debug)}`, { cause: error });
  }
}

async function constraintResult(page: Page, name: string, actionSamples: readonly number[]): Promise<ConstraintCombinationResult> {
  await page.waitForTimeout(250);
  const size = await sketchSizeSnapshot(page);
  const records = await probeHistory(page);
  const actionLongMax = actionLongTaskMax(records);
  const actionMs = summarize(actionSamples);
  const budgetViolations = [
    ...(actionMs.p95 !== null && actionMs.p95 > 500 ? [`constraint/dimension p95 ${actionMs.p95.toFixed(1)} ms > 500 ms`] : []),
    ...(actionLongMax > BUDGETS.longTaskMaxMs ? [`action-overlapping long task ${actionLongMax.toFixed(1)} ms > ${BUDGETS.longTaskMaxMs} ms`] : []),
  ];
  return { name, actionMs, ...size, budgetViolations, probeRecords: records };
}

function violationsFor(result: Omit<ShapeResult, "status" | "error" | "budgetViolations">, actionLongMax: number): string[] {
  const violations: string[] = [];
  if (result.creationMs > BUDGETS.creationMs) violations.push(`creation ${result.creationMs.toFixed(1)} ms > ${BUDGETS.creationMs} ms`);
  if (result.hoverMs.p95 !== null && result.hoverMs.p95 > BUDGETS.hoverP95Ms) violations.push(`hover p95 ${result.hoverMs.p95.toFixed(1)} ms > ${BUDGETS.hoverP95Ms} ms`);
  if (result.selectionMs.p95 !== null && result.selectionMs.p95 > BUDGETS.selectionP95Ms) violations.push(`selection p95 ${result.selectionMs.p95.toFixed(1)} ms > ${BUDGETS.selectionP95Ms} ms`);
  if (result.snapMs.p95 !== null && result.snapMs.p95 > BUDGETS.snapP95Ms) violations.push(`snap p95 ${result.snapMs.p95.toFixed(1)} ms > ${BUDGETS.snapP95Ms} ms`);
  if (actionLongMax > BUDGETS.longTaskMaxMs) violations.push(`action-overlapping long task ${actionLongMax.toFixed(1)} ms > ${BUDGETS.longTaskMaxMs} ms`);
  return violations;
}

async function inspectShape(page: Page, context: SketchContext, shape: ShapeCase): Promise<ShapeResult> {
  const created = await createShape(page, context, shape);
  const targetId = created.ids[0];
  if (!targetId) throw new Error(`${shape.name} created no selectable geometry`);
  const creationOnly = !["line", "circle", "arc"].includes(shape.tool);
  if (!creationOnly) {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  let hoverMs = summarize([]); let selectionMs = summarize([]); let snapMs = summarize([]);
  const kind = await page.evaluate((geometryId) => window.__crawlerApp.sketchDraft()?.geometry[geometryId]?.geometry.kind, targetId);
  if (kind !== "sketch_point" && !creationOnly) {
    try { hoverMs = await withWallClockTimeout(measureHover(page, context, targetId, MEASURED_REPETITIONS), 30_000, `${shape.name} hover`); } catch { /* recorded as missing below */ }
    if (shape.tool === "line" || shape.tool === "circle" || shape.tool === "arc") {
      try { selectionMs = await withWallClockTimeout(measureSelection(page, context, targetId, MEASURED_REPETITIONS), 8_000, `${shape.name} selection`); } catch (error) { console.warn(`${shape.name} selection probe failed`, error, await context.overlay.locator(`[data-sketch-geometry="${targetId}"]`).evaluateAll((elements) => elements.map((element) => ({ tag: element.tagName, className: element.getAttribute("class"), segment: element.getAttribute("data-sketch-segment") })))); }
      try { snapMs = await withWallClockTimeout(measureSnap(page, context, targetId, MEASURED_REPETITIONS), 30_000, `${shape.name} snap`); } catch { /* recorded as missing below */ }
    }
  }
  // The creation workflow itself remains covered even when a curved or
  // overlapping SVG member cannot be targeted unambiguously by this viewport.
  if (!creationOnly) await page.waitForTimeout(60);
  const snapshot = await page.evaluate((ids) => {
    const draft = window.__crawlerApp.sketchDraft();
    const overlay = document.querySelector<SVGElement>("#sketch-overlay")!;
    const longTasks = (window as typeof window & { __sketchPerfLongTasks?: { startTime: number; duration: number }[] }).__sketchPerfLongTasks ?? [];
    return {
      geometryKinds: ids.map((id) => draft?.geometry[id]?.geometry.kind ?? "missing"),
      geometryCount: Object.keys(draft?.geometry ?? {}).length,
      constraintCount: Object.keys(draft?.constraints ?? {}).length,
      svgNodes: overlay.querySelectorAll("*").length,
      markupBytes: new TextEncoder().encode(overlay.innerHTML).length,
      longTaskMaxMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    };
  }, created.ids);
  const measured = {
    name: shape.name,
    geometryKinds: snapshot.geometryKinds,
    geometryCount: snapshot.geometryCount,
    constraintCount: snapshot.constraintCount,
    svgNodes: snapshot.svgNodes,
    markupBytes: snapshot.markupBytes,
    creationMs: Number(created.creationMs.toFixed(2)),
    hoverMs,
    selectionMs,
    snapMs,
    longTaskMaxMs: Number(snapshot.longTaskMaxMs.toFixed(2)),
  };
  const records = await probeHistory(page);
  const budgetViolations = violationsFor(measured, actionLongTaskMax(records));
  if (kind !== "sketch_point" && !creationOnly && hoverMs.count === 0) budgetViolations.push("hover produced no samples");
  if ((shape.tool === "line" || shape.tool === "circle" || shape.tool === "arc") && selectionMs.count === 0) budgetViolations.push("selection produced no samples");
  if ((shape.tool === "line" || shape.tool === "circle" || shape.tool === "arc") && snapMs.count === 0) budgetViolations.push("snap produced no samples");
  return { ...measured, status: "passed", budgetViolations, probeRecords: records };
}

function printShapeTable(results: readonly ShapeResult[]): void {
  console.table(results.map((result) => ({
    shape: result.name,
    status: result.status,
    kinds: result.geometryKinds.join(","),
    geometry: result.geometryCount,
    constraints: result.constraintCount,
    nodes: result.svgNodes,
    create_ms: result.creationMs,
    hover_p95_ms: result.hoverMs.p95,
    select_p95_ms: result.selectionMs.p95,
    snap_p95_ms: result.snapMs.p95,
    long_task_ms: result.longTaskMaxMs,
    violations: result.budgetViolations.join("; "),
  })));
}

test("all sketch creation types expose bounded creation with primitive interaction probes", async ({ browser }, testInfo) => {
  assertCatalogCoverage();
  const results: ShapeResult[] = [];
  const filter = process.env.SKETCH_PERF_FILTER?.toLowerCase();
  const shapes = filter ? SHAPES.filter((shape) => shape.name.toLowerCase() === filter) : SHAPES;
  expect(shapes.length, `SKETCH_PERF_FILTER=${filter ?? ""} must match at least one shape`).toBeGreaterThan(0);
  for (const shape of shapes) {
    const { context, page } = await newMeasuredPage(browser, testInfo);
    try {
      const sketch = await openSketch(page);
      await page.evaluate(() => { (window as typeof window & { __sketchPerfLongTasks?: { startTime: number; duration: number }[] }).__sketchPerfLongTasks = []; });
      results.push(await withWallClockTimeout(inspectShape(page, sketch, shape), 30_000, shape.name));
    } catch (error) {
      results.push({
        name: shape.name,
        status: "failed",
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        geometryKinds: [], geometryCount: 0, constraintCount: 0, svgNodes: 0, markupBytes: 0, creationMs: 0,
        hoverMs: summarize([]), selectionMs: summarize([]), snapMs: summarize([]), longTaskMaxMs: 0,
        budgetViolations: ["workflow failed"], probeRecords: [],
      });
    } finally {
      await withWallClockTimeout(context.close(), 5_000, `${shape.name} context close`).catch(() => undefined);
    }
  }

  printShapeTable(results);
  await persistArtifact(testInfo, "sketch-performance-matrix", { budgets: BUDGETS, warmups: WARMUP_REPETITIONS, measuredRepetitions: MEASURED_REPETITIONS, results });
  expect.soft(results.filter((result) => result.status === "failed"), "every shipped creation workflow must be automatable").toEqual([]);
  expect.soft(results.flatMap((result) => result.budgetViolations.map((violation) => `${result.name}: ${violation}`)), "observable latency budgets").toEqual([]);
});
test("every auto-inferred constraint batch remains conflict-free and non-redundant", async ({ browser }, testInfo) => {
  const { context, page } = await newMeasuredPage(browser, testInfo);
  try {
    const sketch = await openSketch(page);
    await createShape(page, sketch, {
      name: "auto-inference baseline",
      tool: "line",
      points: [[.35, .55], [.65, .55]],
      expectedAdded: 1,
    });
    await createShape(page, sketch, {
      name: "circle center at line midpoint with tangent candidate",
      tool: "circle",
      variant: "center_diameter",
      points: [[.50, .55], [.50, .47]],
      expectedAdded: 1,
      suppressInference: false,
    });

    const audit = await page.evaluate(() => window.__crawlerApp.sketchAutoConstraintAudit());
    await persistArtifact(testInfo, "sketch-auto-constraint-audit", { audit });
    expect(audit.length, "the benchmark must exercise at least one automatic inference batch").toBeGreaterThan(0);
    expect(audit.some((entry) => entry.rawInferenceKinds.includes("midpoint"))).toBe(true);
    expect(audit.some((entry) => entry.rawInferenceKinds.includes("tangent"))).toBe(true);
    expect(audit.flatMap((entry) => entry.emittedConstraints).some((constraint) => constraint.kind === "midpoint")).toBe(true);
    expect(audit.flatMap((entry) => entry.emittedConstraints).some((constraint) => constraint.kind === "tangent")).toBe(false);
    await assertHealthyAutomaticConstraints(page, "automatic inference audit");
  } finally {
    await withWallClockTimeout(context.close(), 5_000, "automatic inference audit context close").catch(() => undefined);
  }
});

test("mixed sketch combinations remain observable as geometry and constraint density increase", async ({ browser }, testInfo) => {
  const results: CombinationResult[] = [];
  let denseIds: string[] = [];
  const runScene = async (name: string, action: (page: Page, sketch: SketchContext) => Promise<void>) => {
    if (SCENARIO_FILTER && name.toLowerCase() !== SCENARIO_FILTER) return;
    const { context, page } = await newMeasuredPage(browser, testInfo);
    try {
      const sketch = await openSketch(page);
      await page.evaluate(() => { (window as typeof window & { __sketchPerfLongTasks?: { startTime: number; duration: number }[] }).__sketchPerfLongTasks = []; });
      await withWallClockTimeout(action(page, sketch), 20_000, name);
    } catch (error) {
      results.push(failedCombination(name, error));
    } finally {
      await withWallClockTimeout(context.close(), 5_000, `${name} context close`).catch(() => undefined);
    }
  };
  const addMildScene = async (page: Page, sketch: SketchContext) => {
    const rectangle = await createShape(page, sketch, { name: "mild rectangle", tool: "rect", variant: "two_point", points: [[.36, .35], [.64, .67]], expectedAdded: 4 });
    console.log("sketch-combination stage: mild rectangle complete");
    const diagonal = await createConstructionLine(page, sketch, [[.36, .35], [.64, .67]]);
    console.log("sketch-combination stage: construction diagonal complete");
    const circle = await createShape(page, sketch, { name: "mild circle", tool: "circle", variant: "center_diameter", points: [[.50, .51], [.56, .51]], expectedAdded: 1 });
    console.log("sketch-combination stage: mild circle complete");
    return { rectangle, diagonal, circle };
  };

  await runScene("mild rectangle + construction diagonal + circle", async (page, sketch) => {
    const { rectangle, diagonal, circle } = await addMildScene(page, sketch);
    results.push(await checkpointCombination(page, sketch, "mild rectangle + construction diagonal + circle", rectangle.ids[0], circle.ids[0], [...rectangle.ids, diagonal, ...circle.ids]));
    console.log("sketch-combination checkpoint: mild scene complete");
  });

  await runScene("mild scene + center-point arc", async (page, sketch) => {
    await addMildScene(page, sketch);
    const arc = await createShape(page, sketch, { name: "mixed arc", tool: "arc", variant: "center_point", points: [[.28, .70], [.35, .70], [.28, .76]], expectedAdded: 1 });
    results.push(await creationOnlyCombination(page, "mild scene + center-point arc", arc.creationMs));
    console.log("sketch-combination checkpoint: arc mix complete");
  });

  await runScene("mild scene + ellipse", async (page, sketch) => {
    await addMildScene(page, sketch);
    console.log("sketch-combination stage: ellipse start");
    const ellipse = await createShape(page, sketch, { name: "mixed ellipse", tool: "ellipse", points: [[.28, .70], [.35, .70], [.28, .76]], expectedAdded: 1 });
    console.log("sketch-combination stage: ellipse complete");
    results.push(await creationOnlyCombination(page, "mild scene + ellipse", ellipse.creationMs));
  });

  await runScene("mild scene + control-point spline", async (page, sketch) => {
    await addMildScene(page, sketch);
    const spline = await createShape(page, sketch, { name: "mixed control-point spline", tool: "spline", points: [[.24, .70], [.32, .36], [.42, .72], [.49, .40]], expectedAdded: 1 });
    results.push(await creationOnlyCombination(page, "mild scene + control-point spline", spline.creationMs));
  });

  await runScene("mild scene + arc + polygon-6 + arc slot", async (page, sketch) => {
    // Exercise the multi-point arc-slot workflow before dense profile fills
    // introduce overlapping hit targets; the final scene and complexity are
    // identical, while each placement remains a real trusted canvas action.
    const slot = await createShape(page, sketch, { name: "arc slot", tool: "slot", variant: "three_point_arc", points: [[.38, .57], [.50, .39], [.63, .57], [.50, .44]], expectedAdded: 4 });
    await addMildScene(page, sketch);
    const arc = await createShape(page, sketch, { name: "mixed arc", tool: "arc", variant: "center_point", points: [[.28, .70], [.35, .70], [.28, .76]], expectedAdded: 1 });
    const polygon6 = await createShape(page, sketch, { name: "6-side polygon", tool: "polygon", variant: "inscribed", polygonSides: 6, points: [[.24, .51], [.31, .51]], expectedAdded: 6 });
    denseIds = await geometryIds(page);
    results.push(await creationOnlyCombination(page, "mild scene + arc + polygon-6 + arc slot", arc.creationMs + polygon6.creationMs + slot.creationMs));
    console.log("sketch-combination checkpoint: composite density complete");
  });

  console.table(results.map((result) => ({
    combination: result.name,
    status: result.status,
    geometry: result.geometryCount,
    constraints: result.constraintCount,
    nodes: result.svgNodes,
    markup_kb: Number((result.markupBytes / 1024).toFixed(1)),
    combined_creation_ms: result.combinationCreationMs,
    cold_hover_ms: result.coldHoverMs,
    warm_hover_p95_ms: result.warmHoverMs.p95,
    additive_select_p95_ms: result.additiveSelectionMs.p95,
    snap_p95_ms: result.snapMs.p95,
    smart_dimension_ms: result.smartDimensionActivationMs,
    long_task_ms: result.longTaskMaxMs,
    violations: result.budgetViolations.join("; "),
  })));
  await persistArtifact(testInfo, "sketch-combination-performance", { budgets: BUDGETS, geometryIds: denseIds, results });
  expect.soft(results.filter((result) => result.status !== "passed").map((result) => `${result.name}: ${result.error}`), "combination workflows must finish within their watchdog").toEqual([]);
  expect.soft(results.flatMap((result) => result.budgetViolations.map((violation) => `${result.name}: ${violation}`)), "combination latency budgets").toEqual([]);
});

test("constraint, Smart Dimension, and native-curve edit combinations expose bounded latency", async ({ browser }, testInfo) => {
  const results: ConstraintCombinationResult[] = [];
  const failures: { name: string; error: string }[] = [];
  const run = async (name: string, action: (page: Page, sketch: SketchContext) => Promise<readonly number[]>) => {
    if (SCENARIO_FILTER && name.toLowerCase() !== SCENARIO_FILTER) return;
    const { context, page } = await newMeasuredPage(browser, testInfo);
    try {
      const sketch = await openSketch(page);
      await page.evaluate(() => { (window as typeof window & { __sketchPerfLongTasks?: { startTime: number; duration: number }[] }).__sketchPerfLongTasks = []; });
      await withWallClockTimeout((async () => {
        results.push(await constraintResult(page, name, await action(page, sketch)));
      })(), 15_000, name);
    } catch (error) {
      failures.push({ name, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await withWallClockTimeout(context.close(), 5_000, `${name} context close`).catch(() => undefined);
    }
  };

  await run("circle center + diagonal midpoint", async (page, sketch) => {
    // Reproduce the reported workflow exactly: the diagonal is construction
    // geometry. Besides matching user intent, this gives the overlapping line
    // a unique semantic SVG target rather than relying on paint order.
    const diagonalId = await createConstructionLine(page, sketch, [[.36, .35], [.64, .67]]);
    // Start off the diagonal so the benchmark proves the midpoint constraint
    // moves a genuinely free center. Placing at the canvas origin can create a
    // point-on-origin inference first and turn this into an overconstrained or
    // redundant-operation test instead of the intended interaction.
    const circle = await createShape(page, sketch, { name: "midpoint circle", tool: "circle", variant: "center_diameter", points: [[.50, .59], [.56, .59]], expectedAdded: 1 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Target the interactive stable center handle, not a same-attribute
    // dimension/annotation member that does not participate in point
    // selection. This mirrors the real midpoint lifecycle and prevents a
    // false automation timeout when duplicate SVG members overlap.
    await sketch.overlay.locator(`[data-sketch-handle][data-geometry="${circle.ids[0]}"][data-anchor="center"]`).click({ force: true });
    const linePoint = await screenPointForGeometry(sketch.overlay, diagonalId);
    await clickScreenPoint(page, linePoint, true);
    return [await measureConstraintApplication(page, "midpoint", [diagonalId, circle.ids[0]])];
  });

  await run("two line Smart Dimension angle preview and commit", async (page, sketch) => {
    const first = await createShape(page, sketch, { name: "angle first", tool: "line", points: [[.34, .65], [.50, .43]], expectedAdded: 1 });
    const second = await createShape(page, sketch, { name: "angle second", tool: "line", points: [[.58, .62], [.75, .51]], expectedAdded: 1 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("#smart-sketch-dimension").click();
    const firstPoint = await screenPointForGeometry(sketch.overlay, first.ids[0]);
    const secondPoint = await screenPointForGeometry(sketch.overlay, second.ids[0]);
    await page.mouse.click(firstPoint.x, firstPoint.y);
    const previewSelector = '#sketch-overlay [data-dimension-preview-mode="angle"]';
    await armProbe(page, { eventType: "pointerdown", selector: previewSelector, expectedSelectorCount: 1 });
    await page.mouse.click(secondPoint.x, secondPoint.y);
    const previewMs = await readProbe(page, 5_000);
    await page.locator("#active-tool-constraint-value").fill("32 deg");
    const constraintCount = await page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.constraints ?? {}).length);
    await armProbe(page, { label: "smart-dimension-angle-commit", eventType: "keydown", expectedConstraintCount: constraintCount + 1, expectedConstraintKind: "angle", expectedOperandIds: [first.ids[0], second.ids[0]] });
    await page.locator("#active-tool-constraint-value").press("Enter");
    return [previewMs, await readProbe(page, 5_000)];
  });

  await run("line + circle tangent", async (page, sketch) => {
    const line = await createShape(page, sketch, { name: "tangent line", tool: "line", points: [[.34, .65], [.70, .65]], expectedAdded: 1 });
    const circle = await createShape(page, sketch, { name: "tangent circle", tool: "circle", variant: "center_diameter", points: [[.52, .57], [.60, .57]], expectedAdded: 1 });
    await selectGeometryIds(page, sketch, [line.ids[0], circle.ids[0]]);
    return [await measureConstraintApplication(page, "tangent", [line.ids[0], circle.ids[0]])];
  });

  await run("circle + circle equal", async (page, sketch) => {
    const first = await createShape(page, sketch, { name: "equal circle one", tool: "circle", variant: "center_diameter", points: [[.42, .52], [.47, .52]], expectedAdded: 1 });
    const second = await createShape(page, sketch, { name: "equal circle two", tool: "circle", variant: "center_diameter", points: [[.63, .52], [.70, .52]], expectedAdded: 1 });
    await selectGeometryIds(page, sketch, [first.ids[0], second.ids[0]]);
    return [await measureConstraintApplication(page, "equal", [first.ids[0], second.ids[0]])];
  });

  await run("circle + arc concentric", async (page, sketch) => {
    // Keep the shared center away from the origin/axes so this gate measures
    // the explicit concentric command rather than an inferred origin relation.
    const circle = await createShape(page, sketch, { name: "concentric circle", tool: "circle", variant: "center_diameter", points: [[.58, .58], [.69, .58]], expectedAdded: 1 });
    await leaveToolAndClearSelection(page, sketch);
    const arc = await createShape(page, sketch, { name: "concentric arc", tool: "arc", variant: "center_point", points: [[.58, .58], [.65, .58], [.58, .48]], expectedAdded: 1 });
    await selectGeometryIds(page, sketch, [circle.ids[0], arc.ids[0]]);
    return [await measureConstraintApplication(page, "concentric", [circle.ids[0], arc.ids[0]])];
  });

  await run("native point + spline point-on-object", async (page, sketch) => {
    const point = await createShape(page, sketch, { name: "constraint point", tool: "point", points: [[.50, .52]], expectedAdded: 1 });
    const spline = await createShape(page, sketch, { name: "constraint spline", tool: "spline", points: [[.34, .60], [.43, .38], [.57, .66], [.69, .45]], expectedAdded: 1 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const pointScreen = await screenPointForGeometry(sketch.overlay, point.ids[0]);
    await page.mouse.click(pointScreen.x, pointScreen.y);
    await sketch.overlay.locator(`[data-geometry="${point.ids[0]}"][data-anchor="position"]`).click({ force: true });
    const splineScreen = await screenPointForGeometry(sketch.overlay, spline.ids[0]);
    await clickScreenPoint(page, splineScreen, true);
    return [await measureConstraintApplication(page, "point-on-object", [point.ids[0], spline.ids[0]])];
  });

  const offsetShapes: readonly ShapeCase[] = [
    { name: "control spline", tool: "spline", points: [[.34, .60], [.43, .38], [.57, .66], [.69, .45]], expectedAdded: 1 },
    { name: "fit spline", tool: "fit-spline", points: [[.34, .60], [.43, .38], [.57, .66], [.69, .45]], expectedAdded: 1 },
    { name: "ellipse", tool: "ellipse", points: [[.50, .52], [.64, .52], [.50, .62]], expectedAdded: 1 },
    { name: "elliptical arc", tool: "elliptical-arc", points: [[.50, .52], [.64, .52], [.50, .62], [.64, .52], [.50, .62]], expectedAdded: 1 },
    { name: "conic", tool: "conic", points: [[.36, .62], [.50, .34], [.66, .62]], expectedAdded: 1 },
  ];
  for (const shape of offsetShapes) {
    await run(`${shape.name} + retained offset`, async (page, sketch) => {
      const source = await createShape(page, sketch, shape);
      await selectGeometryIds(page, sketch, [source.ids[0]]);
      await page.locator('[data-ribbon-flyout="edit-sketch"]').click();
      const previewSelector = "#sketch-overlay .sketch-operation-preview";
      await armProbe(page, { eventType: "pointerdown", selector: previewSelector, expectedSelectorCount: 1 });
      await page.locator('[data-ribbon-run="offset"]').click();
      const previewMs = await readProbe(page, 5_000);
      const operationCount = await page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.operations ?? {}).length);
      await armProbe(page, { label: `offset-commit:${source.ids[0]}`, eventType: "keydown", expectedOperationCount: operationCount + 1, expectedOperationKind: "offset", expectedOperandIds: [source.ids[0]] });
      await page.keyboard.press("Enter");
      return [previewMs, await readProbe(page, 10_000)];
    });
  }

  console.table(results.map((result) => ({
    combination: result.name,
    p50_ms: result.actionMs.p50,
    p95_ms: result.actionMs.p95,
    max_ms: result.actionMs.max,
    geometry: result.geometryCount,
    constraints: result.constraintCount,
    nodes: result.svgNodes,
    long_task_ms: result.longTaskMaxMs,
    violations: result.budgetViolations.join("; "),
  })));
  await persistArtifact(testInfo, "sketch-constraint-combinations", { budgets: BUDGETS, failures, results });
  expect.soft(failures, "every constraint and edit workflow must remain automatable within its watchdog").toEqual([]);
  expect.soft(results.flatMap((result) => result.budgetViolations.map((violation) => `${result.name}: ${violation}`)), "combination action budgets").toEqual([]);
});
