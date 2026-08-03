import "./style.css";

import { adapterFromWorkerSnapshot, DocumentAdapter, loadDocumentAdapter } from "./document-adapter";
import type { AdvancedFeatureCommand, AdvancedFeatureOperationId, ExportFormat, FeatureServicesView, NamedParameterView, RepairInspectionView, Selection, TopologyKind, TopologyReferenceView, WorkerResponse } from "./protocol";
import { WorkspaceRenderer } from "./renderer";
import { initialState } from "./state";
import { AppStorage, type RecoveryChoice } from "./storage";
import { installOnboarding } from "./onboarding";
import { PerformanceEvidence } from "./performance-evidence";
import { installPwa, type PwaStatus } from "./pwa";
import { CONSTRAINT_SCHEMA, SKETCH_TOOL_SCHEMA, SketchEditSession, hydrateSketchFromDocument, rectangleCommands, toolCommands, type Point2, type PointRef, type SketchCommand, type SketchSupport, type SketchTool } from "./sketch-editor";
import { WorkerSketchBridge } from "./sketch-worker-bridge";
import {
  alphaOperations,
  displayDefault,
  lifecycleLabel,
  operationById,
  operationForFeatureType,
  parameterByKey,
  selectionCountLabel,
  valueKindLabel,
  type AlphaOperation,
  type OperationParameter,
} from "./operation-catalog";

const rectangleOperation = operationById("crawler.sketch.rectangle");
const extrudeOperation = operationById("crawler.part.extrude");

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("application host is missing");

root.innerHTML = `
  <main class="shell" data-testid="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">C</span><div><strong>Crawler</strong><small>Part Design Alpha</small></div></div>
      <div class="readiness" aria-label="runtime readiness">
        ${["ui", "wasm", "worker", "renderer"].map((stage) => `<span class="ready-pill" data-stage="${stage}"><i></i>${stage}<b>idle</b></span>`).join("")}
      </div>
      <button id="retry-runtime" class="quiet" type="button">Retry runtime</button>
      <button id="new-part" class="quiet" type="button">New</button><button id="open-part" class="quiet" type="button">Open</button><input id="open-part-file" type="file" accept=".crawlerpart,application/vnd.crawler.part+zip" hidden />
      <button id="save-part" class="quiet" type="button">Save</button><button id="save-as-part" class="quiet" type="button">Save As</button><button id="restart-tour" class="quiet" type="button">Tour</button><span id="storage-status">local</span>
      <button id="import-step" class="quiet" type="button">Import STEP</button><input id="import-step-file" type="file" accept=".step,.stp,model/step" hidden /><button id="cancel-step-import" class="quiet" type="button" disabled>Cancel import</button><button id="reimport-step" class="quiet" type="button" disabled>Re-import STEP</button><output id="import-status" role="status" aria-live="polite">no import</output>
      <span id="update-status" hidden>Update ready for next launch</span>
    </header>
    <section class="commandbar" aria-label="modeling and view commands">
      <button id="start-rectangle" type="button">${rectangleOperation.label}</button>
      <button id="edit-sketch" type="button">Edit Sketch</button>
      <label class="dimension-control">${parameterByKey(rectangleOperation, "width").label} <input id="part-width" type="number" min="0.001" step="0.001" value="40" /> mm</label>
      <label class="dimension-control">${parameterByKey(rectangleOperation, "height").label} <input id="part-height" type="number" min="0.001" step="0.001" value="28" /> mm</label>
      <button id="start-pad" type="button">${extrudeOperation.label}</button>
      <label class="dimension-control">${parameterByKey(extrudeOperation, "distance").label} <input id="pad-length" type="number" min="0.001" step="0.001" value="20" /> mm</label>
      <button id="undo" class="quiet" type="button">Undo</button><button id="redo" class="quiet" type="button">Redo</button>
      <span class="divider"></span>
      ${["front", "top", "right", "isometric"].map((view) => `<button class="quiet view-command" data-view="${view}" type="button">${view}</button>`).join("")}
      <button id="fit-view" class="quiet" type="button">Fit</button>
      <button id="projection-mode" class="quiet" type="button" aria-pressed="false">Perspective</button>
      <span class="divider"></span>
      ${["browser", "inspector", "timeline"].map((panel) => `<button class="quiet panel-command" data-panel-toggle="${panel}" type="button">${panel}</button>`).join("")}
      <span class="divider"></span>
      ${["step", "stl", "obj"].map((format) => `<button class="quiet export-command" data-export="${format}" type="button">${format.toUpperCase()}</button>`).join("")}
      <span class="operation-state" id="operation-state" role="status">Operation: idle</span>
    </section>
    <section class="workspace">
      <aside class="browser-panel panel" data-testid="browser-region">
        <div class="panel-title"><span>Model</span><small id="document-name">loading</small></div>
        <nav id="feature-browser" aria-label="feature browser"></nav>
      </aside>
      <section class="viewport-region" data-testid="viewport-region">
        <canvas id="viewport" aria-label="3D viewport"></canvas>
        <button id="extrude-manipulator" class="extrude-manipulator" type="button" role="slider" aria-label="Extrude distance" aria-valuemin="0.001" aria-valuenow="12" hidden>
          <span aria-hidden="true">↕</span><output>12 mm</output><small>drag · Enter accept · Esc cancel</small>
        </button>
        <svg id="sketch-overlay" aria-label="Editable sketch geometry" hidden></svg>
        <section id="sketch-toolbar" class="sketch-toolbar" aria-label="Sketch tools" hidden>
          <header><strong>Sketch plane edit</strong><select id="sketch-plane" aria-label="Sketch plane"><option value="xy">XY origin plane</option><option value="xz">XZ origin plane</option><option value="yz">YZ origin plane</option><option value="face">Selected planar face</option></select></header>
          <div class="sketch-tool-row">${SKETCH_TOOL_SCHEMA.map((tool) => `<button type="button" data-sketch-tool="${tool.id}" aria-pressed="${tool.id === "line"}">${tool.label}</button>`).join("")}</div>
          <details><summary>Constraints</summary><div class="sketch-tool-row">${CONSTRAINT_SCHEMA.map((constraint) => `<button type="button" data-sketch-constraint="${constraint}">${constraint}</button>`).join("")}</div></details>
          <output id="sketch-solver-state">Under-constrained · click the plane to draw</output>
          <output id="sketch-profile-state">Profile: empty</output>
          <footer><button id="commit-sketch" type="button">Finish sketch (Enter)</button><button id="cancel-sketch" type="button">Cancel (Escape)</button></footer>
        </section>
        <div class="viewport-tools" aria-label="selection filters">
          ${["body", "face", "edge", "vertex"].map((kind) => `<label><input data-filter="${kind}" type="checkbox" checked />${kind}</label>`).join("")}
        </div>
        <output id="preselection-readout">Hover: none</output>
        <output id="selection-readout">Selection: none</output>
      </section>
      <aside class="inspector-panel panel" data-testid="inspector-region">
        <div class="panel-title"><span>Inspector</span><small>schema</small></div>
        <div id="inspector"></div>
      </aside>
      <section class="timeline-panel panel" data-testid="timeline-region">
        <div class="panel-title"><span>Feature timeline</span><small id="timeline-status" role="status">Solver: ready</small></div>
        <div id="timeline"></div>
      </section>
    </section>
    <section id="onboarding" aria-label="Quick tour"></section>
    <section id="safe-mode" role="alert" hidden><strong>Editing paused</strong><span id="safe-reason"></span><span id="recovery-provenance"></span><button id="recover-runtime" type="button">Retry accepted source</button><button id="stay-safe" class="quiet" type="button">Keep read-only</button></section>
    <div id="command-search" role="dialog" aria-modal="true" aria-label="Command search" hidden><label>Command <input id="command-query" autocomplete="off" /></label><div id="command-results" role="listbox"></div></div>
    <aside id="diagnostics" aria-live="polite"></aside>
  </main>`;

const state = initialState();
let adapter: DocumentAdapter;
let worker: Worker | undefined;
let renderer: WorkspaceRenderer | undefined;
let transferredBytes = 0;
let startupFailurePending = new URLSearchParams(location.search).has("failWorker");
let storage: AppStorage | undefined;
let acceptedPersistence: Promise<void> = Promise.resolve();
let acceptedPersistenceRevision = 0;
let importedSourcePersistence: Promise<void> = Promise.resolve();
type PortableWritable = { write(data: BlobPart): Promise<void>; close(): Promise<void> };
type PortableFileHandle = { name: string; getFile(): Promise<File>; createWritable(): Promise<PortableWritable> };
type PortablePickerWindow = Window & typeof globalThis & {
  showOpenFilePicker?: (options: { types: { description: string; accept: Record<string, string[]> }[]; multiple: false }) => Promise<PortableFileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<PortableFileHandle>;
};
let portableFileHandle: PortableFileHandle | undefined;
let pendingPortableSaveHandle: PortableFileHandle | undefined;
let runtimeHydrated = false;
let documentReady = false;
let currentDimensions = { widthNanometers: 0, heightNanometers: 0, distanceNanometers: 0 };
let currentBounds: number[] = [];
let lastPacketSemanticHash: string | undefined;
let acceptedBodyId = "";
let acceptedExtrudeDistanceNanometers = 0;
let extrudePreviewRequest = 0;
let latestExtrudePreviewRequest = 0;
const extrudePreviewStarted = new Map<number, number>();
let lastRecompute = { dirtyRoots: [] as string[], evaluationOrder: [] as string[] };
let safeMode = false;
let faultCount = 0;
let recoveryProvenance = "Canonical seed";
let recoveryChoices: readonly RecoveryChoice[] = [];
let sessionRecoveryDocument: unknown;
let selectedCatalogOperationId: string | null = null;
let editingAdvancedFeatureId: string | null = null;
let activeAdvancedOperationLabel = "Advanced feature";
let activeParameterLabel = "Parameter";
let currentParameters: readonly NamedParameterView[] = [];
const currentParameterErrors = new Map<string, string>();
let lastExplicitSaveChecksum: string | undefined;
const persistedSemanticHashes = new Set<string>();
let pendingOperationCompletion: { type: "advanced" | "parameter" | "step-import"; semanticHash: string } | undefined;
let featureServices: FeatureServicesView | undefined;
let repairInspection: RepairInspectionView | undefined;
let repairObservedTopology: readonly TopologyReferenceView[] = [];
let historyActionMessage = "";
let sketchBridge: WorkerSketchBridge | undefined;
let sketchSession: SketchEditSession | undefined;
let sketchPoints: Point2[] = [];
let sketchConstruction = false;
let activeSketchOperationLabel = "Sketch";
let sketchReturnFocus: HTMLElement | null = null;
let sketchDrag: { pointerId: number; point: PointRef; handle: SVGCircleElement } | undefined;
let stepImportRunning = false;
let stepSourceRetained = false;
const performanceEvidence = new PerformanceEvidence();
let pwaStatus = (): PwaStatus => ({ supported: false, controlled: false, updateAvailable: false, cacheVersion: "crawler-alpha-v2" });

function requestFeatureServices(observedTopology?: readonly TopologyReferenceView[]): void {
  if (!worker || !state.selectedFeatureId.startsWith("feature:")) return;
  worker.postMessage({ type: "feature-services", feature: state.selectedFeatureId, ...(observedTopology ? { observedTopology } : {}) });
}

function updateStepImportControls(): void {
  document.querySelector<HTMLButtonElement>("#import-step")!.disabled = safeMode || stepImportRunning;
  document.querySelector<HTMLButtonElement>("#cancel-step-import")!.disabled = safeMode || !stepImportRunning;
  document.querySelector<HTMLButtonElement>("#reimport-step")!.disabled = safeMode || stepImportRunning || !stepSourceRetained;
}

function setReadiness(stage: keyof typeof state.readiness, value: typeof state.readiness.ui, diagnostic?: string): void {
  state.readiness[stage] = value;
  if (stage !== "ui") {
    if (diagnostic) state.diagnostics[stage] = diagnostic;
    else delete state.diagnostics[stage];
  }
  const pill = document.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
  pill?.setAttribute("data-status", value);
  const text = pill?.querySelector("b"); if (text) text.textContent = value;
  if (value === "ready") performanceEvidence.mark(stage);
  if (stage === "renderer" && value === "ready") {
    performanceEvidence.mark("load");
    performanceEvidence.beginReferenceWorkflow();
  }
  renderDiagnostics();
}

function setSafeMode(value: boolean, reason = ""): void {
  safeMode = value;
  const panel = document.querySelector<HTMLElement>("#safe-mode")!;
  panel.hidden = !value;
  document.querySelector("#safe-reason")!.textContent = reason || "The accepted source remains preserved.";
  document.querySelector("#recovery-provenance")!.textContent = `Recovery source: ${recoveryProvenance}. Attempts: ${faultCount}.`;
  for (const selector of ["#start-rectangle", "#edit-sketch", "#part-width", "#part-height", "#start-pad", "#pad-length", "#undo", "#redo", "#import-step", "#cancel-step-import", "#reimport-step"]) document.querySelector<HTMLButtonElement | HTMLInputElement>(selector)!.disabled = value;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-parameter-name], [data-parameter-expression], [data-rename-parameter], [data-apply-parameter], [data-reuse-parameter], [data-promote-parameter]").forEach((control) => { control.disabled = value; });
  document.querySelector(".shell")!.classList.toggle("safe", value);
  updateStepImportControls();
}

