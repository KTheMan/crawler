import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

type ScaleTier = { name: string; cells: number };
type Summary = { samples: number[]; p50: number; p95: number; max: number };
type ScaleResult = {
  tier: string;
  cells: number;
  geometryCount: number;
  constraintCount: number;
  profileCount: number;
  solveComponentCount: number;
  solveState: string;
  totalMs: number;
  solverMs: number;
  workerRuntimeMs: number;
  bridgeOverheadMs: number;
  requestParseMs: number;
  applyBatchMs: number;
  ezpzSolveMs: number;
  profileBuildMs: number;
  documentHashMs: number;
  wasmBoundaryAndSerializeMs: number;
  responseParseMs: number;
  diagnosticsMs: number;
  overlayMs: number;
  inspectorMs: number;
  stablePaintMs: number;
  svgNodes: number;
  overlayMarkupBytes: number;
  inspectorNodes: number;
  inspectorMarkupBytes: number;
  renderedConstraintRows: number;
  hoverMs: Summary;
  selectionMs: Summary;
  constraintManagerOpenMs: number;
  longTaskMaxMs: number;
  longTaskTotalMs: number;
};

const SELECTED_CLASS = /(?:^|\s)selected(?:\s|$)/;
const PERFORMANCE_REPETITIONS = 20;

const DEFAULT_TIERS: readonly ScaleTier[] = [
  { name: "multiple-100", cells: 100 },
  { name: "large-500", cells: 500 },
  { name: "huge-1000", cells: 1_000 },
];

function selectedTiers(): readonly ScaleTier[] {
  const customCells = Number.parseInt(process.env.SKETCH_SCALE_CELLS ?? "", 10);
  if (Number.isInteger(customCells) && customCells > 0) return [{ name: `custom-${customCells}`, cells: customCells }];
  const filter = process.env.SKETCH_SCALE_TIER?.toLowerCase();
  const tiers = filter ? DEFAULT_TIERS.filter((tier) => tier.name === filter) : DEFAULT_TIERS;
  if (!tiers.length) throw new Error(`SKETCH_SCALE_TIER=${filter} matched no scale tier`);
  return tiers;
}

function summary(values: readonly number[]): Summary {
  const samples = values.map((value) => Number(value.toFixed(2))).sort((a, b) => a - b);
  const percentile = (fraction: number) => samples[Math.max(0, Math.ceil(samples.length * fraction) - 1)] ?? 0;
  return { samples, p50: percentile(.5), p95: percentile(.95), max: samples.at(-1) ?? 0 };
}

async function openSketch(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await expect(page.getByLabel("Editable sketch geometry")).toBeVisible();
}

async function loadConstrainedGrid(page: Page, cells: number) {
  return page.evaluate(async (cellCount) => {
    const state = window as typeof window & { __sketchScaleLongTasks?: { startTime: number; duration: number }[] };
    state.__sketchScaleLongTasks = [];
    const columns = Math.ceil(Math.sqrt(cellCount));
    const rows = Math.ceil(cellCount / columns);
    const spacing = 2_500_000;
    const size = 1_500_000;
    const commands: import("../src/sketch-editor").SketchCommand[] = [];
    for (let cell = 0; cell < cellCount; cell += 1) {
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      const x = Math.round((column - (columns - 1) / 2) * spacing);
      const y = Math.round((row - (rows - 1) / 2) * spacing);
      const points = [
        { x_nm: x, y_nm: y },
        { x_nm: x + size, y_nm: y },
        { x_nm: x + size, y_nm: y + size },
        { x_nm: x, y_nm: y + size },
      ];
      const ids = points.map((_, edge) => `scale:${cell}:line:${edge}`);
      ids.forEach((id, edge) => {
        commands.push({ kind: "add_geometry", entity: { id, geometry: { kind: "line", start: points[edge], end: points[(edge + 1) % points.length] } } });
      });
      ids.forEach((id, edge) => {
        commands.push({ kind: "add_constraint", id: `scale:${cell}:axis:${edge}`, constraint: { kind: edge % 2 ? "vertical" : "horizontal", line: id } });
        commands.push({ kind: "add_constraint", id: `scale:${cell}:join:${edge}`, constraint: {
          kind: "coincident",
          a: { geometry: id, anchor: "end" },
          b: { geometry: ids[(edge + 1) % ids.length], anchor: "start" },
        } });
      });
      commands.push({ kind: "add_constraint", id: `scale:${cell}:width`, constraint: {
        kind: "distance",
        a: { geometry: ids[0], anchor: "start" },
        b: { geometry: ids[0], anchor: "end" },
        distance_nm: size,
      } });
      commands.push({ kind: "add_constraint", id: `scale:${cell}:height`, constraint: {
        kind: "distance",
        a: { geometry: ids[1], anchor: "start" },
        b: { geometry: ids[1], anchor: "end" },
        distance_nm: size,
      } });
    }
    const phases = await window.__crawlerApp.applySketchCommands(commands);
    const targetCell = Math.min(cellCount - 1, Math.floor(rows / 2) * columns + Math.floor(columns / 2));
    return { ...phases, targetId: `scale:${targetCell}:line:0` };
  }, cells);
}