function handleRuntimeFault(message: string): void {
  faultCount += 1;
  setReadiness("worker", "error", message); setReadiness("wasm", "error", message);
  setSafeMode(true, `Runtime fault: ${message}`);
  setOperation("cancelled");
}

function storageFailure(error: unknown): void {
  const quota = error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
  document.querySelector("#storage-status")!.textContent = quota ? "Storage full — export a copy, free browser space, then Save again" : `storage error: ${error instanceof Error ? error.message : String(error)}`;
}

function renderDiagnostics(): void {
  const host = document.querySelector<HTMLElement>("#diagnostics")!;
  const rows = Object.entries(state.diagnostics);
  host.innerHTML = rows.length ? rows.map(([stage, detail]) => `<div><strong>${stage}</strong>${detail}</div>`).join("") : "";
  host.toggleAttribute("data-visible", rows.length > 0);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

interface ParameterDocumentView {
  features?: Record<string, { parameters?: Record<string, string> }>;
}

interface ParameterBindingView {
  feature: string;
  field: string;
  parameter: string;
}

function parameterBindings(): ParameterBindingView[] {
  const durable = adapter.durableDocument() as ParameterDocumentView;
  return Object.entries(durable.features ?? {}).flatMap(([feature, record]) =>
    Object.entries(record.parameters ?? {}).map(([field, parameter]) => ({ feature, field, parameter })),
  );
}

function bindingForParameter(parameterId: string, preferredFeatureId: string): ParameterBindingView | undefined {
  const bindings = parameterBindings().filter((binding) => binding.parameter === parameterId);
  return bindings.find((binding) => binding.feature === preferredFeatureId) ?? bindings[0];
}

function exactParameterDisplay(parameter: NamedParameterView): string {
  const value = parameter.evaluated_value.value;
  if (typeof value !== "number") return String(value);
  if (parameter.evaluated_value.kind === "length_nanometers") return `${value / 1_000_000} mm`;
  if (parameter.evaluated_value.kind === "angle_microdegrees") return `${value / 1_000_000} deg`;
  if (parameter.evaluated_value.kind === "scalar_millionths") return String(value / 1_000_000);
  if (parameter.evaluated_value.kind === "tolerance_nanometers") return `${value / 1_000_000} mm tolerance`;
  return String(value);
}

function renderParameterPanel(featureId: string): string {
  if (!currentParameters.length) return `<section class="parameter-panel" aria-label="Named parameters"><h3>Named parameters</h3><p>Loading exact parameters…</p></section>`;
  const rows = currentParameters.map((parameter) => {
    const binding = bindingForParameter(parameter.id, featureId);
    const field = binding?.field ?? parameter.id;
    const parameterError = currentParameterErrors.get(field) ?? "";
    const editable = Boolean(binding) && !["boolean", "text"].includes(parameter.kind);
    return `<article class="parameter-row" data-parameter-id="${escapeHtml(parameter.id)}">
      <header><strong>${escapeHtml(parameter.name)}</strong><code>${escapeHtml(parameter.id)}</code></header>
      <label>Name <input data-parameter-name="${escapeHtml(parameter.id)}" value="${escapeHtml(parameter.name)}" data-accepted-value="${escapeHtml(parameter.name)}" aria-label="Name for ${escapeHtml(parameter.name)}" /></label>
      <button type="button" data-rename-parameter="${escapeHtml(parameter.id)}">Rename</button>
      <label class="parameter-expression-label">Expression <input data-parameter-expression="${escapeHtml(parameter.id)}" data-feature="${escapeHtml(binding?.feature ?? "")}" data-field="${escapeHtml(field)}" value="${escapeHtml(parameter.source)}" data-accepted-value="${escapeHtml(parameter.source)}" aria-describedby="parameter-error-${escapeHtml(parameter.id)}" ${parameterError ? 'aria-invalid="true"' : ""} ${editable ? "" : "disabled"} /></label>
      <button type="button" data-apply-parameter="${escapeHtml(parameter.id)}" ${editable ? "" : "disabled"}>Apply</button>
      <output class="parameter-evaluated" aria-label="Evaluated value">${escapeHtml(exactParameterDisplay(parameter))}</output>
      <small class="parameter-display-expression">${escapeHtml(parameter.display_expression)}</small>
      <p id="parameter-error-${escapeHtml(parameter.id)}" class="parameter-error" data-parameter-error="${escapeHtml(field)}" role="status" ${parameterError ? "" : "hidden"}>${escapeHtml(parameterError)}</p>
    </article>`;
  }).join("");
  return `<section class="parameter-panel" aria-label="Named parameters"><h3>Named parameters</h3><p class="parameter-help">Unit-bearing expressions resolve names to stable IDs. Enter applies; Escape restores the accepted source.</p>${rows}</section>`;
}

function renderFeatureParameterBindings(featureId: string): string {
  const bindings = parameterBindings().filter((binding) => binding.feature === featureId);
  if (!bindings.length) return "";
  const byId = new Map(currentParameters.map((parameter) => [parameter.id, parameter]));
  return `<section class="parameter-bindings" aria-label="Feature parameter bindings"><h3>Promote or reuse</h3>${bindings.map((binding) => {
    const current = byId.get(binding.parameter);
    if (!current) return "";
    const options = currentParameters.filter((parameter) => parameter.kind === current.kind).map((parameter) => `<option value="${escapeHtml(parameter.id)}" ${parameter.id === current.id ? "selected" : ""}>${escapeHtml(parameter.name)} · ${escapeHtml(parameter.id)}</option>`).join("");
    return `<div class="parameter-binding" data-binding-field="${escapeHtml(binding.field)}"><label>${escapeHtml(binding.field)} <select data-reuse-parameter data-feature="${escapeHtml(binding.feature)}" data-field="${escapeHtml(binding.field)}" data-current-parameter="${escapeHtml(binding.parameter)}">${options}</select></label><button type="button" data-promote-parameter>Promote / reuse</button></div>`;
  }).join("")}</section>`;
}

function beginParameterOperation(label: string): void {
  activeParameterLabel = label;
  setOperation("preview", "parameter");
}

function installParameterControls(): void {
  document.querySelectorAll<HTMLInputElement>("[data-parameter-name]").forEach((input) => {
    const button = document.querySelector<HTMLButtonElement>(`[data-rename-parameter="${CSS.escape(input.dataset.parameterName!)}"]`)!;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); button.click(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); input.value = input.dataset.acceptedValue ?? ""; button.focus(); }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rename-parameter]").forEach((button) => button.addEventListener("click", () => {
    const parameter = currentParameters.find((candidate) => candidate.id === button.dataset.renameParameter);
    const input = document.querySelector<HTMLInputElement>(`[data-parameter-name="${CSS.escape(button.dataset.renameParameter!)}"]`)!;
    if (!parameter || !input.value.trim()) return;
    beginParameterOperation(`Rename ${parameter.name}`);
    worker?.postMessage({ type: "rename-parameter", parameter: parameter.id, displayName: input.value.trim() });
  }));
  document.querySelectorAll<HTMLInputElement>("[data-parameter-expression]").forEach((input) => {
    const button = document.querySelector<HTMLButtonElement>(`[data-apply-parameter="${CSS.escape(input.dataset.parameterExpression!)}"]`)!;
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      currentParameterErrors.delete(input.dataset.field!);
      const error = document.querySelector<HTMLElement>(`[data-parameter-error="${CSS.escape(input.dataset.field!)}"]`)!;
      error.textContent = "";
      error.hidden = true;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); button.click(); }
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); input.value = input.dataset.acceptedValue ?? ""; input.removeAttribute("aria-invalid");
        currentParameterErrors.delete(input.dataset.field!);
        const error = document.querySelector<HTMLElement>(`[data-parameter-error="${CSS.escape(input.dataset.field!)}"]`)!;
        error.textContent = ""; error.hidden = true; button.focus();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-apply-parameter]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>(`[data-parameter-expression="${CSS.escape(button.dataset.applyParameter!)}"]`)!;
    if (!input.dataset.feature) return;
    beginParameterOperation(`Edit ${input.dataset.field}`);
    worker?.postMessage({ type: "set-parameter-expression", feature: input.dataset.feature, field: input.dataset.field, source: input.value });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-promote-parameter]").forEach((button) => button.addEventListener("click", () => {
    const select = button.parentElement!.querySelector<HTMLSelectElement>("[data-reuse-parameter]")!;
    const target = currentParameters.find((parameter) => parameter.id === select.value);
    if (!target) return;
    beginParameterOperation(`${select.dataset.field} parameter`);
    if (select.value === select.dataset.currentParameter) {
      worker?.postMessage({ type: "promote-parameter", feature: select.dataset.feature, field: select.dataset.field, parameter: target.id, displayName: target.name });
    } else {
      worker?.postMessage({ type: "set-parameter-expression", feature: select.dataset.feature, field: select.dataset.field, source: target.name });
    }
  }));
}

function renderBodyContext(bodyId = adapter.activeBody()?.id ?? ""): { id: string; visible: boolean; selectable: boolean } {
  const body = adapter.findBody(bodyId);
  if (!body) return { id: bodyId, visible: false, selectable: false };
  return {
    id: body.id,
    visible: body.visibility === "visible" && body.status !== "suppressed",
    selectable: adapter.selectionAllowed(body.id),
  };
}

function renderBrowser(): void {
  const snapshot = adapter.getSnapshot();
  const browser = document.querySelector<HTMLElement>("#feature-browser")!;
  const componentById = new Map(snapshot.components.map((component) => [component.id, component]));
  const featureById = new Map(snapshot.features.map((feature) => [feature.id, feature]));
  const featureRow = (featureId: string, index: number) => {
    const feature = featureById.get(featureId);
    if (!feature) return "";
    return `<li role="treeitem"><button type="button" class="tree-row feature-row ${feature.id === state.selectedFeatureId ? "selected" : ""}" data-tree-row data-feature-id="${escapeHtml(feature.id)}" data-entity-kind="feature" data-entity-id="${escapeHtml(feature.id)}"><i>${index + 1}</i><span>${escapeHtml(feature.name)}</span><small>${feature.type} · ${feature.status}</small></button></li>`;
  };
  const group = (label: string, kind: string, rows: string) => rows ? `<li role="treeitem" aria-expanded="true" class="tree-group" data-tree-group="${kind}"><span class="tree-group-label">${label}</span><ul role="group">${rows}</ul></li>` : "";
  const renderComponent = (componentId: string): string => {
    const component = componentById.get(componentId);
    if (!component) return "";
    const planes = component.originPlanes.map((plane) => `<li role="treeitem"><button type="button" class="tree-row plane-row ${state.selectedFeatureId === "origin" ? "selected" : ""}" data-tree-row data-origin-plane-id="${escapeHtml(plane.id)}" data-entity-kind="origin-plane" data-entity-id="${escapeHtml(plane.id)}"><i>◇</i><span>${escapeHtml(plane.name)}</span><small>construction</small></button></li>`).join("");
    const bodies = component.bodies.map((body) => {
      const selected = state.selection?.kind === "body" && state.selection.stableId === body.id;
      const visible = body.visibility === "visible";
      return `<li role="treeitem" class="body-tree-item"><button type="button" class="tree-row body-row ${selected ? "selected" : ""}" data-tree-row data-body-id="${escapeHtml(body.id)}" data-entity-kind="body" data-entity-id="${escapeHtml(body.id)}" ${adapter.selectionAllowed(body.id) ? "" : "aria-disabled=\"true\""}><i>⬡</i><span>${escapeHtml(body.name)}</span><small>${body.status}</small></button><button type="button" class="visibility-toggle" data-body-visibility="${escapeHtml(body.id)}" aria-pressed="${visible}" aria-label="${visible ? "Hide" : "Show"} ${escapeHtml(body.name)}" title="${visible ? "Hide" : "Show"} body">${visible ? "Visible" : "Hidden"}</button></li>`;
    }).join("");
    const sketches = component.sketches.map((sketch) => `<li role="treeitem"><button type="button" class="tree-row sketch-row ${sketch.featureId === state.selectedFeatureId ? "selected" : ""}" data-tree-row data-sketch-id="${escapeHtml(sketch.id)}" data-sketch-feature-id="${escapeHtml(sketch.featureId ?? "")}" data-entity-kind="sketch" data-entity-id="${escapeHtml(sketch.id)}"><i>⌑</i><span>${escapeHtml(sketch.name)}</span><small>${escapeHtml(sketch.support)}</small></button></li>`).join("");
    const features = component.featureIds.map(featureRow).join("");
    const children = component.childComponentIds.map(renderComponent).join("");
    return `<li role="treeitem" aria-expanded="true" class="tree-component" data-component-id="${escapeHtml(component.id)}"><button type="button" class="tree-row component-row" data-tree-row data-entity-kind="component" data-entity-id="${escapeHtml(component.id)}"><i>▾</i><span>${escapeHtml(component.name)}</span><small>component</small></button><ul role="group">${group("Origin & construction", "origin-planes", planes)}${group("Bodies", "bodies", bodies)}${group("Sketches", "sketches", sketches)}${group("Features", "features", features)}${children}</ul></li>`;
  };
  const roots = snapshot.components.filter((component) => !component.parentId || !componentById.has(component.parentId));
  browser.innerHTML = `<ul role="tree" class="browser-tree">${roots.map((component) => renderComponent(component.id)).join("")}</ul>`;
  browser.querySelectorAll<HTMLButtonElement>("[data-feature-id]").forEach((button) => button.addEventListener("click", () => { state.selectedFeatureId = button.dataset.featureId!; renderDocument(); requestFeatureServices(); }));
  browser.querySelectorAll<HTMLButtonElement>("[data-origin-plane-id]").forEach((button) => button.addEventListener("click", () => { state.selectedFeatureId = "origin"; renderDocument(); }));
  browser.querySelectorAll<HTMLButtonElement>("[data-sketch-id]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.sketchFeatureId) state.selectedFeatureId = button.dataset.sketchFeatureId; renderDocument(); }));
  browser.querySelectorAll<HTMLButtonElement>("[data-body-id]").forEach((button) => button.addEventListener("click", () => {
    const bodyId = button.dataset.bodyId!;
    applySelection(adapter.selectionAllowed(bodyId) ? { kind: "body", stableId: bodyId, bodyId, token: 0 } : null);
    renderDocument();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-body-visibility]").forEach((button) => button.addEventListener("click", () => {
    const body = adapter.findBody(button.dataset.bodyVisibility!);
    if (!body) return;
    worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}`, changes: [{ kind: "set_body_visibility", body: body.id, visibility: body.visibility === "visible" ? "hidden" : "visible" }] });
  }));
  installRoving(browser, "[data-tree-row]");
}

function renderDocument(): void {
  const focusedTimelineId = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.timelineId
    : undefined;
  selectedCatalogOperationId = null;
  const snapshot = adapter.getSnapshot();
  document.querySelector("#document-name")!.textContent = snapshot.name;
  renderBrowser();
  renderInspector();
  const timeline = document.querySelector<HTMLElement>("#timeline")!;
  const inputs = new Set(featureServices?.relationships.direct_inputs ?? []);
  const consumers = new Set(featureServices?.relationships.direct_consumers ?? []);
  const serviceItems = new Map(featureServices?.timeline.map((item) => [item.feature, item]) ?? []);
  timeline.innerHTML = snapshot.features.map((feature, index) => {
    const service = serviceItems.get(feature.id);
    const dependencyClass = inputs.has(feature.id) ? "dependency-input" : consumers.has(feature.id) ? "dependency-consumer" : "";
    const group = service?.group ? `<em>${escapeHtml(service.group)}</em>` : "";
    return `<button type="button" data-timeline-id="${feature.id}" class="timeline-item ${feature.id === state.selectedFeatureId ? "selected" : ""} ${dependencyClass}" data-after-rollback="${service?.after_rollback ?? false}"><i>${index + 1}</i><span>${feature.name}</span><b>${service?.state ?? feature.status}</b>${group}</button>`;
  }).join("");
  timeline.querySelectorAll<HTMLButtonElement>("[data-timeline-id]").forEach((button) => button.addEventListener("click", () => { state.selectedFeatureId = button.dataset.timelineId!; renderDocument(); requestFeatureServices(); }));
  installRoving(timeline, "[data-timeline-id]");
  if (focusedTimelineId) {
    const replacement = timeline.querySelector<HTMLButtonElement>(`[data-timeline-id="${CSS.escape(focusedTimelineId)}"]`);
    if (replacement) {
      timeline.querySelectorAll<HTMLButtonElement>("[data-timeline-id]").forEach((button) => { button.tabIndex = button === replacement ? 0 : -1; });
      replacement.focus();
    }
  }
}

interface DurableStepEvidence {
  provenance: { source_sha256: string; source_bytes: number; shell_count: number; face_count: number; triangle_count: number };
  body: { evidence: { vertex_count: number; edge_count: number; face_count: number; bounds_nm: { min: number[]; max: number[] }; volume_model_units3: number; deterministic_digest: string }; solid_json: number[] };
  transferred_bytes: number;
  kernel_time_ms: number;
}

function durableStepEvidence(featureId: string): DurableStepEvidence | undefined {
  const durable = adapter.durableDocument() as { transactions?: { changes?: { kind?: string; feature?: string; result_json?: string }[] }[] };
  const stored = (durable.transactions ?? []).flatMap((transaction) => transaction.changes ?? [])
    .filter((change) => change.kind === "accept_feature_result" && change.feature === featureId && change.result_json)
    .at(-1);
  if (!stored?.result_json) return undefined;
  try {
    const result = JSON.parse(stored.result_json) as DurableStepEvidence & { kind?: string };
    return result.kind === "step_import" ? result : undefined;
  } catch { return undefined; }
}

interface DurableAdvancedFeatureRecord {
  operation?: { schema_id?: string };
  parameters?: Record<string, string>;
}

interface DurableAdvancedRequest {
  output_body_id?: string;
  operation?: Record<string, unknown>;
}

function durableAdvancedEditState(featureId: string): { feature?: DurableAdvancedFeatureRecord; request?: DurableAdvancedRequest; values: Record<string, number | boolean | string> } {
  const durable = adapter.durableDocument() as {
    features?: Record<string, DurableAdvancedFeatureRecord>;
    parameters?: Record<string, { value?: { value?: number | boolean | string } }>;
    transactions?: { changes?: { kind?: string; feature?: string; request_json?: string }[] }[];
  };
  const feature = durable.features?.[featureId];
  const accepted = (durable.transactions ?? []).flatMap((transaction) => transaction.changes ?? [])
    .filter((change) => change.kind === "accept_feature_result" && change.feature === featureId && change.request_json)
    .at(-1);
  let request: DurableAdvancedRequest | undefined;
  try { request = accepted?.request_json ? JSON.parse(accepted.request_json) as DurableAdvancedRequest : undefined; } catch { request = undefined; }
  const values = Object.fromEntries(Object.entries(feature?.parameters ?? {}).flatMap(([key, id]) => {
    const value = durable.parameters?.[id]?.value?.value;
    return typeof value === "number" || typeof value === "boolean" || typeof value === "string" ? [[key, value]] : [];
  }));
  return { feature, request, values };
}

function renderInspector(): void {
  if (selectedCatalogOperationId) {
    renderOperationInspector(operationById(selectedCatalogOperationId));
    return;
  }
  const feature = adapter.findFeature(state.selectedFeatureId) ?? adapter.getSnapshot().features.at(-1);
  if (!feature) return;
  state.selectedFeatureId = feature.id;
  const selection = state.selection;
  const definition = operationForFeatureType(feature.type);
  const catalogFields = definition?.parameters.map((parameter) => ({ key: parameter.key, label: parameter.label, kind: valueKindLabel(parameter.value_kind), fallback: displayDefault(parameter) })) ?? [];
  const knownKeys = new Set(catalogFields.map((field) => field.key));
  const fields = [
    ...catalogFields,
    ...Object.keys(feature.parameters).filter((key) => !knownKeys.has(key)).sort().map((key) => ({ key, label: key.replaceAll("_", " "), kind: "Document value", fallback: "—" })),
  ];
  const isTimelineFeature = feature.id.startsWith("feature:");
  const isBaseFeature = feature.id === "feature:rectangle-sketch" || feature.id === "feature:extrude";
  const isEditableAdvancedFeature = Boolean(definition && isAdvancedFeatureOperation(definition.id) && durableAdvancedEditState(feature.id).request);
  const orderedFeatures = adapter.getSnapshot().features;
  const featureIndex = orderedFeatures.findIndex((candidate) => candidate.id === feature.id);
  const previousFeature = featureIndex > 0 ? orderedFeatures[featureIndex - 1] : undefined;
  const relationships = featureServices?.relationships.selected === feature.id ? featureServices.relationships : undefined;
  const timing = featureServices?.diagnostics.features.find((item) => item.feature === feature.id);
  const repair = repairInspection?.status === "evaluation_blocked" && repairInspection.preview.unresolved.feature === feature.id ? repairInspection.preview : undefined;
  const stepEvidence = durableStepEvidence(feature.id);
  const stepMeasurements = stepEvidence ? `<section class="step-import-evidence" aria-label="Imported body measurements"><h3>Imported body evidence</h3><dl>
    <div><dt>Source</dt><dd>${stepEvidence.provenance.source_bytes} bytes · ${escapeHtml(stepEvidence.provenance.source_sha256)}</dd></div>
    <div><dt>Topology</dt><dd>${stepEvidence.body.evidence.face_count} faces · ${stepEvidence.body.evidence.edge_count} edges · ${stepEvidence.body.evidence.vertex_count} vertices</dd></div>
    <div><dt>Triangles</dt><dd>${stepEvidence.provenance.triangle_count}</dd></div>
    <div><dt>Volume</dt><dd>${stepEvidence.body.evidence.volume_model_units3.toFixed(6)} model units³</dd></div>
    <div><dt>B-rep</dt><dd>${stepEvidence.body.solid_json.length} bytes · ${escapeHtml(stepEvidence.body.evidence.deterministic_digest)}</dd></div>
    <div><dt>Bounds</dt><dd>${stepEvidence.body.evidence.bounds_nm.min.join(", ")} → ${stepEvidence.body.evidence.bounds_nm.max.join(", ")} nm</dd></div>
    <div><dt>Worker</dt><dd>${stepEvidence.kernel_time_ms.toFixed(1)} ms · ${stepEvidence.transferred_bytes} transferred bytes</dd></div>
  </dl></section>` : "";
  const historyServices = isTimelineFeature ? `<section class="history-services" aria-label="History services">
    <h3>Dependencies & compute</h3>
    <p data-dependency-inputs>Inputs: ${relationships?.direct_inputs.length ? relationships.direct_inputs.map(escapeHtml).join(", ") : "none"}</p>
    <p data-dependency-consumers>Consumers: ${relationships?.direct_consumers.length ? relationships.direct_consumers.map(escapeHtml).join(", ") : "none"}</p>
    <p data-feature-timing>${timing ? `${(timing.elapsed_microseconds / 1000).toFixed(3)} ms · ${timing.cost_cue.replaceAll("_", " ")} · ${(timing.cost_share_ppm / 10_000).toFixed(1)}%` : "Timing available after recompute"}</p>
    <div><button data-history-action="recompute" type="button">Recompute from here</button>${previousFeature ? `<button data-history-action="group" type="button">Group with ${escapeHtml(previousFeature.name)}</button><button data-history-action="reorder" type="button">Move before ${escapeHtml(previousFeature.name)}</button>` : ""}<button data-history-action="rollback-end" type="button">Return to end</button></div>
    <output id="history-action-status">${escapeHtml(historyActionMessage)}</output>
    ${repair ? `<section class="repair-preview" role="alert"><strong>Repair ${escapeHtml(repair.unresolved.input_name)}</strong><p>Evaluation stopped at ${escapeHtml(repair.unresolved.feature)}. ${repair.downstream_stop.blocked_features.length} feature(s) blocked.</p>${repair.candidates.length ? repair.candidates.map((ranked) => `<button type="button" data-repair-candidate="${escapeHtml(ranked.candidate.id)}">Use #${ranked.rank} ${escapeHtml(ranked.candidate.id)} · Δ ${ranked.score.position_delta}/${ranked.score.normal_delta}/${ranked.score.measure_delta}</button>`).join("") : `<p data-no-repair-candidate>No candidate available; the document remains unchanged.</p>`}</section>` : ""}
  </section>` : "";
  document.querySelector<HTMLElement>("#inspector")!.innerHTML = `
    <h2>${feature.type === "sketch" ? `Sketch — ${feature.name}` : feature.name}</h2><p class="feature-type">${feature.type} · ${feature.status}${definition ? ` · ${escapeHtml(lifecycleLabel(definition))}` : ""}</p>
    ${feature.type === "sketch" ? `<h3>Constraints</h3>` : ""}
    <dl>${fields.map((field) => `<div data-parameter-key="${escapeHtml(field.key)}"><dt>${escapeHtml(field.label)}<small>${escapeHtml(field.kind)}</small></dt><dd>${feature.parameters[field.key] ?? field.fallback}</dd></div>`).join("")}</dl>
    ${definition ? renderSelectionRequirements(definition) : ""}
    ${renderFeatureParameterBindings(feature.id)}
    ${isTimelineFeature ? `<section class="feature-actions" aria-label="feature actions"><label>Name <input id="feature-name" value="${feature.name}" /></label><button data-feature-action="rename" type="button">Rename</button>${isEditableAdvancedFeature ? `<button data-feature-action="edit-parameters" type="button">Edit parameters</button>` : ""}<button data-feature-action="suppress" type="button">${feature.status === "suppressed" ? "Resume" : "Suppress"}</button><button data-feature-action="rollback" type="button">Rollback here</button>${isBaseFeature ? "" : `<button data-feature-action="delete" type="button">Delete</button>`}</section>` : ""}
    ${historyServices}
    ${stepMeasurements}
    ${renderParameterPanel(feature.id)}
    <section class="selection-card"><small>Viewport selection</small><strong>${selection ? `${selection.kind} · ${selection.stableId}` : "None"}</strong></section>`;
  document.querySelectorAll<HTMLButtonElement>("[data-feature-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.featureAction;
    if (action === "rollback") {
      worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "after", feature: feature.id } });
      return;
    }
    if (action === "edit-parameters" && definition && isAdvancedFeatureOperation(definition.id)) {
      editingAdvancedFeatureId = feature.id;
      selectedCatalogOperationId = definition.id;
      activeAdvancedOperationLabel = definition.label;
      setOperation("preview", "advanced");
      renderInspector();
      document.querySelector<HTMLInputElement | HTMLSelectElement>("[data-operation-parameter]")?.focus();
      return;
    }
    const changes: Record<string, unknown>[] = [];
    if (action === "rename") changes.push({ kind: "rename_entity", entity: { kind: "feature", id: feature.id }, display_name: document.querySelector<HTMLInputElement>("#feature-name")!.value.trim() });
    if (action === "suppress") changes.push({ kind: "set_feature_suppressed", feature: feature.id, suppressed: feature.status !== "suppressed" });
    if (action === "delete") changes.push({ kind: "delete_feature", component: "component:root", feature: feature.id });
    if (changes.length) worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}`, changes });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-history-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.historyAction;
    historyActionMessage = "";
    if (action === "recompute") worker?.postMessage({ type: "recompute-from-here", feature: feature.id });
    if (action === "rollback-end") worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "end" } });
    if (action === "group" && previousFeature) worker?.postMessage({ type: "commit-document-changes", operation: "group_features", transactionId: `transaction:${crypto.randomUUID()}:group`, changes: [{ kind: "group_features", group_id: `group:${crypto.randomUUID()}`, display_name: `${previousFeature.name} + ${feature.name}`, features: [previousFeature.id, feature.id] }] });
    if (action === "reorder" && previousFeature) worker?.postMessage({ type: "commit-document-changes", operation: "reorder_feature", transactionId: `transaction:${crypto.randomUUID()}:reorder`, changes: [{ kind: "reorder_feature", component: "component:root", feature: feature.id, before: previousFeature.id }] });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-repair-candidate]").forEach((button) => button.addEventListener("click", () => {
    worker?.postMessage({ type: "explicit-rebind", transactionId: `transaction:${crypto.randomUUID()}:repair`, selected: button.dataset.repairCandidate, observedTopology: repairObservedTopology });
  }));
  installParameterControls();
}