async function entityMidpoint(entity: Locator): Promise<{ x: number; y: number }> {
  return entity.evaluate((element) => {
    if (!(element instanceof SVGLineElement)) throw new Error(`Expected an SVG line, received ${element.tagName}`);
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error("Sketch line has no screen transform");
    const local = new DOMPoint(
      element.x1.baseVal.value * .7 + element.x2.baseVal.value * .3,
      element.y1.baseVal.value * .7 + element.y2.baseVal.value * .3,
    );
    const screen = local.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
}

async function measureHover(page: Page, overlay: Locator, entity: Locator, hit: Locator, point: { x: number; y: number }, repetitions = PERFORMANCE_REPETITIONS): Promise<Summary> {
  const values: number[] = [];
  const geometryId = await entity.getAttribute("data-sketch-geometry");
  if (!geometryId) throw new Error("Scale target has no geometry identity");
  for (let index = 0; index < repetitions; index += 1) {
    await overlay.evaluate(async (element, args) => {
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse", clientX: args.x, clientY: 4 }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, { x: 4 + index });
    values.push(await hit.evaluate(async (element, args) => {
      const target = document.querySelector<SVGElement>(`[data-sketch-geometry="${CSS.escape(args.geometryId)}"]`);
      if (!target) throw new Error(`Missing scale geometry ${args.geometryId}`);
      const startedAt = performance.now();
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse", clientX: args.point.x, clientY: args.point.y }));
      for (let frame = 0; frame < 120 && !target.classList.contains("preselected"); frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!target.classList.contains("preselected")) throw new Error("Hover state did not publish");
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - startedAt;
    }, { geometryId, point }));
  }
  return summary(values);
}

async function measureSelection(page: Page, entity: Locator, hit: Locator, point: { x: number; y: number }, repetitions = PERFORMANCE_REPETITIONS): Promise<Summary> {
  const values: number[] = [];
  const geometryId = await entity.getAttribute("data-sketch-geometry");
  if (!geometryId) throw new Error("Scale target has no geometry identity");
  for (let index = 0; index < repetitions; index += 1) {
    if (await entity.evaluate((element) => element.classList.contains("selected"))) {
      await page.keyboard.press("Escape");
      await expect(entity).not.toHaveClass(SELECTED_CLASS);
    }
    values.push(await hit.evaluate(async (element, args) => {
      const target = document.querySelector<SVGElement>(`[data-sketch-geometry="${CSS.escape(args.geometryId)}"]`);
      if (!target) throw new Error(`Missing scale geometry ${args.geometryId}`);
      const startedAt = performance.now();
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: args.point.x, clientY: args.point.y }));
      for (let frame = 0; frame < 120 && !target.classList.contains("selected"); frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!target.classList.contains("selected")) throw new Error("Selection state did not publish");
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - startedAt;
    }, { geometryId, point }));
  }
  return summary(values);
}

async function persist(testInfo: TestInfo, result: ScaleResult): Promise<void> {
  const body = JSON.stringify({ runId: process.env.SKETCH_PERF_RUN_ID ?? "unmanaged", result }, null, 2);
  await testInfo.attach(`sketch-workspace-scale-${result.tier}.json`, { body: Buffer.from(body), contentType: "application/json" });
  const directory = process.env.SKETCH_PERF_ARTIFACT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `sketch-workspace-scale-${result.tier}.json`), body, "utf8");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __sketchScaleLongTasks?: { startTime: number; duration: number }[] };
    state.__sketchScaleLongTasks = [];
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => state.__sketchScaleLongTasks!.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ entryTypes: ["longtask"] });
    }
  });
});