function parameterControl(parameter: OperationParameter, disabled: boolean, initialValue?: number | boolean | string): string {
  const disabledAttribute = disabled ? " disabled" : "";
  const selectedValue = initialValue ?? parameter.default.value;
  if (parameter.value_kind === "boolean") {
    return `<input data-operation-parameter="${escapeHtml(parameter.key)}" type="checkbox" ${selectedValue ? "checked" : ""}${disabledAttribute} />`;
  }
  if (parameter.choices.length) {
    return `<select data-operation-parameter="${escapeHtml(parameter.key)}"${disabledAttribute}>${parameter.choices.map((choice) => `<option ${choice === selectedValue ? "selected" : ""}>${escapeHtml(choice)}</option>`).join("")}</select>`;
  }
  const divisor = parameter.value_kind === "length_nanometers" || parameter.value_kind === "angle_microdegrees" || parameter.value_kind === "scalar_millionths" ? 1_000_000 : 1;
  const value = typeof selectedValue === "number" ? selectedValue / divisor : selectedValue;
  const minimum = parameter.bounds ? ` min="${parameter.bounds.minimum / divisor}"` : "";
  const maximum = parameter.bounds ? ` max="${parameter.bounds.maximum / divisor}"` : "";
  const step = parameter.value_kind === "count" ? "1" : "0.001";
  return `<input data-operation-parameter="${escapeHtml(parameter.key)}" type="${parameter.value_kind === "text" ? "text" : "number"}" value="${escapeHtml(String(value))}"${minimum}${maximum} step="${step}"${disabledAttribute} />`;
}

function renderSelectionRequirements(operation: AlphaOperation): string {
  return `<section class="operation-requirements" aria-label="Selection requirements"><h3>Selection requirements</h3>${operation.input_slots.length
    ? `<ul>${operation.input_slots.map((slot) => `<li data-input-slot="${escapeHtml(slot.key)}"><strong>${escapeHtml(slot.label)}</strong><span>${escapeHtml(slot.allowed_kinds.join(" or "))} · ${escapeHtml(selectionCountLabel(slot))}</span></li>`).join("")}</ul>`
    : "<p>No selection required.</p>"}</section>`;
}

function renderOperationInspector(operation: AlphaOperation): void {
  const disabled = operation.enablement.state === "disabled";
  const executable = isAdvancedFeatureOperation(operation.id);
  const editing = executable && editingAdvancedFeatureId ? durableAdvancedEditState(editingAdvancedFeatureId) : undefined;
  document.querySelector<HTMLElement>("#inspector")!.innerHTML = `
    <h2>${escapeHtml(operation.label)}</h2>
    <p class="feature-type">${escapeHtml(operation.group.replaceAll("_", " "))} · output ${escapeHtml(operation.output_kind)}</p>
    <p class="operation-lifecycle">${escapeHtml(lifecycleLabel(operation))}</p>
    ${disabled ? `<p class="operation-disabled" role="status"><strong>Disabled</strong>${escapeHtml(operation.enablement.reason ?? "This operation is disabled.")}</p>` : ""}
    ${renderSelectionRequirements(operation)}
    ${executable ? renderAdvancedSelectionControls(operation) : ""}
    <section class="operation-fields" aria-label="Operation parameters"><h3>Parameters</h3>${operation.parameters.map((parameter) => `<label><span>${escapeHtml(parameter.label)}<small>${escapeHtml(valueKindLabel(parameter.value_kind))}</small></span>${parameterControl(parameter, disabled, editing?.values[parameter.key])}</label>`).join("")}</section>
    ${disabled ? "" : executable
      ? `<button id="execute-advanced-feature" type="button">${editing ? "Update" : "Execute"} ${escapeHtml(operation.label)}</button><p id="operation-execution-status" class="operation-schema-ready" role="status">${editing ? `Editing ${escapeHtml(editingAdvancedFeatureId!)}. Its stable feature and body identities will be preserved.` : "Schema ready. Accepted document inputs will execute atomically."}</p>`
      : `<p class="operation-schema-ready" role="status">Schema ready. Execution is not connected for this command yet.</p>`}`;
  document.querySelector<HTMLButtonElement>("#execute-advanced-feature")?.addEventListener("click", () => executeCatalogOperation(operation));
}

const advancedOperationIds = new Set<AdvancedFeatureOperationId>([
  "crawler.part.revolve",
  "crawler.part.boolean.union",
  "crawler.part.boolean.cut",
  "crawler.part.boolean.intersect",
  "crawler.part.fillet",
  "crawler.part.chamfer",
  "crawler.part.mirror",
  "crawler.part.transform",
  "crawler.part.pattern.linear",
  "crawler.part.pattern.circular",
  "crawler.part.shell",
]);

function isAdvancedFeatureOperation(id: string): id is AdvancedFeatureOperationId {
  return advancedOperationIds.has(id as AdvancedFeatureOperationId);
}

function acceptedKernelBodyIds(): string[] {
  const durable = adapter.durableDocument() as { transactions?: { changes?: { kind?: string; body?: string }[] }[] };
  const accepted = (durable.transactions ?? []).flatMap((transaction) => transaction.changes ?? [])
    .filter((change) => change.kind === "accept_feature_result" && change.body)
    .map((change) => change.body!);
  const activeBodyId = renderer?.bodyId();
  if (activeBodyId && adapter.findBody(activeBodyId)) accepted.push(activeBodyId);
  return [...new Set(accepted)];
}

function bodyOptions(selectedBodyId?: string, multiple = false): string {
  const activeBodyId = renderer?.bodyId();
  return acceptedKernelBodyIds().map((bodyId) => `<option value="${escapeHtml(bodyId)}" ${(multiple ? bodyId !== selectedBodyId : bodyId === (selectedBodyId ?? activeBodyId)) ? "selected" : ""}>${escapeHtml(adapter.findBody(bodyId)?.name ?? bodyId)}</option>`).join("");
}

function renderAdvancedSelectionControls(operation: AlphaOperation): string {
  if (operation.id === "crawler.part.revolve") {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Principal axis <select data-advanced-axis><option value="z">Z</option><option value="x">X</option><option value="y">Y</option></select></label><p>Profile dimensions are resolved from the active accepted body bounds.</p></section>`;
  }
  const activeBodyId = renderer?.bodyId();
  const bodies = acceptedKernelBodyIds();
  const bodyHelp = bodies.length ? "Durable accepted body snapshots" : "Create or import a body-producing feature first.";
  if (operation.id.startsWith("crawler.part.boolean.")) {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Target body <select data-advanced-target-body>${bodyOptions(activeBodyId)}</select></label><label>Tool bodies <select data-advanced-tool-bodies multiple size="${Math.max(2, Math.min(5, bodies.length))}">${bodyOptions(activeBodyId, true)}</select></label><p>${escapeHtml(bodyHelp)}</p></section>`;
  }
  const edgeSummary = state.selections.filter((selection) => selection.kind === "edge").map((selection) => selection.stableId).join(", ");
  const faceSummary = state.selections.filter((selection) => selection.kind === "face").map((selection) => selection.stableId).join(", ");
  const axis = operation.id === "crawler.part.mirror" || operation.id.startsWith("crawler.part.pattern.")
    ? `<label>Principal axis <select data-advanced-axis><option value="z">Z</option><option value="x">X</option><option value="y">Y</option></select></label>`
    : "";
  const edges = operation.id === "crawler.part.fillet" || operation.id === "crawler.part.chamfer"
    ? `<p data-advanced-edge-selection>${edgeSummary ? `Selected edges: ${escapeHtml(edgeSummary)}` : "Select one or more viewport edges (Shift-click for multiple)."}</p>`
    : "";
  const faces = operation.id === "crawler.part.shell"
    ? `<p data-advanced-face-selection>${faceSummary ? `Selected face: ${escapeHtml(faceSummary)}` : "Select one rectangular-prism viewport face."}</p>`
    : "";
  return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Source body <select data-advanced-source-body>${bodyOptions(activeBodyId)}</select></label>${axis}${edges}${faces}<p>${escapeHtml(bodyHelp)}</p></section>`;
}

function collectOperationParameters(operation: AlphaOperation): Record<string, number | boolean | string> {
  return Object.fromEntries(operation.parameters.map((parameter) => {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-operation-parameter="${CSS.escape(parameter.key)}"]`);
    if (!control) throw new Error(`missing ${parameter.key} control`);
    if (parameter.value_kind === "boolean") return [parameter.key, (control as HTMLInputElement).checked];
    if (parameter.value_kind === "text") return [parameter.key, control.value];
    const displayed = Number(control.value);
    if (!Number.isFinite(displayed)) throw new Error(`${parameter.label} must be a number`);
    const multiplier = parameter.value_kind === "length_nanometers" || parameter.value_kind === "angle_microdegrees" || parameter.value_kind === "scalar_millionths" ? 1_000_000 : 1;
    const exact = displayed * multiplier;
    if (!Number.isSafeInteger(exact)) throw new Error(`${parameter.label} must resolve to an exact ${valueKindLabel(parameter.value_kind).toLowerCase()}`);
    return [parameter.key, exact];
  }));
}

function executeCatalogOperation(operation: AlphaOperation): void {
  if (!worker || safeMode || !isAdvancedFeatureOperation(operation.id) || operation.enablement.state === "disabled") return;
  const status = document.querySelector<HTMLElement>("#operation-execution-status");
  try {
    const target = document.querySelector<HTMLSelectElement>("[data-advanced-target-body]")?.value;
    const source = document.querySelector<HTMLSelectElement>("[data-advanced-source-body]")?.value;
    const toolBodies = Array.from(document.querySelector<HTMLSelectElement>("[data-advanced-tool-bodies]")?.selectedOptions ?? []).map((option) => option.value);
    const axis = document.querySelector<HTMLSelectElement>("[data-advanced-axis]")?.value as "x" | "y" | "z" | undefined;
    const command: AdvancedFeatureCommand = {
      type: editingAdvancedFeatureId ? "edit-advanced-feature" : "execute-advanced-feature",
      operationId: operation.id,
      displayName: operation.label,
      featureId: editingAdvancedFeatureId ?? undefined,
      outputBodyId: editingAdvancedFeatureId ? durableAdvancedEditState(editingAdvancedFeatureId).request?.output_body_id : undefined,
      parameters: collectOperationParameters(operation),
      selection: {
        sourceBodyId: source || undefined,
        targetBodyId: target || undefined,
        toolBodyIds: toolBodies,
        edgeStableIds: state.selections.filter((selection) => selection.kind === "edge").map((selection) => selection.stableId),
        removedFaceStableIds: state.selections.filter((selection) => selection.kind === "face").map((selection) => selection.stableId),
        axis,
      },
    };
    activeAdvancedOperationLabel = operation.label;
    setOperation("preview", "advanced");
    performanceEvidence.beginRecompute();
    if (status) status.textContent = `Executing ${operation.label}…`;
    worker.postMessage(command);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function applySelection(selection: Selection | null, additive = false): void {
  if (!selection) state.selections = [];
  else if (!additive) state.selections = [selection];
  else {
    const key = `${selection.kind}:${selection.stableId}`;
    const existing = state.selections.findIndex((item) => `${item.kind}:${item.stableId}` === key);
    if (existing >= 0) state.selections.splice(existing, 1);
    else state.selections.push(selection);
    const order: Record<TopologyKind, number> = { body: 0, face: 1, edge: 2, vertex: 3 };
    state.selections.sort((a, b) => order[a.kind] - order[b.kind] || a.stableId.localeCompare(b.stableId));
  }
  state.selection = state.selections.at(-1) ?? null;
  const summary = state.selections.map((item) => `${item.kind} ${item.stableId}`).join(", ");
  document.querySelector("#selection-readout")!.textContent = summary ? `Selection (${state.selections.length}): ${summary}` : "Selection: none";
  document.querySelector("#timeline-status")!.textContent = historyActionMessage || (state.selection ? `Solver: ready · selected ${state.selection.kind} ${state.selection.stableId}` : "Solver: ready");
  renderInspector();
}

function applyPreselection(selection: Selection | null): void {
  state.preselection = selection;
  document.querySelector("#preselection-readout")!.textContent = selection ? `Hover: ${selection.kind}, stable ID ${selection.stableId}` : "Hover: none";
}

function startRuntime(): void {
  worker?.terminate(); renderer?.dispose(); renderer = undefined;
  runtimeHydrated = false;
  documentReady = false;
  setReadiness("wasm", "loading"); setReadiness("worker", "loading"); setReadiness("renderer", "loading");
  worker = new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" });
  sketchBridge = new WorkerSketchBridge(worker);
  let workerMessageProcessing = Promise.resolve();
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    workerMessageProcessing = workerMessageProcessing.then(async () => {
    if (event.data.type === "wasm-ready") { setReadiness("wasm", "ready"); setReadiness("worker", "ready"); }
    if (event.data.type === "packet") {
      try {
        transferredBytes = event.data.transferredBytes;
        performanceEvidence.setTransferBytes(transferredBytes);
        acceptedBodyId = event.data.bodyId;
        lastPacketSemanticHash = event.data.semanticHash;
        currentBounds = Array.from(event.data.packet.bounds);
        renderer?.dispose();
        renderer = new WorkspaceRenderer(document.querySelector<HTMLCanvasElement>("#viewport")!, event.data.packet, renderBodyContext(event.data.bodyId), applySelection, applyPreselection);
        renderer.setFilters(state.selectionFilters);
        if (documentReady && event.data.semanticHash === adapter.checksum()) { setReadiness("renderer", "ready"); setSafeMode(false); void performanceEvidence.sampleFrames(); }
      } catch (error) { setReadiness("renderer", "error", error instanceof Error ? error.message : String(error)); }
    }
    if (event.data.type === "extrude-preview") {
      const started = extrudePreviewStarted.get(event.data.requestId);
      extrudePreviewStarted.delete(event.data.requestId);
      if (event.data.requestId !== latestExtrudePreviewRequest || state.operation.status !== "preview" || state.operation.type !== "pad") return;
      try {
        if (event.data.semanticHash !== adapter.checksum()) throw new Error("Extrude preview is not based on the accepted document");
        if (started !== undefined) performanceEvidence.record("preview", performance.now() - started);
        transferredBytes = event.data.transferredBytes;
        performanceEvidence.setTransferBytes(transferredBytes);
        currentBounds = Array.from(event.data.packet.bounds);
        renderer?.dispose();
        renderer = new WorkspaceRenderer(document.querySelector<HTMLCanvasElement>("#viewport")!, event.data.packet, { id: event.data.bodyId || acceptedBodyId, visible: true, selectable: false }, applySelection, applyPreselection);
        renderer.setFilters(state.selectionFilters);
        setExtrudeManipulatorValue(event.data.distanceNanometers);
        document.querySelector("#operation-state")!.setAttribute("data-preview-source", "worker-render-packet");
      } catch (error) { setReadiness("renderer", "error", error instanceof Error ? error.message : String(error)); }
    }
    if (event.data.type === "imported-step-source") {
      storage ??= await AppStorage.open();
      const sourceSha256 = event.data.sourceSha256;
      const source = new Uint8Array(event.data.bytes);
      importedSourcePersistence = importedSourcePersistence.then(() => storage!.retainImportedStepSource(sourceSha256, source));
      await importedSourcePersistence;
    }
    if (event.data.type === "document") {
      try {
        storage ??= await AppStorage.open();
        await importedSourcePersistence;
        if (!runtimeHydrated) {
          if (sessionRecoveryDocument) {
            runtimeHydrated = true; recoveryProvenance = "In-memory accepted runtime snapshot";
            worker?.postMessage({ type: "hydrate-document", documentJson: JSON.stringify(sessionRecoveryDocument) });
            return;
          }
          const result = await storage.initializeOrRecover(JSON.parse(event.data.documentJson), event.data.semanticHash);
          runtimeHydrated = true;
          if (result.status === "recovered") {
            recoveryChoices = result.choices;
            recoveryProvenance = `${result.provenance.source} accepted state (${result.provenance.action}, sequence ${result.provenance.acceptedSequence})`;
            if (result.semanticHash !== event.data.semanticHash) {
              document.querySelector("#storage-status")!.textContent = "recovering";
              worker?.postMessage({ type: "hydrate-document", documentJson: JSON.stringify(result.document) });
              return;
            }
          }
          document.querySelector("#storage-status")!.textContent = result.status === "recovered" ? "recovered" : "autosave ready";
        }
        adapter = adapterFromWorkerSnapshot(event.data.documentJson, event.data.semanticHash, event.data.dimensionsJson);
        await restoreImportedStepSources(adapter.durableDocument());
        currentParameters = event.data.parameters;
        if (renderer) renderer.setBodyContext(renderBodyContext(renderer.bodyId()));
        if (state.selections.some((selection) => !adapter.selectionAllowed(selection.bodyId))) applySelection(null);
        const dimensions = JSON.parse(event.data.dimensionsJson) as { width_nanometers: number; height_nanometers: number; distance_nanometers: number };
        currentDimensions = { widthNanometers: dimensions.width_nanometers, heightNanometers: dimensions.height_nanometers, distanceNanometers: dimensions.distance_nanometers };
        acceptedExtrudeDistanceNanometers = dimensions.distance_nanometers;
        document.querySelector<HTMLInputElement>("#part-width")!.value = String(dimensions.width_nanometers / 1_000_000);
        document.querySelector<HTMLInputElement>("#part-height")!.value = String(dimensions.height_nanometers / 1_000_000);
        document.querySelector<HTMLInputElement>("#pad-length")!.value = String(dimensions.distance_nanometers / 1_000_000);
        sessionRecoveryDocument = adapter.durableDocument();
        renderDocument();
        requestFeatureServices();
        documentReady = true;
        if (renderer && lastPacketSemanticHash === event.data.semanticHash) { setReadiness("renderer", "ready"); setSafeMode(false); void performanceEvidence.sampleFrames(); }
        if (event.data.recompute) {
          lastRecompute = { dirtyRoots: [...event.data.recompute.dirtyRoots], evaluationOrder: [...event.data.recompute.evaluationOrder] };
          document.querySelector("#timeline-status")!.textContent = `Solver: recomputed ${event.data.recompute.evaluationOrder.join(" → ")}`;
        }
        if (event.data.historyAction) document.querySelector("#timeline-status")!.textContent = `Solver: ${event.data.historyAction}`;
        if (event.data.historyAction === "hydrate") document.querySelector("#storage-status")!.textContent = "recovered";
        if (event.data.historyAction === "new" || event.data.historyAction === "open") {
          stepImportRunning = false; stepSourceRetained = false; updateStepImportControls();
          await storage.adoptPortableDocument(adapter.durableDocument(), event.data.semanticHash, event.data.historyAction === "new" ? "new_document" : "open");
          runtimeHydrated = true;
          recoveryChoices = [];
          recoveryProvenance = event.data.historyAction === "open" ? "Opened portable part file" : "New canonical part";
          document.querySelector("#storage-status")!.textContent = event.data.historyAction === "open" ? "opened" : "new part";
        }
        if (event.data.historyAction === "undo" || event.data.historyAction === "redo") {
          const acceptedDocument = adapter.durableDocument();
          const semanticHash = event.data.semanticHash;
          const historyAction = event.data.historyAction;
          const persistenceRevision = ++acceptedPersistenceRevision;
          const persistence = acceptedPersistence.then(() => storage!.recordAcceptedState((acceptedDocument as { id: string }).id, acceptedDocument, semanticHash, historyAction));
          acceptedPersistence = persistence;
          await persistence;
          if (persistenceRevision === acceptedPersistenceRevision) document.querySelector("#storage-status")!.textContent = lastExplicitSaveChecksum === adapter.checksum() ? "saved" : "autosaved";
        }
        if (event.data.transaction) {
          performanceEvidence.finishRecompute();
          const acceptedDocument = adapter.durableDocument();
          const transaction = event.data.transaction;
          const semanticHash = event.data.semanticHash;
          const persistenceRevision = ++acceptedPersistenceRevision;
          const persistence = acceptedPersistence.then(() => storage!.recordAccepted((acceptedDocument as { id: string }).id, transaction, acceptedDocument, semanticHash));
          acceptedPersistence = persistence;
          await persistence;
          recordPersistedOperationHash(event.data.semanticHash);
          if (state.operation.status === "preview" && (state.operation.type === "rectangle" || state.operation.type === "pad")) setOperation("committed");
          document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
          if (persistenceRevision === acceptedPersistenceRevision) document.querySelector("#storage-status")!.textContent = lastExplicitSaveChecksum === adapter.checksum() ? "saved" : "autosaved";
        }
      } catch (error) { storageFailure(error); }
    }
    if (event.data.type === "error") handleRuntimeFault(event.data.message);
    if (event.data.type === "operation-error") {
      setOperation("cancelled");
      const detail = `${event.data.field ? `${event.data.field}: ` : ""}${event.data.message}${event.data.recovery ? ` — ${event.data.recovery}` : ""}`;
      if (event.data.operationId) {
        document.querySelector<HTMLElement>("#operation-execution-status")?.setAttribute("data-error-field", event.data.field ?? "");
        const status = document.querySelector<HTMLElement>("#operation-execution-status");
        if (status) status.textContent = detail;
        if (event.data.field?.startsWith("parameters.")) {
          document.querySelector(`[data-operation-parameter="${CSS.escape(event.data.field.slice("parameters.".length))}"]`)?.setAttribute("aria-invalid", "true");
        }
      } else if (event.data.code === "group_features" || event.data.code === "reorder_feature") {
        historyActionMessage = `${event.data.code.replaceAll("_", " ")} blocked: ${detail}`;
        renderInspector();
      } else {
        if (stepImportRunning) { stepImportRunning = false; stepSourceRetained = true; updateStepImportControls(); }
        document.querySelector("#import-status")!.textContent = `${event.data.code}: ${detail}`;
      }
    }
    if (event.data.type === "parameter-error") {
      setOperation("cancelled", "parameter");
      const input = document.querySelector<HTMLInputElement>(`[data-parameter-expression][data-field="${CSS.escape(event.data.diagnostic.field)}"]`);
      input?.setAttribute("aria-invalid", "true");
      const cycle = event.data.diagnostic.cycle?.length ? ` Dependency path: ${event.data.diagnostic.cycle.join(" → ")}.` : "";
      currentParameterErrors.set(event.data.diagnostic.field, `${event.data.diagnostic.message}${cycle}`);
      const output = document.querySelector<HTMLElement>(`[data-parameter-error="${CSS.escape(event.data.diagnostic.field)}"]`);
      if (output) { output.textContent = `${event.data.diagnostic.message}${cycle}`; output.hidden = false; }
      input?.focus();
    }
    if (event.data.type === "parameter-action-completed") completeOperationAfterPersistence("parameter", event.data.semanticHash);
    if (event.data.type === "advanced-feature-completed") {
      completeOperationAfterPersistence("advanced", event.data.semanticHash);
      document.querySelector("#timeline-status")!.textContent = `${activeAdvancedOperationLabel} accepted as ${event.data.bodyId}`;
    }
    if (event.data.type === "step-import-progress") {
      stepImportRunning = true;
      updateStepImportControls();
      document.querySelector("#import-status")!.textContent = `STEP ${event.data.phase.replaceAll("_", " ")} · ${event.data.percent}%`;
    }
    if (event.data.type === "step-import-cancelled") {
      stepImportRunning = false;
      stepSourceRetained = event.data.sourceRetained;
      updateStepImportControls();
      setOperation("cancelled", "step-import");
      document.querySelector("#import-status")!.textContent = "STEP import cancelled · source retained for re-import";
    }
    if (event.data.type === "step-imported") {
      stepImportRunning = false;
      stepSourceRetained = true;
      updateStepImportControls();
      completeOperationAfterPersistence("step-import", adapter.checksum());
      document.querySelector("#import-status")!.textContent = `STEP: ${event.data.provenance.face_count} faces, ${event.data.provenance.triangle_count} triangles, ${event.data.provenance.source_bytes} source bytes, ${event.data.measurements.snapshot.serialized_bytes} B-rep bytes`;
      document.querySelector("#timeline-status")!.textContent = `Imported ${event.data.bodyId} in ${event.data.kernelTimeMs.toFixed(1)} ms · volume ${event.data.evidence.volume_model_units3.toFixed(3)}`;
      renderInspector();
    }
    if (event.data.type === "timeline-rollback") {
      document.querySelector("#timeline-status")!.textContent = event.data.rollback.kind === "after" ? `Rollback after ${event.data.rollback.feature}` : `Rollback: ${event.data.rollback.kind}`;
      requestFeatureServices();
    }
    if (event.data.type === "feature-services" && event.data.selected === state.selectedFeatureId) {
      featureServices = event.data.services;
      repairInspection = event.data.repair;
      repairObservedTopology = event.data.observedTopology;
      // A late dependency response must not replace an operation form the
      // user has already opened in the shared inspector.
      if (!selectedCatalogOperationId) renderDocument();
    }
    if (event.data.type === "recompute-from-here") {
      lastRecompute = { dirtyRoots: [event.data.plan.requested_from], evaluationOrder: [...event.data.plan.evaluation_order] };
      historyActionMessage = event.data.accepted
        ? `Recomputed ${event.data.plan.evaluation_order.join(" → ") || "cached result"}`
        : `Recompute blocked: ${event.data.error?.message ?? "feature execution was refused"}`;
      document.querySelector("#timeline-status")!.textContent = historyActionMessage;
      renderInspector();
    }
    if (event.data.type === "repair-committed") {
      historyActionMessage = `Rebound explicitly to ${event.data.selected}; undo is available.`;
      document.querySelector("#timeline-status")!.textContent = historyActionMessage;
      requestFeatureServices();
    }
    if (event.data.type === "export") {
      const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
      const mediaType = event.data.format === "step" ? "model/step" : event.data.format === "stl" ? "model/stl" : "text/plain";
      const url = URL.createObjectURL(new Blob([event.data.content], { type: mediaType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${base}.${event.data.format}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    if (event.data.type === "portable-package") {
      const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
      if (pendingPortableSaveHandle) {
        const handle = pendingPortableSaveHandle;
        pendingPortableSaveHandle = undefined;
        try {
          const writable = await handle.createWritable();
          await writable.write(event.data.bytes as BlobPart);
          await writable.close();
          document.querySelector("#storage-status")!.textContent = "saved";
        } catch (error) { storageFailure(error); }
      } else {
        const url = URL.createObjectURL(new Blob([event.data.bytes as BlobPart], { type: "application/vnd.crawler.part+zip" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${base}.crawlerpart`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    }
    }).catch((error) => handleRuntimeFault(error instanceof Error ? error.message : String(error)));
  });
  worker.addEventListener("error", (event) => handleRuntimeFault(event.message));
  worker.postMessage({ type: "initialize", fail: startupFailurePending });
  startupFailurePending = false;
}

function setOperation(status: typeof state.operation.status, type: "rectangle" | "sketch" | "pad" | "step-import" | "advanced" | "parameter" | null = state.operation.type): void {
  if (status === "preview" || status === "idle" || status === "cancelled") pendingOperationCompletion = undefined;
  state.operation.status = status;
  state.operation.type = status === "idle" || status === "cancelled" ? null : type;
  const operationName = type === "rectangle" ? rectangleOperation.label : type === "sketch" ? activeSketchOperationLabel : type === "step-import" ? "STEP import" : type === "pad" ? extrudeOperation.label : type === "advanced" ? activeAdvancedOperationLabel : type === "parameter" ? activeParameterLabel : "Document change";
  const labels = { idle: "Operation: idle", preview: type === "step-import" ? "Operation: STEP import running — Cancel import stops the worker" : `Operation: ${operationName} preview — Enter commits, Escape cancels`, committed: `Operation: ${operationName} committed`, cancelled: "Operation: cancelled" };
  document.querySelector("#operation-state")!.textContent = labels[status];
  document.querySelector("#operation-state")!.setAttribute("data-status", status);
}

function setExtrudeManipulatorValue(valueNanometers: number): void {
  const millimeters = valueNanometers / 1_000_000;
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.setAttribute("aria-valuenow", String(millimeters));
  handle.querySelector("output")!.textContent = `${Number(millimeters.toFixed(3))} mm`;
}

function requestExtrudePreview(valueNanometers: number): void {
  if (!worker || state.operation.status !== "preview" || state.operation.type !== "pad" || !Number.isSafeInteger(valueNanometers) || valueNanometers <= 0) return;
  const requestId = ++extrudePreviewRequest;
  latestExtrudePreviewRequest = requestId;
  extrudePreviewStarted.set(requestId, performance.now());
  setExtrudeManipulatorValue(valueNanometers);
  worker.postMessage({ type: "preview-extrude", requestId, valueNanometers });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function referencedStepSourceHashes(documentValue: unknown): string[] {
  const document = documentValue as { transactions?: { changes?: { result_json?: unknown }[] }[] };
  const hashes = new Set<string>();
  for (const change of (document.transactions ?? []).flatMap((transaction) => transaction.changes ?? [])) {
    if (typeof change.result_json !== "string") continue;
    try {
      const result = JSON.parse(change.result_json) as { kind?: string; provenance?: { source_sha256?: string } };
      const sourceSha256 = result.kind === "step_import" ? result.provenance?.source_sha256 : undefined;
      if (sourceSha256 && /^[0-9a-f]{64}$/.test(sourceSha256)) hashes.add(sourceSha256);
    } catch { /* Non-STEP feature results are unrelated to imported source payloads. */ }
  }
  return [...hashes].sort();
}

async function restoreImportedStepSources(documentValue: unknown): Promise<void> {
  if (!worker) return;
  storage ??= await AppStorage.open();
  for (const sourceSha256 of referencedStepSourceHashes(documentValue)) {
    const source = await storage.importedStepSource(sourceSha256);
    if (!source) continue;
    worker.postMessage({ type: "retain-step-source", sourceSha256, bytes: source.buffer }, [source.buffer]);
  }
}

function updateExtrudePreviewFromField(): void {
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  if (Number.isFinite(input.valueAsNumber) && input.valueAsNumber > 0) {
    requestExtrudePreview(Math.round(input.valueAsNumber * 1_000_000));
  }
}

function beginExtrudePreview(): void {
  acceptedExtrudeDistanceNanometers = currentDimensions.distanceNanometers;
  setOperation("preview", "pad");
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.hidden = false;
  updateExtrudePreviewFromField();
}

function commitExtrudePreview(): void {
  const millimeters = document.querySelector<HTMLInputElement>("#pad-length")!.valueAsNumber;
  if (!Number.isFinite(millimeters) || millimeters <= 0) return;
  document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
  latestExtrudePreviewRequest = ++extrudePreviewRequest;
  performanceEvidence.beginRecompute();
  worker?.postMessage({ type: "commit-pad", valueNanometers: Math.round(millimeters * 1_000_000) });
}

function cancelExtrudePreview(): void {
  latestExtrudePreviewRequest = ++extrudePreviewRequest;
  extrudePreviewStarted.clear();
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  input.value = String(acceptedExtrudeDistanceNanometers / 1_000_000);
  document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
  setOperation("cancelled");
  worker?.postMessage({ type: "restore-accepted-packet" });
  document.querySelector<HTMLButtonElement>("#start-pad")!.focus();
}

function completeOperationAfterPersistence(type: "advanced" | "parameter" | "step-import", semanticHash: string): void {
  if (persistedSemanticHashes.has(semanticHash)) {
    if (state.operation.status === "preview" && state.operation.type === type) setOperation("committed", type);
    return;
  }
  pendingOperationCompletion = { type, semanticHash };
}

function recordPersistedOperationHash(semanticHash: string): void {
  persistedSemanticHashes.add(semanticHash);
  const pending = pendingOperationCompletion;
  if (pending?.semanticHash === semanticHash) {
    pendingOperationCompletion = undefined;
    if (state.operation.status === "preview" && state.operation.type === pending.type) setOperation("committed", pending.type);
  }
}

function startSketchEdit(tool: SketchTool = "line", operationLabel?: string): void {
  if (!sketchBridge) return;
  sketchReturnFocus = document.activeElement as HTMLElement;
  const sketchView = adapter.getSnapshot().components
    .flatMap((component) => component.sketches)
    .find((sketch) => sketch.featureId === state.selectedFeatureId)
    ?? adapter.getSnapshot().components.flatMap((component) => component.sketches)[0];
  const hydrated = hydrateSketchFromDocument(adapter.durableDocument(), sketchView?.id);
  sketchSession = new SketchEditSession(
    hydrated?.sketch ?? { id: "sketch:rectangle", revision: 0, geometry: {}, constraints: {} },
    hydrated?.support ?? { kind: "origin_plane_reference", plane: "origin-plane:xy" },
    sketchBridge,
  );
  sketchPoints = [];
  sketchConstruction = tool === "construction";
  sketchSession.activeTool = tool === "construction" ? "line" : tool;
  activeSketchOperationLabel = operationLabel ?? SKETCH_TOOL_SCHEMA.find((entry) => entry.id === tool)?.label ?? "Sketch";
  document.querySelector<HTMLElement>("#sketch-toolbar")!.hidden = false;
  setSketchPlaneControl(sketchSession.support);
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => {
    const selected = button.dataset.sketchTool;
    button.setAttribute("aria-pressed", String(selected === sketchSession?.activeTool || (selected === "construction" && sketchConstruction)));
  });
  setOperation("preview", "sketch");
  updateSketchStatus();
  document.querySelector<HTMLButtonElement>(`[data-sketch-tool="${CSS.escape(tool)}"]`)?.focus();
}

function setSketchPlaneControl(support: SketchSupport): void {
  const select = document.querySelector<HTMLSelectElement>("#sketch-plane")!;
  if (support.kind === "origin_plane") select.value = support.plane;
  else if (support.kind === "origin_plane_reference") select.value = support.plane.replace("origin-plane:", "");
  else select.value = "face";
}

function updateSketchStatus(): void {
  const solve = document.querySelector<HTMLOutputElement>("#sketch-solver-state")!;
  const profile = document.querySelector<HTMLOutputElement>("#sketch-profile-state")!;
  if (!sketchSession) {
    solve.textContent = "Sketch editor idle";
    profile.textContent = "Profile: empty";
    renderSketchOverlay();
    return;
  }
  solve.textContent = sketchSession.solve
    ? `${sketchSession.solve.state.replaceAll("_", " ")} · ${sketchSession.solve.degrees_of_freedom} degrees of freedom${sketchSession.solve.conflicts.length ? ` · conflict set ${sketchSession.solve.conflicts.flatMap((conflict) => conflict.constraints).join(", ")}` : ""}`
    : "Under-constrained · click the plane to draw";
  const report = sketchSession.profile;
  profile.textContent = report
    ? `Profiles: ${report.closed_profiles.length} closed · ${report.diagnostics.length ? report.diagnostics.map((diagnostic) => diagnostic.kind.replaceAll("_", " ")).join(", ") : "no gaps"}`
    : "Profile: empty";
  renderSketchOverlay();
}

function sketchPoint(event: PointerEvent): Point2 {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
  const bounds = canvas.getBoundingClientRect();
  return {
    x_nm: Math.round((event.clientX - bounds.left - bounds.width / 2) * 100_000),
    y_nm: Math.round((bounds.height / 2 - (event.clientY - bounds.top)) * 100_000),
  };
}

function sketchOverlayPoint(point: Point2, bounds: DOMRect): { x: number; y: number } {
  return {
    x: bounds.width / 2 + point.x_nm / 100_000,
    y: bounds.height / 2 - point.y_nm / 100_000,
  };
}

function renderSketchOverlay(): void {
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  if (!sketchSession) {
    overlay.setAttribute("hidden", "");
    overlay.replaceChildren();
    return;
  }
  const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
  overlay.removeAttribute("hidden");
  overlay.setAttribute("viewBox", `0 0 ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`);
  const geometry: string[] = [];
  const handles: string[] = [];
  const point = (value: Point2) => sketchOverlayPoint(value, bounds);
  const handle = (geometryId: string, anchor: PointRef["anchor"], value: Point2) => {
    const position = point(value);
    handles.push(`<circle class="sketch-handle" data-sketch-handle="${escapeHtml(geometryId)}:${anchor}" data-geometry="${escapeHtml(geometryId)}" data-anchor="${anchor}" cx="${position.x}" cy="${position.y}" r="6" tabindex="0" role="button" aria-label="Drag ${escapeHtml(geometryId)} ${anchor}" />`);
  };
  for (const entity of Object.values(sketchSession.draft.geometry)) {
    const cssClass = entity.construction ? "sketch-entity construction" : "sketch-entity";
    const value = entity.geometry;
    if (value.kind === "line") {
      const start = point(value.start); const end = point(value.end);
      geometry.push(`<line class="${cssClass}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`);
      handle(entity.id, "start", value.start); handle(entity.id, "end", value.end);
    } else if (value.kind === "circle") {
      const center = point(value.center);
      geometry.push(`<circle class="${cssClass}" cx="${center.x}" cy="${center.y}" r="${value.radius_nm / 100_000}" />`);
      handle(entity.id, "center", value.center);
    } else if (value.kind === "arc") {
      const start = point(value.start); const end = point(value.end); const center = point(value.center);
      const radius = Math.hypot(start.x - center.x, start.y - center.y);
      geometry.push(`<path class="${cssClass}" d="M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${value.clockwise ? 1 : 0} ${end.x} ${end.y}" />`);
      handle(entity.id, "center", value.center); handle(entity.id, "start", value.start); handle(entity.id, "end", value.end);
    } else {
      const min = point(value.min); const max = point(value.max);
      geometry.push(`<rect class="${cssClass}" x="${Math.min(min.x, max.x)}" y="${Math.min(min.y, max.y)}" width="${Math.abs(max.x - min.x)}" height="${Math.abs(max.y - min.y)}" />`);
      handle(entity.id, "min", value.min); handle(entity.id, "max", value.max);
    }
  }
  overlay.innerHTML = `${geometry.join("")}${handles.join("")}`;
}

async function applySketchClick(point: Point2): Promise<void> {
  if (!sketchSession || state.operation.type !== "sketch") return;
  const tool = sketchSession.activeTool;
  if (tool === "construction") {
    sketchConstruction = !sketchConstruction;
    document.querySelector<HTMLButtonElement>('[data-sketch-tool="construction"]')!.setAttribute("aria-pressed", String(sketchConstruction));
    return;
  }
  if (tool === "trim") {
    const line = Object.values(sketchSession.draft.geometry).reverse().find((entity) => entity.geometry.kind === "line");
    if (!line) return;
    const first = sketchSession.ids.next("geometry");
    const second = sketchSession.ids.next("geometry");
    await sketchSession.apply({ kind: "trim", operation: { kind: "split_line", source: line.id, first, second, at: point } });
    updateSketchStatus();
    return;
  }
  sketchPoints.push(point);
  const required = SKETCH_TOOL_SCHEMA.find((entry) => entry.id === tool)?.points ?? 0;
  if (sketchPoints.length < required) return;
  let commands: SketchCommand[];
  if (tool === "rectangle") commands = rectangleCommands(sketchSession.ids, sketchPoints[0], sketchPoints[1]);
  else commands = toolCommands(tool, sketchSession.ids, sketchPoints);
  if (sketchConstruction) {
    commands = commands.map((command) => command.kind === "add_geometry" ? { ...command, entity: { ...command.entity, construction: true } } : command);
  }
  sketchPoints = [];
  await sketchSession.applyAll(commands);
  updateSketchStatus();
}

async function applySketchConstraint(kind: (typeof CONSTRAINT_SCHEMA)[number]): Promise<void> {
  if (!sketchSession) return;
  const entities = Object.values(sketchSession.draft.geometry);
  const last = entities.at(-1);
  const previous = entities.at(-2);
  if (!last) return;
  const id = sketchSession.ids.next("constraint");
  const start = { geometry: last.id, anchor: "start" as const };
  const end = { geometry: last.id, anchor: "end" as const };
  let command: SketchCommand | undefined;
  if (kind === "horizontal" || kind === "vertical") command = { kind: "add_constraint", id, constraint: { kind, line: last.id } };
  else if (kind === "radius") command = { kind: "add_constraint", id, constraint: { kind, geometry: last.id, radius_nm: last.geometry.kind === "circle" ? last.geometry.radius_nm : 1_000_000 } };
  else if (kind === "distance") command = { kind: "add_constraint", id, constraint: { kind, a: start, b: end, distance_nm: 1_000_000 } };
  else if (kind === "coincident" && previous) command = { kind: "add_constraint", id, constraint: { kind, a: { geometry: previous.id, anchor: "end" }, b: start } };
  else if (kind === "angle" && previous) command = { kind: "add_constraint", id, constraint: { kind, first: previous.id, second: last.id, angle_microdegrees: 90_000_000 } };
  else if (previous) command = { kind: "add_constraint", id, constraint: { kind, first: previous.id, second: last.id } } as SketchCommand;
  if (!command) return;
  try { await sketchSession.apply(command); } catch { /* Solver status remains at the last accepted draft. */ }
  updateSketchStatus();
}

async function finishSketch(): Promise<void> {
  if (!sketchSession) return;
  if (!(await sketchSession.commit())) {
    updateSketchStatus();
    return;
  }
  document.querySelector<HTMLElement>("#sketch-toolbar")!.hidden = true;
  sketchSession = undefined;
  renderSketchOverlay();
  setOperation("committed", "sketch");
  const returnFocus = sketchReturnFocus;
  sketchReturnFocus = null;
  returnFocus?.focus();
}

function cancelSketch(): void {
  sketchSession?.cancel();
  sketchSession = undefined;
  sketchPoints = [];
  sketchDrag = undefined;
  renderSketchOverlay();
  document.querySelector<HTMLElement>("#sketch-toolbar")!.hidden = true;
  setOperation("cancelled", "sketch");
  const returnFocus = sketchReturnFocus;
  sketchReturnFocus = null;
  returnFocus?.focus();
}

function installRoving(host: HTMLElement, selector: string): void {
  const items = Array.from(host.querySelectorAll<HTMLButtonElement>(selector));
  items.forEach((item, index) => {
    item.tabIndex = index === 0 ? 0 : -1;
    item.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      let next = delta ? (index + delta + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[index].tabIndex = -1; items[next].tabIndex = 0; items[next].focus(); }
    });
  });
}

async function savePart(): Promise<void> {
  try {
    storage ??= await AppStorage.open();
    await storage.explicitSave(adapter.durableDocument());
    lastExplicitSaveChecksum = adapter.checksum();
    if (portableFileHandle) {
      pendingPortableSaveHandle = portableFileHandle;
      document.querySelector("#storage-status")!.textContent = "saving";
      worker?.postMessage({ type: "export-package" });
    } else document.querySelector("#storage-status")!.textContent = "saved";
  } catch (error) { storageFailure(error); }
}

const portablePickerType = { description: "Crawler portable part", accept: { "application/vnd.crawler.part+zip": [".crawlerpart"] } };

async function saveAsPortable(): Promise<void> {
  const picker = (window as PortablePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
      portableFileHandle = await picker({ suggestedName: `${base}.crawlerpart`, types: [portablePickerType] });
      pendingPortableSaveHandle = portableFileHandle;
      document.querySelector("#storage-status")!.textContent = "saving";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      storageFailure(error);
      return;
    }
  }
  worker?.postMessage({ type: "export-package" });
}

async function openPortablePart(): Promise<void> {
  const picker = (window as PortablePickerWindow).showOpenFilePicker;
  if (!picker) {
    document.querySelector<HTMLInputElement>("#open-part-file")!.click();
    return;
  }
  try {
    const [handle] = await picker({ types: [portablePickerType], multiple: false });
    if (!handle) return;
    const bytes = await (await handle.getFile()).arrayBuffer();
    portableFileHandle = handle;
    runtimeHydrated = true; sessionRecoveryDocument = undefined;
    worker?.postMessage({ type: "open-package", bytes }, [bytes]);
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") handleRuntimeFault(`Portable part could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function newPortablePart(): void {
  portableFileHandle = undefined;
  pendingPortableSaveHandle = undefined;
  runtimeHydrated = true; sessionRecoveryDocument = undefined;
  worker?.postMessage({ type: "new-document", documentId: `document:${crypto.randomUUID()}` });
}

let previousFocus: HTMLElement | null = null;
let onboarding: ReturnType<typeof installOnboarding>;
interface AppCommand {
  label: string;
  detail?: string;
  enabled: boolean;
  operationId?: string;
  run: () => void;
}

function openCatalogOperation(operation: AlphaOperation): void {
  if (operation.id === rectangleOperation.id) {
    document.querySelector<HTMLButtonElement>("#start-rectangle")!.click();
    return;
  }
  if (operation.id === extrudeOperation.id) {
    document.querySelector<HTMLButtonElement>("#start-pad")!.click();
    return;
  }
  const sketchTool = ({
    "crawler.sketch.line": "line",
    "crawler.sketch.circle": "circle",
    "crawler.sketch.arc": "arc",
    "crawler.sketch.trim": "trim",
    "crawler.sketch.construction": "construction",
  } as const)[operation.id as "crawler.sketch.line" | "crawler.sketch.circle" | "crawler.sketch.arc" | "crawler.sketch.trim" | "crawler.sketch.construction"];
  if (sketchTool) {
    selectedCatalogOperationId = null;
    renderDocument();
    startSketchEdit(sketchTool, operation.label);
    return;
  }
  editingAdvancedFeatureId = null;
  selectedCatalogOperationId = operation.id;
  if (isAdvancedFeatureOperation(operation.id) && operation.enablement.state === "enabled") {
    activeAdvancedOperationLabel = operation.label;
    setOperation("preview", "advanced");
  }
  renderInspector();
  const inspector = document.querySelector<HTMLElement>("#inspector")!;
  inspector.tabIndex = -1;
  inspector.focus();
}

const operationCommands: AppCommand[] = alphaOperations.map((operation) => ({
  label: operation.label,
  detail: operation.enablement.state === "disabled"
    ? operation.enablement.reason ?? "This operation is disabled."
    : `${operation.group.replaceAll("_", " ")} · ${lifecycleLabel(operation)}`,
  enabled: operation.enablement.state === "enabled",
  operationId: operation.id,
  run: () => openCatalogOperation(operation),
}));

const utilityCommands: AppCommand[] = [
  { label: "Focus feature timeline", run: () => { const timeline = document.querySelector<HTMLElement>("#timeline")!; timeline.tabIndex = -1; timeline.focus(); } },
  { label: "Save part", run: () => void savePart() },
  { label: "Save As portable part", run: saveAsPortable },
  { label: "New part", run: newPortablePart },
  { label: "Open portable part", run: () => void openPortablePart() },
  { label: "Import STEP body", run: () => document.querySelector<HTMLInputElement>("#import-step-file")!.click() },
  { label: "Retry accepted recovery source", run: () => startRuntime() },
  { label: "Restart quick tour", run: () => onboarding.restart() },
].map((command) => ({ ...command, enabled: true }));

const commands: AppCommand[] = [...operationCommands, ...utilityCommands];

function closeCommands(): void {
  document.querySelector<HTMLElement>("#command-search")!.hidden = true;
  previousFocus?.focus();
}

function renderCommands(): void {
  const query = document.querySelector<HTMLInputElement>("#command-query")!.value.trim().toLowerCase();
  const rank = (command: AppCommand): number => {
    const label = command.label.toLowerCase();
    if (label === query) return 0;
    if (label.startsWith(query)) return 1;
    if (label.includes(query)) return 2;
    return 3;
  };
  const matches = commands
    .filter((command) => `${command.label} ${command.detail ?? ""}`.toLowerCase().includes(query))
    .map((command, index) => ({ command, index }))
    .sort((left, right) => rank(left.command) - rank(right.command) || left.index - right.index)
    .map(({ command }) => command);
  const host = document.querySelector<HTMLElement>("#command-results")!;
  host.innerHTML = matches.map((command, index) => `<button role="option" aria-disabled="${!command.enabled}" data-command="${commands.indexOf(command)}" data-operation-id="${command.operationId ?? ""}" class="${index === 0 && command.enabled ? "active" : ""}" type="button" ${command.enabled ? "" : "disabled"}><span>${escapeHtml(command.label)}</span>${command.detail ? `<small>${escapeHtml(command.detail)}</small>` : ""}</button>`).join("");
  host.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => button.addEventListener("click", () => { closeCommands(); commands[Number(button.dataset.command)].run(); }));
}

function openCommands(): void {
  previousFocus = document.activeElement as HTMLElement;
  document.querySelector<HTMLElement>("#command-search")!.hidden = false;
  const input = document.querySelector<HTMLInputElement>("#command-query")!; input.value = ""; renderCommands(); input.focus();
}

document.querySelector("#retry-runtime")!.addEventListener("click", startRuntime);
document.querySelector("#save-part")!.addEventListener("click", () => void savePart());
document.querySelector("#save-as-part")!.addEventListener("click", saveAsPortable);
document.querySelector("#new-part")!.addEventListener("click", newPortablePart);
document.querySelector("#open-part")!.addEventListener("click", () => void openPortablePart());
document.querySelector("#import-step")!.addEventListener("click", () => document.querySelector<HTMLInputElement>("#import-step-file")!.click());
document.querySelector("#cancel-step-import")!.addEventListener("click", () => worker?.postMessage({ type: "cancel-step-import" }));
document.querySelector("#reimport-step")!.addEventListener("click", () => {
  if (safeMode || stepImportRunning || !stepSourceRetained) return;
  stepImportRunning = true;
  updateStepImportControls();
  setOperation("preview", "step-import");
  document.querySelector("#import-status")!.textContent = "re-importing retained STEP source…";
  worker?.postMessage({ type: "reimport-step" });
});
document.querySelector<HTMLInputElement>("#import-step-file")!.addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    const bytes = await file.arrayBuffer();
    const source = new Uint8Array(bytes);
    const sourceSha256 = await sha256Hex(source);
    storage ??= await AppStorage.open();
    await storage.retainImportedStepSource(sourceSha256, source);
    stepImportRunning = true;
    stepSourceRetained = true;
    updateStepImportControls();
    setOperation("preview", "step-import");
    document.querySelector("#import-status")!.textContent = "importing STEP…";
    const phaseDelayMs = Number(new URLSearchParams(location.search).get("stepImportDelay") ?? 0);
    worker?.postMessage({ type: "import-step", bytes, displayName: file.name.replace(/\.(step|stp)$/i, ""), phaseDelayMs }, [bytes]);
  } catch (error) { stepImportRunning = false; updateStepImportControls(); document.querySelector("#import-status")!.textContent = `STEP import failed: ${error instanceof Error ? error.message : String(error)}`; }
  finally { input.value = ""; }
});
document.querySelector<HTMLInputElement>("#open-part-file")!.addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    const bytes = await file.arrayBuffer();
    portableFileHandle = undefined;
    pendingPortableSaveHandle = undefined;
    runtimeHydrated = true; sessionRecoveryDocument = undefined;
    worker?.postMessage({ type: "open-package", bytes }, [bytes]);
  } catch (error) { handleRuntimeFault(`Portable part could not be opened: ${error instanceof Error ? error.message : String(error)}`); }
  finally { input.value = ""; }
});
document.querySelector("#start-pad")!.addEventListener("click", (event) => {
  if (safeMode) return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  beginExtrudePreview();
  const input = document.querySelector<HTMLInputElement>("#pad-length")!; input.focus(); input.select();
});
document.querySelector<HTMLInputElement>("#pad-length")!.addEventListener("input", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad") return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  updateExtrudePreviewFromField();
});
const extrudeManipulator = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
let extrudeManipulatorDrag: { pointerId: number; startY: number; startNanometers: number } | undefined;
extrudeManipulator.addEventListener("pointerdown", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad") return;
  event.preventDefault(); event.stopPropagation();
  const value = document.querySelector<HTMLInputElement>("#pad-length")!.valueAsNumber;
  extrudeManipulatorDrag = { pointerId: event.pointerId, startY: event.clientY, startNanometers: Math.round(value * 1_000_000) };
  extrudeManipulator.setPointerCapture(event.pointerId);
});
extrudeManipulator.addEventListener("pointermove", (event) => {
  const drag = extrudeManipulatorDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  const valueNanometers = Math.max(1_000, drag.startNanometers + Math.round((drag.startY - event.clientY) * 100_000));
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  input.value = String(valueNanometers / 1_000_000);
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  requestExtrudePreview(valueNanometers);
});
const finishExtrudeManipulatorDrag = (event: PointerEvent) => {
  if (!extrudeManipulatorDrag || extrudeManipulatorDrag.pointerId !== event.pointerId) return;
  extrudeManipulatorDrag = undefined;
  if (extrudeManipulator.hasPointerCapture(event.pointerId)) extrudeManipulator.releasePointerCapture(event.pointerId);
};
extrudeManipulator.addEventListener("pointerup", finishExtrudeManipulatorDrag);
extrudeManipulator.addEventListener("pointercancel", finishExtrudeManipulatorDrag);
extrudeManipulator.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commitExtrudePreview(); return; }
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelExtrudePreview(); return; }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault(); event.stopPropagation();
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  const stepMillimeters = event.shiftKey ? 0.1 : 1;
  input.value = String(Math.max(0.001, input.valueAsNumber + (event.key === "ArrowUp" ? stepMillimeters : -stepMillimeters)));
  requestExtrudePreview(Math.round(input.valueAsNumber * 1_000_000));
});
document.querySelector("#start-rectangle")!.addEventListener("click", (event) => {
  if (safeMode) return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  const previewStarted = performance.now(); setOperation("preview", "rectangle"); performanceEvidence.record("preview", performance.now() - previewStarted);
  const input = document.querySelector<HTMLInputElement>("#part-width")!; input.focus(); input.select();
});
document.querySelector("#edit-sketch")!.addEventListener("click", () => { if (!safeMode) startSketchEdit(); });
document.querySelector<HTMLCanvasElement>("#viewport")!.addEventListener("pointerdown", (event) => {
  if (state.operation.type === "sketch") { event.stopImmediatePropagation(); void applySketchClick(sketchPoint(event)); }
}, { capture: true });
const sketchOverlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
sketchOverlay.addEventListener("pointerdown", (event) => {
  const handle = (event.target as Element).closest<SVGCircleElement>("[data-sketch-handle]");
  if (!handle || !sketchSession) return;
  event.preventDefault();
  event.stopPropagation();
  const geometry = handle.dataset.geometry;
  const anchor = handle.dataset.anchor as PointRef["anchor"] | undefined;
  if (!geometry || !anchor) return;
  sketchDrag = { pointerId: event.pointerId, point: { geometry, anchor }, handle };
  handle.setPointerCapture(event.pointerId);
  sketchOverlay.dataset.dragging = "true";
});
sketchOverlay.addEventListener("pointermove", (event) => {
  if (!sketchDrag || sketchDrag.pointerId !== event.pointerId) return;
  const position = sketchOverlayPoint(sketchPoint(event), document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect());
  sketchDrag.handle.setAttribute("cx", String(position.x));
  sketchDrag.handle.setAttribute("cy", String(position.y));
});
sketchOverlay.addEventListener("pointerup", async (event) => {
  const active = sketchDrag;
  if (!active || active.pointerId !== event.pointerId || !sketchSession) return;
  sketchDrag = undefined;
  delete sketchOverlay.dataset.dragging;
  const started = performance.now();
  const accepted = await sketchSession.drag(active.point, sketchPoint(event));
  performanceEvidence.record("preview", performance.now() - started);
  updateSketchStatus();
  document.querySelector("#sketch-solver-state")!.setAttribute("data-last-drag", accepted ? "accepted" : "refused");
});
sketchOverlay.addEventListener("pointercancel", () => {
  sketchDrag = undefined;
  delete sketchOverlay.dataset.dragging;
  renderSketchOverlay();
});
window.addEventListener("resize", renderSketchOverlay);
document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => button.addEventListener("click", () => {
  if (!sketchSession) return;
  const selected = button.dataset.sketchTool!;
  if (selected === "construction") { void applySketchClick({ x_nm: 0, y_nm: 0 }); return; }
  sketchSession.activeTool = selected as typeof sketchSession.activeTool;
  sketchPoints = [];
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
}));
document.querySelectorAll<HTMLButtonElement>("[data-sketch-constraint]").forEach((button) => button.addEventListener("click", () => void applySketchConstraint(button.dataset.sketchConstraint as (typeof CONSTRAINT_SCHEMA)[number])));
document.querySelector("#commit-sketch")!.addEventListener("click", () => void finishSketch());
document.querySelector("#cancel-sketch")!.addEventListener("click", cancelSketch);
document.querySelector<HTMLSelectElement>("#sketch-plane")!.addEventListener("change", (event) => {
  if (!sketchSession) return;
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value === "face") {
    if (state.selection?.kind === "face") sketchSession.support = { kind: "topology", reference: state.selection.stableId };
    else (event.currentTarget as HTMLSelectElement).value = "xy";
  } else sketchSession.support = { kind: "origin_plane", plane: value as "xy" | "xz" | "yz" };
});
document.querySelector("#undo")!.addEventListener("click", () => {
  document.querySelector("#storage-status")!.textContent = "saving";
  worker?.postMessage({ type: "undo" });
});
document.querySelector("#redo")!.addEventListener("click", () => {
  document.querySelector("#storage-status")!.textContent = "saving";
  worker?.postMessage({ type: "redo" });
});
document.querySelector("#recover-runtime")!.addEventListener("click", startRuntime);
document.querySelector("#stay-safe")!.addEventListener("click", () => setSafeMode(true, "Read-only mode retained; the accepted source is unchanged."));
document.querySelector("#restart-tour")!.addEventListener("click", () => onboarding.restart());
document.querySelector("#command-query")!.addEventListener("input", renderCommands);
document.querySelector("#command-query")!.addEventListener("keydown", (event) => {
  const key = (event as KeyboardEvent).key;
  if (["Escape", "Enter", "ArrowDown", "ArrowUp"].includes(key)) event.stopPropagation();
  if (key === "Escape") closeCommands();
  if (key === "Enter") { event.preventDefault(); document.querySelector<HTMLButtonElement>("#command-results .active")?.click(); }
  if (["ArrowDown", "ArrowUp"].includes(key)) {
    event.preventDefault();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>("#command-results button:not(:disabled)"));
    if (!items.length) return;
    const active = Math.max(0, items.findIndex((item) => item.classList.contains("active")));
    const next = (active + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((item, index) => item.classList.toggle("active", index === next));
  }
});
document.querySelector("#fit-view")!.addEventListener("click", () => renderer?.fit());
document.querySelector("#projection-mode")!.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const mode = renderer?.projectionMode() === "perspective" ? "orthographic" : "perspective";
  renderer?.setProjection(mode);
  button.textContent = mode === "orthographic" ? "Orthographic" : "Perspective";
  button.setAttribute("aria-pressed", String(mode === "orthographic"));
});
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => renderer?.standardView(button.dataset.view as "front" | "top" | "right" | "isometric")));
document.querySelectorAll<HTMLInputElement>("[data-filter]").forEach((input) => input.addEventListener("change", () => {
  state.selectionFilters[input.dataset.filter as TopologyKind] = input.checked;
  renderer?.setFilters(state.selectionFilters); applySelection(null);
}));
document.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]").forEach((button) => button.addEventListener("click", () => {
  const panel = button.dataset.panelToggle as keyof typeof state.panels;
  state.panels[panel] = !state.panels[panel];
  document.querySelector(".workspace")!.classList.toggle(`hide-${panel}`, !state.panels[panel]);
  button.classList.toggle("inactive", !state.panels[panel]);
}));
document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((button) => button.addEventListener("click", () => {
  worker?.postMessage({ type: "export", format: button.dataset.export as ExportFormat });
}));
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommands(); return; }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); saveAsPortable(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void savePart(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newPortablePart(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); document.querySelector<HTMLInputElement>("#open-part-file")!.click(); return; }
  if (event.key === "Enter" && state.operation.status === "preview") {
    if (state.operation.type === "sketch") { event.preventDefault(); void finishSketch(); return; }
    if (state.operation.type === "rectangle") {
      const width = document.querySelector<HTMLInputElement>("#part-width")!.valueAsNumber;
      const height = document.querySelector<HTMLInputElement>("#part-height")!.valueAsNumber;
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        performanceEvidence.beginRecompute();
        worker?.postMessage({ type: "commit-dimensions", widthNanometers: Math.round(width * 1_000_000), heightNanometers: Math.round(height * 1_000_000) });
      }
    } else if (state.operation.type === "pad") {
      commitExtrudePreview();
    } else if (state.operation.type === "advanced" && selectedCatalogOperationId && isAdvancedFeatureOperation(selectedCatalogOperationId)) executeCatalogOperation(operationById(selectedCatalogOperationId));
  }
  if (event.key === "Escape" && state.operation.status === "preview") {
    if (state.operation.type === "sketch") { event.preventDefault(); cancelSketch(); return; }
    if (state.operation.type === "pad") { event.preventDefault(); cancelExtrudePreview(); return; }
    const trigger = state.operation.type === "rectangle" ? "#start-rectangle" : state.operation.type === "parameter" ? "#inspector [data-apply-parameter]" : "#command-button";
    selectedCatalogOperationId = null;
    setOperation("cancelled"); renderInspector(); document.querySelector<HTMLButtonElement>(trigger)?.focus();
  }
});