for (const tier of selectedTiers()) {
  test(`${tier.name}: full constrained workspace remains measurable`, async ({ page }, testInfo) => {
    await openSketch(page);
    const phases = await loadConstrainedGrid(page, tier.cells);
    console.log("sketch scale load phases", phases);
    const overlay = page.getByLabel("Editable sketch geometry");
    const entity = overlay.locator(`[data-sketch-geometry="${phases.targetId}"]`).first();
    const hit = overlay.locator(`[data-sketch-hit-geometry="${phases.targetId}"]`).first();
    await expect(entity).toHaveCount(1);
    await expect(hit).toHaveCount(1);
    await page.locator("#sketch-select-tool").click();
    const point = await entityMidpoint(entity);
    const hoverMs = await measureHover(page, overlay, entity, hit, point);
    const selectionMs = await measureSelection(page, entity, hit, point);
    await page.keyboard.press("Escape");

    const manager = page.locator(".sketch-constraint-manager");
    const constraintManagerOpenMs = await manager.evaluate(async (element) => {
      const startedAt = performance.now();
      element.querySelector<HTMLElement>("summary")!.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - startedAt;
    });
    await expect(manager).toHaveAttribute("open", "");

    const dom = await page.evaluate(() => {
      const overlay = document.querySelector<SVGElement>("#sketch-overlay")!;
      const inspector = document.querySelector<HTMLElement>("#inspector")!;
      const longTasks = (window as typeof window & { __sketchScaleLongTasks?: { duration: number }[] }).__sketchScaleLongTasks ?? [];
      return {
        svgNodes: overlay.querySelectorAll("*").length,
        overlayMarkupBytes: new TextEncoder().encode(overlay.innerHTML).length,
        inspectorNodes: inspector.querySelectorAll("*").length,
        inspectorMarkupBytes: new TextEncoder().encode(inspector.innerHTML).length,
        renderedConstraintRows: inspector.querySelectorAll("[data-constraint-row]").length,
        longTaskMaxMs: Math.max(0, ...longTasks.map(({ duration }) => duration)),
        longTaskTotalMs: longTasks.reduce((sum, { duration }) => sum + duration, 0),
      };
    });
    const result: ScaleResult = { tier: tier.name, cells: tier.cells, ...phases, ...dom, hoverMs, selectionMs, constraintManagerOpenMs };
    console.table([{
      tier: result.tier,
      geometry: result.geometryCount,
      constraints: result.constraintCount,
      profiles: result.profileCount,
      total_ms: result.totalMs.toFixed(1),
      solver_ms: result.solverMs.toFixed(1),
      worker_runtime_ms: result.workerRuntimeMs.toFixed(1),
      bridge_overhead_ms: result.bridgeOverheadMs.toFixed(1),
      request_parse_ms: result.requestParseMs.toFixed(1),
      apply_batch_ms: result.applyBatchMs.toFixed(1),
      ezpz_solve_ms: result.ezpzSolveMs.toFixed(1),
      profile_build_ms: result.profileBuildMs.toFixed(1),
      wasm_boundary_serialize_ms: result.wasmBoundaryAndSerializeMs.toFixed(1),
      response_parse_ms: result.responseParseMs.toFixed(1),
      diagnostics_ms: result.diagnosticsMs.toFixed(1),
      overlay_ms: result.overlayMs.toFixed(1),
      inspector_ms: result.inspectorMs.toFixed(1),
      paint_ms: result.stablePaintMs.toFixed(1),
      svg_nodes: result.svgNodes,
      inspector_nodes: result.inspectorNodes,
      manager_rows: result.renderedConstraintRows,
      hover_p95_ms: result.hoverMs.p95,
      selection_p95_ms: result.selectionMs.p95,
      manager_open_ms: result.constraintManagerOpenMs.toFixed(1),
      long_task_max_ms: result.longTaskMaxMs.toFixed(1),
    }]);
    await persist(testInfo, result);

    const lastConstraintId = `scale:${tier.cells - 1}:height`;
    await manager.locator("[data-constraint-search]").fill(lastConstraintId);
    await expect(manager.locator(`[data-manage-constraint="${lastConstraintId}"]`)).toHaveCount(1);
    await expect(manager.locator("[data-constraint-row]")).toHaveCount(1);

    expect(result.geometryCount).toBe(tier.cells * 4);
    expect(result.constraintCount).toBe(tier.cells * 10);
    expect(result.profileCount).toBe(tier.cells);
    expect(result.solveComponentCount).toBe(tier.cells);
    expect(["conflicting", "over_constrained"], "scale fixtures must never benchmark an invalid solve").not.toContain(result.solveState);
    // Preserve the backend/profile optimization target with enough headroom for
    // browser and CI variance. The 1,000-cell ceiling is 25% below the prior
    // 1,593ms qualified baseline.
    expect(result.totalMs).toBeLessThan(Math.max(350, tier.cells * 1.2));
    expect(result.solverMs).toBeLessThan(Math.max(200, tier.cells * .5));
    expect(result.workerRuntimeMs).toBeLessThan(Math.max(180, tier.cells * .4));
    expect(result.profileBuildMs).toBeLessThan(Math.max(15, tier.cells * .02));
    expect(result.overlayMs).toBeLessThan(Math.max(250, tier.cells * .8));
    expect(result.longTaskMaxMs).toBeLessThan(900);
    expect(result.hoverMs.p95).toBeLessThan(250);
    expect(result.selectionMs.p95).toBeLessThan(250);
    expect(result.constraintManagerOpenMs).toBeLessThan(250);
    expect(result.renderedConstraintRows).toBeLessThanOrEqual(14);
  });
}