adapter = await loadDocumentAdapter();
const durableChecksum = adapter.checksum();
setReadiness("ui", "ready");
renderDocument();
  onboarding = installOnboarding(document.querySelector<HTMLElement>("#onboarding")!, ["#pad-length", "[data-timeline-id]", "#save-part"]);
void installPwa(() => { document.querySelector<HTMLElement>("#update-status")!.hidden = false; })
  .then((status) => { pwaStatus = status; })
  .catch((error) => { state.diagnostics.renderer = `Offline installation unavailable: ${error instanceof Error ? error.message : String(error)}`; renderDiagnostics(); });
startRuntime();

const api = {
  state: () => structuredClone(state),
  readiness: () => ({ ...state.readiness }),
  durableChecksum: () => adapter.checksum(),
  originalDurableChecksum: durableChecksum,
  transferredBytes: () => transferredBytes,
  dimensions: () => ({ ...currentDimensions }),
  geometryBounds: () => [...currentBounds],
  recompute: () => structuredClone(lastRecompute),
  selectFirst: (kind: TopologyKind, additive = false) => renderer?.selectFirst(kind, additive) ?? null,
  cameraPosition: () => renderer?.cameraPosition() ?? [],
  projectionMode: () => renderer?.projectionMode() ?? "perspective",
  hasExplicitSave: async () => storage?.hasExplicitSave((adapter.durableDocument() as { id: string }).id) ?? false,
  pwaStatus: () => pwaStatus(),
  onboarding: () => onboarding.state(),
  safeMode: () => safeMode,
  recoveryProvenance: () => recoveryProvenance,
  recoveryChoices: () => structuredClone(recoveryChoices),
  parameters: () => structuredClone(currentParameters),
  historyServices: () => ({ services: structuredClone(featureServices), repair: structuredClone(repairInspection), message: historyActionMessage }),
  inspectRepair: (observedTopology: readonly TopologyReferenceView[]) => requestFeatureServices(observedTopology),
  commitDocumentChanges: (changes: readonly Record<string, unknown>[]) => worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}:integration`, changes }),
  performanceEvidence: () => performanceEvidence.snapshot(),
  faultWorker: (message = "forced runtime fault") => worker?.postMessage({ type: "force-fault", message }),
  simulateQuotaFailure: () => storageFailure(new DOMException("quota exhausted", "QuotaExceededError")),
};

window.__crawlerApp = api;
