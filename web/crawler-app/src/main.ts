import "./style.css";

import { cadIcon } from "./cad-icons";
import { installThemeManager } from "./theme-manager";

import {
  AlignCenter,
  Anchor,
  Box,
  BoxSelect,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Command,
  Component,
  CornerDownRight,
  Crosshair,
  Download,
  EllipsisVertical,
  Equal,
  FileDown,
  FileText,
  FilePlus2,
  FileUp,
  FolderOpen,
  Hexagon,
  HardDriveDownload,
  Import,
  Layers3,
  LayoutGrid,
  LayoutPanelTop,
  LayoutTemplate,
  Link,
  List,
  Maximize2,
  Minus,
  Move,
  MoveHorizontal,
  MoveRight,
  MousePointer2,
  Orbit,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  PencilRuler,
  Pin,
  Plus,
  Redo2,
  RefreshCw,
  Rotate3D,
  RotateCcw,
  Ruler,
  Save,
  SaveAll,
  Search,
  Settings2,
  Split,
  SkipBack,
  SkipForward,
  Square,
  Spline,
  Sun,
  Table2,
  Undo2,
  View,
  X,
  Moon,
  BetweenHorizontalEnd,
  Circle,
  Copy,
  createIcons,
} from "lucide";

import { adapterFromWorkerSnapshot, DocumentAdapter, loadDocumentAdapter } from "./document-adapter";
import type { AdvancedFeatureCommand, AdvancedFeatureOperationId, ExportFormat, FeatureServicesView, NamedParameterView, OffsetConstructionPlaneFrame, OffsetConstructionPlaneRequest, PlanarFaceFrameAuthority, PlanarFaceFrameRequest, RenderPacket, RepairInspectionView, Selection, TopologyKind, TopologyReferenceView, WorkerResponse } from "./protocol";
import { normalizeExtrudeDistance, visibleExtrudeDistance, type ExtrudeDirection } from "./extrude-direction";
import { ExtrudeTargetError, isExtrudeCutErrorCode, parseExtrudeResultMode, requireSingleCutTarget, retainedExtrudeBody, type ExtrudeResultMode } from "./extrude-result-mode";
import { buildOffsetConstructionPlaneRequest, constructionPlaneOffsetInputError, isConstructionPlaneRuntimeErrorCode, isConstructionPlaneSupportRuntimeErrorCode, offsetNanometersToMillimeters } from "./offset-construction-plane";
import { SKETCH_SVG_LAYER_NAMES, SketchSvgLayerCache, type SketchSvgLayerName } from "./sketch-svg-layer-cache";
import { SketchSnapSpatialIndexCache } from "./sketch-snap-spatial-index";
import { firstRetainedOperationId, retainedOperationGeometry, SketchRenderIndexCache } from "./sketch-render-indexes";
import { constraintKindLabel, constraintPointKey, constraintVisualOperands, layoutConstraintGlyphs, positionedConstraintVisualOperands, selectedConstraintIds, sketchConstraintCoverage, sketchConstraintIcon, sketchConstraintIconBody, sketchConstraintVisualState, sketchPointMobility, visibleConstraintIds, type ConstraintGlyphPlacement, type SketchConstraintVisualState, type SketchMobilityKind } from "./sketch-constraint-visuals";
import { IdentityRevisionTracker, LatestFrameCoordinator, mergeLatestPointerFrameWork, SketchPointerRenderCoordinator, type LatestPointerFrameWork } from "./sketch-pointer-render";
import { keyedSketchSvgMarkup, reconcileSketchSvgFragments, type SketchSvgFragment } from "./sketch-svg-reconciler";
import { WorkspaceRenderer, type CommittedSketchDisplay, type SketchSupportPick, type WorkspaceViewState } from "./renderer";
import type { ViewportStateController } from "./viewport-state";
import { initialState } from "./state";
import { AppStorage, type RecoveryChoice } from "./storage";
import { installOnboarding, type OnboardingAction } from "./onboarding";
import { PerformanceEvidence } from "./performance-evidence";
import { installPwa, type PwaStatus } from "./pwa";
import { CONSTRAINT_SCHEMA, SKETCH_TOOL_SCHEMA, SketchEditSession, StableSketchIds, constraintCommand, filterCenterOnLineTangencies, hydrateSketchFromDocument, sketchToolFacsimile, toolCommands, type Constraint, type ConstraintTool, type Geometry, type Point2, type PointRef, type PreparedSketchPreview, type Sketch, type SketchCommand, type SketchDraftView, type SketchOperation, type SketchRecipe, type SketchSupport, type SketchTool, type SketchTopologyReference } from "./sketch-editor";
import { SKETCH_CONSTRAINT_MANIFEST, SKETCH_TOOL_MANIFEST, constraintDisabledReason, parseSketchDimensionExpression, sketchEntityMatchesFilter, smartDimensionDisabledReason, smartDimensionKind, smartDimensionLinePlacementMode, summarizeSketchSelection, toolDisabledReason } from "./sketch-tool-manifest";
import { originPlaneSupport, planeLocalToWorldMillimeters, resolvedSketchPlanesEqual, resolveSketchPlane, worldMillimetersToPlaneLocal, type CurrentPlanarFaceEvidenceLookup, type ResolvedSketchPlane, type SketchPlaneDocument } from "./sketch-plane";
import { bodyAcceptsFeatureProducer, planarFaceAuthorityKey } from "./planar-face-authority";
import { sketchReferenceId } from "./parameter-references";
import { planIntersectionTrim } from "./sketch-trim";
import { closedProfileGeometryIds, closedProfilePolylines, constraintAnnotations, geometryPointRefs, inferSketchPoint, pointForRef, sketchGeometrySelectionPath, sketchProfileId, type SketchInference, type SketchSnap } from "./sketch-workspace";
import { blendCommands, breakCommands, canonicalOffsetCommands, chamferCommands, circularPatternCommands, conicCommands, ellipseCommands, ellipticalArcCommands, extendCommands, filletCommands, fitSplineCommands, linearPatternCommands, mirrorCommands, moveCopyCommands, planConnectedOffsetChain, pointCommands, scaleCommands, splineCommands, type OffsetChainInstrumentation } from "./sketch-operations";
import { evaluateGeometryCurve, projectPointToGeometryCurve, sampleConic, sampleControlPointSpline, sampleEllipse, sampleEllipticalArc, sampleFitPointSpline } from "./sketch-spline";
import { WorkerSketchBridge } from "./sketch-worker-bridge";
import { SKETCH_CREATION_VARIANTS, arcVariantCommands, circleVariantCommands, creationVariantPointCount, polygonVariantCommands, rectangleVariantCommands, slotVariantCommands, type ArcVariant, type CircleVariant, type PolygonVariant, type RectangleVariant, type SlotVariant } from "./sketch-creation";
import { deriveInlineCreationFields, solveInlineCreation, type InlineCreationContext, type InlineCreationField, type InlineCreationFieldKey } from "./sketch-inline-creation";
import { layoutSketchDimension, type DimensionPrimitive, type SketchDimensionLayoutInput } from "./sketch-dimension-layout";
import { explodeSketchTextCommand, sketchTextCommands, updatedSketchTextRecipe } from "./sketch-text";
import { exportSketchSvg, importSketchSvgCommands } from "./sketch-interchange";
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
const extrudeCutOperation = operationById("crawler.part.extrude.cut");
const extrudeDirectionParameter = parameterByKey(extrudeOperation, "direction");
const extrudeDirectionLabels: Record<string, string> = { positive: "Forward", negative: "Reverse", symmetric: "Symmetric" };
const extrudeDirectionOptions = extrudeDirectionParameter.choices
  .map((value) => `<option value="${value}" ${value === extrudeDirectionParameter.default.value ? "selected" : ""}>${extrudeDirectionLabels[value] ?? value}</option>`)
  .join("");
const ABSOLUTE_SKETCH_ORIGIN: Point2 = { x_nm: 0, y_nm: 0 };

interface RibbonTool {
  key: string;
  label: string;
  icon: string;
  id?: string;
  invoke?: string;
  operationId?: string;
  sketchTool?: SketchTool;
  sketchConstraint?: (typeof CONSTRAINT_SCHEMA)[number];
  comingSoon?: boolean;
  tone?: "blue" | "green" | "cyan" | "violet" | "amber";
}

type WorkbenchId = "Part Design" | "Sketcher" | "Assembly" | "Drawing" | "Mesh";
interface RibbonSection { id: string; label: string; tools: RibbonTool[] }
interface WorkbenchSpec { id: WorkbenchId; color: string; sections: RibbonSection[]; pinned: string[] }
interface MenuAction { label: string; icon?: string; shortcut?: string; invoke?: string; operationId?: string; exportFormat?: string; comingSoon?: boolean; id?: string; groupStart?: boolean }
interface ActiveToolContext { key: string; label: string; source: "ribbon" | "catalog" | "sketch" | "constraint" }

type ColorTheme = "light" | "dark";

const THEME_STORAGE_KEY = "crawler.theme";
const TOOLBAR_PREFERENCES_KEY = "crawler.toolbar-preferences";
const ACTIVE_DOCUMENT_ID_KEY = "crawler.active-document-id";
const qualificationReferencePart = new URLSearchParams(location.search).has("qualificationReferencePart");
const exposeFutureCapabilities = new URLSearchParams(location.search).has("showFutureCapabilities");
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");

type ToolbarPreferences = Partial<Record<WorkbenchId, string[]>>;
function readToolbarPreferences(): ToolbarPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOOLBAR_PREFERENCES_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Array.isArray(value) && value.every((key) => typeof key === "string"))) as ToolbarPreferences;
  } catch {
    return {};
  }
}
const toolbarPreferences = readToolbarPreferences();

function readActiveDocumentId(): string | undefined {
  try {
    const value = localStorage.getItem(ACTIVE_DOCUMENT_ID_KEY);
    return value && value.startsWith("document:") && value.length <= 512 ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeActiveDocumentId(documentId: string): void {
  if (!documentId.startsWith("document:") || documentId.length > 512) return;
  try { localStorage.setItem(ACTIVE_DOCUMENT_ID_KEY, documentId); } catch { /* Recovery remains available in-session. */ }
}

function writeToolbarPreferences(): void {
  try { localStorage.setItem(TOOLBAR_PREFERENCES_KEY, JSON.stringify(toolbarPreferences)); } catch { /* The current toolbar remains usable without persistence. */ }
}

function readThemePreference(): ColorTheme | undefined {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined;
  }
}

let themePreference = readThemePreference();
let activeTheme: ColorTheme = themePreference ?? (systemTheme.matches ? "light" : "dark");
document.documentElement.dataset.theme = activeTheme;
document.documentElement.dataset.themePreference = themePreference ?? "system";

function renderMenuAction(action: MenuAction): string {
  if (action.comingSoon && !exposeFutureCapabilities) return "";
  const behavior = action.id ? `id="${action.id}"` : action.invoke ? `data-invoke="${action.invoke}"` : action.operationId ? `data-catalog-operation="${action.operationId}"` : action.exportFormat ? `data-export-proxy="${action.exportFormat}"` : "";
  const disabled = action.comingSoon ? `class="coming-soon" aria-disabled="true" data-coming-soon="${action.label.replace("…", "")} - coming soon!" title="${action.label.replace("…", "")} - coming soon!"` : "";
  const separator = action.groupStart ? `<hr role="separator" />` : "";
  return `${separator}<button type="button" role="menuitem" ${behavior} ${disabled}><i data-lucide="${action.icon ?? "circle-dot"}"></i><span>${action.label}${action.shortcut ? `<small>${action.shortcut}</small>` : ""}</span></button>`;
}

function renderRibbonTool(tool: RibbonTool, pinned = true): string {
  const comingSoon = tool.comingSoon === true;
  const behavior = tool.id
    ? `id="${tool.id}"`
    : tool.sketchTool
      ? `data-sketch-tool="${tool.sketchTool}"`
      : tool.sketchConstraint
        ? `data-sketch-constraint="${tool.sketchConstraint}"`
    : tool.invoke
      ? `data-invoke="${tool.invoke}"`
      : tool.operationId
        ? `data-catalog-operation="${tool.operationId}"`
        : "";
  const availability = comingSoon
    ? `aria-disabled="true" data-coming-soon="${tool.label} - coming soon!" title="${tool.label} - coming soon!"`
    : `title="${tool.label}"`;
  return `<button class="ribbon-tool${comingSoon ? " coming-soon" : ""}${pinned ? " pinned" : ""}" type="button" ${behavior} ${availability} data-ribbon-tool="${tool.key}" data-tone="${tool.tone ?? "blue"}" draggable="false">${cadIcon(tool.key, tool.icon)}<span>${tool.label}</span></button>`;
}

function renderRibbonGroup(section: RibbonSection, pinned: ReadonlySet<string>): string {
  const visibleTools = section.tools.filter((tool) => exposeFutureCapabilities || !tool.comingSoon);
  if (!visibleTools.length) return "";
  return `<section class="ribbon-group" data-ribbon-section="${section.id}" aria-label="${section.label}"><div>${visibleTools.map((tool) => renderRibbonTool(tool, pinned.has(tool.key))).join("")}</div><small><button type="button" data-ribbon-flyout="${section.id}" aria-label="More ${escapeHtml(section.label)} operations" title="More ${escapeHtml(section.label)} operations" aria-expanded="false">${section.label}<i data-lucide="chevron-down"></i></button></small><div class="ribbon-flyout" data-ribbon-flyout-panel="${section.id}" hidden>${visibleTools.map((tool) => {
    const isPinned = pinned.has(tool.key);
    const pinAction = isPinned ? "Unpin" : "Pin";
    return `<div class="ribbon-flyout-row" data-ribbon-tool-row="${tool.key}"><button type="button" data-ribbon-run="${tool.key}" title="${tool.label}">${cadIcon(tool.key, tool.icon)}<span>${tool.label}</span></button><button class="ribbon-pin" type="button" data-ribbon-pin="${tool.key}" aria-pressed="${isPinned}" aria-label="${pinAction} ${tool.label} ${isPinned ? "from" : "to"} toolbar" title="${pinAction} ${tool.label} ${isPinned ? "from" : "to"} toolbar"><i data-lucide="pin"></i></button></div>`;
  }).join("")}</div></section>`;
}

const workbenchSpecs: WorkbenchSpec[] = [
  { id: "Part Design", color: "#0ea5e9", pinned: ["select", "box-select", "new-sketch", "offset-plane", "extrude", "revolve", "extrude-cut", "fillet", "chamfer", "linear-pattern", "combine", "measure"], sections: [
    { id: "select", label: "Select", tools: [{ key: "select", label: "Select", icon: "mouse-pointer-2", id: "select-tool" }, { key: "box-select", label: "Box Select", icon: "box-select", comingSoon: true }] },
    { id: "sketch", label: "Sketch", tools: [{ key: "new-sketch", label: "New Sketch", icon: "pencil-ruler", id: "edit-sketch", tone: "violet" }, { key: "rectangle", label: rectangleOperation.label, icon: "square", id: "start-rectangle", tone: "violet" }] },
    { id: "datum", label: "Reference", tools: [{ key: "offset-plane", label: "Plane", icon: "panel-top", id: "create-offset-plane", tone: "cyan" }] },
    { id: "add", label: "Create", tools: [{ key: "extrude", label: "Extrude", icon: "box-select", id: "start-pad", tone: "green" }, { key: "revolve", label: "Revolve", icon: "rotate-3-d", operationId: "crawler.part.revolve", tone: "green" }, { key: "loft", label: "Loft", icon: "layers-3", operationId: "crawler.part.loft", tone: "green" }, { key: "sweep", label: "Sweep", icon: "spline", operationId: "crawler.part.sweep", tone: "green" }] },
    { id: "remove", label: "Cut", tools: [{ key: "extrude-cut", label: "Extrude Cut", icon: "box", operationId: "crawler.part.extrude.cut", tone: "cyan" }, { key: "revolve-cut", label: "Revolve Cut", icon: "orbit", operationId: "crawler.part.revolve.cut", tone: "cyan" }] },
    { id: "modify", label: "Modify", tools: [{ key: "fillet", label: "Fillet", icon: "circle-dot", operationId: "crawler.part.fillet", tone: "violet" }, { key: "chamfer", label: "Chamfer", icon: "square", operationId: "crawler.part.chamfer", tone: "violet" }, { key: "draft", label: "Draft", icon: "spline", operationId: "crawler.part.draft", tone: "violet" }, { key: "shell", label: "Shell", icon: "box", operationId: "crawler.part.shell", tone: "violet" }] },
    { id: "pattern", label: "Pattern", tools: [{ key: "linear-pattern", label: "Linear Pattern", icon: "layout-panel-top", operationId: "crawler.part.pattern.linear", tone: "amber" }, { key: "circular-pattern", label: "Circular Pattern", icon: "orbit", operationId: "crawler.part.pattern.circular", tone: "amber" }, { key: "mirror", label: "Mirror", icon: "layers-3", operationId: "crawler.part.mirror", tone: "amber" }] },
    { id: "boolean", label: "Combine", tools: [{ key: "combine", label: "Combine", icon: "layers-3", operationId: "crawler.part.boolean.union" }, { key: "subtract", label: "Subtract", icon: "box-select", operationId: "crawler.part.boolean.cut" }, { key: "intersect", label: "Intersect", icon: "circle-dot", operationId: "crawler.part.boolean.intersect" }] },
    { id: "measure", label: "Inspect", tools: [{ key: "measure", label: "Measure", icon: "view", comingSoon: true }, { key: "measure-angle", label: "Measure Angle", icon: "orbit", comingSoon: true }] },
  ] },
  { id: "Sketcher", color: "#7c8ae0", pinned: ["sketch-select", "line", "arc", "circle", "rect", "trim", "construction", "coincident", "horizontal", "vertical", "fixed", "smart-sketch-dimension"], sections: [
    { id: "sketch-select", label: "Select", tools: [{ key: "sketch-select", label: "Select", icon: "mouse-pointer-2", id: "sketch-select-tool" }] },
    { id: "draw", label: "Draw", tools: [{ key: "line", label: "Line", icon: "spline", sketchTool: "line", tone: "violet" }, { key: "arc", label: "Arc", icon: "orbit", sketchTool: "arc", tone: "violet" }, { key: "circle", label: "Circle", icon: "circle-dot", sketchTool: "circle", tone: "violet" }, { key: "rect", label: "Rectangle", icon: "square", sketchTool: "rectangle", tone: "violet" }, { key: "point", label: "Point", icon: "circle-dot", sketchTool: "point", tone: "violet" }, { key: "text", label: "Text", icon: "file-text", sketchTool: "text", tone: "violet" }, { key: "spline", label: "Spline", icon: "spline", sketchTool: "spline", tone: "violet" }, { key: "fit-spline", label: "Fit Spline", icon: "spline", sketchTool: "fit_spline", tone: "violet" }, { key: "conic", label: "Conic", icon: "spline", sketchTool: "conic", tone: "violet" }, { key: "polygon", label: "Polygon", icon: "hexagon", sketchTool: "polygon", tone: "violet" }, { key: "slot", label: "Slot", icon: "between-horizontal-end", sketchTool: "slot", tone: "violet" }, { key: "ellipse", label: "Ellipse", icon: "circle", sketchTool: "ellipse", tone: "violet" }, { key: "elliptical-arc", label: "Elliptical Arc", icon: "orbit", sketchTool: "elliptical_arc", tone: "violet" }, { key: "trim", label: "Trim", icon: "x", sketchTool: "trim", tone: "violet" }, { key: "project", label: "Project", icon: "link", sketchTool: "project", tone: "violet" }] },
    { id: "format-sketch", label: "Format", tools: [{ key: "construction", label: "Normal / Construction", icon: "pencil-ruler", sketchTool: "construction", tone: "violet" }] },
    { id: "edit-sketch", label: "Edit", tools: [{ key: "offset", label: "Offset", icon: "copy", sketchTool: "offset" }, { key: "extend", label: "Extend", icon: "move-right", sketchTool: "extend" }, { key: "sketch-fillet", label: "Fillet", icon: "circle-dot", sketchTool: "sketch_fillet" }, { key: "sketch-chamfer", label: "Chamfer", icon: "square", sketchTool: "sketch_chamfer" }, { key: "sketch-mirror", label: "Mirror", icon: "layers-3", sketchTool: "sketch_mirror" }, { key: "sketch-rectangular-pattern", label: "Rectangular Pattern", icon: "layout-panel-top", sketchTool: "sketch_linear_pattern" }, { key: "sketch-circular-pattern", label: "Circular Pattern", icon: "orbit", sketchTool: "sketch_circular_pattern" }, { key: "sketch-break", label: "Break", icon: "split", sketchTool: "sketch_break" }, { key: "sketch-scale", label: "Scale", icon: "maximize-2", sketchTool: "sketch_scale" }, { key: "sketch-move-copy", label: "Move / Copy", icon: "move", sketchTool: "sketch_move_copy" }, { key: "sketch-blend", label: "Blend", icon: "spline", sketchTool: "sketch_blend" }] },
    { id: "constrain", label: "Constrain", tools: [{ key: "coincident", label: "Coincident", icon: "circle-dot", sketchConstraint: "coincident" }, { key: "horizontal", label: "Horizontal", icon: "minus", sketchConstraint: "horizontal" }, { key: "vertical", label: "Vertical", icon: "ellipsis-vertical", sketchConstraint: "vertical" }, { key: "parallel", label: "Parallel", icon: "equal", sketchConstraint: "parallel" }, { key: "perpendicular", label: "Perpendicular", icon: "corner-down-right", sketchConstraint: "perpendicular" }, { key: "tangent", label: "Tangent", icon: "orbit", sketchConstraint: "tangent" }, { key: "equal", label: "Equal", icon: "equal", sketchConstraint: "equal" }, { key: "fixed", label: "Fix / Unfix", icon: "anchor", sketchConstraint: "fixed" }, { key: "midpoint", label: "Midpoint", icon: "align-center", sketchConstraint: "midpoint" }, { key: "concentric", label: "Concentric", icon: "circle-dot", sketchConstraint: "concentric" }, { key: "point-on-object", label: "Point On Object", icon: "link", sketchConstraint: "point_on_object" }] },
    { id: "dimension", label: "Dimension", tools: [{ key: "smart-sketch-dimension", label: "Smart Dimension", icon: "ruler", id: "smart-sketch-dimension" }] },
  ] },
  { id: "Assembly", color: "#f59e0b", pinned: ["insert-part", "new-body", "rigid", "revolute-joint", "ground", "explode"], sections: [
    { id: "insert", label: "Insert", tools: [{ key: "insert-part", label: "Insert Component", icon: "box", tone: "amber", comingSoon: true }, { key: "new-body", label: "New Body", icon: "layers-3", tone: "amber", comingSoon: true }, { key: "new-component", label: "New Component", icon: "component", tone: "amber", comingSoon: true }] },
    { id: "joints", label: "Joints", tools: [{ key: "rigid", label: "Rigid Joint", icon: "link", tone: "amber", comingSoon: true }, { key: "revolute-joint", label: "Revolute Joint", icon: "rotate-3-d", tone: "amber", comingSoon: true }, { key: "slider", label: "Slider Joint", icon: "move-horizontal", tone: "amber", comingSoon: true }, { key: "cylindrical", label: "Cylindrical Joint", icon: "link", tone: "amber", comingSoon: true }, { key: "ball", label: "Ball Joint", icon: "orbit", tone: "amber", comingSoon: true }] },
    { id: "position", label: "Position", tools: [{ key: "ground", label: "Ground", icon: "anchor", comingSoon: true }, { key: "assembly-mirror", label: "Mirror Components", icon: "layers-3", tone: "amber", comingSoon: true }, { key: "assembly-linear", label: "Linear Component Pattern", icon: "layout-panel-top", tone: "amber", comingSoon: true }] },
    { id: "inspect", label: "Inspect", tools: [{ key: "explode", label: "Exploded View", icon: "maximize-2", comingSoon: true }, { key: "assembly-distance", label: "Measure", icon: "ruler", comingSoon: true }, { key: "interference", label: "Interference", icon: "layout-grid", comingSoon: true }] },
  ] },
  { id: "Drawing", color: "#10b981", pinned: ["standard-view", "section-view", "smart-dimension", "note", "table"], sections: [
    { id: "views", label: "Views", tools: [{ key: "standard-view", label: "Base View", icon: "layout-template", tone: "green", comingSoon: true }, { key: "section-view", label: "Section View", icon: "panel-top", tone: "green", comingSoon: true }, { key: "detail-view", label: "Detail View", icon: "search", tone: "green", comingSoon: true }, { key: "aux-view", label: "Auxiliary View", icon: "maximize-2", tone: "green", comingSoon: true }] },
    { id: "drawing-dimension", label: "Dimension", tools: [{ key: "smart-dimension", label: "Smart Dimension", icon: "ruler", comingSoon: true }, { key: "linear-dimension", label: "Linear Dimension", icon: "move-horizontal", comingSoon: true }, { key: "angular-dimension", label: "Angular Dimension", icon: "rotate-ccw", comingSoon: true }, { key: "radius-dimension", label: "Radius Dimension", icon: "circle-dot", comingSoon: true }] },
    { id: "annotate", label: "Annotate", tools: [{ key: "note", label: "Note", icon: "file-text", comingSoon: true }, { key: "centerline", label: "Centerline", icon: "align-center", comingSoon: true }, { key: "center-mark", label: "Center Mark", icon: "crosshair", comingSoon: true }] },
    { id: "drawing-insert", label: "Insert", tools: [{ key: "table", label: "Table", icon: "table-2", comingSoon: true }, { key: "bom", label: "Bill of Materials", icon: "list", comingSoon: true }] },
  ] },
  { id: "Mesh", color: "#94a3b8", pinned: [], sections: [] },
];

// Only expose workbenches that currently contain usable commands. Future
// workbenches remain in the catalog above so their definitions can be built
// out without presenting users with selectable dead ends.
const availableWorkbenchSpecs = workbenchSpecs.filter((spec) => spec.id === "Part Design" || spec.id === "Sketcher");

function renderWorkbenchRibbon(spec: WorkbenchSpec): string {
  const preferredOrder = toolbarPreferences[spec.id] ?? spec.pinned;
  const pinned = new Set(preferredOrder);
  const rank = new Map(preferredOrder.map((key, index) => [key, index]));
  const orderedSections = spec.sections.map((section) => ({
    ...section,
    tools: [...section.tools].sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER)),
  }));
  const content = orderedSections.length ? orderedSections.map((section) => renderRibbonGroup(section, pinned)).join("") : `<p class="empty-workbench">Mesh workbench — coming soon</p>`;
  return `<div class="ribbon-workbench" data-workbench-ribbon="${spec.id}" data-workbench-color="${spec.color}" ${spec.id === "Part Design" ? "" : "hidden"}>${content}${spec.id === "Sketcher" ? `<button id="finish-sketch-ribbon" type="button" class="finish-sketch"><i data-lucide="check"></i><span>Finish Sketch</span></button>` : ""}</div>`;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("application host is missing");

root.innerHTML = `
  <main class="shell ${activeTheme}" data-testid="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark"><i data-lucide="box"></i></span><div><strong>Crawler</strong><small>Part design</small></div></div>
      <nav class="app-menus" aria-label="Application menus">
        <details class="app-menu"><summary>File <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${[
            { label: "New", icon: "file-plus-2", shortcut: "Ctrl+N", invoke: "#new-part" }, { label: "Open…", icon: "folder-open", shortcut: "Ctrl+O", invoke: "#open-part" }, { label: "Open Recent ▶", icon: "folder-open", comingSoon: true },
            { label: "Save", icon: "save", shortcut: "Ctrl+S", invoke: "#save-part", groupStart: true }, { label: "Save As…", icon: "save-all", shortcut: "Ctrl+Shift+S", invoke: "#save-as-part" }, { label: "Save Copy…", icon: "save-all", id: "save-copy-part" },
            { label: "Import STEP…", icon: "import", invoke: "#import-step", groupStart: true }, { label: "Import Sketch SVG / DXF…", icon: "import", id: "import-sketch-command" }, { label: "Export STEP…", icon: "file-down", exportFormat: "step", groupStart: true }, { label: "Export STL…", icon: "file-down", exportFormat: "stl" }, { label: "Export OBJ…", icon: "file-down", exportFormat: "obj" },
            { label: "Appearance themes…", icon: "settings-2", id: "preferences-command", groupStart: true }, { label: "Quit", icon: "x", comingSoon: true },
          ].map(renderMenuAction).join("")}
        </div></details>
        <details class="app-menu"><summary>Edit <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${[
            { label: "Undo", icon: "undo-2", shortcut: "Ctrl+Z", invoke: "#undo" }, { label: "Redo", icon: "redo-2", shortcut: "Ctrl+Shift+Z", invoke: "#redo" },
            { label: "Cut", icon: "x", shortcut: "Ctrl+X", comingSoon: true, groupStart: true }, { label: "Copy", icon: "save", shortcut: "Ctrl+C", comingSoon: true }, { label: "Paste", icon: "import", shortcut: "Ctrl+V", comingSoon: true }, { label: "Delete", icon: "x", shortcut: "Del", comingSoon: true },
            { label: "Select All", icon: "box-select", shortcut: "Ctrl+A", comingSoon: true, groupStart: true }, { label: "Deselect All", icon: "mouse-pointer-2", shortcut: "Esc", comingSoon: true }, { label: "Find/Replace…", icon: "search", shortcut: "Ctrl+F", comingSoon: true },
          ].map(renderMenuAction).join("")}
        </div></details>
        <details class="app-menu"><summary>View <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${[
            { label: "Zoom In", icon: "maximize-2", comingSoon: true }, { label: "Zoom Out", icon: "maximize-2", comingSoon: true }, { label: "Fit All", icon: "maximize-2", shortcut: "F", invoke: "#fit-view" }, { label: "Fit Selection", icon: "maximize-2", shortcut: "Shift+F", comingSoon: true },
            { label: "Isometric", icon: "rotate-3-d", shortcut: "0", invoke: "[data-view='isometric']", groupStart: true }, { label: "Camera ▶", icon: "orbit", comingSoon: true },
            { label: "Part Design Workbench", icon: "layout-panel-top", invoke: "[data-workbench='Part Design']", groupStart: true }, { label: "Sketcher Workbench", icon: "layout-panel-top", invoke: "[data-workbench='Sketcher']" }, { label: "Task Panel", icon: "panel-left", invoke: "[data-panel-toggle='browser']" }, { label: "Properties", icon: "panel-right", invoke: "[data-panel-toggle='inspector']" }, { label: "Timeline", icon: "panel-bottom", invoke: "[data-panel-toggle='timeline']" }, { label: "Full Screen", icon: "maximize-2", id: "fullscreen-command", groupStart: true },
          ].map(renderMenuAction).join("")}
        </div></details>
        <details class="app-menu"><summary>Sketch <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${[
            { label: "New Sketch", icon: "pencil-ruler", invoke: "#edit-sketch" }, { label: "Finish Sketch", icon: "check", id: "finish-sketch-menu" },
            { label: "Line", icon: "spline", operationId: "crawler.sketch.line", groupStart: true }, { label: "Arc", icon: "orbit", operationId: "crawler.sketch.arc" }, { label: "Circle", icon: "circle-dot", operationId: "crawler.sketch.circle" }, { label: "Rectangle", icon: "square", operationId: "crawler.sketch.rectangle" }, { label: "Polygon", icon: "circle-dot", invoke: "[data-sketch-tool='polygon']" }, { label: "Spline", icon: "spline", invoke: "[data-sketch-tool='spline']" },
          ].map(renderMenuAction).join("")}
          <hr role="separator" />
          ${([[
            "coincident", "Coincident"], ["horizontal", "Horizontal"], ["vertical", "Vertical"], ["parallel", "Parallel"],
            ["perpendicular", "Perpendicular"], ["tangent", "Tangent"], ["equal", "Equal"], ["fixed", "Fix / Unfix"],
            ["midpoint", "Midpoint"], ["concentric", "Concentric"], ["point_on_object", "Point On Object"],
          ] as [ConstraintTool, string][]).map(([constraint, label]) => {
            return `<button type="button" role="menuitem" data-sketch-constraint="${constraint}" title="${escapeHtml(label)}"><i data-lucide="link"></i><span>${escapeHtml(label)}</span></button>`;
          }).join("")}
          <button type="button" role="menuitem" data-smart-dimension-proxy title="Smart Dimension"><i data-lucide="ruler"></i><span>Smart Dimension</span></button>
          ${renderMenuAction({ label: "Validate Sketch", icon: "check", comingSoon: true })}
        </div></details>
        <details class="app-menu"><summary>Model <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${[
            { label: "Extrude…", icon: "box-select", operationId: "crawler.part.extrude" }, { label: "Extrude Cut…", icon: "box", operationId: "crawler.part.extrude.cut" }, { label: "Revolve…", icon: "rotate-3-d", operationId: "crawler.part.revolve" }, { label: "Revolve Cut…", icon: "orbit", operationId: "crawler.part.revolve.cut" }, { label: "Loft…", icon: "layers-3", operationId: "crawler.part.loft" }, { label: "Sweep…", icon: "spline", operationId: "crawler.part.sweep" },
            { label: "Fillet…", icon: "circle-dot", operationId: "crawler.part.fillet", groupStart: true }, { label: "Chamfer…", icon: "square", operationId: "crawler.part.chamfer" }, { label: "Draft…", icon: "spline", operationId: "crawler.part.draft" }, { label: "Shell…", icon: "box", operationId: "crawler.part.shell" }, { label: "Boolean Union…", icon: "layers-3", operationId: "crawler.part.boolean.union", groupStart: true }, { label: "Boolean Subtract…", icon: "box-select", operationId: "crawler.part.boolean.cut" }, { label: "Boolean Intersect…", icon: "circle-dot", operationId: "crawler.part.boolean.intersect" }, { label: "Datum ▶", icon: "crosshair", comingSoon: true, groupStart: true },
          ].map(renderMenuAction).join("")}
        </div></details>
        <details class="app-menu app-menu-future" data-capability="future" hidden><summary>Assembly <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${["New Assembly", "Insert Component…", "Coincident…", "Tangent…", "Parallel…", "Perpendicular…", "Fix…", "Explode View"].map((label) => renderMenuAction({ label, icon: "layers-3", comingSoon: true })).join("")}
        </div></details>
        <details class="app-menu"><summary>Tools <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          <button type="button" role="menuitem" data-open-command-search><i data-lucide="search"></i><span>Command search<small>Ctrl+K</small></span></button>
          <hr role="separator" />
          <button type="button" role="menuitem" data-open-parameters><i data-lucide="settings-2"></i><span>Parameters…</span></button>
          ${["Spreadsheet…", "Measure Distance", "Measure Angle", "Macros…", "Addon Manager…"].map((label) => renderMenuAction({ label, icon: "ruler", comingSoon: true })).join("")}
        </div></details>
        <details class="app-menu app-menu-secondary"><summary>Insert <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          <button type="button" role="menuitem" data-invoke="#import-step"><i data-lucide="import"></i><span>Import STEP<small>.step · .stp</small></span></button>
          <button type="button" role="menuitem" data-import-sketch-proxy><i data-lucide="import"></i><span>Import Sketch<small>.svg · .dxf</small></span></button>
        </div></details>
        <details class="app-menu app-menu-secondary"><summary>Export <i data-lucide="chevron-down"></i></summary><div class="menu-popover" role="menu">
          ${["step", "stl", "obj"].map((format) => `<button type="button" role="menuitem" data-export-proxy="${format}"><i data-lucide="file-down"></i><span>${format.toUpperCase()}<small>${format === "step" ? "Editable CAD exchange" : "Mesh export"}</small></span></button>`).join("")}
          <button type="button" role="menuitem" data-sketch-export-proxy="svg"><i data-lucide="file-down"></i><span>SVG<small>Active sketch vectors</small></span></button>
          <button type="button" role="menuitem" data-sketch-export-proxy="dxf"><i data-lucide="file-down"></i><span>DXF<small>Active sketch exchange</small></span></button>
        </div></details>
        <details class="app-menu"><summary>Help <i data-lucide="chevron-down"></i></summary><div class="menu-popover menu-popover-right" role="menu">
          <button type="button" role="menuitem" data-invoke="#restart-tour"><i data-lucide="circle-help"></i><span>Quick tour<small>Learn the core workflow</small></span></button>
          <hr role="separator" />
          <button type="button" role="menuitem" data-invoke="#retry-runtime"><i data-lucide="refresh-cw"></i><span>Restart editing<small>Reload the last good model state</small></span></button>
          ${["Documentation", "Examples…", "Check for Updates", "About"].map((label) => renderMenuAction({ label, icon: "circle-help", comingSoon: true })).join("")}
        </div></details>
      </nav>
      <div class="topbar-status-cluster">
        <div class="document-state" aria-label="Document status"><strong id="top-document-name">Bracket.crawlerpart</strong><span id="storage-status">local</span></div>
        <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="${activeTheme === "light"}" aria-label="Switch to ${activeTheme === "light" ? "dark" : "light"} mode" title="Switch to ${activeTheme === "light" ? "Dark" : "Light"} Mode"><i class="theme-sun" data-lucide="sun"></i><i class="theme-moon" data-lucide="moon"></i></button>
      </div>
      <div class="quick-actions" aria-label="Quick file actions">
        <button id="new-part" class="icon-button quiet" type="button" aria-label="New part" title="New part (Ctrl+N)"><i data-lucide="file-plus-2"></i></button>
        <button id="open-part" class="icon-button quiet" type="button" aria-label="Open part" title="Open part (Ctrl+O)"><i data-lucide="folder-open"></i></button><input id="open-part-file" type="file" accept=".crawlerpart,application/vnd.crawler.part+zip" hidden />
        <button id="save-part" class="icon-button quiet" type="button" aria-label="Save part" title="Save part (Ctrl+S)"><i data-lucide="save"></i></button>
        <button id="save-as-part" class="icon-button quiet" type="button" aria-label="Save part as" title="Save part as (Ctrl+Shift+S)"><i data-lucide="save-all"></i></button>
        <span class="toolbar-separator"></span>
        <button id="undo" class="icon-button quiet" type="button" aria-label="Undo" title="Undo (Ctrl+Z)"><i data-lucide="undo-2"></i></button>
        <button id="redo" class="icon-button quiet" type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><i data-lucide="redo-2"></i></button>
      </div>
      <div class="exchange-actions" aria-label="Import and export">
        <button id="import-step" class="icon-button quiet" type="button" aria-label="Import STEP" title="Import STEP"><i data-lucide="import"></i></button><input id="import-step-file" type="file" accept=".step,.stp,model/step" hidden />
        ${["step", "stl", "obj"].map((format) => `<button class="format-button quiet export-command" data-export="${format}" type="button" aria-label="Export ${format.toUpperCase()}" title="Export ${format.toUpperCase()}"><i data-lucide="file-down"></i><span>${format.toUpperCase()}</span></button>`).join("")}
      </div>
      <div class="import-followup-actions" aria-label="STEP import actions">
        <button id="cancel-step-import" class="icon-button quiet import-followup" type="button" aria-label="Cancel STEP import" title="Cancel import" disabled><i data-lucide="x"></i></button>
        <button id="reimport-step" class="icon-button quiet import-followup" type="button" aria-label="Re-import STEP" title="Re-import STEP" disabled><i data-lucide="refresh-cw"></i></button>
      </div>
      <div class="runtime-summary" aria-label="Runtime readiness">
        <div class="readiness">
          ${["ui", "wasm", "worker", "renderer"].map((stage) => `<span class="ready-pill" data-stage="${stage}" title="${stage}"><i></i><span>${stage}</span><b>idle</b></span>`).join("")}
        </div>
        <button id="retry-runtime" class="icon-button quiet" type="button" aria-label="Restart editing" title="Restart editing"><i data-lucide="refresh-cw"></i></button>
        <button id="restart-tour" class="icon-button quiet" type="button" aria-label="Restart quick tour" title="Quick tour"><i data-lucide="circle-help"></i></button>
      </div>
      <output id="import-status" class="sr-only" role="status" aria-live="polite">no import</output>
      <span id="update-status" hidden>Update ready for next launch</span>
    </header>
    <nav class="workbench-tabs" aria-label="Workbenches">
      ${availableWorkbenchSpecs.map((spec) => `<button class="${spec.id === "Part Design" ? "active" : ""}" type="button" data-workbench="${spec.id}" data-workbench-color="${spec.color}" ${spec.id === "Part Design" ? 'aria-current="page"' : ""}>${spec.id}</button>`).join("")}
      <button class="parameters-shortcut" type="button" data-open-parameters title="Open parameters"><i data-lucide="settings-2"></i><span>Parameters</span></button>
    </nav>
    <section class="commandbar" aria-label="Part Design commands">
      <div class="ribbon-scroll" id="ribbon-scroll">
        ${availableWorkbenchSpecs.map(renderWorkbenchRibbon).join("")}
      </div>
      <button class="command-search-hint quiet" type="button" data-open-command-search title="Search commands (Ctrl+K)"><i data-lucide="search"></i><span>Search</span><kbd>Ctrl K</kbd></button>
      <button id="toolbar-customize" class="toolbar-customize-toggle quiet" type="button" aria-expanded="false" aria-controls="toolbar-customize-panel" title="Customize toolbar"><i data-lucide="settings-2"></i><span>Customize</span></button>
      <section id="toolbar-customize-panel" class="toolbar-customize-panel" role="dialog" aria-modal="false" aria-labelledby="toolbar-customize-title" hidden>
        <header><div><strong id="toolbar-customize-title">Customize toolbar</strong><small id="toolbar-customize-context"></small></div><button id="close-toolbar-customize" type="button" aria-label="Close toolbar customization">×</button></header>
        <p>Choose the commands shown in the ribbon. While this panel is open, drag shown commands within a group to reorder them.</p>
        <div id="toolbar-customize-list"></div>
        <footer><button id="reset-toolbar-customize" class="quiet" type="button">Restore defaults</button><button id="done-toolbar-customize" type="button">Done</button></footer>
      </section>
      <span class="operation-state" id="operation-state" role="status">Operation: idle</span>
    </section>
    <section class="workspace">
      <div class="browser-rail" aria-label="Browser panels">
        <button class="active" type="button" data-invoke="[data-panel-toggle='browser']" aria-label="Toggle model browser" title="Model browser"><i data-lucide="layers-3"></i></button>
      </div>
      <aside class="browser-panel panel" data-testid="browser-region">
        <div class="panel-title"><span>Browser</span><small id="document-name">•••</small></div>
        <nav id="feature-browser" aria-label="feature browser"></nav>
        <footer id="browser-summary">Loading document…</footer>
      </aside>
      <section class="viewport-region" data-testid="viewport-region">
        <canvas id="viewport" tabindex="0" aria-label="3D viewport"></canvas>
        <section id="empty-document-actions" class="empty-document-actions" aria-labelledby="empty-document-title" hidden>
          <h2 id="empty-document-title">Start your part</h2>
          <p>Choose the next modeling step. This card disappears as soon as the document has content.</p>
          <div><button type="button" data-empty-action="sketch"><i data-lucide="pencil-ruler"></i><span>Create sketch</span></button><button type="button" data-empty-action="import"><i data-lucide="import"></i><span>Import STEP</span></button><button type="button" data-empty-action="open"><i data-lucide="folder-open"></i><span>Open part</span></button></div>
        </section>
        <div id="view-cube" class="view-cube" role="group" aria-label="Interactive orientation cube"></div>
        <fieldset class="dimension-panel" data-operation="idle" aria-label="Active operation dimensions" aria-hidden="true"><legend>Operation input</legend>
          <label class="dimension-control rectangle-dimension"><span>${parameterByKey(rectangleOperation, "width").label}</span><input id="part-width" aria-label="Rectangle width in millimeters" type="number" min="0.001" step="0.001" value="40" /><b>mm</b></label>
          <label class="dimension-control rectangle-dimension"><span>${parameterByKey(rectangleOperation, "height").label}</span><input id="part-height" aria-label="Rectangle height in millimeters" type="number" min="0.001" step="0.001" value="28" /><b>mm</b></label>
          <label class="dimension-control pad-dimension"><span id="extrude-distance-label">${parameterByKey(extrudeOperation, "distance").label}</span><input id="pad-length" aria-label="Extrude distance in millimeters" aria-describedby="operation-dimension-hint extrude-normalization-status" type="number" min="0.001" step="0.000001" value="20" /><b>mm</b></label>
          <label class="dimension-control pad-dimension extrude-direction-control"><span>${extrudeDirectionParameter.label}</span><select id="extrude-direction-mode" aria-label="Extrude direction mode" data-value-kind="${extrudeDirectionParameter.value_kind}">${extrudeDirectionOptions}</select></label>
          <label class="dimension-control pad-dimension extrude-result-control"><span>Result</span><select id="extrude-result-mode" aria-label="Extrude result mode"><option value="new_body">New Body</option><option value="cut">Cut</option></select></label>
          <label id="extrude-target-control" class="dimension-control pad-dimension extrude-target-control" hidden><span>Target body</span><select id="extrude-target-body" aria-label="Cut target body"><option value="">Select target…</option></select></label>
          <small id="extrude-normalization-status" class="extrude-normalization-status" role="status"></small>
          <small id="operation-dimension-hint" class="operation-dimension-hint">Enter accepts · Escape cancels</small>
        </fieldset>
        <button id="extrude-manipulator" class="extrude-manipulator" type="button" role="slider" aria-label="Extrude distance" aria-valuemin="0.001" aria-valuenow="12" hidden>
          <span aria-hidden="true">↕</span><output>12 mm</output><small>drag · Enter accept · Esc cancel</small>
        </button>
        <svg id="sketch-overlay" aria-label="Editable sketch geometry" hidden></svg>
        <form id="sketch-dimension-editor" class="sketch-dimension-editor" aria-label="Dimension editor" hidden>
          <span id="sketch-dimension-editor-title" class="sketch-dimension-title">Smart Dimension</span>
          <label id="sketch-dimension-mode-field" class="sketch-dimension-mode"><select id="sketch-dimension-editor-mode" aria-label="Dimension mode"></select></label>
          <div id="sketch-dimension-fields" class="sketch-dimension-fields">
            <label class="sketch-dimension-expression"><span id="sketch-dimension-field-label">Value</span><input id="active-tool-constraint-value" type="text" inputmode="decimal" autocomplete="off" aria-label="Dimension value" /><b id="sketch-dimension-editor-unit">mm</b></label>
          </div>
          <button id="sketch-dimension-lock" class="sketch-dimension-accept" type="submit" aria-label="Accept dimension">↵</button>
          <small id="sketch-dimension-hint" class="sketch-dimension-hint">Tab next · Enter accept · Esc cancel</small>
        </form>
        <div class="viewport-tools" aria-label="selection filters">
          <span>Selection</span>${["body", "face", "edge", "vertex"].map((kind) => `<label title="Select ${kind}"><input data-filter="${kind}" type="checkbox" checked /><i data-lucide="${kind === "body" ? "box" : kind === "face" ? "square" : kind === "edge" ? "spline" : "circle-dot"}"></i><span>${kind}</span></label>`).join("")}
        </div>
        <div class="sketch-selection-filters" aria-label="Sketch selection filters" hidden>
          <button id="sketch-selection-filter-toggle" type="button" aria-expanded="false" title="Selection filters"><span>Select</span><i data-lucide="chevron-down"></i></button>${[["curves", "Curves"], ["points", "Points"], ["construction", "Construction"], ["external", "Projected"], ["constraints", "Constraints"], ["dimensions", "Dimensions"]].map(([kind, label]) => `<label title="Select ${label.toLowerCase()}"><input data-sketch-filter="${kind}" type="checkbox" checked /><span>${label}</span></label>`).join("")}
        </div>
        <div id="sketch-selection-tray" class="sketch-selection-tray" role="toolbar" aria-label="Sketch selection actions" hidden>
          <div class="sketch-selection-tray-summary"><strong data-selection-count>0 selected</strong><span data-selection-mix>Selection</span></div>
          <div class="sketch-selection-tray-actions">
            <button type="button" data-sketch-selection-mode="add" aria-pressed="false" title="Keep adding to the selection (Shift)"><i data-lucide="plus"></i><span>Add</span></button>
            <button type="button" data-sketch-selection-mode="remove" aria-pressed="false" title="Remove targets from the selection"><i data-lucide="minus"></i><span>Remove</span></button>
            <button type="button" data-sketch-selection-clear title="Clear selection (Escape)"><i data-lucide="x"></i><span>Clear</span></button>
          </div>
          <small><kbd>Shift</kbd> add · <kbd>Ctrl</kbd> toggle · drag → window / ← crossing</small>
        </div>
        <output id="sketch-hover-card" class="sketch-hover-card" aria-live="polite" hidden><strong></strong><code></code><span></span></output>
        <div id="sketch-select-other" class="sketch-select-other" role="menu" aria-label="Select overlapping sketch geometry" hidden></div>
        <div class="viewport-nav" aria-label="View commands">
          ${["front", "top", "right", "isometric"].map((view) => `<button class="icon-button quiet view-command" data-view="${view}" type="button" aria-label="${view} view" title="${view} view"><i data-lucide="${view === "isometric" ? "rotate-3-d" : "view"}"></i><span>${view === "isometric" ? "ISO" : view[0].toUpperCase()}</span></button>`).join("")}
          <span class="toolbar-separator"></span>
          <button id="fit-view" class="icon-button quiet" type="button" aria-label="Fit view" title="Fit view"><i data-lucide="maximize-2"></i></button>
          <button id="toggle-grid" class="icon-button quiet" type="button" aria-pressed="true" aria-label="Toggle grid" title="Toggle Grid"><i data-lucide="layout-grid"></i></button>
          <button id="projection-mode" class="icon-button projection-button quiet" type="button" aria-pressed="false" aria-label="Toggle orthographic projection" title="Perspective projection"><i data-lucide="orbit"></i><span>Perspective</span></button>
          <button id="viewport-background" class="viewport-background-button quiet" type="button" aria-expanded="false" title="Viewport background"><span aria-hidden="true"></span>BG<i data-lucide="chevron-down"></i></button>
        </div>
        <div id="viewport-background-menu" class="viewport-background-menu" hidden>
          ${[["dark-cad", "Dark CAD", "#0c0d10"], ["midnight", "Midnight", "#0a1628"], ["graphite", "Graphite", "#1a1d23"], ["slate", "Slate", "#334155"], ["studio", "Studio", "#b8bec8"]].map(([id, label, color]) => `<button type="button" data-viewport-bg="${color}" data-bg-id="${id}"><span style="background:${color}"></span>${label}</button>`).join("")}
          <label>Custom <input id="viewport-background-custom" type="text" value="#0c0d10" placeholder="#rrggbb" /></label>
        </div>
        <div class="panel-dock" aria-label="Panel visibility">
          <button class="icon-button quiet panel-command" data-panel-toggle="browser" type="button" aria-label="Toggle model browser" title="Model browser"><i data-lucide="panel-left"></i></button>
          <button class="icon-button quiet panel-command" data-panel-toggle="timeline" type="button" aria-label="Toggle timeline" title="Feature timeline"><i data-lucide="panel-bottom"></i></button>
          <button class="icon-button quiet panel-command" data-panel-toggle="inspector" type="button" aria-label="Toggle inspector" title="Inspector"><i data-lucide="panel-right"></i></button>
        </div>
        <output id="preselection-readout">Hover: none</output>
        <output id="selection-readout">Selection: none</output>
      </section>
      <aside class="inspector-panel panel" data-testid="inspector-region" aria-label="Context panel">
        <div class="inspector-drag-handle" title="Drag properties panel"><span></span></div>
        <div class="inspector-tabs">
          <div class="inspector-tablist" role="tablist" aria-label="Context views">
            <button id="inspector-tool-tab" type="button" role="tab" aria-controls="inspector" aria-selected="false" tabindex="-1" data-inspector-tab="tool" hidden>Tool</button>
            <button id="inspector-properties-tab" class="active" type="button" role="tab" aria-controls="inspector" aria-selected="true" tabindex="0" data-inspector-tab="properties">Properties</button>
            <button id="inspector-constraints-tab" type="button" role="tab" aria-controls="inspector" aria-selected="false" tabindex="-1" data-inspector-tab="constraints">Constraints</button>
            <button id="inspector-appearance-tab" type="button" role="tab" aria-controls="inspector" aria-selected="false" tabindex="-1" data-inspector-tab="appearance">Appearance</button>
          </div>
          <button id="inspector-layout" class="inspector-layout-toggle" type="button" aria-pressed="false" aria-label="Float properties panel" title="Float properties panel"><i data-lucide="panel-right"></i><span>Float</span></button>
        </div>
        <div id="inspector" role="tabpanel" aria-labelledby="inspector-properties-tab" aria-live="polite"></div>
      </aside>
      <section class="timeline-panel panel" data-testid="timeline-region">
        <div class="panel-title"><span>History</span><div class="history-controls"><button id="history-start" type="button" title="Go to start" aria-label="Go to start"><i data-lucide="skip-back"></i></button><button id="history-back" type="button" title="Step back" aria-label="Step back"><i data-lucide="chevron-left"></i></button><button id="history-forward" type="button" title="Step forward" aria-label="Step forward"><i data-lucide="chevron-right"></i></button><button id="history-end" type="button" title="Go to end" aria-label="Go to end"><i data-lucide="skip-forward"></i></button></div><small id="timeline-status" role="status">Solver: ready</small></div>
        <div id="timeline"></div>
      </section>
    </section>
    <footer class="statusbar" role="status" aria-label="Modeling status">
      <span class="status-hint">Left click select/place · Middle drag orbit · Ctrl+middle pan · Wheel zoom</span>
      <span>DOF: <b>0</b></span><span>Constraints: <b>ready</b></span><span id="statusbar-selection">Selection: none</span><span>Units: <b>mm</b></span><span id="statusbar-operation">Operation: idle</span><span id="statusbar-storage">local</span>
    </footer>
    <section id="onboarding" aria-label="Quick tour"></section>
    <section id="action-error" class="error-flyin" role="alert" aria-labelledby="action-error-title" hidden><header><span class="error-flyin-icon" aria-hidden="true">!</span><strong id="action-error-title"></strong><button id="dismiss-action-error" class="quiet" type="button" aria-label="Dismiss error">×</button></header><ul class="error-tree"><li><span>Cause</span><strong id="action-error-reason"></strong><ul><li><span>Next</span><strong id="action-error-next"></strong></li></ul></li></ul></section>
    <section id="safe-mode" class="error-flyin" role="alert" aria-labelledby="safe-mode-title" hidden><header><span class="error-flyin-icon" aria-hidden="true">!</span><strong id="safe-mode-title">Editing couldn’t continue</strong></header><ul class="error-tree"><li><span>Cause</span><strong id="safe-reason"></strong><ul><li><span>Model</span><strong id="safe-impact">Your last completed model state is safe. Restoring it discards only the unfinished action.</strong></li></ul></li></ul><div class="error-flyin-actions"><button id="recover-runtime" type="button">Restore and continue</button><button id="stay-safe" class="quiet" type="button">View read-only</button></div></section>
    <div id="modal-scrim" class="modal-scrim" aria-hidden="true" hidden></div>
    <div id="command-search" role="dialog" aria-modal="true" aria-labelledby="command-search-title" hidden><h2 id="command-search-title" class="sr-only">Command search</h2><label>Command <input id="command-query" type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="command-results" aria-expanded="false" aria-describedby="command-result-status" /></label><div id="command-results" role="listbox" aria-label="Matching commands"></div><output id="command-result-status" class="sr-only" role="status" aria-live="polite"></output></div>
    <div id="parameters-dialog" role="dialog" aria-modal="true" aria-labelledby="parameters-dialog-title" hidden><div class="dialog-card">
      <header><span class="window-lights" aria-hidden="true"><i></i><i></i><i></i></span><h2 id="parameters-dialog-title">Parameters</h2><code id="parameters-document-name">Bracket</code><span id="parameter-health"></span><button id="close-parameters" type="button" aria-label="Close parameters">×</button></header>
      <div class="parameters-toolbar"><label><i data-lucide="search"></i><input id="parameters-filter" type="search" placeholder="Filter…" aria-label="Filter parameters" /></label></div>
      <div class="parameter-columns" aria-hidden="true"><span></span><span>Name</span><span>Expression</span><span>Value</span><span>Unit</span><span>Refs</span><span>Description</span></div>
      <div id="parameters-dialog-list"></div>
      <footer><small>Only explicitly defined parameters appear here</small><button id="parameters-edit-inspector" type="button">Set up sketch parameters</button><button type="button" data-close-parameters>Apply</button></footer>
    </div></div>
    <div id="viewport-context-menu" class="context-surface" role="menu" aria-label="Viewport context menu" hidden>
      <label class="context-search"><i data-lucide="search"></i><input type="search" data-context-filter="viewport" placeholder="Search commands…" aria-label="Search viewport commands" /></label>
      <small>View</small>
      <button type="button" role="menuitem" data-context-label="Fit All" data-invoke="#fit-view"><i data-lucide="maximize-2"></i><span>Fit All</span><kbd>F</kbd></button>
      <button class="coming-soon" type="button" role="menuitem" data-context-label="Fit Selection" aria-disabled="true" data-coming-soon="Fit Selection - coming soon!" title="Fit Selection - coming soon!"><i data-lucide="maximize-2"></i><span>Fit Selection</span><kbd>⇧F</kbd></button>
      <small>Standard Views</small>
      ${[["front", "Front", "1"], ["back", "Back", "4"], ["right", "Right", "3"], ["left", "Left", "6"], ["top", "Top", "7"], ["bottom", "Bottom", "9"], ["isometric", "Isometric", "0"]].map(([view, label, shortcut]) => `<button type="button" role="menuitem" data-context-label="${label}" data-context-view="${view}"><i data-lucide="view"></i><span>${label}</span><kbd>Num ${shortcut}</kbd></button>`).join("")}
      <small>Draw Style</small>
      ${[["shaded-edges", "Shaded with Edges", "V, 1"], ["shaded", "Shaded", "V, 2"], ["wireframe", "Wireframe", "V, 3"], ["hidden-line", "Hidden Line", "V, 4"], ["no-shading", "No Shading", "V, 5"]].map(([mode, label, shortcut]) => `<button type="button" role="menuitem" data-context-label="${label}" data-display-mode="${mode}"><i data-lucide="layout-grid"></i><span>${label}</span><kbd>${shortcut}</kbd></button>`).join("")}
      <small>Create</small>
      <button type="button" role="menuitem" data-context-label="New Sketch" data-invoke="#edit-sketch"><i data-lucide="pencil-ruler"></i><span>New Sketch</span><kbd>S</kbd></button>
      <button type="button" role="menuitem" data-context-label="Extrude" data-invoke="#start-pad"><i data-lucide="box-select"></i><span>Extrude…</span><kbd>P</kbd></button>
      <button type="button" role="menuitem" data-context-label="Extrude Cut" data-catalog-operation="crawler.part.extrude.cut"><i data-lucide="box"></i><span>Extrude Cut…</span><kbd>⇧P</kbd></button>
      <small>Visibility</small>
      <button type="button" role="menuitem" data-context-label="Toggle Visibility" id="viewport-toggle-visibility"><i data-lucide="layers-3"></i><span>Toggle Visibility</span><kbd>Space</kbd></button>
      <button class="coming-soon" type="button" role="menuitem" data-context-label="Isolate" aria-disabled="true" data-coming-soon="Isolate - coming soon!" title="Isolate - coming soon!"><i data-lucide="layers-3"></i><span>Isolate</span><kbd>Alt+I</kbd></button>
      <small>Edit</small>
      <button class="coming-soon" type="button" role="menuitem" data-context-label="Copy" aria-disabled="true" data-coming-soon="Copy - coming soon!" title="Copy - coming soon!"><i data-lucide="settings-2"></i><span>Copy</span><kbd>Ctrl+C</kbd></button>
      <button id="viewport-edit-feature" type="button" role="menuitem" data-context-label="Edit Feature"><i data-lucide="settings-2"></i><span>Edit Feature…</span><kbd>E</kbd></button>
      <button class="coming-soon" type="button" role="menuitem" data-context-label="Delete" aria-disabled="true" data-coming-soon="Delete - coming soon!" title="Delete - coming soon!"><i data-lucide="settings-2"></i><span>Delete</span><kbd>Del</kbd></button>
      <small>Settings</small>
      <button type="button" role="menuitem" data-context-label="Viewport Settings" data-invoke="#viewport-background"><i data-lucide="settings-2"></i><span>Viewport Settings…</span></button>
      <p class="context-no-results" hidden>No matching commands</p>
    </div>
    <div id="tree-context-menu" class="context-surface" role="menu" aria-label="Model tree context menu" hidden></div>
    <div id="toolbar-command-context-menu" class="context-surface toolbar-command-context-menu" role="menu" aria-label="Toolbar command context menu" hidden>
      <button id="toolbar-context-pin" type="button" role="menuitem"><i data-lucide="pin"></i><span>Pin to toolbar</span></button>
      <button id="toolbar-context-customize" type="button" role="menuitem"><i data-lucide="settings-2"></i><span>Customize toolbar…</span></button>
    </div>
    <aside id="diagnostics" aria-live="polite"></aside>
    <div id="coming-soon-tooltip" role="tooltip" hidden></div>
  </main>`;

createIcons({
  icons: {
    AlignCenter,
    Anchor,
    Box,
    BoxSelect,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleDot,
    CircleHelp,
    Command,
    Component,
    CornerDownRight,
    Crosshair,
    Download,
    EllipsisVertical,
    Equal,
    FileDown,
    FileText,
    FilePlus2,
    FileUp,
    FolderOpen,
    Hexagon,
    HardDriveDownload,
    Import,
    Layers3,
    LayoutGrid,
    LayoutPanelTop,
    LayoutTemplate,
    Link,
    List,
    Maximize2,
    Minus,
    Move,
    MoveHorizontal,
    MoveRight,
    MousePointer2,
    Orbit,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelTop,
    PencilRuler,
    Pin,
    Plus,
    Redo2,
    RefreshCw,
    Rotate3D,
    RotateCcw,
    Ruler,
    Save,
    SaveAll,
    Search,
    Settings2,
    Split,
    SkipBack,
    SkipForward,
    Square,
    Spline,
    Sun,
    Table2,
    Undo2,
    View,
    X,
    Moon,
    BetweenHorizontalEnd,
    Circle,
    Copy,
  },
});

const state = initialState();
let adapter: DocumentAdapter;
let worker: Worker | undefined;
let renderer: WorkspaceRenderer | undefined;
let viewportState: ViewportStateController | undefined;
let acceptedPlanarFaceEvidence: CurrentPlanarFaceEvidenceLookup = new Map();
const nativePlanarFaceAuthorities = new Map<string, PlanarFaceFrameAuthority>();
const pendingPlanarFaceFrameRequests = new Map<string, PlanarFaceFrameRequest>();
let pendingAcceptedPacket: Extract<WorkerResponse, { type: "packet" }> | undefined;
let lastAcceptedPacket: Extract<WorkerResponse, { type: "packet" }> | undefined;
let suppressedRepairCancelPacketHash: string | undefined;
let viewportBackground = activeTheme === "light" ? "#b8bec8" : "#0c0d10";
let viewportGridVisible = true;
let viewportDisplayMode: "shaded-edges" | "shaded" | "wireframe" | "hidden-line" | "no-shading" = "shaded-edges";
let appearanceColor = "#6c93cf";
let appearanceOpacity = 1;
let appearanceEdgesVisible = true;
let transferredBytes = 0;
let startupFailurePending = new URLSearchParams(location.search).has("failWorker");
let storage: AppStorage | undefined;
let acceptedPersistence: Promise<void> = Promise.resolve();
let acceptedPersistenceRevision = 0;
const persistenceWorker = new Worker(new URL("./persistence.worker.ts", import.meta.url), { type: "module" });
let persistenceRequestId = 0;
const pendingPersistence = new Map<number, { resolve(): void; reject(error: Error): void }>();

persistenceWorker.addEventListener("message", (event: MessageEvent<{ type: "persisted-accepted" | "persistence-error"; requestId: number; message?: string }>) => {
  const pending = pendingPersistence.get(event.data.requestId);
  if (!pending) return;
  pendingPersistence.delete(event.data.requestId);
  if (event.data.type === "persisted-accepted") pending.resolve();
  else pending.reject(new Error(event.data.message ?? "accepted document persistence failed"));
});
persistenceWorker.addEventListener("error", (event) => {
  const error = new Error(event.message || "accepted document persistence worker failed");
  for (const pending of pendingPersistence.values()) pending.reject(error);
  pendingPersistence.clear();
});

function persistAcceptedOffMainThread(
  documentJson: string,
  semanticHash: string,
  options: { transaction?: import("./protocol").AcceptedTransaction; action?: import("./storage").AcceptedStateAction },
): Promise<void> {
  const requestId = ++persistenceRequestId;
  return new Promise<void>((resolve, reject) => {
    pendingPersistence.set(requestId, { resolve, reject });
    persistenceWorker.postMessage({ type: "persist-accepted", requestId, documentJson, semanticHash, ...options });
  });
}
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
let hasBaseDimensions = false;
let currentBounds: number[] = [];
let lastPacketSemanticHash: string | undefined;
let acceptedBodyId = "";
let acceptedExtrudeDistanceNanometers = 0;
let acceptedExtrudeDirection: ExtrudeDirection = "positive";
let acceptedExtrudeResultMode: ExtrudeResultMode = "new_body";
let extrudePreviewRequest = 0;
let latestExtrudePreviewRequest = 0;
const extrudePreviewStarted = new Map<number, number>();
type SketchExtrudeSource = { sketch: Sketch; support: SketchSupport; profileGeometryIds?: readonly string[]; featureId: string; bodyId: string; newBodyId: string; resultMode: ExtrudeResultMode; targetBodyId?: string; transactionId: string; editing?: boolean };
let activeSketchExtrudeSource: SketchExtrudeSource | undefined;
let acceptedCutPreviewBasis: { semanticHash: string; baseRevision: number; requestId: number } | undefined;
let lastRecompute = { dirtyRoots: [] as string[], evaluationOrder: [] as string[] };
let lastRecomputeOutcome: Extract<WorkerResponse, { type: "recompute-from-here" }> | undefined;
let safeMode = false;
let faultCount = 0;
let recoveryProvenance = "Canonical seed";
let recoveryChoices: readonly RecoveryChoice[] = [];
let sessionRecoveryDocument: unknown;
let selectedCatalogOperationId: string | null = null;
let editingAdvancedFeatureId: string | null = null;
let activeAdvancedOperationLabel = "Advanced feature";
let advancedFeaturePreviewReady = false;
let advancedFeaturePreviewTimer: ReturnType<typeof setTimeout> | undefined;
let advancedFeaturePreviewRequest = 0;
let advancedFeatureApplyAfterPreviewRequest: number | undefined;
let activeParameterLabel = "Parameter";
let currentParameters: readonly NamedParameterView[] = [];
const currentParameterErrors = new Map<string, string>();
let lastExplicitSaveChecksum: string | undefined;
const persistedSemanticHashes = new Set<string>();
let pendingOperationCompletion: { type: "advanced" | "parameter" | "step-import"; semanticHash: string } | undefined;
let featureServices: FeatureServicesView | undefined;
let repairInspection: RepairInspectionView | undefined;
let repairObservedTopology: readonly TopologyReferenceView[] = [];
type TopologyRebindPreviewState = {
  requestId: string;
  selected: string;
  phase: "loading" | "ready";
  baseDocumentHash?: string;
  baseRevision?: number;
  candidateFrame?: OffsetConstructionPlaneFrame;
};
let topologyRebindPreview: TopologyRebindPreviewState | undefined;
let historyActionMessage = "";
let sketchBridge: WorkerSketchBridge | undefined;
let sketchSession: SketchEditSession | undefined;
let activeSketchPlane: ResolvedSketchPlane | undefined;
let sketchChoosingSupport = false;
let selectedSketchSupport: SketchSupport | undefined;
let selectedSketchId: string | undefined;
let selectedConstructionPlaneId: string | undefined;
const hiddenConstructionPlaneIds = new Set<string>();
type OffsetConstructionPlaneEdit = {
  mode: "create" | "edit";
  planeId: string;
  componentId: string;
  offsetParameterId: string;
  basePlane: "xy" | "xz" | "yz";
  offsetMillimeters: string;
  suppressed: boolean;
  transactionId: string;
  baseRevision: number;
  requestId: number;
  previewReady: boolean;
  previewFrame?: OffsetConstructionPlaneFrame | null;
  error?: string;
};
let activeOffsetConstructionPlane: OffsetConstructionPlaneEdit | undefined;
let offsetConstructionPlaneRequest = 0;
type SketchProfileSelection = { sketchId: string; profileId: string; geometryIds: string[] };
type SketchConstructionAxisSelection = { sketchId: string; geometryId: string };
let selectedSketchProfile: SketchProfileSelection | undefined;
let selectedSketchConstructionAxis: SketchConstructionAxisSelection | undefined;
let sketchProfileRepairMessage: string | undefined;
// v2 intentionally drops the legacy auto-hidden-on-finish values. Only an
// explicit browser visibility toggle may hide a committed sketch now.
const SKETCH_VISIBILITY_STORAGE_KEY = "crawler.sketch.hidden-committed.v2";
const SKETCH_DIMENSION_PLACEMENT_STORAGE_KEY = "crawler.sketch.dimension-placement.v1";
const SKETCH_DIMENSION_EXPRESSION_STORAGE_KEY = "crawler.sketch.dimension-expressions.v1";
const hiddenCommittedSketchIds = new Set<string>((() => {
  try {
    const stored = JSON.parse(localStorage.getItem(SKETCH_VISIBILITY_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
})());
const sketchDimensionPositions = new Map<string, Point2>((() => {
  try {
    const stored = JSON.parse(localStorage.getItem(SKETCH_DIMENSION_PLACEMENT_STORAGE_KEY) ?? "{}");
    return Object.entries(stored).flatMap(([id, value]) => {
      const point = value as Partial<Point2>;
      return Number.isFinite(point.x_nm) && Number.isFinite(point.y_nm) ? [[id, { x_nm: Number(point.x_nm), y_nm: Number(point.y_nm) }] as [string, Point2]] : [];
    });
  } catch { return []; }
})());
const sketchDimensionExpressions = new Map<string, string>(Object.entries((() => {
  try { return JSON.parse(localStorage.getItem(SKETCH_DIMENSION_EXPRESSION_STORAGE_KEY) ?? "{}"); }
  catch { return {}; }
})()).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
let sketchPreviousView: WorkspaceViewState | undefined;
let sketchPoints: Point2[] = [];
let sketchPointInferences: SketchInference[][] = [];
let sketchHoverSnap: SketchSnap | undefined;
let sketchConstruction = false;
let sketchAutoConstraints = true;
const sketchCreationVariant = { rectangle: "two_point" as RectangleVariant, circle: "center_diameter" as CircleVariant, arc: "center_point" as ArcVariant, polygon: "inscribed" as PolygonVariant, slot: "center_to_center" as SlotVariant };
let sketchPolygonSides = 6;
let sketchTextValue = "TEXT";
let sketchTextHeightNm = 5_000_000;
let sketchTextRotationMicrodegrees = 0;
let sketchTextAlignment: "left" | "center" | "right" = "left";
let sketchTextOnPath = false;
let sketchTextReversed = false;
let sketchShowSplineControlPolygon = true;
let sketchSnapEnabled = true;
let sketchSliceEnabled = false;
let sketchPaletteExpanded = false;
let sketchProjectIntersectionMode = false;
let sketchProjectWorkReference: "none" | "origin" | "x_axis" | "y_axis" = "none";
const sketchVisibility = new Set(["profiles", "points", "dimensions", "constraints", "construction", "projection"]);
let sketchConstraintValue = 1;
let inlineCreationLocks: Partial<Record<InlineCreationFieldKey, number>> = {};
let inlineCreationExpressions: Partial<Record<InlineCreationFieldKey, string>> = {};
let inlineCreationActiveField: InlineCreationFieldKey | undefined;
let sketchSolverStatus = "Under-constrained · click the plane to draw";
let sketchProfileStatus = "Profile: empty";
let sketchLastDrag: "accepted" | "refused" | undefined;
type SketchAutoConstraintAuditEntry = {
  tool: SketchTool;
  rawInferenceKinds: string[];
  emittedConstraints: Array<{ id: string; kind: Constraint["kind"] }>;
  solveState: import("./sketch-editor").SolveState | "idle";
  redundantConstraints: string[];
  conflicts: import("./sketch-editor").SolveResult["conflicts"];
};
let sketchAutoConstraintAudit: SketchAutoConstraintAuditEntry[] = [];
let selectedSketchGeometry: string[] = [];
let selectedSketchPoints: PointRef[] = [];
let sketchOriginSelected = false;
let selectedSketchSegments: { geometry: string; segment: number }[] = [];
let selectedSketchConstraint: string | undefined;
let sketchConstraintManagerExpanded = false;
let sketchConflictIsolation = false;
let sketchDofNavigationIndex = -1;
type SketchSelectionMode = "replace" | "add" | "remove" | "toggle";
let sketchSelectionMode: Exclude<SketchSelectionMode, "toggle"> = "replace";
let sketchBoxSelection: { pointerId: number; start: { x: number; y: number }; current: { x: number; y: number }; mode: SketchSelectionMode } | undefined;
let sketchPlacementGesture: { pointerId: number; startClient: { x: number; y: number }; tool: SketchTool; captureTarget: Element } | undefined;
let pendingSketchConstraint: ConstraintTool | undefined;
let sketchSmartDimensionActive = false;
let pendingDimensionPlacement: { kind: ConstraintTool; command: SketchCommand; position?: Point2; placed?: boolean; valueEdited?: boolean } | undefined;
let pendingReferenceDimension: { kind: ConstraintTool; command: Extract<SketchCommand, { kind: "add_constraint" }>; position?: Point2 } | undefined;
let pendingSketchEditPreview: {
  tool: SketchTool;
  commands: SketchCommand[];
  state: "loading" | "ready";
  requestId: number;
  prepared?: PreparedSketchPreview;
  canonicalGeometryIds?: string[];
  offsetChain?: OffsetChainInstrumentation;
  planMs?: number;
  commandConstructionMs?: number;
  bridgeMs?: number;
} | undefined;
let sketchEditPreviewRequestId = 0;
let sketchEditPreviewAbort: AbortController | undefined;
function cancelPendingSketchEditPreview(): void {
  sketchEditPreviewRequestId += 1;
  sketchEditPreviewAbort?.abort();
  sketchEditPreviewAbort = undefined;
  pendingSketchEditPreview = undefined;
}
type OffsetPerformanceRecord = {
  stage: "preview" | "commit";
  outcome: "ready" | "rejected" | "accepted" | "refused";
  planMs: number;
  commandConstructionMs?: number;
  bridgeMs?: number;
  diagnosticsMs?: number;
  overlayMs?: number;
  stablePaintMs?: number;
  stableLayerDelta?: number;
  offsetChain?: OffsetChainInstrumentation;
  reason?: string;
};
const offsetPerformanceRecords: OffsetPerformanceRecord[] = [];
function recordOffsetPerformance(record: OffsetPerformanceRecord): void {
  offsetPerformanceRecords.push(structuredClone(record));
  if (offsetPerformanceRecords.length > 20) offsetPerformanceRecords.splice(0, offsetPerformanceRecords.length - 20);
}
function waitForStableBrowserPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
let sketchConstraintApplying = false;
let sketchDiagnosticsRenderFrame: number | undefined;
let sketchSelectionToolApplying = false;
let sketchToolArmed = false;
type SketchToolPhase = "idle" | "collecting" | "ready" | "applying" | "complete" | "blocked";
let sketchToolPhase: SketchToolPhase = "idle";
let activeSketchOperationLabel = "Sketch";
let sketchReturnFocus: HTMLElement | null = null;
let sketchHoverPoint: Point2 | undefined;
let sketchHoverTarget: { kind: "geometry" | "point" | "constraint" | "profile" | "origin" | "plane"; id?: string; anchor?: PointRef["anchor"]; segment?: number; valid: boolean; reason?: string } | undefined;
let sketchHoverClientPoint: { x: number; y: number } | undefined;
let sketchHoverModifiers = { shift: false, toggle: false };
const sketchSelectionFilters = new Set(["curves", "points", "construction", "external", "constraints", "dimensions"]);
let activeWorkbench: WorkbenchId = "Part Design";
let sketchPreviousWorkbench: WorkbenchId | undefined;
let activeToolContext: ActiveToolContext | undefined;
let sketchDrag:
  | { kind: "point"; pointerId: number; point: PointRef; handle: SVGCircleElement; startClient: { x: number; y: number }; moved: boolean }
  | { kind: "radius"; pointerId: number; geometry: string; center: Point2; handle: SVGCircleElement; startClient: { x: number; y: number }; moved: boolean }
  | { kind: "entity"; pointerId: number; geometry: string[]; point: PointRef; pointStart: Point2; startPlane: Point2; currentPlane: Point2; startClient: { x: number; y: number }; moved: boolean }
  | undefined;
let stepImportRunning = false;
let stepSourceRetained = false;
const performanceEvidence = new PerformanceEvidence();
let pwaStatus = (): PwaStatus => ({ supported: false, controlled: false, updateAvailable: false, cacheVersion: import.meta.env.DEV ? "development-disabled" : "pending" });

function activeSketchPointRequirement(tool: SketchTool): number {
  return tool in sketchCreationVariant
    ? creationVariantPointCount(tool as keyof typeof sketchCreationVariant, sketchCreationVariant[tool as keyof typeof sketchCreationVariant])
    : SKETCH_TOOL_MANIFEST[tool].points;
}

function activeCreationOperandRequirement(): { count: number; label: string } | undefined {
  if (!sketchSession || !sketchToolArmed) return undefined;
  if (sketchSession.activeTool === "circle" && sketchCreationVariant.circle === "two_tangent") return { count: 2, label: "tangent curve" };
  if (sketchSession.activeTool === "circle" && sketchCreationVariant.circle === "three_tangent") return { count: 3, label: "tangent curve" };
  if (sketchSession.activeTool === "arc" && sketchCreationVariant.arc === "tangent") return { count: 1, label: "source curve" };
  if (sketchSession.activeTool === "text" && sketchTextOnPath) return { count: 1, label: "text path" };
  return undefined;
}

function geometrySupportsCreationOperand(id: string): boolean {
  const kind = sketchSession?.draft.geometry[id]?.geometry.kind;
  return Boolean(kind && !["sketch_point", "rectangle"].includes(kind));
}

function downloadSketchFile(extension: "svg" | "dxf", content: string): void {
  const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sketch";
  const url = URL.createObjectURL(new Blob([content], { type: extension === "svg" ? "image/svg+xml" : "application/dxf" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${base}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function persistCommittedSketchVisibility(): void {
  try { localStorage.setItem(SKETCH_VISIBILITY_STORAGE_KEY, JSON.stringify([...hiddenCommittedSketchIds])); } catch { /* storage is optional */ }
}

function persistSketchDimensionPositions(): void {
  try { localStorage.setItem(SKETCH_DIMENSION_PLACEMENT_STORAGE_KEY, JSON.stringify(Object.fromEntries(sketchDimensionPositions))); } catch { /* storage is optional */ }
}

function persistSketchDimensionExpressions(): void {
  try { localStorage.setItem(SKETCH_DIMENSION_EXPRESSION_STORAGE_KEY, JSON.stringify(Object.fromEntries(sketchDimensionExpressions))); } catch { /* storage is optional */ }
}

function requestNativePlanarFaceFrame(
  support: SketchSupport,
  supportReference?: SketchTopologyReference,
): boolean {
  if (!worker || support.kind !== "topology") return support.kind !== "topology";
  const documentValue = adapter.durableDocument() as SketchPlaneDocument;
  const reference = supportReference ?? documentValue.topology_references?.[support.reference];
  const body = reference?.body ? documentValue.bodies?.[reference.body] : undefined;
  const producer = reference?.producer ? documentValue.features?.[reference.producer] : undefined;
  const component = body?.component;
  const stableId = reference?.stable_kernel_id;
  if (!reference || reference.kind !== "face" || !reference.body || !reference.producer || !stableId
    || !Number.isSafeInteger(documentValue.revision) || !body || body.suppressed
    || !bodyAcceptsFeatureProducer(body, reference.producer)
    || !producer || producer.suppressed || !component || producer.component !== component) return false;
  const key = planarFaceAuthorityKey(reference.body, stableId);
  const cached = nativePlanarFaceAuthorities.get(key);
  if (cached && cached.acceptedRevision === documentValue.revision && cached.producerFeatureId === reference.producer && cached.componentId === component) return true;
  // Different retained references may legitimately point at the same current
  // face. De-duplicate only an identical waiter so every active reference is
  // resumed by its own response rather than being stranded behind another
  // sketch's request.
  if ([...pendingPlanarFaceFrameRequests.values()].some((pending) => pending.topologyReferenceId === support.reference
    && pending.bodyId === reference.body && pending.faceStableId === stableId
    && pending.expectedAcceptedRevision === documentValue.revision)) return false;
  const request: PlanarFaceFrameRequest = {
    type: "resolve-planar-face-frame", requestId: `planar-face-frame:${crypto.randomUUID()}`,
    topologyReferenceId: support.reference, bodyId: reference.body, faceStableId: stableId,
    expectedAcceptedRevision: documentValue.revision!, expectedProducerFeatureId: reference.producer,
    expectedComponentId: component,
  };
  pendingPlanarFaceFrameRequests.set(request.requestId, request);
  worker.postMessage(request);
  return false;
}

function syncCommittedSketches(): void {
  if (!renderer) return;
  const documentValue = adapter.durableDocument() as SketchPlaneDocument & { sketches?: Record<string, { id?: string }> };
  const displays: CommittedSketchDisplay[] = [];
  for (const storedId of Object.keys(documentValue.sketches ?? {})) {
    const hydrated = hydrateSketchFromDocument(documentValue, storedId);
    if (!hydrated) continue;
    if (hydrated.support.kind === "topology") requestNativePlanarFaceFrame(hydrated.support);
    const resolution = resolveSketchPlane(hydrated.support, documentValue, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities);
    if (resolution.status !== "ready") continue;
    displays.push({
      id: hydrated.sketch.id,
      sketch: hydrated.sketch,
      plane: resolution.plane,
      selected: selectedSketchId === hydrated.sketch.id,
      visible: !hiddenCommittedSketchIds.has(hydrated.sketch.id),
    });
  }
  renderer.setCommittedSketches(displays, sketchSession?.draft.id);
}

function requestFeatureServices(observedTopology?: readonly TopologyReferenceView[]): void {
  if (!worker || !state.selectedFeatureId.startsWith("feature:")) return;
  const unresolvedFeature = repairInspection?.status === "evaluation_blocked" ? repairInspection.preview.unresolved.feature : undefined;
  if (topologyRebindPreview && unresolvedFeature && unresolvedFeature !== state.selectedFeatureId) {
    worker.postMessage({ type: "cancel-topology-rebind-preview", requestId: topologyRebindPreview.requestId });
    topologyRebindPreview = undefined;
  }
  const observed = observedTopology ?? currentObservedTopology();
  worker.postMessage({ type: "feature-services", feature: state.selectedFeatureId, observedTopology: observed });
}

function currentObservedTopology(): readonly TopologyReferenceView[] {
  const documentValue = adapter.durableDocument() as SketchPlaneDocument;
  return [...acceptedPlanarFaceEvidence.values()].flatMap((evidence) => {
    const body = documentValue.bodies?.[evidence.body];
    const retained = Object.values(documentValue.topology_references ?? {}).find((reference) =>
      reference.kind === "face" && reference.body === evidence.body && reference.stable_kernel_id === evidence.stable_kernel_id);
    const producer = retained?.producer ?? body?.generated_by;
    if (!producer || !body?.component) return [];
    return [{
      schema_version: 1 as const,
      id: retained?.id ?? `observed:face:${evidence.body}:${evidence.stable_kernel_id}`,
      component: body.component,
      body: evidence.body,
      producer,
      kind: "face" as const,
      stable_kernel_id: evidence.stable_kernel_id,
      stable_token: retained?.stable_token ?? `observed:face:${evidence.stable_kernel_id}`,
      fallback_signature: { kind: "face", centroid_nanometers: evidence.centroid_nanometers, normal_millionths: evidence.normal_millionths, area_square_nanometers: evidence.area_square_nanometers },
    }];
  });
}

function modelingRuntimeReady(): boolean {
  return Boolean(worker && documentReady && !safeMode
    && state.readiness.wasm === "ready"
    && state.readiness.worker === "ready"
    && state.readiness.renderer === "ready");
}

function hasExportableBody(): boolean {
  return adapter.getSnapshot().components.some((component) =>
    component.bodies.some((body) => body.status !== "suppressed" && body.status !== "failed"));
}

function updateStepImportControls(): void {
  const ready = modelingRuntimeReady();
  document.querySelector<HTMLButtonElement>("#import-step")!.disabled = !ready || stepImportRunning;
  document.querySelector<HTMLButtonElement>("#cancel-step-import")!.disabled = !ready || !stepImportRunning;
  document.querySelector<HTMLButtonElement>("#reimport-step")!.disabled = !ready || stepImportRunning || !stepSourceRetained;
}

function synchronizeRuntimeCommandAvailability(): void {
  const ready = modelingRuntimeReady();
  const exportReady = ready && hasExportableBody();
  updateBaseOperationAvailability();
  updateStepImportControls();
  for (const selector of ["#save-part", "#save-as-part", "#save-copy-part"]) {
    const control = document.querySelector<HTMLButtonElement>(selector);
    if (control) control.disabled = !ready;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-catalog-operation]").forEach((button) => {
    const operationId = button.dataset.catalogOperation ?? "";
    if (!operationId.startsWith("crawler.part.")) return;
    const catalogEnabled = operationById(operationId).enablement.state === "enabled";
    button.disabled = !ready || !catalogEnabled;
    button.setAttribute("aria-disabled", String(button.disabled));
    if (!ready) button.title = "Modeling is available after the document runtime is ready";
  });
  document.querySelectorAll<HTMLButtonElement>("[data-export], [data-export-proxy]").forEach((button) => {
    const format = (button.dataset.export ?? button.dataset.exportProxy ?? "model").toUpperCase();
    button.disabled = !exportReady;
    button.setAttribute("aria-disabled", String(button.disabled));
    button.title = exportReady
      ? `Export ${format}`
      : ready
        ? "Create or import a body before exporting"
        : "Export is available after the document runtime is ready";
  });
  const search = document.querySelector<HTMLElement>("#command-search");
  if (search && !search.hidden) renderCommands();
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
  synchronizeRuntimeCommandAvailability();
}

function setSafeMode(value: boolean, reason = "", action = "Editing"): void {
  safeMode = value;
  const panel = document.querySelector<HTMLElement>("#safe-mode")!;
  panel.hidden = !value;
  document.querySelector("#safe-mode-title")!.textContent = `${action} couldn’t continue`;
  document.querySelector("#safe-reason")!.textContent = reason || "The last operation stopped before it could be completed.";
  for (const selector of ["#edit-sketch", "#create-offset-plane", "#undo", "#redo", "#import-step", "#cancel-step-import", "#reimport-step"]) document.querySelector<HTMLButtonElement | HTMLInputElement>(selector)!.disabled = value;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-parameter-name], [data-parameter-expression], [data-rename-parameter], [data-apply-parameter], [data-reuse-parameter], [data-promote-parameter]").forEach((control) => { control.disabled = value; });
  document.querySelector(".shell")!.classList.toggle("safe", value);
  synchronizeRuntimeCommandAvailability();
}

function actionErrorExplanation(message: string): { reason: string; next: string } {
  if (/replacement profile must belong to this Extrude's source sketch and resolved support/i.test(message)) {
    return { reason: message, next: "Select a closed region from the original source sketch, or clear the incompatible profile selection." };
  }
  if (/start or edit a sketch/i.test(message)) {
    return { reason: "Sketch interchange needs an active sketch.", next: "Start or edit a sketch, then choose the import or export command again." };
  }
  if (/runtime is not ready for export/i.test(message)) {
    return { reason: "The model is still loading or is in read-only recovery.", next: "Wait for editing to become ready, or restore editing, then export again." };
  }
  if (/STEP input contains no supported|STEP BLOCK|no inspectable shells/i.test(message)) {
    return { reason: "That STEP file does not contain a supported solid representation.", next: "Choose a STEP file containing a B-rep solid or CSG block." };
  }
  if (/invalid[_ ]step|STEP.*(?:parse|read|invalid)/i.test(message)) {
    return { reason: "That STEP file could not be read.", next: "Choose a valid STEP file and try again." };
  }
  if (/line must have positive length|same start and end|zero[- ]length/i.test(message)) {
    return { reason: "The start and end points overlap.", next: "Choose a different endpoint." };
  }
  if (/circle must have positive radius|radius.*zero/i.test(message)) {
    return { reason: "The center and radius point overlap.", next: "Choose a different point on the circle." };
  }
  if (/geometry is degenerate|collapsed/i.test(message)) {
    return { reason: "The geometry collapsed to a point or zero-length edge.", next: "Change the placement so the shape has a usable size." };
  }
  return { reason: "The geometry could not be added.", next: "Adjust the placement and try again." };
}

function showActionError(action: string, message: string): void {
  const explanation = actionErrorExplanation(message);
  document.querySelector("#action-error-title")!.textContent = `${action} couldn’t be completed`;
  document.querySelector("#action-error-reason")!.textContent = explanation.reason;
  document.querySelector("#action-error-next")!.textContent = explanation.next;
  document.querySelector<HTMLElement>("#action-error")!.hidden = false;
}

function hideActionError(): void {
  document.querySelector<HTMLElement>("#action-error")!.hidden = true;
}

function faultActionLabel(message: string): string {
  if (/portable part could not be opened/i.test(message)) return "Open part";
  if (state.operation.status !== "preview") return "Editing";
  if (state.operation.type === "sketch" && sketchSession) return SKETCH_TOOL_SCHEMA.find((entry) => entry.id === sketchSession?.activeTool)?.label ?? "Sketch action";
  if (state.operation.type === "rectangle") return "Rectangle";
  if (state.operation.type === "pad") return "Extrude";
  if (state.operation.type === "step-import") return "STEP import";
  return "Editing";
}

function explainRuntimeFault(message: string): string {
  if (/portable part could not be opened/i.test(message)) return "That part file could not be opened.";
  if (/geometry is degenerate|zero[- ]length|collapsed/i.test(message)) return "That shape has no usable size, so it wasn’t added.";
  if (/invalid part document/i.test(message)) return "The last change produced invalid geometry and wasn’t applied.";
  return "The last operation stopped before it could be completed.";
}

function handleRuntimeFault(message: string): void {
  faultCount += 1;
  setReadiness("worker", "error", message); setReadiness("wasm", "error", message);
  setSafeMode(true, explainRuntimeFault(message), faultActionLabel(message));
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
  sketches?: Record<string, {
    id?: string;
    display_name?: string;
    constraints?: Array<{ id?: string; kind?: string; parameter?: string; implicit_name?: string }>;
  }>;
  parameters?: Record<string, { id?: string; display_name?: string }>;
  transactions?: Array<{ changes?: Array<{
    kind?: string;
    parameter?: string | { id?: string };
    entity?: { kind?: string; id?: string };
  }> }>;
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

function titleCaseField(field: string): string {
  return field.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function definedParameterIds(): Set<string> {
  const durable = adapter.durableDocument() as ParameterDocumentView;
  const bindings = parameterBindings();
  const boundIds = new Set(bindings.map((binding) => binding.parameter));
  const defined = new Set<string>();
  for (const transaction of durable.transactions ?? []) {
    for (const change of transaction.changes ?? []) {
      if (change.kind === "rename_entity" && change.entity?.kind === "parameter" && change.entity.id) defined.add(change.entity.id);
      if (change.kind === "create_parameter") {
        const parameterId = typeof change.parameter === "string" ? change.parameter : change.parameter?.id;
        if (parameterId) defined.add(parameterId);
      }
    }
  }
  for (const parameter of currentParameters) {
    if (!boundIds.has(parameter.id)) {
      defined.add(parameter.id);
      continue;
    }
    const implicitNames = bindings.filter((binding) => binding.parameter === parameter.id).map((binding) => titleCaseField(binding.field));
    if (!implicitNames.includes(parameter.name)) defined.add(parameter.id);
  }
  return defined;
}

function definedParameters(): readonly NamedParameterView[] {
  const ids = definedParameterIds();
  return currentParameters.filter((parameter) => ids.has(parameter.id));
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

function parameterExpressionDisplay(parameter: NamedParameterView): string {
  const source = parameter.source.trim();
  const nanometers = source.match(/^(-?\d+(?:\.\d+)?)\s*nm$/i);
  if (nanometers && ["length", "tolerance"].includes(parameter.kind)) {
    return `${Number(nanometers[1]) / 1_000_000} mm`;
  }
  const microdegrees = source.match(/^(-?\d+(?:\.\d+)?)\s*(?:udeg|microdegrees?)$/i);
  if (microdegrees && parameter.kind === "angle") {
    return `${Number(microdegrees[1]) / 1_000_000} deg`;
  }
  return source;
}

function sketchForFeature(featureId: string) {
  const snapshot = adapter.getSnapshot();
  const sketches = snapshot.components.flatMap((component) => component.sketches);
  const directlyAssociated = sketches.find((candidate) => candidate.featureId === featureId);
  if (directlyAssociated) return directlyAssociated;

  // Durable documents associate a sketch input with its consuming feature. When
  // the sketch feature itself is selected, retain its component-local ordering
  // so parameter setup can still resolve the sketch it owns.
  const featureById = new Map(snapshot.features.map((feature) => [feature.id, feature]));
  for (const component of snapshot.components) {
    const sketchFeatureIndex = component.featureIds
      .filter((candidateId) => featureById.get(candidateId)?.type === "sketch")
      .findIndex((candidateId) => candidateId === featureId);
    if (sketchFeatureIndex >= 0) return component.sketches[sketchFeatureIndex];
  }
  return undefined;
}

function renderSketchDimensions(featureId: string): string {
  const durable = adapter.durableDocument() as ParameterDocumentView;
  const sketch = sketchForFeature(featureId);
  if (!sketch) return "";
  const durableSketch = durable.sketches?.[sketch.id];
  const bindings = parameterBindings().filter((binding) => binding.feature === featureId);
  const bindingByParameter = new Map(bindings.map((binding) => [binding.parameter, binding]));
  const constraintDimensions = (durableSketch?.constraints ?? []).filter((constraint) => constraint.parameter).map((constraint, index) => {
    const parameter = constraint.parameter!;
    const binding = bindingByParameter.get(parameter);
    const idSuffix = constraint.id?.split(":").at(-1) ?? "";
    return {
      id: constraint.id ?? `dimension:${binding?.field ?? parameter}`,
      field: binding?.field ?? constraint.id?.split(":").at(-1) ?? "dimension",
      parameter,
      implicitName: constraint.implicit_name ?? (/^d\d+$/i.test(idSuffix) ? idSuffix : `d${index + 1}`),
    };
  });
  const seen = new Set(constraintDimensions.map((dimension) => dimension.parameter));
  const dimensions = [...constraintDimensions, ...bindings.filter((binding) => !seen.has(binding.parameter)).map((binding, index) => ({ id: `dimension:${binding.field}`, field: binding.field, parameter: binding.parameter, implicitName: `d${constraintDimensions.length + index + 1}` }))];
  if (!dimensions.length) return "";
  const parameters = new Map(currentParameters.map((parameter) => [parameter.id, parameter]));
  const defined = definedParameterIds();
  const sketchId = sketchReferenceId(sketch.id);
  const alias = JSON.stringify(sketch.name);
  return `<section class="sketch-dimensions" aria-label="Sketch parameter setup"><h3>Parameter setup</h3><p class="sketch-dimension-help">Promote a canvas dimension only when it needs a reusable name or expression reference.</p>${dimensions.map((dimension) => {
    const parameter = parameters.get(dimension.parameter);
    if (!parameter) return "";
    const stableReference = `{{sketch.${sketchId}.${dimension.implicitName}}}`;
    const aliasReference = `{{sketch.alias.${alias}.${dimension.implicitName}}}`;
    const isDefined = defined.has(parameter.id);
    return `<article class="sketch-dimension-row" data-sketch-dimension="${escapeHtml(dimension.implicitName)}">
      <header><strong><code>${escapeHtml(dimension.implicitName)}</code>${escapeHtml(titleCaseField(dimension.field))}</strong><output>${escapeHtml(exactParameterDisplay(parameter))}</output></header>
      <button class="sketch-reference" type="button" data-copy-parameter-reference="${escapeHtml(stableReference)}" title="Copy stable sketch reference"><span>ID</span><code>${escapeHtml(stableReference)}</code></button>
      <button class="sketch-reference" type="button" data-copy-parameter-reference="${escapeHtml(aliasReference)}" title="Copy sketch alias reference"><span>Alias</span><code>${escapeHtml(aliasReference)}</code></button>
      <footer><span class="${isDefined ? "defined" : "implicit"}">${isDefined ? `Defined as ${escapeHtml(parameter.name)}` : "Canvas dimension"}</span>${isDefined ? `<button type="button" data-open-parameters>Open parameter</button>` : `<button type="button" data-start-define-parameter>Define parameter</button>`}</footer>
      <form class="sketch-define-form" data-define-parameter-form data-feature="${escapeHtml(featureId)}" data-field="${escapeHtml(dimension.field)}" data-parameter="${escapeHtml(parameter.id)}" hidden><input name="displayName" aria-label="Parameter name" placeholder="Parameter name" autocomplete="off" /><button type="submit">Define</button><button type="button" data-cancel-define-parameter>Cancel</button></form>
    </article>`;
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
  document.querySelectorAll<HTMLButtonElement>("[data-copy-parameter-reference]").forEach((button) => button.addEventListener("click", async () => {
    const reference = button.dataset.copyParameterReference ?? "";
    try {
      await navigator.clipboard.writeText(reference);
      button.classList.add("copied");
      button.querySelector("span")!.textContent = "Copied";
      window.setTimeout(() => {
        button.classList.remove("copied");
        button.querySelector("span")!.textContent = button.title.includes("alias") ? "Alias" : "ID";
      }, 1200);
    } catch {
      document.querySelector<HTMLElement>("#operation-message")!.textContent = reference;
    }
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-start-define-parameter]").forEach((button) => button.addEventListener("click", () => {
    const form = button.closest(".sketch-dimension-row")!.querySelector<HTMLFormElement>("[data-define-parameter-form]")!;
    form.hidden = false;
    button.hidden = true;
    form.querySelector<HTMLInputElement>("input")!.focus();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-cancel-define-parameter]").forEach((button) => button.addEventListener("click", () => {
    const form = button.closest<HTMLFormElement>("form")!;
    form.hidden = true;
    const start = form.parentElement!.querySelector<HTMLButtonElement>("[data-start-define-parameter]");
    if (start) { start.hidden = false; start.focus(); }
  }));
  document.querySelectorAll<HTMLFormElement>("[data-define-parameter-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const displayName = new FormData(form).get("displayName")?.toString().trim() ?? "";
    if (!displayName) { form.querySelector<HTMLInputElement>("input")!.focus(); return; }
    beginParameterOperation(`Define ${displayName}`);
    worker?.postMessage({ type: "promote-parameter", feature: form.dataset.feature, field: form.dataset.field, parameter: form.dataset.parameter, displayName });
  }));
  document.querySelectorAll<HTMLButtonElement>(".sketch-dimensions [data-open-parameters]").forEach((button) => button.addEventListener("click", () => openParametersDialog(button)));
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

function constructionPlaneDocumentState(): SketchPlaneDocument & { revision?: number } {
  return adapter.durableDocument() as SketchPlaneDocument & { revision?: number };
}

function syncConstructionPlaneDisplay(): void {
  if (!renderer) return;
  const documentState = constructionPlaneDocumentState();
  const accepted = adapter.getSnapshot().components.flatMap((component) => component.constructionPlanes).flatMap((plane) => {
    if (plane.suppressed || hiddenConstructionPlaneIds.has(plane.id)) return [];
    const resolved = resolveSketchPlane({ kind: "construction_plane_reference", plane: plane.id }, documentState);
    if (resolved.status !== "ready") return [];
    return [{
      id: plane.id,
      frame: {
        origin_nanometers: resolved.plane.origin_nanometers,
        x_axis_millionths: resolved.plane.x_axis_millionths,
        y_axis_millionths: resolved.plane.y_axis_millionths,
        normal_millionths: resolved.plane.normal_millionths,
      },
      selected: selectedConstructionPlaneId === plane.id,
    }];
  });
  const preview = activeOffsetConstructionPlane?.previewFrame && !activeOffsetConstructionPlane.suppressed
    ? [{ id: activeOffsetConstructionPlane.planeId, frame: activeOffsetConstructionPlane.previewFrame, selected: true, preview: true }]
    : [];
  renderer.setConstructionPlanes([...accepted.filter((plane) => plane.id !== activeOffsetConstructionPlane?.planeId), ...preview]);
}

function currentDocumentRevision(): number {
  const revision = constructionPlaneDocumentState().revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0;
}

function startOffsetConstructionPlaneEdit(planeId?: string): void {
  if (!documentReady || !modelingRuntimeReady()) {
    showActionError("Plane", "The model runtime is not ready");
    return;
  }
  const snapshot = adapter.getSnapshot();
  const existing = planeId
    ? snapshot.components.flatMap((component) => component.constructionPlanes.map((plane) => ({ component, plane }))).find((entry) => entry.plane.id === planeId)
    : undefined;
  const component = existing?.component ?? snapshot.components.find((candidate) => !candidate.parentId) ?? snapshot.components[0];
  if (!component) {
    showActionError("Plane", "No component is available for the construction plane");
    return;
  }
  const revision = currentDocumentRevision();
  const id = existing?.plane.id ?? `construction-plane:${crypto.randomUUID()}`;
  const selectedBase = selectedSketchSupport?.kind === "origin_plane_reference"
    ? selectedSketchSupport.plane.replace("origin-plane:", "")
    : "xy";
  const basePlane = existing?.plane.basePlaneId.replace("origin-plane:", "") ?? selectedBase;
  activeOffsetConstructionPlane = {
    mode: existing ? "edit" : "create",
    planeId: id,
    componentId: component.id,
    offsetParameterId: existing?.plane.offsetParameterId ?? `parameter:construction-plane-offset:${crypto.randomUUID()}`,
    basePlane: basePlane === "xz" || basePlane === "yz" ? basePlane : "xy",
    offsetMillimeters: existing ? offsetNanometersToMillimeters(existing.plane.offsetNanometers) : "10",
    suppressed: existing?.plane.suppressed ?? false,
    transactionId: `transaction:${revision + 1}:construction-plane:${crypto.randomUUID()}`,
    baseRevision: revision,
    requestId: 0,
    previewReady: false,
  };
  selectedConstructionPlaneId = existing?.plane.id;
  selectedCatalogOperationId = null;
  setOperation("preview", "construction-plane");
  renderInspector();
  requestOffsetConstructionPlanePreview();
}

function currentOffsetConstructionPlaneRequest(): OffsetConstructionPlaneRequest | undefined {
  const edit = activeOffsetConstructionPlane;
  if (!edit) return undefined;
  return buildOffsetConstructionPlaneRequest({
    planeId: edit.planeId,
    componentId: edit.componentId,
    basePlane: edit.basePlane,
    offsetParameterId: edit.offsetParameterId,
    offsetMillimeters: edit.offsetMillimeters,
    suppressed: edit.suppressed,
    transactionId: edit.transactionId,
    baseRevision: edit.baseRevision,
  });
}

function requestOffsetConstructionPlanePreview(): void {
  const edit = activeOffsetConstructionPlane;
  if (!edit) return;
  const request = currentOffsetConstructionPlaneRequest();
  edit.previewReady = false;
  edit.previewFrame = undefined;
  edit.error = request ? undefined : constructionPlaneOffsetInputError(edit.offsetMillimeters);
  syncConstructionPlaneDisplay();
  const status = document.querySelector<HTMLElement>("#construction-plane-status");
  if (status) status.textContent = edit.error ?? "Computing an exact preview…";
  const apply = document.querySelector<HTMLButtonElement>("#apply-construction-plane");
  if (apply) apply.disabled = true;
  if (!request) return;
  edit.requestId = ++offsetConstructionPlaneRequest;
  worker?.postMessage({ type: "preview-offset-construction-plane", requestId: edit.requestId, request });
}

function commitOffsetConstructionPlane(): void {
  const edit = activeOffsetConstructionPlane;
  const request = currentOffsetConstructionPlaneRequest();
  if (!edit || !request || !edit.previewReady) return;
  edit.previewReady = false;
  document.querySelector<HTMLButtonElement>("#apply-construction-plane")?.setAttribute("disabled", "true");
  const status = document.querySelector<HTMLElement>("#construction-plane-status");
  if (status) status.textContent = edit.mode === "edit" ? "Applying plane update…" : "Creating plane…";
  worker?.postMessage({ type: "commit-offset-construction-plane", requestId: edit.requestId, request });
}

function cancelOffsetConstructionPlane(): void {
  if (!activeOffsetConstructionPlane) return;
  offsetConstructionPlaneRequest += 1;
  activeOffsetConstructionPlane = undefined;
  setOperation("cancelled", "construction-plane");
  syncConstructionPlaneDisplay();
  renderDocument();
}

function renderOffsetConstructionPlaneInspector(): void {
  const edit = activeOffsetConstructionPlane;
  if (!edit) return;
  const inspector = document.querySelector<HTMLElement>("#inspector")!;
  inspector.innerHTML = `<header class="inspector-selection-header"><i aria-hidden="true"></i><span><h2>${edit.mode === "edit" ? "Edit" : "Create"} offset plane</h2><p class="feature-type">Construction geometry · exact signed offset</p></span></header>
    <section class="inspector-section inspector-parameters offset-construction-plane-editor" aria-label="Offset construction plane">
      <h3>Plane definition</h3>
      <label><span>Base plane</span><select id="construction-plane-base" aria-label="Base origin plane"><option value="xy" ${edit.basePlane === "xy" ? "selected" : ""}>XY plane</option><option value="xz" ${edit.basePlane === "xz" ? "selected" : ""}>XZ plane</option><option value="yz" ${edit.basePlane === "yz" ? "selected" : ""}>YZ plane</option></select></label>
      <label><span>Offset</span><span class="dimension-control"><input id="construction-plane-offset" inputmode="decimal" aria-label="Signed plane offset in millimeters" value="${escapeHtml(edit.offsetMillimeters)}"/><b>mm</b></span></label>
      ${edit.mode === "edit" ? `<label class="construction-plane-suppression"><input id="construction-plane-suppressed" type="checkbox" ${edit.suppressed ? "checked" : ""}/><span>Suppress plane</span></label>` : ""}
      <output id="construction-plane-status" role="status">${escapeHtml(edit.error ?? (edit.previewReady ? "Preview ready. Enter accepts; Escape cancels." : "Computing an exact preview…"))}</output>
      <div class="operation-actions"><button id="apply-construction-plane" type="button" ${edit.previewReady ? "" : "disabled"}>${edit.mode === "edit" ? "Apply update" : "Create plane"}</button><button id="cancel-construction-plane" type="button">Cancel</button></div>
    </section>`;
  const base = inspector.querySelector<HTMLSelectElement>("#construction-plane-base")!;
  const offset = inspector.querySelector<HTMLInputElement>("#construction-plane-offset")!;
  base.addEventListener("change", () => { edit.basePlane = base.value as typeof edit.basePlane; requestOffsetConstructionPlanePreview(); });
  offset.addEventListener("input", () => { edit.offsetMillimeters = offset.value; requestOffsetConstructionPlanePreview(); });
  offset.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commitOffsetConstructionPlane(); } });
  inspector.querySelector<HTMLInputElement>("#construction-plane-suppressed")?.addEventListener("change", (event) => { edit.suppressed = (event.currentTarget as HTMLInputElement).checked; requestOffsetConstructionPlanePreview(); });
  inspector.querySelector<HTMLButtonElement>("#apply-construction-plane")!.addEventListener("click", commitOffsetConstructionPlane);
  inspector.querySelector<HTMLButtonElement>("#cancel-construction-plane")!.addEventListener("click", cancelOffsetConstructionPlane);
}

function renderBrowser(): void {
  const snapshot = adapter.getSnapshot();
  const browser = document.querySelector<HTMLElement>("#feature-browser")!;
  const componentById = new Map(snapshot.components.map((component) => [component.id, component]));
  const group = (label: string, kind: string, rows: string) => rows ? `<li role="treeitem" aria-expanded="true" class="tree-group" data-tree-group="${kind}"><button type="button" class="tree-group-label" aria-expanded="true"><i>⌄</i><span>${label}</span></button><ul role="group">${rows}</ul></li>` : "";
  const renderComponent = (componentId: string): string => {
    const component = componentById.get(componentId);
    if (!component) return "";
    const planes = component.originPlanes.map((plane) => `<li role="treeitem"><button type="button" class="tree-row plane-row ${selectedSketchSupport?.kind === "origin_plane_reference" && selectedSketchSupport.plane === plane.id ? "selected" : ""}" data-tree-row data-origin-plane-id="${escapeHtml(plane.id)}" data-entity-kind="origin-plane" data-entity-id="${escapeHtml(plane.id)}"><i>◇</i><span>${escapeHtml(plane.name)}</span><small>construction</small></button></li>`).join("");
    const constructionPlanes = component.constructionPlanes.map((plane) => {
      const visible = !plane.suppressed && !hiddenConstructionPlaneIds.has(plane.id);
      return `<li role="treeitem" class="construction-plane-tree-item"><button type="button" class="tree-row construction-plane-row ${selectedConstructionPlaneId === plane.id || selectedSketchSupport?.kind === "construction_plane_reference" && selectedSketchSupport.plane === plane.id ? "selected" : ""}" data-tree-row data-construction-plane-id="${escapeHtml(plane.id)}" data-entity-kind="construction-plane" data-entity-id="${escapeHtml(plane.id)}"><i>◇</i><span>${escapeHtml(plane.name)}</span><small>${plane.suppressed ? "suppressed" : `${offsetNanometersToMillimeters(plane.offsetNanometers)} mm`}</small></button><button type="button" class="visibility-toggle" data-construction-plane-visibility="${escapeHtml(plane.id)}" aria-pressed="${visible}" aria-label="${visible ? "Hide" : "Show"} ${escapeHtml(plane.name)}" title="${visible ? "Hide" : "Show"} plane" ${plane.suppressed ? "disabled" : ""}>${cadIcon(visible ? "eye" : "eye-off", visible ? "eye" : "eye-off")}</button></li>`;
    }).join("");
    const bodies = component.bodies.map((body) => {
      const selected = state.selection?.kind === "body" && state.selection.stableId === body.id;
      const visible = body.visibility === "visible";
      return `<li role="treeitem" class="body-tree-item"><button type="button" class="tree-row body-row ${selected ? "selected" : ""}" data-tree-row data-body-id="${escapeHtml(body.id)}" data-entity-kind="body" data-entity-id="${escapeHtml(body.id)}" ${adapter.selectionAllowed(body.id) ? "" : "aria-disabled=\"true\""}><i>⬡</i><span>${escapeHtml(body.name)}</span><small>${body.status}</small></button><button type="button" class="visibility-toggle" data-body-visibility="${escapeHtml(body.id)}" aria-pressed="${visible}" aria-label="${visible ? "Hide" : "Show"} ${escapeHtml(body.name)}" title="${visible ? "Hide" : "Show"} body">${cadIcon(visible ? "eye" : "eye-off", visible ? "eye" : "eye-off")}</button></li>`;
    }).join("");
    const sketches = component.sketches.map((sketch) => {
      const visible = !hiddenCommittedSketchIds.has(sketch.id);
      return `<li role="treeitem" class="sketch-tree-item"><button type="button" class="tree-row sketch-row ${selectedSketchId === sketch.id || (!selectedSketchId && sketch.featureId === state.selectedFeatureId) ? "selected" : ""}" data-tree-row data-sketch-id="${escapeHtml(sketch.id)}" data-sketch-feature-id="${escapeHtml(sketch.featureId ?? "")}" data-entity-kind="sketch" data-entity-id="${escapeHtml(sketch.id)}"><i>⌑</i><span>${escapeHtml(sketch.name)}</span><small>${escapeHtml(sketch.support)}</small></button><button type="button" class="visibility-toggle" data-sketch-visibility="${escapeHtml(sketch.id)}" aria-pressed="${visible}" aria-label="${visible ? "Hide" : "Show"} ${escapeHtml(sketch.name)}" title="${visible ? "Hide" : "Show"} sketch">${cadIcon(visible ? "eye" : "eye-off", visible ? "eye" : "eye-off")}</button></li>`;
    }).join("");
    const children = component.childComponentIds.map(renderComponent).join("");
    return `<li role="treeitem" aria-expanded="true" class="tree-component" data-component-id="${escapeHtml(component.id)}"><button type="button" class="tree-row component-row" data-tree-row data-entity-kind="component" data-entity-id="${escapeHtml(component.id)}"><i>▾</i><span>${escapeHtml(component.name)}</span><small>component</small></button><ul role="group">${group("Origin & construction", "origin-planes", planes + constructionPlanes)}${group("Bodies", "bodies", bodies)}${group("Sketches", "sketches", sketches)}${children}</ul></li>`;
  };
  const roots = snapshot.components.filter((component) => !component.parentId || !componentById.has(component.parentId));
  const featureIndex = snapshot.features.map((feature) => feature.name).join(" ");
  browser.innerHTML = `<ul role="tree" class="browser-tree">${roots.map((component) => renderComponent(component.id)).join("")}<li class="browser-feature-index" data-tree-group="features" aria-hidden="true">${escapeHtml(featureIndex)}</li></ul>`;
  browser.querySelectorAll<HTMLButtonElement>("[data-origin-plane-id]").forEach((button) => button.addEventListener("click", () => {
    const plane = button.dataset.originPlaneId?.replace("origin-plane:", "") as "xy" | "xz" | "yz" | undefined;
    if (sketchChoosingSupport && plane && ["xy", "xz", "yz"].includes(plane)) {
      handleSketchSupportPick({ kind: "origin_plane", plane });
      return;
    }
    state.selectedFeatureId = "origin";
    selectedSketchId = undefined;
    selectedConstructionPlaneId = undefined;
    selectedSketchProfile = undefined;
    selectedSketchSupport = { kind: "origin_plane_reference", plane: button.dataset.originPlaneId! };
    renderDocument();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-construction-plane-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.constructionPlaneId!;
      const plane = adapter.getSnapshot().components.flatMap((component) => component.constructionPlanes).find((candidate) => candidate.id === id);
      if (!plane || plane.suppressed) return;
      state.selectedFeatureId = "origin";
      selectedConstructionPlaneId = id;
      selectedSketchId = undefined;
      selectedSketchProfile = undefined;
      selectedSketchSupport = { kind: "construction_plane_reference", plane: id };
      if (sketchChoosingSupport) {
        handleSketchSupportPick({ kind: "construction_plane", plane: id });
        return;
      }
      renderDocument();
    });
    button.addEventListener("dblclick", () => startOffsetConstructionPlaneEdit(button.dataset.constructionPlaneId));
  });
  browser.querySelectorAll<HTMLButtonElement>("[data-construction-plane-visibility]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = button.dataset.constructionPlaneVisibility!;
    if (hiddenConstructionPlaneIds.has(id)) hiddenConstructionPlaneIds.delete(id); else hiddenConstructionPlaneIds.add(id);
    syncConstructionPlaneDisplay();
    renderBrowser();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-sketch-id]").forEach((button) => button.addEventListener("click", () => {
    selectedSketchId = button.dataset.sketchId;
    selectedConstructionPlaneId = undefined;
    if (selectedSketchId) { hiddenCommittedSketchIds.delete(selectedSketchId); persistCommittedSketchVisibility(); }
    if (button.dataset.sketchFeatureId) state.selectedFeatureId = button.dataset.sketchFeatureId;
    selectedSketchSupport = undefined;
    renderDocument();
    updateBaseOperationAvailability();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-sketch-visibility]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = button.dataset.sketchVisibility!;
    if (hiddenCommittedSketchIds.has(id)) hiddenCommittedSketchIds.delete(id); else hiddenCommittedSketchIds.add(id);
    persistCommittedSketchVisibility();
    syncCommittedSketches();
    renderBrowser();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-body-id]").forEach((button) => button.addEventListener("click", () => {
    selectedSketchId = undefined;
    selectedConstructionPlaneId = undefined;
    const bodyId = button.dataset.bodyId!;
    applySelection(adapter.selectionAllowed(bodyId) ? { kind: "body", stableId: bodyId, bodyId, token: 0 } : null);
    renderDocument();
  }));
  browser.querySelectorAll<HTMLButtonElement>("[data-body-visibility]").forEach((button) => button.addEventListener("click", () => {
    const body = adapter.findBody(button.dataset.bodyVisibility!);
    if (!body) return;
    worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}`, changes: [{ kind: "set_body_visibility", body: body.id, visibility: body.visibility === "visible" ? "hidden" : "visible" }] });
  }));
  browser.querySelectorAll<HTMLButtonElement>(".tree-group-label").forEach((button) => button.addEventListener("click", () => {
    const group = button.closest<HTMLElement>(".tree-group")!;
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    group.setAttribute("aria-expanded", String(!expanded));
    group.querySelector<HTMLElement>(":scope > ul")!.hidden = expanded;
    button.querySelector("i")!.textContent = expanded ? "›" : "⌄";
  }));
  browser.querySelectorAll<HTMLButtonElement>(".component-row").forEach((button) => button.addEventListener("dblclick", () => {
    const component = button.closest<HTMLElement>(".tree-component")!;
    const children = component.querySelector<HTMLElement>(":scope > ul")!;
    const expanded = component.getAttribute("aria-expanded") === "true";
    component.setAttribute("aria-expanded", String(!expanded));
    children.hidden = expanded;
    button.querySelector("i")!.textContent = expanded ? "›" : "▾";
  }));
  installRoving(browser, "[data-tree-row]");
}

function timelineFeatureIcon(type: string): string {
  const normalized = type.toLowerCase().replaceAll(".", "_").replaceAll("-", "_");
  if (normalized === "origin") return cadIcon("origin", "crosshair");
  if (normalized.includes("sketch")) return cadIcon("new-sketch", "pencil-ruler");
  if (normalized === "pad" || normalized.includes("extrude")) return cadIcon("extrude", "box-select");
  if (normalized.includes("pocket")) return cadIcon("extrude-cut", "box");
  if (normalized.includes("revolve")) return cadIcon("revolve", "rotate-3-d");
  if (normalized.includes("fillet")) return cadIcon("fillet", "circle-dot");
  if (normalized.includes("chamfer")) return cadIcon("chamfer", "square");
  if (normalized.includes("pattern_linear") || normalized.includes("linear_pattern")) return cadIcon("linear-pattern", "layout-panel-top");
  if (normalized.includes("pattern_circular") || normalized.includes("circular_pattern")) return cadIcon("circular-pattern", "orbit");
  if (normalized.includes("mirror")) return cadIcon("mirror", "layers-3");
  if (normalized.includes("boolean_union")) return cadIcon("combine", "layers-3");
  if (normalized.includes("boolean_cut")) return cadIcon("subtract", "box-select");
  if (normalized.includes("boolean_intersect")) return cadIcon("intersect", "circle-dot");
  return cadIcon("box-select", "box");
}

function installTimelineInteractions(timeline: HTMLElement): void {
  let tooltip = document.querySelector<HTMLElement>("#timeline-feature-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("aside");
    tooltip.id = "timeline-feature-tooltip";
    tooltip.className = "timeline-feature-tooltip";
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  timeline.querySelectorAll<HTMLButtonElement>("[data-timeline-id]").forEach((button) => {
    button.addEventListener("pointerenter", () => {
      const feature = adapter.findFeature(button.dataset.timelineId!);
      if (!feature || !tooltip) return;
      const status = button.querySelector("b")?.textContent ?? feature.status;
      const bounds = button.getBoundingClientRect();
      tooltip.innerHTML = `<span class="timeline-tooltip-title"><i>${timelineFeatureIcon(feature.type)}</i><strong>${escapeHtml(feature.name)}</strong></span><small>${escapeHtml(feature.type.replaceAll("_", " "))} · ${escapeHtml(status)}</small>`;
      tooltip.style.left = `${bounds.left + bounds.width / 2}px`;
      tooltip.style.top = `${bounds.top - 8}px`;
      tooltip.hidden = false;
    });
    button.addEventListener("pointerleave", () => { if (tooltip) tooltip.hidden = true; });
  });
  const playhead = timeline.querySelector<HTMLElement>("[data-timeline-playhead]");
  const track = timeline.querySelector<HTMLElement>(".timeline-track");
  if (!playhead || !track) return;
  playhead.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    tooltip!.hidden = true;
    playhead.setPointerCapture(event.pointerId);
    playhead.classList.add("dragging");
    const itemCount = timeline.querySelectorAll("[data-timeline-id]").length;
    let targetIndex = Number(playhead.dataset.timelinePlayhead ?? itemCount - 1);
    const update = (clientX: number) => {
      const bounds = track.getBoundingClientRect();
      targetIndex = Math.max(0, Math.min(itemCount - 1, Math.round((clientX - bounds.left - 13) / 29)));
      playhead.style.left = `${targetIndex * 29 + 38}px`;
      const count = timeline.querySelector<HTMLOutputElement>(".timeline-count strong");
      if (count) count.textContent = String(targetIndex + 1);
    };
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const finish = (upEvent: PointerEvent) => {
      playhead.classList.remove("dragging");
      playhead.removeEventListener("pointermove", move);
      playhead.removeEventListener("pointerup", finish);
      if (playhead.hasPointerCapture(upEvent.pointerId)) playhead.releasePointerCapture(upEvent.pointerId);
      rollbackToTimelineIndex(targetIndex);
    };
    playhead.addEventListener("pointermove", move);
    playhead.addEventListener("pointerup", finish);
  });
}

function syncEmptyDocumentActions(): void {
  const snapshot = adapter.getSnapshot();
  const bodyCount = snapshot.components.reduce((total, component) => total + component.bodies.length, 0);
  const sketchCount = snapshot.components.reduce((total, component) => total + component.sketches.length, 0);
  const featureCount = snapshot.features.filter((feature) => feature.type !== "origin").length;
  document.querySelector<HTMLElement>("#empty-document-actions")!.hidden = bodyCount + sketchCount + featureCount > 0 || Boolean(sketchSession);
}

function renderDocument(): void {
  const focusedTimelineId = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.timelineId
    : undefined;
  selectedCatalogOperationId = null;
  const snapshot = adapter.getSnapshot();
  document.querySelector<HTMLElement>("#document-name")!.textContent = "•••";
  document.querySelector<HTMLElement>("#document-name")!.title = snapshot.name;
  const topName = document.querySelector<HTMLElement>("#top-document-name");
    if (topName) topName.textContent = `${snapshot.name}.crawlerpart`;
  const bodyCount = snapshot.components.reduce((total, component) => total + component.bodies.length, 0);
  const sketchCount = snapshot.components.reduce((total, component) => total + component.sketches.length, 0);
  const featureCount = snapshot.features.filter((feature) => feature.type !== "origin").length;
  document.querySelector("#browser-summary")!.textContent = `${bodyCount} ${bodyCount === 1 ? "body" : "bodies"} · ${sketchCount} ${sketchCount === 1 ? "sketch" : "sketches"} · ${featureCount} ${featureCount === 1 ? "feature" : "features"}`;
  syncEmptyDocumentActions();
  renderBrowser();
  syncConstructionPlaneDisplay();
  renderInspector();
  const timeline = document.querySelector<HTMLElement>("#timeline")!;
  const inputs = new Set(featureServices?.relationships.direct_inputs ?? []);
  const consumers = new Set(featureServices?.relationships.direct_consumers ?? []);
  const serviceItems = new Map(featureServices?.timeline.map((item) => [item.feature, item]) ?? []);
  const timelineButtons = snapshot.features.map((feature, index) => {
    const service = serviceItems.get(feature.id);
    const dependencyClass = inputs.has(feature.id) ? "dependency-input" : consumers.has(feature.id) ? "dependency-consumer" : "";
    const group = service?.group ? `<em>${escapeHtml(service.group)}</em>` : "";
    const status = service?.state ?? feature.status;
    return `<button type="button" data-timeline-id="${feature.id}" data-timeline-index="${index}" data-feature-id="${feature.id}" class="timeline-item timeline-${escapeHtml(feature.type.replaceAll("_", "-"))} ${feature.id === state.selectedFeatureId ? "selected" : ""} ${dependencyClass}" data-after-rollback="${service?.after_rollback ?? false}" title="${escapeHtml(feature.name)} · ${escapeHtml(status)}" aria-label="${escapeHtml(feature.name)} · ${escapeHtml(status)}"><i>${timelineFeatureIcon(feature.type)}</i><span>${escapeHtml(feature.name)}</span><small class="timeline-type">${escapeHtml(feature.type)}</small><b>${escapeHtml(status)}</b>${group}${status === "warning" || status === "error" ? `<u class="timeline-warning" aria-hidden="true"></u>` : ""}</button>`;
  }).join("");
  const firstAfterRollback = snapshot.features.findIndex((feature) => serviceItems.get(feature.id)?.after_rollback === true);
  const activeCount = firstAfterRollback < 0 ? snapshot.features.length : Math.max(1, firstAfterRollback);
  const playheadIndex = Math.max(0, activeCount - 1);
  timeline.innerHTML = `<div class="timeline-track" style="--timeline-active-width:${playheadIndex * 29 + 26}px"><i class="timeline-active-track" aria-hidden="true"></i>${timelineButtons}<span class="timeline-playhead" data-timeline-playhead="${playheadIndex}" style="left:${playheadIndex * 29 + 38}px" title="Drag to roll back"><i></i><i></i></span><u class="timeline-end-cap" aria-hidden="true"></u></div><output class="timeline-count" aria-label="Active history steps"><strong>${activeCount}</strong><span>/${snapshot.features.length}</span></output>`;
  timeline.querySelectorAll<HTMLButtonElement>("[data-timeline-id]").forEach((button) => button.addEventListener("click", () => { state.selectedFeatureId = button.dataset.timelineId!; renderDocument(); requestFeatureServices(); }));
  installRoving(timeline, "[data-timeline-id]");
  installTimelineInteractions(timeline);
  if (focusedTimelineId) {
    const replacement = timeline.querySelector<HTMLButtonElement>(`[data-timeline-id="${CSS.escape(focusedTimelineId)}"]`);
    if (replacement) {
      timeline.querySelectorAll<HTMLButtonElement>("[data-timeline-id]").forEach((button) => { button.tabIndex = button === replacement ? 0 : -1; });
      replacement.focus();
    }
  }
  synchronizeRuntimeCommandAvailability();
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

type InspectorTab = "tool" | "properties" | "constraints" | "appearance";
let activeInspectorTab: InspectorTab = "properties";

function syncToolInspectorTab(): void {
  const tab = document.querySelector<HTMLButtonElement>("#inspector-tool-tab")!;
  tab.hidden = !activeToolContext;
  const label = sketchSession && sketchChoosingSupport ? "Support" : activeToolContext?.label ?? "Tool";
  tab.textContent = label;
  tab.title = activeToolContext ? `${label} tool` : "Active tool";
}

function explainAdvancedFeatureError(label: string, message: string, recovery?: string): string {
  if (/invalid part document.*revolve requires one profile source|revolve requires one profile source/i.test(message)) {
    return "Select one closed sketch profile to preview Revolve.";
  }
  if (/invalid part document/i.test(message)) {
    return `${label} could not be previewed with the current inputs. Check the required selections and parameters.`;
  }
  return `${message}${recovery ? ` — ${recovery}` : ""}`;
}

function activateToolContext(context: ActiveToolContext): void {
  activeToolContext = context;
  syncToolInspectorTab();
  setInspectorTab("tool");
}

function deactivateToolContext(render = true): void {
  activeToolContext = undefined;
  syncToolInspectorTab();
  if (activeInspectorTab === "tool") activeInspectorTab = "properties";
  document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
    const active = button.dataset.inspectorTab === activeInspectorTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) document.querySelector<HTMLElement>("#inspector")?.setAttribute("aria-labelledby", button.id);
  });
  if (render) renderInspector();
}

function setInspectorTab(tab: InspectorTab): void {
  if (tab === "tool" && !activeToolContext) tab = "properties";
  activeInspectorTab = tab;
  document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
    const active = button.dataset.inspectorTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) document.querySelector<HTMLElement>("#inspector")?.setAttribute("aria-labelledby", button.id);
  });
  renderInspector();
  inspectorPanel?.scrollTo({ top: 0 });
}

function hasSketchSelection(): boolean {
  return selectedSketchGeometry.length > 0 || selectedSketchPoints.length > 0 || sketchOriginSelected || Boolean(selectedSketchProfile);
}

function hasAnySketchSelection(): boolean {
  return hasSketchSelection() || Boolean(selectedSketchConstraint);
}

function sketchSelectionModeForEvent(event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">): SketchSelectionMode {
  if (event.ctrlKey || event.metaKey) return "toggle";
  if (event.shiftKey) return "add";
  return sketchSelectionMode;
}

function updateSketchIdSelection(current: readonly string[], id: string, mode: SketchSelectionMode): string[] {
  const selected = current.includes(id);
  if (mode === "replace") return [id];
  if (mode === "remove" || (mode === "toggle" && selected)) return current.filter((candidate) => candidate !== id);
  return selected ? [...current] : [...current, id];
}

function clearSketchSelection(render = true): void {
  selectedSketchGeometry = [];
  selectedSketchPoints = [];
  selectedSketchSegments = [];
  selectedSketchConstraint = undefined;
  sketchOriginSelected = false;
  selectedSketchProfile = undefined;
  selectedSketchConstructionAxis = undefined;
  sketchProfileRepairMessage = undefined;
  sketchSelectionMode = "replace";
  if (render) {
    renderSketchSelectionChanged();
    setSketchSelectionPhase("collecting");
    updateSketchToolInspectorState();
    if (activeInspectorTab === "tool") renderSketchSelectionInspectorChanged();
  }
}

function sketchSelectionPresentation(): { count: number; label: string; mix: string } {
  const pointParents = new Set(selectedSketchPoints.map((point) => point.geometry));
  const entityCount = selectedSketchGeometry.filter((id) => !pointParents.has(id)).length;
  const parts: string[] = [];
  if (entityCount) parts.push(`${entityCount} ${entityCount === 1 ? "curve" : "curves"}`);
  if (selectedSketchPoints.length) parts.push(`${selectedSketchPoints.length} ${selectedSketchPoints.length === 1 ? "point" : "points"}`);
  if (selectedSketchConstraint) parts.push(sketchConstraintDimension(selectedSketchConstraint) === undefined ? "1 constraint" : "1 dimension");
  if (sketchOriginSelected) parts.push("origin");
  if (selectedSketchProfile) parts.push("1 closed profile");
  const count = entityCount + selectedSketchPoints.length + (selectedSketchConstraint ? 1 : 0) + (sketchOriginSelected ? 1 : 0) + (selectedSketchProfile ? 1 : 0);
  return { count, label: `${count} selected`, mix: parts.join(" + ") || "Selection" };
}

function syncSketchSelectionAssistUi(): void {
  const tray = document.querySelector<HTMLElement>("#sketch-selection-tray");
  if (tray) {
    const summary = sketchSelectionPresentation();
    tray.hidden = !sketchSession || summary.count === 0;
    setTextIfChanged(tray.querySelector("[data-selection-count]"), summary.label);
    setTextIfChanged(tray.querySelector("[data-selection-mix]"), summary.mix);
    tray.querySelectorAll<HTMLButtonElement>("[data-sketch-selection-mode]").forEach((button) => {
      const active = button.dataset.sketchSelectionMode === sketchSelectionMode;
      button.setAttribute("aria-pressed", String(active));
    });
  }
  const card = document.querySelector<HTMLOutputElement>("#sketch-hover-card");
  if (!card) return;
  const target = sketchHoverTarget;
  const position = sketchHoverClientPoint;
  if (!sketchSession || !position || !target || target.kind === "plane" || !target.id) {
    card.hidden = true;
    return;
  }
  const viewport = document.querySelector<HTMLElement>(".viewport-region")!.getBoundingClientRect();
  const mode: SketchSelectionMode = sketchHoverModifiers.toggle ? "toggle" : sketchHoverModifiers.shift ? "add" : sketchSelectionMode;
  let title = target.kind.replace(/^./, (value) => value.toUpperCase());
  let id = target.id;
  let selected = false;
  if (target.kind === "profile") {
    title = "Closed profile";
    selected = selectedSketchProfile?.profileId === target.id;
  } else if (target.kind === "geometry" || target.kind === "point") {
    const entity = sketchSession.draft.geometry[target.id];
    const geometryName = entity?.geometry.kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase()) ?? "Geometry";
    title = target.kind === "point" ? `${target.anchor?.replaceAll(":", " ") ?? "Point"} · ${geometryName}` : `${geometryName}${target.segment === undefined ? "" : ` · segment ${target.segment + 1}`}`;
    selected = target.kind === "point"
      ? selectedSketchPoints.some((point) => point.geometry === target.id && point.anchor === target.anchor)
      : selectedSketchGeometry.includes(target.id);
  } else if (target.kind === "constraint") selected = selectedSketchConstraint === target.id;
  else if (target.kind === "origin") { title = "Sketch origin"; selected = sketchOriginSelected; }
  const action = !target.valid
    ? target.reason ?? "Unavailable for the active tool"
    : mode === "remove" ? "Click to remove"
      : mode === "add" ? (selected ? "Already selected" : "Click to add")
        : mode === "toggle" ? (selected ? "Click to remove" : "Click to add")
          : (selected ? "Selected · Shift-click to add another" : "Click to select");
  card.dataset.state = target.valid ? (selected ? "selected" : "available") : "invalid";
  setTextIfChanged(card.querySelector("strong"), title);
  setTextIfChanged(card.querySelector("code"), id);
  setTextIfChanged(card.querySelector("span"), action);
  card.style.left = `${Math.max(12, Math.min(viewport.width - 222, position.x - viewport.left + 16))}px`;
  card.style.top = `${Math.max(56, Math.min(viewport.height - 100, position.y - viewport.top + 18))}px`;
  card.hidden = false;
}

function sketchOperandCollectionActive(): boolean {
  return Boolean(sketchSession && !pendingDimensionPlacement && (pendingSketchConstraint || sketchSmartDimensionActive));
}

function sketchConstraintSelectionIsCompatible(kind: ConstraintTool): boolean {
  if (!sketchSession || !hasSketchSelection()) return true;
  return !constraintDisabledReason(kind, summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected));
}

function sketchEditSelectionIsCompatible(tool: SketchTool): boolean {
  if (!sketchSession || !selectedSketchGeometry.length) return true;
  return !toolDisabledReason(tool, summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected));
}

function activeSketchToolKey(): string | undefined {
  if (!sketchSession) return undefined;
  if (sketchChoosingSupport) return undefined;
  if (sketchSmartDimensionActive) return "smart-sketch-dimension";
  if (pendingSketchConstraint) return pendingSketchConstraint;
  if (activeToolContext?.source === "sketch" && activeToolContext.key !== "sketch-select") return activeToolContext.key;
  return undefined;
}

function sketchCursorMode(): "select" | "draw" | "constraint" | "dimension" | "trim" | "modify" | "project" | "support" | "applying" | "blocked" {
  if (sketchChoosingSupport) return "support";
  if (!activeSketchToolKey()) return "select";
  if (sketchToolPhase === "applying") return "applying";
  if (sketchToolPhase === "blocked") return "blocked";
  if (sketchSmartDimensionActive || pendingDimensionPlacement || (pendingSketchConstraint && SKETCH_CONSTRAINT_MANIFEST[pendingSketchConstraint].family === "dimension")) return "dimension";
  if (pendingSketchConstraint) return "constraint";
  if (sketchToolArmed) return sketchSession?.activeTool === "trim" ? "trim" : "draw";
  if (activeToolContext?.source === "sketch" && activeToolContext.key !== "sketch-select") return SKETCH_TOOL_MANIFEST[activeToolContext.key as SketchTool]?.pointer ?? "modify";
  return "select";
}

function sketchCursorBadge(): string {
  const mode = sketchCursorMode();
  if (mode === "constraint") return `${pendingSketchConstraint?.replaceAll("_", " ") ?? "constraint"} ${Math.max(1, selectedSketchGeometry.length + selectedSketchPoints.length + 1)}`;
  if (mode === "dimension") return pendingDimensionPlacement ? "place dimension" : `dimension ${Math.max(1, selectedSketchGeometry.length + selectedSketchPoints.length + 1)}`;
  if (mode === "trim") return "trim";
  if (mode === "modify") return activeToolContext?.label ?? "modify";
  if (mode === "project") return "project";
  if (mode === "draw") return SKETCH_TOOL_SCHEMA.find((entry) => entry.id === sketchSession?.activeTool)?.label ?? "draw";
  return mode;
}

function sketchSelectionReadout(): string {
  if (!sketchSession) return "Selection: none";
  const summary = sketchSelectionPresentation();
  if (!summary.count) return "Selection: none";
  const pointParents = new Set(selectedSketchPoints.map((point) => point.geometry));
  const entityCount = selectedSketchGeometry.filter((id) => !pointParents.has(id)).length;
  const parts: string[] = [];
  if (entityCount) parts.push(`${entityCount} ${entityCount === 1 ? "entity" : "entities"}`);
  if (selectedSketchPoints.length) parts.push(`${selectedSketchPoints.length} ${selectedSketchPoints.length === 1 ? "point" : "points"}`);
  if (selectedSketchConstraint) parts.push(sketchConstraintDimension(selectedSketchConstraint) === undefined ? "1 constraint" : "1 dimension");
  if (sketchOriginSelected) parts.push("origin");
  return `Selection (${summary.count}): ${parts.join(" · ")}`;
}

function sketchOperationReadout(): string {
  if (!sketchSession) return "Operation: idle";
  if (sketchChoosingSupport) return "Operation: Choose sketch plane";
  const key = activeSketchToolKey();
  if (!key) return "Operation: Select · no active sketch tool";
  const label = activeToolContext?.label ?? key.replaceAll("_", " ");
  const phase = ({ idle: "ready", collecting: "waiting for input", ready: "ready to apply", applying: "applying", complete: "complete · ready again", blocked: "needs different input" } satisfies Record<SketchToolPhase, string>)[sketchToolPhase];
  return `Operation: ${label} · ${phase}`;
}

function syncSketchWorkspaceReadouts(): void {
  if (!sketchSession) return;
  const selection = document.querySelector<HTMLElement>("#selection-readout");
  const operation = document.querySelector<HTMLElement>("#operation-state");
  if (selection) {
    setTextIfChanged(selection, sketchSelectionReadout());
    setDatasetIfChanged(selection, "active", String(hasSketchSelection() || Boolean(selectedSketchConstraint)));
  }
  if (operation) {
    setTextIfChanged(operation, sketchOperationReadout());
    const activeKey = activeSketchToolKey();
    setDatasetIfChanged(operation, "status", activeKey && sketchToolPhase === "blocked" ? "blocked" : activeKey ? "preview" : "idle");
  }
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setDatasetIfChanged(element: HTMLElement | SVGElement, name: string, value: string): void {
  if (element.dataset[name] !== value) element.dataset[name] = value;
}

function setOptionalAttributeIfChanged(element: Element, name: string, value?: string): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else setAttributeIfChanged(element, name, value);
}

function setOptionalDatasetIfChanged(element: HTMLElement | SVGElement, name: string, value?: string): void {
  if (value === undefined) {
    if (name in element.dataset) delete element.dataset[name];
  } else setDatasetIfChanged(element, name, value);
}

function setTextIfChanged(element: Element | null | undefined, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function sketchHoverEligibility(target: Element | null): typeof sketchHoverTarget {
  if (!sketchSession) return undefined;
  if (!target) return { kind: "plane", valid: Boolean(sketchToolArmed || pendingDimensionPlacement), reason: "Move over compatible sketch geometry" };
  if (target.closest("[data-sketch-origin]")) return { kind: "origin", id: "reference:origin", valid: sketchSelectionFilters.has("points"), reason: sketchSelectionFilters.has("points") ? undefined : "Point selection is filtered out" };
  const profile = target.closest<SVGPathElement>("[data-sketch-profile-id]");
  if (profile) {
    const valid = !activeSketchToolKey() && !pendingSketchConstraint && !sketchSmartDimensionActive;
    return { kind: "profile", id: profile.dataset.sketchProfileId, valid, reason: valid ? undefined : "Finish the active sketch tool before selecting a profile" };
  }
  const constraint = target.closest<SVGGElement>("[data-sketch-constraint-id]");
  if (constraint) {
    const id = constraint.dataset.sketchConstraintId;
    const dimension = id ? sketchConstraintDimension(id) !== undefined : false;
    const activeDimensionTool = dimension && (sketchSmartDimensionActive || Boolean(pendingSketchConstraint && SKETCH_CONSTRAINT_MANIFEST[pendingSketchConstraint].family === "dimension"));
    const valid = sketchSelectionFilters.has(dimension ? "dimensions" : "constraints") && ((!sketchToolArmed && !pendingSketchConstraint && !sketchSmartDimensionActive) || activeDimensionTool);
    return { kind: "constraint", id, valid, reason: valid ? undefined : `${dimension ? "Dimension" : "Constraint"} selection is filtered or another tool is active` };
  }
  const radiusHandle = target.closest<SVGCircleElement>("[data-sketch-radius]");
  if (radiusHandle && (sketchSmartDimensionActive || pendingSketchConstraint === "radius" || pendingSketchConstraint === "concentric")) {
    return { kind: "geometry", id: radiusHandle.dataset.geometry, valid: true };
  }
  const handle = target.closest<SVGCircleElement>("[data-sketch-handle], [data-sketch-radius]");
  if (handle) {
    const valid = sketchSelectionFilters.has("points") && (!pendingSketchConstraint || !["radius", "angle", "parallel", "perpendicular", "concentric", "tangent", "equal"].includes(pendingSketchConstraint));
    return { kind: "point", id: handle.dataset.geometry, anchor: handle.dataset.anchor as PointRef["anchor"] | undefined, valid, reason: valid ? undefined : "This tool requires curve geometry" };
  }
  const geometryTarget = target.closest<SVGGeometryElement>("[data-sketch-geometry], [data-sketch-hit-geometry]");
  const id = geometryTarget?.dataset.sketchGeometry ?? geometryTarget?.dataset.sketchHitGeometry;
  const entity = id ? (sketchSession.draftView as Sketch).geometry[id] : undefined;
  if (!entity) return { kind: "plane", valid: Boolean(sketchToolArmed || pendingDimensionPlacement) };
  if (!sketchEntityMatchesFilter(entity, sketchSelectionFilters)) return { kind: "geometry", id, valid: false, reason: "This geometry type is filtered out" };
  const kind = entity.geometry.kind;
  let valid = true;
  let reason: string | undefined;
  if (sketchSession.activeTool === "trim" && entity.id.startsWith("external:")) { valid = false; reason = "Projected geometry cannot be trimmed"; }
  else if (pendingSketchConstraint) {
    const lineOnly = ["parallel", "perpendicular", "angle", "midpoint", "collinear", "symmetry", "point_line_distance", "line_distance"].includes(pendingSketchConstraint);
    const roundOnly = ["radius", "diameter", "concentric"].includes(pendingSketchConstraint);
    if (lineOnly && kind !== "line") { valid = false; reason = "This constraint requires line geometry"; }
    if (roundOnly && kind !== "circle" && kind !== "arc") { valid = false; reason = "This constraint requires a circle or arc"; }
  } else if (sketchSmartDimensionActive && ["rectangle", "sketch_point"].includes(kind)) { valid = false; reason = "Smart Dimension needs a curve or selected points"; }
  const segment = Number(geometryTarget?.dataset.sketchSegment);
  return { kind: "geometry", id, segment: Number.isInteger(segment) ? segment : undefined, valid, reason };
}

function syncSketchToolUi(): void {
  const workspace = document.querySelector<HTMLElement>(".workspace")!;
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  const sketchRibbon = document.querySelector<HTMLElement>('[data-workbench-ribbon="Sketcher"]')!;
  const activeKey = activeSketchToolKey();
  const displayedPhase: SketchToolPhase = sketchSession && !sketchChoosingSupport && !activeKey ? "ready" : sketchToolPhase;
  const sketch = sketchSession?.draftView as Sketch | undefined;
  const selectionSummary = sketch && hasSketchSelection()
    ? summarizeSketchSelection(sketch, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected)
    : undefined;
  const syncFlyoutState = (button: HTMLButtonElement, unavailable: boolean, active: boolean, reason?: string) => {
    const key = button.dataset.ribbonTool;
    if (!key) return;
    const run = sketchRibbon.querySelector<HTMLButtonElement>(`[data-ribbon-run="${CSS.escape(key)}"]`);
    if (!run || run.hasAttribute("data-coming-soon")) return;
    if (run.disabled) run.disabled = false;
    setAttributeIfChanged(run, "aria-disabled", String(unavailable));
    setOptionalDatasetIfChanged(run, "disabledReason", unavailable ? reason : undefined);
    setDatasetIfChanged(run, "toolState", unavailable ? "unavailable" : active ? sketchToolPhase : "idle");
    run.dataset.baseTitle ??= run.title;
    const title = unavailable && reason ? `${run.dataset.baseTitle} — ${reason}` : run.dataset.baseTitle;
    if (run.title !== title) run.title = title;
    setOptionalAttributeIfChanged(run, "aria-description", unavailable ? reason : undefined);
  };
  const cursorMode = sketchSession ? sketchCursorMode() : "select";
  const cursorTarget = sketchHoverTarget ? (sketchHoverTarget.valid ? "valid" : "invalid") : "none";
  setDatasetIfChanged(workspace, "sketchToolState", sketchSession ? displayedPhase : "idle");
  setDatasetIfChanged(workspace, "sketchCursor", cursorMode);
  setDatasetIfChanged(overlay, "toolState", sketchSession ? displayedPhase : "idle");
  setDatasetIfChanged(overlay, "cursorState", cursorMode);
  setDatasetIfChanged(overlay, "cursorTarget", cursorTarget);
  setDatasetIfChanged(workspace, "sketchCursorTarget", cursorTarget);
  syncSketchWorkspaceReadouts();
  const selectTool = document.querySelector<HTMLButtonElement>("#sketch-select-tool");
  if (selectTool) {
    const active = !sketchChoosingSupport && !activeKey;
    setAttributeIfChanged(selectTool, "aria-pressed", String(active));
    setDatasetIfChanged(selectTool, "toolState", active ? "ready" : "idle");
  }
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => {
    const key = button.dataset.sketchTool as SketchTool;
    const active = key === "construction" ? sketchConstruction : activeKey === key;
    const reason = selectionSummary ? toolDisabledReason(key, selectionSummary) : undefined;
    const unavailable = Boolean(sketchSession && sketchEditOperations.has(key) && !active && reason);
    button.dataset.baseTitle ??= button.title;
    const title = unavailable ? `${button.dataset.baseTitle} — ${reason}` : button.dataset.baseTitle;
    if (button.title !== title) button.title = title;
    setOptionalAttributeIfChanged(button, "aria-description", unavailable ? reason : undefined);
    if (button.disabled) button.disabled = false;
    setAttributeIfChanged(button, "aria-disabled", String(unavailable));
    setOptionalDatasetIfChanged(button, "disabledReason", unavailable ? reason : undefined);
    setAttributeIfChanged(button, "aria-pressed", String(active));
    setDatasetIfChanged(button, "toolState", unavailable ? "unavailable" : active ? sketchToolPhase : "idle");
    setAttributeIfChanged(button, "aria-busy", String(active && sketchToolPhase === "applying"));
    syncFlyoutState(button, unavailable, active, reason);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-constraint]").forEach((button) => {
    const key = button.dataset.sketchConstraint as ConstraintTool;
    const active = activeKey === key && activeToolContext?.source === "constraint";
    const reason = !sketchSession
      ? "Start or edit a sketch to use constraints"
      : sketchChoosingSupport
        ? "Choose a sketch plane before applying constraints"
        : selectionSummary
          ? constraintDisabledReason(key, selectionSummary)
          : undefined;
    const unavailable = Boolean(!active && reason);
    button.dataset.baseTitle ??= button.title;
    const title = unavailable ? `${button.dataset.baseTitle} — ${reason}` : button.dataset.baseTitle;
    if (button.title !== title) button.title = title;
    setOptionalAttributeIfChanged(button, "aria-description", unavailable ? reason : undefined);
    if (button.disabled) button.disabled = false;
    setAttributeIfChanged(button, "aria-disabled", String(unavailable));
    setOptionalDatasetIfChanged(button, "disabledReason", unavailable ? reason : undefined);
    setAttributeIfChanged(button, "aria-pressed", String(active));
    setDatasetIfChanged(button, "toolState", unavailable ? "unavailable" : active ? sketchToolPhase : "idle");
    setAttributeIfChanged(button, "aria-busy", String(active && sketchToolPhase === "applying"));
    syncFlyoutState(button, unavailable, active, reason);
  });
  const smartDimension = document.querySelector<HTMLButtonElement>("#smart-sketch-dimension");
  if (smartDimension) {
    const summary = selectionSummary ?? (sketch ? summarizeSketchSelection(sketch, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected) : undefined);
    const reason = summary && hasSketchSelection() ? smartDimensionDisabledReason(summary) : undefined;
    const unavailable = Boolean(reason && !sketchSmartDimensionActive);
    if (smartDimension.disabled) smartDimension.disabled = false;
    setAttributeIfChanged(smartDimension, "aria-disabled", String(unavailable));
    setOptionalDatasetIfChanged(smartDimension, "disabledReason", unavailable ? reason : undefined);
    setDatasetIfChanged(smartDimension, "toolState", reason ? "unavailable" : sketchSmartDimensionActive ? sketchToolPhase : "idle");
    setAttributeIfChanged(smartDimension, "aria-pressed", String(sketchSmartDimensionActive));
    const smartTitle = reason ? `Smart Dimension — ${reason}` : "Smart Dimension";
    if (smartDimension.title !== smartTitle) smartDimension.title = smartTitle;
    const smartRun = sketchRibbon.querySelector<HTMLButtonElement>('[data-ribbon-run="smart-sketch-dimension"]');
    if (smartRun) {
      if (smartRun.disabled) smartRun.disabled = false;
      setAttributeIfChanged(smartRun, "aria-disabled", String(unavailable));
      setOptionalDatasetIfChanged(smartRun, "disabledReason", unavailable ? reason : undefined);
      setDatasetIfChanged(smartRun, "toolState", smartDimension.dataset.toolState ?? "idle");
      if (smartRun.title !== smartDimension.title) smartRun.title = smartDimension.title;
    }
    document.querySelectorAll<HTMLButtonElement>("[data-smart-dimension-proxy]").forEach((proxy) => {
      setAttributeIfChanged(proxy, "aria-disabled", String(unavailable));
      setOptionalDatasetIfChanged(proxy, "disabledReason", unavailable ? reason : undefined);
      setAttributeIfChanged(proxy, "aria-pressed", String(sketchSmartDimensionActive));
      if (proxy.title !== smartTitle) proxy.title = smartTitle;
    });
  }
  const phase = document.querySelector<HTMLElement>("#active-tool-phase");
  if (phase) {
    setDatasetIfChanged(phase, "state", displayedPhase);
    setTextIfChanged(phase, ({ idle: "Selection", collecting: "Waiting for input", ready: "Ready", applying: "Applying…", complete: "Complete · ready to use again", blocked: "Unavailable" } satisfies Record<SketchToolPhase, string>)[displayedPhase]);
  }
  const finishMenu = document.querySelector<HTMLButtonElement>("#finish-sketch-menu")!;
  const sketchHidden = !sketchSession;
  const finishHidden = sketchHidden || sketchChoosingSupport;
  if (finishMenu.hidden !== finishHidden) finishMenu.hidden = finishHidden;
  const finishRibbon = document.querySelector<HTMLButtonElement>("#finish-sketch-ribbon")!;
  if (finishRibbon.hidden !== finishHidden) finishRibbon.hidden = finishHidden;
  const selectionFilters = document.querySelector<HTMLElement>(".sketch-selection-filters")!;
  if (selectionFilters.hidden !== sketchHidden) selectionFilters.hidden = sketchHidden;
  const viewportTools = document.querySelector<HTMLElement>(".viewport-tools")!;
  if (viewportTools.hidden !== !sketchHidden) viewportTools.hidden = !sketchHidden;
}

function setSketchToolPhase(phase: SketchToolPhase): void {
  sketchToolPhase = phase;
  syncSketchToolUi();
}

function setSketchSelectionPhase(phase: SketchToolPhase): void {
  const dense = sketchSession && Object.keys(sketchSession.draftView.constraints).length > 500;
  if (!dense) {
    setSketchToolPhase(phase);
    syncSketchSelectionAssistUi();
    return;
  }
  sketchToolPhase = phase;
  const workspace = document.querySelector<HTMLElement>(".workspace")!;
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  setDatasetIfChanged(workspace, "sketchToolState", phase);
  setDatasetIfChanged(overlay, "toolState", phase);
  const phaseLabel = document.querySelector<HTMLElement>("#active-tool-phase");
  if (phaseLabel) {
    setDatasetIfChanged(phaseLabel, "state", phase);
    setTextIfChanged(phaseLabel, ({ idle: "Selection", collecting: "Waiting for input", ready: "Ready", applying: "Applying…", complete: "Complete · ready to use again", blocked: "Unavailable" } satisfies Record<SketchToolPhase, string>)[phase]);
  }
  syncSketchSelectionAssistUi();
}

function sketchPointInstruction(): string {
  if (sketchChoosingSupport) return "Choose a plane or planar face in the viewport";
  if (pendingDimensionPlacement) {
    if (!pendingDimensionPlacement.placed && pendingSmartDimensionLine()) return "Move around the segment to snap Horizontal, Vertical, or Aligned · click to place · Enter locks it";
    const label: Partial<Record<ConstraintTool, string>> = { distance: "aligned distance", distance_x: "horizontal distance", distance_y: "vertical distance", line_distance: "parallel separation", point_line_distance: "point-to-line distance", offset_distance: "offset distance", ellipse_radius: "ellipse radius", angle: "angle" };
    return `Place the ${label[pendingDimensionPlacement.kind] ?? pendingDimensionPlacement.kind.replaceAll("_", " ")} dimension on the sketch · set its value here · Enter locks it`;
  }
  if (sketchSmartDimensionActive) return "Select geometry, centers, or two points · Shift-click any curve location for a tangent measurement";
  if (pendingSketchConstraint) {
    if (pendingSketchConstraint === "coincident" || pendingSketchConstraint === "distance") return `Select two points for ${pendingSketchConstraint}`;
    if (pendingSketchConstraint === "horizontal" || pendingSketchConstraint === "vertical") return `Select one line for ${pendingSketchConstraint}`;
    if (pendingSketchConstraint === "radius") return "Select one circle or arc for radius";
    return `Select two compatible entities for ${pendingSketchConstraint}`;
  }
  if (pendingSketchEditPreview) return pendingSketchEditPreview.state === "loading"
    ? `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === pendingSketchEditPreview?.tool)?.label ?? "Operation"} preview is computing in the sketch plane · Escape cancels`
    : `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === pendingSketchEditPreview?.tool)?.label ?? "Operation"} preview ready · Enter accepts · Escape cancels`;
  if (!sketchToolArmed) return "Select geometry or choose a sketch tool";
  if (!sketchSession) return "Select a sketch tool to begin.";
  if (sketchSession.activeTool === "trim") return "Select geometry, then click the segment to trim.";
  const operands = activeCreationOperandRequirement();
  if (operands && selectedSketchGeometry.filter(geometrySupportsCreationOperand).length < operands.count) return `Select ${operands.count} ${operands.label}${operands.count === 1 ? "" : "s"} · compatible curves highlight as operands`;
  const required = activeSketchPointRequirement(sketchSession.activeTool);
  if (sketchSession.activeTool === "circle" && ["two_tangent", "three_tangent"].includes(sketchCreationVariant.circle)) return "Place a center estimate for the tangent circle";
  if (sketchSession.activeTool === "arc" && sketchCreationVariant.arc === "tangent") return sketchPoints.length ? "Set the tangent arc end" : "Set the tangent start on the selected curve";
  if (sketchSession.activeTool === "text" && sketchTextOnPath) return "Place the text origin along the selected path";
  const labels: Partial<Record<SketchTool, string[]>> = {
    line: ["Set start point", "Set end point"],
    circle: ["Set center", "Set radius"],
    arc: ["Set center", "Set radius", "Set arc end"],
    rectangle: ["Set first corner", "Set opposite corner"],
    spline: ["Set first control point", "Set second control point", "Set third control point", "Set fourth control point"],
  };
  return labels[sketchSession.activeTool]?.[Math.min(sketchPoints.length, Math.max(0, required - 1))]
    ?? SKETCH_TOOL_MANIFEST[sketchSession.activeTool].prompt;
}

function updateSketchToolInspectorState(): void {
  const instruction = document.querySelector<HTMLElement>("#active-tool-instruction");
  setTextIfChanged(instruction, sketchPointInstruction());
  const progress = document.querySelector<HTMLElement>("#active-tool-point-progress");
  if (progress && sketchSession) {
    const required = activeSketchPointRequirement(sketchSession.activeTool);
    setTextIfChanged(progress, sketchChoosingSupport
      ? "Orbit or pan freely · click to choose support"
      : !activeSketchToolKey() && !pendingSketchConstraint && !pendingDimensionPlacement
        ? `${selectedSketchPoints.length} point(s) · ${selectedSketchGeometry.length} entit${selectedSketchGeometry.length === 1 ? "y" : "ies"} selected`
      : pendingSketchConstraint
        ? `${selectedSketchPoints.length} point(s) · ${selectedSketchGeometry.length} entit${selectedSketchGeometry.length === 1 ? "y" : "ies"} selected`
        : activeCreationOperandRequirement()
          ? `${selectedSketchGeometry.filter(geometrySupportsCreationOperand).length} / ${activeCreationOperandRequirement()!.count} curves · ${sketchPoints.length} / ${required} points set`
          : required ? `${sketchPoints.length} / ${required} points set` : "Selection-driven tool");
  }
  const cursor = document.querySelector<HTMLElement>("#active-tool-cursor");
  setTextIfChanged(cursor, sketchHoverPoint
    ? `X ${(sketchHoverPoint.x_nm / 1_000_000).toFixed(3)} mm · Y ${(sketchHoverPoint.y_nm / 1_000_000).toFixed(3)} mm`
    : "Move onto the sketch plane");
  const solver = document.querySelector<HTMLElement>("#active-tool-solver-state");
  const guidance = document.querySelector<HTMLElement>("#sketch-command-guidance");
  const profile = document.querySelector<HTMLElement>("#active-tool-profile-state");
  if (solver) {
    setTextIfChanged(solver, sketchSolverStatus);
    setOptionalDatasetIfChanged(solver, "lastDrag", sketchLastDrag);
  }
  setTextIfChanged(guidance, sketchSolverStatus);
  setTextIfChanged(profile, sketchProfileStatus);
}

function sketchSupportLabel(support: SketchSupport): string {
  if (support.kind === "origin_plane") return `${support.plane.toUpperCase()} origin plane`;
  if (support.kind === "origin_plane_reference") return `${support.plane.replace("origin-plane:", "").toUpperCase()} origin plane`;
  if (support.kind === "topology") return "Selected planar face";
  return "Construction plane";
}

function retainedOperationPanel(id: string, operation: NonNullable<SketchDraftView["operations"]>[string]): string {
  const number = (field: string, label: string, value: number, scale = 1_000_000, min?: number) => `<label class="active-tool-field"><span>${label}</span><input data-operation-field="${field}" type="number" step="${scale === 1_000_000 ? "0.001" : "1"}" ${min === undefined ? "" : `min="${min}"`} value="${value / scale}" /></label>`;
  const check = (field: string, label: string, checked: boolean) => `<label class="sketch-palette-check"><input data-operation-field="${field}" type="checkbox" ${checked ? "checked" : ""}/><span>${label}</span></label>`;
  let fields = "";
  if (operation.kind === "offset") fields = `${number("distance_nm", "Distance", operation.distance_nm)}${check("two_sided", "Two-sided", operation.two_sided)}${check("linked", "Associative link", operation.linked)}`;
  else if (operation.kind === "mirror") fields = `${check("linked", "Associative symmetry", operation.linked)}<p>Axis: ${escapeHtml(operation.axis ?? "Origin Y axis")}</p>`;
  else if (operation.kind === "linear_pattern") fields = `${number("count", "Count", operation.count, 1, 1)}${number("spacing_x", operation.extent ? "Extent X" : "Spacing X", operation.spacing.x_nm)}${number("spacing_y", operation.extent ? "Extent Y" : "Spacing Y", operation.spacing.y_nm)}${check("extent", "Use total extent", operation.extent)}<label class="active-tool-field"><span>Suppressed instances</span><input data-operation-field="suppressed_instances" value="${operation.suppressed_instances.join(", ")}" placeholder="1, 3" /></label>`;
  else if (operation.kind === "circular_pattern") fields = `${number("count", "Count", operation.count, 1, 1)}${number("angle_microdegrees", "Total angle", operation.angle_microdegrees)}${number("center_x", "Center X", operation.center.x_nm)}${number("center_y", "Center Y", operation.center.y_nm)}<label class="active-tool-field"><span>Suppressed instances</span><input data-operation-field="suppressed_instances" value="${operation.suppressed_instances.join(", ")}" placeholder="1, 3" /></label>`;
  else if (operation.kind === "fillet") fields = number("radius_nm", "Radius", operation.radius_nm);
  else if (operation.kind === "chamfer") fields = `<label class="active-tool-field"><span>Mode</span><select data-operation-field="mode">${["equal_distance", "two_distance", "distance_angle"].map((mode) => `<option value="${mode}" ${operation.mode === mode ? "selected" : ""}>${mode.replaceAll("_", " ")}</option>`).join("")}</select></label>${number("first_distance_nm", "First distance", operation.first_distance_nm)}${operation.mode === "distance_angle" ? number("angle_microdegrees", "Angle", operation.angle_microdegrees) : operation.mode === "two_distance" ? number("second_distance_nm", "Second distance", operation.second_distance_nm) : ""}`;
  else if (operation.kind === "break") fields = `<label class="active-tool-field"><span>Break parameters (%)</span><input data-operation-field="parameters_millionths" value="${operation.parameters_millionths.map((value) => value / 10_000).join(", ")}" /></label>`;
  else if (operation.kind === "scale") fields = `${number("factor_millionths", "Scale factor", operation.factor_millionths)}${number("center_x", "Center X", operation.center.x_nm)}${number("center_y", "Center Y", operation.center.y_nm)}${check("copy", "Keep source", operation.copy)}`;
  else if (operation.kind === "move_copy") fields = `${number("delta_x", "Delta X", operation.delta.x_nm)}${number("delta_y", "Delta Y", operation.delta.y_nm)}${check("copy", "Keep source", operation.copy)}`;
  else if (operation.kind === "blend") fields = `<label class="active-tool-field"><span>Continuity</span><select data-operation-field="continuity"><option value="tangent" ${operation.continuity === "tangent" ? "selected" : ""}>Tangent</option><option value="g2" ${operation.continuity === "g2" ? "selected" : ""}>G2 curvature</option></select></label>${number("magnitude_nm", "Handle magnitude", operation.magnitude_nm)}`;
  else fields = `<label class="active-tool-field"><span>Source type</span><select data-operation-field="source_kind">${["point", "edge", "face", "body", "work_geometry", "sketch", "plane_intersection"].map((kind) => `<option value="${kind}" ${operation.source_kind === kind ? "selected" : ""}>${kind.replaceAll("_", " ")}</option>`).join("")}</select></label>${check("linked", "Associative link", operation.linked)}${check("locked", "Lock projected geometry", operation.locked)}${check("intersect_plane", "Intersect active sketch plane", operation.intersect_plane)}${operation.missing ? `<p class="sketch-operation-warning">Source missing · select a replacement to repair</p>` : ""}`;
  return `<section class="property-section sketch-operation-panel" data-operation-id="${escapeHtml(id)}"><h3>${operation.kind.replaceAll("_", " ")}</h3><p class="sketch-spline-help">Retained operation · edit values to recompute while preserving matched result identities.</p>${fields}<div class="sketch-operation-actions"><button type="button" data-operation-unlink>Unlink results</button><button class="quiet" type="button" data-operation-delete>Delete operation record</button></div></section>`;
}

function sketchContextSelectionControls(): string {
  return `<div class="sketch-context-selection-actions">
    <div class="sketch-context-selection-modes" role="group" aria-label="Selection behavior">
      ${(["replace", "add", "remove"] as const).map((mode) => `<button type="button" data-context-selection-mode="${mode}" aria-pressed="${sketchSelectionMode === mode}">${mode.replace(/^./, (value) => value.toUpperCase())}</button>`).join("")}
    </div>
    <button type="button" class="quiet" data-context-selection-clear ${hasAnySketchSelection() ? "" : "disabled"}>Clear</button>
  </div>`;
}

function selectedSketchEntityPanel(): string {
  if (!sketchSession) return "";
  const entities = selectedSketchGeometry.map((id) => sketchSession!.draft.geometry[id]).filter(Boolean);
  const presentation = sketchSelectionPresentation();
  if (!entities.length && !selectedSketchPoints.length && !sketchOriginSelected && !selectedSketchConstraint && !selectedSketchProfile) {
    if (activeSketchToolKey()) return "";
    return `<section class="property-section sketch-selection-panel" data-empty="true" aria-label="Sketch selection properties">
      <h3><span>Selection</span><small>None</small></h3>
      <div class="sketch-selection-hero"><span class="sketch-selection-hero-mark" aria-hidden="true">S</span><div><strong>Ready to select</strong><span>Pick curves, points, constraints, or the origin.</span></div></div>
      ${sketchContextSelectionControls()}
      <div class="sketch-selection-shortcuts"><span><kbd>Shift</kbd> add</span><span><kbd>Ctrl</kbd> toggle</span><span>Drag → window · ← crossing</span></div>
    </section>`;
  }
  const kinds = [...new Set(entities.map((entity) => entity.geometry.kind.replaceAll("_", " ")))];
  const sketch = sketchSession.draftView as Sketch;
  const relatedIds = selectedConstraintIds(sketch, selectedSketchGeometry, selectedSketchPoints, selectedSketchConstraint);
  const related = Object.entries(sketch.constraints).filter(([id]) => relatedIds.has(id));
  const relatedRedundant = new Set(sketchSession.solve?.redundant_constraints ?? []);
  const relatedConflicting = new Set(sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints) ?? []);
  const constructionState = entities.length === 0 ? "not-applicable" : entities.every((entity) => entity.construction) ? "construction" : entities.every((entity) => !entity.construction) ? "standard" : "mixed";
  const metrics = entities.length === 1 ? (() => {
    const geometry = entities[0].geometry;
    if (geometry.kind === "line") return `<div><dt>Length</dt><dd>${(Math.hypot(geometry.end.x_nm - geometry.start.x_nm, geometry.end.y_nm - geometry.start.y_nm) / 1_000_000).toFixed(3)} mm</dd></div>`;
    if (geometry.kind === "circle") return `<div><dt>Radius</dt><dd>${(geometry.radius_nm / 1_000_000).toFixed(3)} mm</dd></div>`;
    if (geometry.kind === "arc") return `<div><dt>Radius</dt><dd>${(Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm) / 1_000_000).toFixed(3)} mm</dd></div>`;
    if (geometry.kind === "rectangle") return `<div><dt>Size</dt><dd>${(Math.abs(geometry.max.x_nm - geometry.min.x_nm) / 1_000_000).toFixed(3)} × ${(Math.abs(geometry.max.y_nm - geometry.min.y_nm) / 1_000_000).toFixed(3)} mm</dd></div>`;
    return "";
  })() : "";
  const summary = summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected);
  const suggestions = selectedSketchProfile ? [] : (Object.keys(SKETCH_CONSTRAINT_MANIFEST) as ConstraintTool[])
    .filter((kind) => SKETCH_CONSTRAINT_MANIFEST[kind].family !== "dimension" && !constraintDisabledReason(kind, summary))
    .slice(0, 6);
  const selectedConstraintKind = selectedSketchConstraint ? sketch.constraints[selectedSketchConstraint]?.kind.replaceAll("_", " ") : undefined;
  const primaryType = selectedSketchProfile ? "closed profile" : kinds.join(", ") || selectedConstraintKind || (sketchOriginSelected ? "origin reference" : "point");
  return `<section class="property-section sketch-selection-panel" aria-label="Sketch selection properties">
    <h3><span>Selection</span><small>${presentation.label}</small></h3>
    <div class="sketch-selection-hero"><span class="sketch-selection-hero-mark" aria-hidden="true">${presentation.count}</span><div><strong>${escapeHtml(presentation.mix)}</strong><span>${escapeHtml(primaryType)}</span></div></div>
    ${sketchContextSelectionControls()}
    <dl class="sketch-selection-summary"><div><dt>Type</dt><dd>${escapeHtml(primaryType)}</dd></div>${metrics}</dl>
    ${entities.length ? `<label class="active-tool-field"><span>Geometry type</span><select id="sketch-selection-construction"><option value="standard" ${constructionState === "standard" ? "selected" : ""}>Normal</option><option value="construction" ${constructionState === "construction" ? "selected" : ""}>Construction</option>${constructionState === "mixed" ? `<option value="mixed" selected disabled>Mixed</option>` : ""}</select></label>` : ""}
    <details class="sketch-selection-relations" ${related.length ? "open" : ""}><summary><span>Relations</span><small>${related.length}</small></summary>${related.length ? `<ul>${related.map(([id, constraint]) => { const visualState = resolvedSketchConstraintState(sketch, id, relatedRedundant, relatedConflicting); return `<li class="${visualState}" data-constraint-state="${visualState}" data-selection-relation="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(constraintKindLabel(constraint.kind))} constraint · ${escapeHtml(sketchConstraintStateLabel(visualState))}">${sketchConstraintIcon(constraint.kind)}<span>${escapeHtml(constraintKindLabel(constraint.kind))}</span><small>${escapeHtml(sketchConstraintStateLabel(visualState))}</small></li>`; }).join("")}</ul>` : `<p>No relations on this selection.</p>`}</details>
    ${suggestions.length && (entities.length || selectedSketchPoints.length) ? `<div class="sketch-suggested-constraints"><strong>Suggested constraints</strong><div>${suggestions.map((kind) => `<button type="button" data-suggest-constraint="${kind}">${escapeHtml(kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase()))}</button>`).join("")}</div></div>` : ""}
  </section>`;
}

let denseSketchInspectorRefresh: ReturnType<typeof setTimeout> | undefined;

function renderActiveToolInspector(): void {
  if (denseSketchInspectorRefresh !== undefined) {
    clearTimeout(denseSketchInspectorRefresh);
    denseSketchInspectorRefresh = undefined;
  }
  const host = document.querySelector<HTMLElement>("#inspector")!;
  const context = activeToolContext ?? (sketchSession ? { key: "sketch-select", label: "Select", source: "sketch" as const } : undefined);
  if (!context) { activeInspectorTab = "properties"; renderInspector(); return; }
  if (sketchSession) {
    const dimensionKind = pendingDimensionPlacement?.kind ?? pendingReferenceDimension?.kind ?? (pendingSketchConstraint && SKETCH_CONSTRAINT_MANIFEST[pendingSketchConstraint].family === "dimension" ? pendingSketchConstraint : undefined);
    const canvasDimensionActive = Boolean(dimensionKind || (selectedSketchConstraint && sketchConstraintDimension(selectedSketchConstraint) !== undefined));
    const scalarToolKeys = new Set(["offset", "extend", "sketch_fillet", "sketch_chamfer", "sketch_linear_pattern", "sketch_scale", "sketch_move_copy", "sketch_blend"]);
    const toolValueControl = canvasDimensionActive
      ? `<div class="sketch-canvas-input-note"><strong>Dimension input is on the sketch</strong><span>Set the value and mode beside the selected geometry, then lock it.</span></div>`
      : scalarToolKeys.has(context.key)
        ? `<label class="active-tool-field"><span>Tool value</span><span><input id="active-tool-operation-value" type="text" inputmode="decimal" value="${Number(sketchConstraintValue.toFixed(3))} mm" aria-describedby="active-tool-value-help" /><b>mm</b></span><small id="active-tool-value-help">Arithmetic and unit expressions are accepted, for example 1 in + 5 mm.</small></label>`
        : "";
    const creationKey = (["rectangle", "circle", "arc", "polygon", "slot"] as const).find((value) => value === context.key);
    const creationVariantPanel = creationKey ? `<section class="property-section sketch-creation-variant"><h3>Creation method</h3><label class="active-tool-field"><span>Variant</span><select id="sketch-creation-variant">${SKETCH_CREATION_VARIANTS[creationKey].map(([value, label]) => `<option value="${value}" ${sketchCreationVariant[creationKey] === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>${creationKey === "polygon" ? `<label class="active-tool-field"><span>Sides</span><input id="sketch-polygon-sides" type="number" min="3" max="128" step="1" value="${sketchPolygonSides}"/></label>` : ""}<p class="sketch-spline-help">${activeSketchPointRequirement(creationKey)} viewport inputs · completion keeps this variant active for another use.</p></section>` : "";
    const textCreationPanel = context.key === "text" ? `<section class="property-section sketch-text-panel"><h3>Sketch text</h3><label class="active-tool-field"><span>Text</span><textarea id="sketch-text-value" rows="3">${escapeHtml(sketchTextValue)}</textarea></label><label class="active-tool-field"><span>Height</span><input id="sketch-text-height" type="number" min="0.001" step="0.1" value="${sketchTextHeightNm / 1_000_000}"/></label><label class="active-tool-field"><span>Rotation</span><input id="sketch-text-rotation" type="number" step="1" value="${sketchTextRotationMicrodegrees / 1_000_000}"/></label><label class="active-tool-field"><span>Alignment</span><select id="sketch-text-alignment">${["left","center","right"].map((value) => `<option ${sketchTextAlignment === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="sketch-palette-check"><input id="sketch-text-on-path" type="checkbox" ${sketchTextOnPath ? "checked" : ""}/><span>Place on preselected curve</span></label><label class="sketch-palette-check"><input id="sketch-text-reversed" type="checkbox" ${sketchTextReversed ? "checked" : ""}/><span>Reverse path direction</span></label></section>` : "";
    const selectedSplineId = [...selectedSketchGeometry].reverse().find((id) => sketchSession?.draft.geometry[id]?.geometry.kind === "control_point_spline");
    const selectedSpline = selectedSplineId ? sketchSession.draft.geometry[selectedSplineId]?.geometry : undefined;
    const splineContext = sketchSession.activeTool === "spline" || selectedSpline?.kind === "control_point_spline";
    const splinePanel = splineContext ? `<section class="property-section sketch-spline-panel"><h3>Control point spline</h3>
      <dl class="sketch-spline-summary"><div><dt>Method</dt><dd>Control points</dd></div><div><dt>Degree</dt><dd>3</dd></div><div><dt>Form</dt><dd>Open</dd></div><div><dt>Points</dt><dd>${selectedSpline?.kind === "control_point_spline" ? selectedSpline.control_points.length : `${sketchPoints.length} / 4`}</dd></div></dl>
      <button id="active-tool-spline-polygon" type="button" aria-pressed="${sketchShowSplineControlPolygon}">Show control polygon</button>
      ${selectedSpline?.kind === "control_point_spline" ? `<div class="sketch-spline-control-fields" aria-label="Spline control point coordinates">${selectedSpline.control_points.map((point, index) => `<fieldset><legend>CP${index + 1}</legend><label>X <input type="number" step="0.001" value="${point.x_nm / 1_000_000}" data-spline-control="${index}" data-axis="x" /></label><label>Y <input type="number" step="0.001" value="${point.y_nm / 1_000_000}" data-spline-control="${index}" data-axis="y" /></label></fieldset>`).join("")}</div>` : `<p class="sketch-spline-help">Place four control points. The completed curve stays active so another spline can begin immediately.</p>`}
    </section>` : "";
    const selectedNativeId = [...selectedSketchGeometry].reverse().find((id) => ["fit_point_spline", "ellipse", "elliptical_arc", "conic", "sketch_point"].includes(sketchSession!.draft.geometry[id]?.geometry.kind));
    const selectedNative = selectedNativeId ? sketchSession.draft.geometry[selectedNativeId]?.geometry : undefined;
    const nativeTool = ["fit_spline", "ellipse", "elliptical_arc", "conic", "point"].includes(sketchSession.activeTool);
    const nativeEntries: Array<{ label: string; anchor: PointRef["anchor"]; point: Point2 }> = selectedNative?.kind === "fit_point_spline"
      ? selectedNative.fit_points.map((point, index) => ({ label: `Fit ${index + 1}`, anchor: `fit:${index}` as const, point }))
      : selectedNative?.kind === "ellipse" ? [{ label: "Center", anchor: "center", point: selectedNative.center }, { label: "Major", anchor: "major", point: selectedNative.major }, { label: "Minor", anchor: "minor", point: selectedNative.minor }]
        : selectedNative?.kind === "elliptical_arc" ? [{ label: "Center", anchor: "center", point: selectedNative.center }, { label: "Major", anchor: "major", point: selectedNative.major }, { label: "Minor", anchor: "minor", point: selectedNative.minor }, { label: "Start", anchor: "start", point: selectedNative.start }, { label: "End", anchor: "end", point: selectedNative.end }]
          : selectedNative?.kind === "conic" ? [{ label: "Start", anchor: "start", point: selectedNative.start }, { label: "Control", anchor: "control", point: selectedNative.control }, { label: "End", anchor: "end", point: selectedNative.end }]
            : selectedNative?.kind === "sketch_point" ? [{ label: "Position", anchor: "position", point: { x_nm: selectedNative.x_nm, y_nm: selectedNative.y_nm } }] : [];
    const nativeTitle = selectedNative?.kind === "fit_point_spline" || sketchSession.activeTool === "fit_spline" ? "Fit point spline"
      : selectedNative?.kind === "ellipse" || sketchSession.activeTool === "ellipse" ? "Ellipse"
        : selectedNative?.kind === "elliptical_arc" || sketchSession.activeTool === "elliptical_arc" ? "Elliptical arc"
          : selectedNative?.kind === "conic" || sketchSession.activeTool === "conic" ? "Conic"
            : "Sketch point";
    const nativePanel = nativeTool || selectedNative ? `<section class="property-section sketch-spline-panel"><h3>${nativeTitle}</h3>
      <dl class="sketch-spline-summary"><div><dt>Representation</dt><dd>Native</dd></div><div><dt>Identity</dt><dd>${selectedNativeId ? escapeHtml(selectedNativeId) : "New entity"}</dd></div><div><dt>Points</dt><dd>${nativeEntries.length || `${sketchPoints.length} / ${activeSketchPointRequirement(sketchSession.activeTool)}`}</dd></div></dl>
      ${nativeEntries.length ? `<div class="sketch-spline-control-fields" aria-label="Native geometry coordinates">${nativeEntries.map((entry) => `<fieldset><legend>${entry.label}</legend><label>X <input type="number" step="0.001" value="${entry.point.x_nm / 1_000_000}" data-native-anchor="${entry.anchor}" data-axis="x" /></label><label>Y <input type="number" step="0.001" value="${entry.point.y_nm / 1_000_000}" data-native-anchor="${entry.anchor}" data-axis="y" /></label></fieldset>`).join("")}</div>` : `<p class="sketch-spline-help">${escapeHtml(SKETCH_TOOL_MANIFEST[sketchSession.activeTool].prompt)}. Completion keeps the tool active for another use.</p>`}
      ${selectedNative?.kind === "conic" ? `<label class="active-tool-field"><span>Weight</span><span><input id="active-tool-conic-weight" type="number" min="0.000001" step="0.01" value="${selectedNative.weight_millionths / 1_000_000}" /><b>w</b></span></label>` : ""}
    </section>` : "";
    const selectedRecipeEntry = Object.entries(sketchSession.draft.recipes ?? {}).find(([, recipe]) => recipe.geometry.some((id) => selectedSketchGeometry.includes(id)));
    const selectedRecipeId = selectedRecipeEntry?.[0];
    const selectedRecipe = selectedRecipeEntry?.[1];
    const recipePanel = selectedRecipe?.kind === "polygon" ? `<section class="property-section sketch-recipe-panel"><h3>Polygon construction</h3>
      <p class="sketch-spline-help">Editing these retained values rebuilds the polygon while preserving every unaffected member identity.</p>
      <label class="active-tool-field"><span>Sides</span><input data-recipe-field="sides" type="number" min="3" step="1" value="${selectedRecipe.sides}" /></label>
      <label class="active-tool-field"><span>Center X</span><input data-recipe-field="center_x" type="number" step="0.001" value="${selectedRecipe.center.x_nm / 1_000_000}" /></label>
      <label class="active-tool-field"><span>Center Y</span><input data-recipe-field="center_y" type="number" step="0.001" value="${selectedRecipe.center.y_nm / 1_000_000}" /></label>
      <label class="active-tool-field"><span>Radius</span><input data-recipe-field="radius" type="number" min="0.001" step="0.001" value="${selectedRecipe.radius_nm / 1_000_000}" /></label>
      <label class="active-tool-field"><span>Orientation</span><input data-recipe-field="orientation" type="number" step="0.1" value="${selectedRecipe.orientation_microdegrees / 1_000_000}" /></label>
    </section>` : selectedRecipe?.kind === "slot" ? `<section class="property-section sketch-recipe-panel"><h3>Slot construction</h3>
      <p class="sketch-spline-help">Edit the centerline endpoints and radius; all four members retain their identities.</p>
      ${(["first", "second"] as const).map((end) => `<fieldset><legend>${end === "first" ? "First endpoint" : "Second endpoint"}</legend><label>X <input data-recipe-field="${end}_x" type="number" step="0.001" value="${selectedRecipe[end].x_nm / 1_000_000}" /></label><label>Y <input data-recipe-field="${end}_y" type="number" step="0.001" value="${selectedRecipe[end].y_nm / 1_000_000}" /></label></fieldset>`).join("")}
      <label class="active-tool-field"><span>Radius</span><input data-recipe-field="radius" type="number" min="0.001" step="0.001" value="${selectedRecipe.radius_nm / 1_000_000}" /></label>
    </section>` : selectedRecipe?.kind === "text" ? `<section class="property-section sketch-recipe-panel sketch-text-panel"><h3>Sketch text</h3><p class="sketch-spline-help">Retained text remains editable and associative to its path. Explode removes only the text record and leaves native curves.</p><label class="active-tool-field"><span>Text</span><textarea data-recipe-field="text" rows="3">${escapeHtml(selectedRecipe.text)}</textarea></label><label class="active-tool-field"><span>Height</span><input data-recipe-field="height" type="number" min="0.001" step="0.1" value="${selectedRecipe.height_nm / 1_000_000}"/></label><label class="active-tool-field"><span>Rotation</span><input data-recipe-field="text_rotation" type="number" step="1" value="${selectedRecipe.rotation_microdegrees / 1_000_000}"/></label><label class="active-tool-field"><span>Alignment</span><select data-recipe-field="alignment">${["left","center","right"].map((value) => `<option value="${value}" ${selectedRecipe.horizontal_alignment === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="sketch-palette-check"><input data-recipe-field="reversed" type="checkbox" ${selectedRecipe.reversed ? "checked" : ""}/><span>Reverse path direction</span></label><button id="sketch-text-explode" type="button">Explode to native curves</button></section>` : "";
    const inspectorSketch = sketchSession.draftView;
    const inspectorIndexes = sketchRenderIndexCache.resolveDraft(inspectorSketch);
    const selectedOperationId = firstRetainedOperationId(inspectorIndexes, selectedSketchGeometry);
    // Inspector edit handlers intentionally receive a mutable command payload;
    // selection/indexing remains on the stable draftView identity above.
    const selectedOperation = selectedOperationId ? sketchSession.draft.operations?.[selectedOperationId] : undefined;
    const selectedOperationEntry = selectedOperationId && selectedOperation
      ? [selectedOperationId, selectedOperation] as const
      : undefined;
    const operationPanel = selectedOperationEntry
      ? retainedOperationPanel(selectedOperationEntry[0], selectedOperationEntry[1])
      : "";
    const selectionPanel = selectedSketchEntityPanel();
    const selectionIsPrimary = context.key === "sketch-select";
    const compactSelectionContext = selectionIsPrimary && !sketchChoosingSupport;
    const palettePanel = `<details class="property-section sketch-context-palette" ${sketchPaletteExpanded ? "open" : ""}><summary>Sketch palette</summary>
      <div class="sketch-palette-actions"><button id="sketch-look-at" type="button">Look At</button><button id="sketch-slice" type="button" aria-pressed="${sketchSliceEnabled}">Slice</button></div>
      <div class="sketch-palette-grid"><label><input id="sketch-grid-visible" type="checkbox" ${viewportGridVisible ? "checked" : ""}/> Grid</label><label><input id="sketch-snap-enabled" type="checkbox" ${sketchSnapEnabled ? "checked" : ""}/> Snap</label>${["profiles", "points", "dimensions", "constraints", "construction", "projection"].map((value) => `<label><input data-sketch-visibility="${value}" type="checkbox" ${sketchVisibility.has(value) ? "checked" : ""}/> ${value}</label>`).join("")}</div><div class="sketch-interchange-actions" aria-label="Sketch interchange"><button id="sketch-export-svg" type="button">Export SVG</button><button id="sketch-export-dxf" type="button">Export DXF</button><button id="sketch-import-file" type="button">Import SVG / DXF</button><input id="sketch-import-input" type="file" accept=".svg,.dxf,image/svg+xml,application/dxf" hidden/></div>
    </details>`;
    const projectOptions = context.key === "project" ? `<label class="sketch-palette-check"><input id="sketch-project-intersection" type="checkbox" ${sketchProjectIntersectionMode ? "checked" : ""}/> Intersect selected topology with active plane</label><label class="active-tool-field"><span>Work geometry</span><select id="sketch-project-work"><option value="none">Selected topology</option>${["origin", "x_axis", "y_axis"].map((value) => `<option value="${value}" ${sketchProjectWorkReference === value ? "selected" : ""}>${value.replaceAll("_", " ")}</option>`).join("")}</select></label>` : "";
    const creationOptions = sketchToolArmed ? `<button id="active-tool-construction" type="button" aria-pressed="${sketchConstruction}">Create as construction</button><button id="active-tool-auto-constraints" type="button" aria-pressed="${sketchAutoConstraints}">Automatic constraints</button>` : "";
    const transientActions = `${pendingSketchEditPreview ? `<button id="active-tool-apply-preview" type="button">Apply preview</button>` : ""}${pendingReferenceDimension ? `<button id="active-tool-add-reference" type="button">Add as reference dimension</button>` : ""}`;
    const inputPanel = projectOptions || toolValueControl || creationOptions || transientActions
      ? `<section class="property-section active-tool-options"><h3>Tool options</h3>${projectOptions}${toolValueControl}${creationOptions}${transientActions}</section>`
      : "";
    const supportPanel = selectionIsPrimary
      ? `<details class="property-section sketch-support-section sketch-context-support" ${sketchChoosingSupport ? "open" : ""}><summary><span>Sketch support</span><small>${escapeHtml(sketchChoosingSupport ? "Choose in viewport" : sketchSupportLabel(sketchSession.support))}</small></summary><div id="active-tool-sketch-plane" class="sketch-support-inline" data-selecting="${sketchChoosingSupport}" aria-label="Sketch plane selection"><div><span>Support</span><strong>${escapeHtml(sketchChoosingSupport ? "Choose in viewport" : sketchSupportLabel(sketchSession.support))}</strong></div><button id="active-tool-choose-plane" type="button" ${sketchChoosingSupport ? "disabled" : ""}>${sketchChoosingSupport ? "Waiting…" : "Change"}</button></div></details>`
      : `<section class="property-section sketch-support-section"><h3>Sketch support</h3><div id="active-tool-sketch-plane" class="sketch-support-inline" data-selecting="${sketchChoosingSupport}" aria-label="Sketch plane selection"><div><span>Support</span><strong>${escapeHtml(sketchChoosingSupport ? "Choose in viewport" : sketchSupportLabel(sketchSession.support))}</strong></div><button id="active-tool-choose-plane" type="button" ${sketchChoosingSupport ? "disabled" : ""}>${sketchChoosingSupport ? "Waiting…" : "Change"}</button></div></section>`;
    host.innerHTML = `<section class="inspector-tab-content active-tool-content" data-active-tool="${escapeHtml(context.key)}" data-selection-primary="${selectionIsPrimary}" data-support-only="${sketchChoosingSupport}" aria-label="Sketch tool properties">
      <header class="active-tool-header"><span>${cadIcon(context.key, "pencil-ruler")}</span><div><h2>${escapeHtml(sketchChoosingSupport ? "Choose sketch support" : context.label)}</h2><p id="active-tool-phase" data-state="${sketchToolPhase}">${sketchChoosingSupport ? "Support selection" : "Active sketch tool"}</p></div></header>
      ${compactSelectionContext ? "" : `<section class="active-tool-prompt"><strong id="active-tool-instruction">${escapeHtml(sketchPointInstruction())}</strong><span id="active-tool-point-progress"></span><code id="active-tool-cursor">Move onto the sketch plane</code></section><p id="sketch-command-guidance" class="sketch-command-guidance" role="status">${escapeHtml(sketchSolverStatus)}</p>`}
      ${selectionIsPrimary ? selectionPanel : ""}
      ${supportPanel}
      ${inputPanel}
      ${selectionIsPrimary ? "" : selectionPanel}
      ${splinePanel}
      ${nativePanel}
      ${creationVariantPanel}
      ${textCreationPanel}
      ${recipePanel}
      ${operationPanel}
      ${palettePanel}
      <section class="active-tool-evidence"><output id="active-tool-solver-state"></output><output id="active-tool-profile-state"></output></section>
      ${renderSketchConstraintManager()}
      <footer class="active-tool-actions">${sketchChoosingSupport ? "" : '<button id="active-tool-finish" type="button" aria-label="Finish sketch">Finish sketch</button>'}<button id="active-tool-cancel" class="quiet" type="button" aria-label="Discard sketch draft">${sketchChoosingSupport ? "Cancel" : "Discard"}</button></footer>
    </section>`;
    document.querySelector<HTMLButtonElement>("#active-tool-choose-plane")!.addEventListener("click", () => beginSketchSupportSelection());
    document.querySelectorAll<HTMLButtonElement>("[data-context-selection-mode]").forEach((button) => button.addEventListener("click", () => {
      sketchSelectionMode = button.dataset.contextSelectionMode as "replace" | "add" | "remove";
      document.querySelectorAll<HTMLButtonElement>("[data-context-selection-mode]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate.dataset.contextSelectionMode === sketchSelectionMode)));
      syncSketchSelectionAssistUi();
      sketchViewport.focus();
    }));
    document.querySelector<HTMLButtonElement>("[data-context-selection-clear]")?.addEventListener("click", () => {
      clearSketchSelection();
      sketchViewport.focus();
    });
    const operationValueInput = document.querySelector<HTMLInputElement>("#active-tool-operation-value");
    document.querySelector<HTMLInputElement>("#sketch-project-intersection")?.addEventListener("change", (event) => { sketchProjectIntersectionMode = (event.currentTarget as HTMLInputElement).checked; });
    document.querySelector<HTMLSelectElement>("#sketch-project-work")?.addEventListener("change", (event) => { sketchProjectWorkReference = (event.currentTarget as HTMLSelectElement).value as typeof sketchProjectWorkReference; });
    const parseConstraintInput = () => {
      if (!operationValueInput) return undefined;
      const value = parseSketchDimensionExpression(operationValueInput.value, "length");
      operationValueInput.setAttribute("aria-invalid", String(value === undefined || value < 0));
      if (value !== undefined && value >= 0) sketchConstraintValue = value;
      return value;
    };
    operationValueInput?.addEventListener("input", parseConstraintInput);
    operationValueInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const value = parseConstraintInput();
      if (value === undefined) return;
      event.preventDefault(); event.stopPropagation();
      void completeActiveSketchInvocation();
    });
    document.querySelector<HTMLButtonElement>("#active-tool-construction")?.addEventListener("click", (event) => {
      sketchConstruction = !sketchConstruction;
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(sketchConstruction));
      document.querySelector<HTMLButtonElement>('[data-sketch-tool="construction"]')?.setAttribute("aria-pressed", String(sketchConstruction));
    });
    document.querySelector<HTMLSelectElement>("#sketch-selection-construction")?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (value === "standard" || value === "construction") void setSelectedSketchConstruction(value === "construction");
    });
    document.querySelectorAll<HTMLButtonElement>("[data-suggest-constraint]").forEach((button) => button.addEventListener("click", () => {
      const kind = button.dataset.suggestConstraint;
      document.querySelector<HTMLButtonElement>(`[data-sketch-constraint="${CSS.escape(kind ?? "")}"]`)?.click();
    }));
    document.querySelector<HTMLButtonElement>("#active-tool-auto-constraints")?.addEventListener("click", (event) => {
      sketchAutoConstraints = !sketchAutoConstraints;
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(sketchAutoConstraints));
    });
    document.querySelector<HTMLSelectElement>("#sketch-creation-variant")?.addEventListener("change", (event) => {
      if (!creationKey) return;
      sketchCreationVariant[creationKey] = (event.currentTarget as HTMLSelectElement).value as never;
      sketchPoints = []; sketchPointInferences = []; sketchHoverSnap = undefined; setSketchToolPhase("collecting"); renderActiveToolInspector(); renderSketchOverlay();
    });
    document.querySelector<HTMLInputElement>("#sketch-polygon-sides")?.addEventListener("change", (event) => {
      const value = Math.round(Number((event.currentTarget as HTMLInputElement).value)); if (value < 3 || value > 128) return;
      sketchPolygonSides = value;
    });
    document.querySelector<HTMLTextAreaElement>("#sketch-text-value")?.addEventListener("input", (event) => { sketchTextValue = (event.currentTarget as HTMLTextAreaElement).value; });
    document.querySelector<HTMLInputElement>("#sketch-text-height")?.addEventListener("change", (event) => { const value=Number((event.currentTarget as HTMLInputElement).value);if(value>0)sketchTextHeightNm=Math.round(value*1_000_000); });
    document.querySelector<HTMLInputElement>("#sketch-text-rotation")?.addEventListener("change", (event) => { const value=Number((event.currentTarget as HTMLInputElement).value);if(Number.isFinite(value))sketchTextRotationMicrodegrees=Math.round(value*1_000_000); });
    document.querySelector<HTMLSelectElement>("#sketch-text-alignment")?.addEventListener("change", (event) => { sketchTextAlignment=(event.currentTarget as HTMLSelectElement).value as typeof sketchTextAlignment; });
    document.querySelector<HTMLInputElement>("#sketch-text-on-path")?.addEventListener("change", (event) => { sketchTextOnPath=(event.currentTarget as HTMLInputElement).checked; });
    document.querySelector<HTMLInputElement>("#sketch-text-reversed")?.addEventListener("change", (event) => { sketchTextReversed=(event.currentTarget as HTMLInputElement).checked; });
    document.querySelector<HTMLButtonElement>("#sketch-export-svg")?.addEventListener("click", () => downloadSketchFile("svg", exportSketchSvg(sketchSession!.draft)));
    document.querySelector<HTMLButtonElement>("#sketch-export-dxf")?.addEventListener("click", () => { if(sketchBridge)void sketchBridge.exportDxf(sketchSession!.draft).then((value)=>downloadSketchFile("dxf",value)).catch((error)=>showActionError("DXF export",String(error))); });
    const importInput=document.querySelector<HTMLInputElement>("#sketch-import-input");
    document.querySelector<HTMLButtonElement>("#sketch-import-file")?.addEventListener("click",()=>importInput?.click());
    importInput?.addEventListener("change",async()=>{
      const file=importInput.files?.[0];if(!file||!sketchSession)return;
      try {
        const extension=file.name.toLowerCase().split(".").at(-1);if(extension!=="svg"&&extension!=="dxf")throw new Error("Choose an SVG or DXF sketch file");
        const content=await file.text();
        let commands:SketchCommand[];let message:string;
        if(extension==="dxf"){
          if(!sketchBridge)throw new Error("Sketch runtime is not ready");const imported=await sketchBridge.importDxf(`${sketchSession.draft.id}:import`,content);
          commands=Object.values(imported.sketch.geometry).map((entity)=>({kind:"add_geometry",entity:{...entity,id:sketchSession!.ids.next("geometry")}} as SketchCommand));message=`Imported ${commands.length} native DXF entities`;
        }else{const imported=importSketchSvgCommands(sketchSession.ids,content);commands=imported.commands;message=`Imported ${imported.imported} native SVG entities${imported.ignored?` · ${imported.ignored} ignored`:""}`;}
        if(!commands.length)throw new Error("The file contains no supported sketch geometry");await sketchSession.applyAll(commands);selectedSketchGeometry=commands.flatMap((command)=>command.kind==="add_geometry"?[command.entity.id]:[]);sketchSolverStatus=message;updateSketchStatus();renderActiveToolInspector();renderSketchOverlay();
      }catch(error){showActionError("Sketch import",error instanceof Error?error.message:String(error));}finally{importInput.value="";}
    });
    document.querySelector<HTMLButtonElement>("#active-tool-spline-polygon")?.addEventListener("click", (event) => {
      sketchShowSplineControlPolygon = !sketchShowSplineControlPolygon;
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(sketchShowSplineControlPolygon));
      renderSketchOverlay();
    });
    document.querySelectorAll<HTMLInputElement>("[data-spline-control]").forEach((input) => input.addEventListener("change", async () => {
      if (!sketchSession || !selectedSplineId || selectedSpline?.kind !== "control_point_spline") return;
      const index = Number(input.dataset.splineControl);
      const axis = input.dataset.axis;
      const millimeters = Number(input.value);
      if (!Number.isFinite(millimeters) || (axis !== "x" && axis !== "y")) return;
      const current = sketchSession.draft.geometry[selectedSplineId]?.geometry;
      if (current?.kind !== "control_point_spline" || !current.control_points[index]) return;
      const target = { ...current.control_points[index], [`${axis}_nm`]: Math.round(millimeters * 1_000_000) } as Point2;
      sketchLastDrag = await sketchSession.drag({ geometry: selectedSplineId, anchor: `control:${index}` }, target) ? "accepted" : "refused";
      updateSketchStatus();
      renderActiveToolInspector();
    }));
    document.querySelectorAll<HTMLInputElement>("[data-native-anchor]").forEach((input) => input.addEventListener("change", async () => {
      if (!sketchSession || !selectedNativeId) return;
      const axis = input.dataset.axis; const anchor = input.dataset.nativeAnchor as PointRef["anchor"] | undefined; const millimeters = Number(input.value);
      if (!anchor || !Number.isFinite(millimeters) || (axis !== "x" && axis !== "y")) return;
      const current = pointForRef(sketchSession.draft, { geometry: selectedNativeId, anchor }); if (!current) return;
      const target = { ...current, [`${axis}_nm`]: Math.round(millimeters * 1_000_000) } as Point2;
      sketchLastDrag = await sketchSession.drag({ geometry: selectedNativeId, anchor }, target) ? "accepted" : "refused";
      updateSketchStatus(); renderActiveToolInspector();
    }));
    document.querySelector<HTMLInputElement>("#active-tool-conic-weight")?.addEventListener("change", async (event) => {
      if (!sketchSession || !selectedNativeId || selectedNative?.kind !== "conic") return;
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value) || value <= 0) return;
      await sketchSession.apply({ kind: "set_conic_weight", geometry: selectedNativeId, weight_millionths: Math.round(value * 1_000_000) });
      updateSketchStatus(); renderActiveToolInspector();
    });
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-recipe-field]").forEach((input) => input.addEventListener("change", async () => {
      if (!sketchSession || !selectedRecipeId || !selectedRecipe) return;
      const recipe: SketchRecipe = structuredClone(selectedRecipe);
      const field = input.dataset.recipeField;
      const value = Number(input.value);
      if (field === "radius" && recipe.kind !== "text" && Number.isFinite(value)) recipe.radius_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "polygon" && field === "sides") {
        const sides = Math.round(value); if (sides < 3) return;
        recipe.sides = sides;
        recipe.geometry = recipe.geometry.slice(0, sides);
        while (recipe.geometry.length < sides) recipe.geometry.push(sketchSession.ids.next("geometry"));
      }
      else if (recipe.kind === "polygon" && field === "orientation") recipe.orientation_microdegrees = Math.round(value * 1_000_000);
      else if (recipe.kind === "polygon" && field === "center_x") recipe.center.x_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "polygon" && field === "center_y") recipe.center.y_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "slot" && field === "first_x") recipe.first.x_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "slot" && field === "first_y") recipe.first.y_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "slot" && field === "second_x") recipe.second.x_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "slot" && field === "second_y") recipe.second.y_nm = Math.round(value * 1_000_000);
      else if (recipe.kind === "text") {
        const updated = updatedSketchTextRecipe(sketchSession.draft, recipe, {
          ...(field === "text" ? { text: input.value } : {}), ...(field === "height" && Number.isFinite(value) ? { heightNm: Math.round(value * 1_000_000) } : {}),
          ...(field === "text_rotation" && Number.isFinite(value) ? { rotationMicrodegrees: Math.round(value * 1_000_000) } : {}),
          ...(field === "alignment" ? { horizontalAlignment: input.value as "left"|"center"|"right" } : {}),
          ...(field === "reversed" && input instanceof HTMLInputElement ? { reversed: input.checked } : {}),
        }, sketchSession.ids);
        await sketchSession.apply({ kind: "set_recipe", id: selectedRecipeId, recipe: updated.recipe }); updateSketchStatus(); renderActiveToolInspector(); renderSketchOverlay(); return;
      } else return;
      if (!Number.isFinite(value) || recipe.radius_nm <= 0) return;
      await sketchSession.apply({ kind: "set_recipe", id: selectedRecipeId, recipe });
      updateSketchStatus(); renderActiveToolInspector(); renderSketchOverlay();
    }));
    document.querySelector<HTMLButtonElement>("#sketch-text-explode")?.addEventListener("click",async()=>{if(!sketchSession||!selectedRecipeId)return;await sketchSession.apply(explodeSketchTextCommand(selectedRecipeId));sketchSolverStatus="Text exploded to native curves";updateSketchStatus();renderActiveToolInspector();renderSketchOverlay();});
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-operation-field]").forEach((input) => input.addEventListener("change", async () => {
      if (!sketchSession || !selectedOperationEntry) return;
      const operation = structuredClone(selectedOperationEntry[1]); const field = input.dataset.operationField!;
      const checked = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : undefined;
      const millimeters = Number(input.value);
      if (field === "suppressed_instances" && (operation.kind === "linear_pattern" || operation.kind === "circular_pattern")) operation.suppressed_instances = [...new Set(input.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0 && value < operation.count))].sort((a, b) => a - b);
      else if (field === "parameters_millionths" && operation.kind === "break") {
        operation.parameters_millionths = [...new Set(input.value.split(",").map((value) => Math.round(Number(value) * 10_000)).filter((value) => value > 0 && value < 1_000_000))].sort((a, b) => a - b);
        if (!operation.parameters_millionths.length) return;
        operation.results = operation.results.slice(0, operation.parameters_millionths.length + 1);
        while (operation.results.length < operation.parameters_millionths.length + 1) operation.results.push(sketchSession.ids.next("geometry"));
      } else if (field === "count" && (operation.kind === "linear_pattern" || operation.kind === "circular_pattern")) {
        const count = Math.max(1, Math.round(millimeters)); operation.count = count; operation.instances = operation.instances.slice(0, count - 1);
        while (operation.instances.length < count - 1) operation.instances.push(operation.sources.map(() => sketchSession!.ids.next("geometry")));
        operation.suppressed_instances = operation.suppressed_instances.filter((value) => value < count);
      } else if (field === "two_sided" && operation.kind === "offset") {
        operation.two_sided = Boolean(checked);
        if (operation.two_sided && operation.result_chains.length === operation.sources.length) operation.result_chains.push(...operation.result_chains.map((chain) => chain.map(() => sketchSession!.ids.next("geometry"))));
        if (!operation.two_sided) operation.result_chains = operation.result_chains.slice(0, operation.sources.length);
      } else if (field === "copy" && (operation.kind === "scale" || operation.kind === "move_copy")) {
        operation.copy = Boolean(checked); operation.results = operation.copy ? operation.sources.map(() => sketchSession!.ids.next("geometry")) : [...operation.sources];
      } else if (field === "linked" && (operation.kind === "offset" || operation.kind === "mirror" || operation.kind === "project_include")) operation.linked = Boolean(checked);
      else if (field === "extent" && operation.kind === "linear_pattern") operation.extent = Boolean(checked);
      else if (field === "locked" && operation.kind === "project_include") operation.locked = Boolean(checked);
      else if (field === "intersect_plane" && operation.kind === "project_include") operation.intersect_plane = Boolean(checked);
      else if (field === "source_kind" && operation.kind === "project_include") operation.source_kind = input.value as typeof operation.source_kind;
      else if (field === "mode" && operation.kind === "chamfer") operation.mode = input.value as typeof operation.mode;
      else if (field === "continuity" && operation.kind === "blend") operation.continuity = input.value as typeof operation.continuity;
      else if (!Number.isFinite(millimeters)) return;
      else if (field === "distance_nm" && operation.kind === "offset") operation.distance_nm = Math.round(millimeters * 1_000_000);
      else if (field === "spacing_x" && operation.kind === "linear_pattern") operation.spacing.x_nm = Math.round(millimeters * 1_000_000);
      else if (field === "spacing_y" && operation.kind === "linear_pattern") operation.spacing.y_nm = Math.round(millimeters * 1_000_000);
      else if (field === "angle_microdegrees" && operation.kind === "circular_pattern") operation.angle_microdegrees = Math.round(millimeters * 1_000_000);
      else if (field === "center_x" && (operation.kind === "circular_pattern" || operation.kind === "scale")) operation.center.x_nm = Math.round(millimeters * 1_000_000);
      else if (field === "center_y" && (operation.kind === "circular_pattern" || operation.kind === "scale")) operation.center.y_nm = Math.round(millimeters * 1_000_000);
      else if (field === "radius_nm" && operation.kind === "fillet") operation.radius_nm = Math.round(millimeters * 1_000_000);
      else if (field === "first_distance_nm" && operation.kind === "chamfer") operation.first_distance_nm = Math.round(millimeters * 1_000_000);
      else if (field === "second_distance_nm" && operation.kind === "chamfer") operation.second_distance_nm = Math.round(millimeters * 1_000_000);
      else if (field === "angle_microdegrees" && operation.kind === "chamfer") operation.angle_microdegrees = Math.round(millimeters * 1_000_000);
      else if (field === "factor_millionths" && operation.kind === "scale") operation.factor_millionths = Math.round(millimeters * 1_000_000);
      else if (field === "delta_x" && operation.kind === "move_copy") operation.delta.x_nm = Math.round(millimeters * 1_000_000);
      else if (field === "delta_y" && operation.kind === "move_copy") operation.delta.y_nm = Math.round(millimeters * 1_000_000);
      else if (field === "magnitude_nm" && operation.kind === "blend") operation.magnitude_nm = Math.round(millimeters * 1_000_000);
      else return;
      const commands: SketchCommand[] = [];
      if (operation.kind === "project_include" && field === "locked") {
        const fixed = Object.entries(sketchSession.draft.constraints).filter(([, constraint]) => constraint.kind === "fixed" && operation.results.includes(constraint.point.geometry));
        if (!operation.locked) commands.push(...fixed.map(([constraint]) => ({ kind: "remove_constraint", constraint } as SketchCommand)));
        else for (const result of operation.results) for (const anchor of ["start", "end"] as const) {
          const point = pointForRef(sketchSession.draft, { geometry: result, anchor }); if (point) commands.push({ kind: "add_constraint", id: sketchSession.ids.next("constraint"), constraint: { kind: "fixed", point: { geometry: result, anchor }, x_nm: point.x_nm, y_nm: point.y_nm } });
        }
      }
      commands.push({ kind: "set_operation", id: selectedOperationEntry[0], operation });
      await sketchSession.applyAll(commands); updateSketchStatus(); renderActiveToolInspector(); renderSketchOverlay();
    }));
    document.querySelector<HTMLButtonElement>("[data-operation-unlink]")?.addEventListener("click", async () => {
      if (!sketchSession || !selectedOperationEntry) return;
      const operation = selectedOperationEntry[1]; const constraints = Object.entries(sketchSession.draft.constraints).filter(([, constraint]) => retainedOperationGeometry(operation).some((id) => constraint.kind === "offset_distance" ? constraint.source === id || constraint.offset === id : constraint.kind === "fixed" && constraint.point.geometry === id));
      await sketchSession.applyAll([...constraints.map(([constraint]) => ({ kind: "remove_constraint", constraint } as SketchCommand)), { kind: "remove_operation", id: selectedOperationEntry[0] }]);
      if (operation.kind === "project_include") operation.results.forEach((id) => sketchSession?.removeExternalReference(id));
      sketchSolverStatus = "Operation unlinked · result geometry is now independently editable"; updateSketchStatus(); renderActiveToolInspector();
    });
    document.querySelector<HTMLButtonElement>("[data-operation-delete]")?.addEventListener("click", async () => {
      if (!sketchSession || !selectedOperationEntry) return;
      const results = selectedOperationEntry[1].kind === "scale" || selectedOperationEntry[1].kind === "move_copy" ? (selectedOperationEntry[1].copy ? selectedOperationEntry[1].results : []) : selectedOperationEntry[1].kind === "linear_pattern" || selectedOperationEntry[1].kind === "circular_pattern" ? selectedOperationEntry[1].instances.flat() : selectedOperationEntry[1].kind === "offset" ? selectedOperationEntry[1].result_chains.flat() : selectedOperationEntry[1].kind === "mirror" || selectedOperationEntry[1].kind === "break" || selectedOperationEntry[1].kind === "project_include" ? selectedOperationEntry[1].results : [selectedOperationEntry[1].result];
      await sketchSession.applyAll([{ kind: "remove_operation", id: selectedOperationEntry[0] }, ...results.map((geometry) => ({ kind: "remove_geometry", geometry } as SketchCommand))]);
      selectedSketchGeometry = []; updateSketchStatus(); renderActiveToolInspector();
    });
    document.querySelector<HTMLButtonElement>("#sketch-look-at")?.addEventListener("click", () => { if (activeSketchPlane) renderer?.alignToSketchPlane(activeSketchPlane); });
    document.querySelector<HTMLDetailsElement>(".sketch-context-palette")?.addEventListener("toggle", (event) => { sketchPaletteExpanded = (event.currentTarget as HTMLDetailsElement).open; });
    document.querySelector<HTMLButtonElement>("#sketch-slice")?.addEventListener("click", (event) => { sketchSliceEnabled = !sketchSliceEnabled; (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(sketchSliceEnabled)); renderer?.setSketchSlice(activeSketchPlane, sketchSliceEnabled); });
    document.querySelector<HTMLInputElement>("#sketch-grid-visible")?.addEventListener("change", (event) => { viewportGridVisible = (event.currentTarget as HTMLInputElement).checked; renderer?.setGridVisible(viewportGridVisible); });
    document.querySelector<HTMLInputElement>("#sketch-snap-enabled")?.addEventListener("change", (event) => { sketchSnapEnabled = (event.currentTarget as HTMLInputElement).checked; });
    document.querySelectorAll<HTMLInputElement>("[data-sketch-visibility]").forEach((input) => input.addEventListener("change", () => { const key = input.dataset.sketchVisibility!; if (input.checked) sketchVisibility.add(key); else sketchVisibility.delete(key); renderSketchOverlay(); }));
    document.querySelector<HTMLButtonElement>("#active-tool-apply-preview")?.addEventListener("click", () => void completeActiveSketchInvocation());
    document.querySelector<HTMLButtonElement>("#active-tool-add-reference")?.addEventListener("click", () => void acceptPendingReferenceDimension());
    document.querySelector<HTMLButtonElement>("#active-tool-finish")?.addEventListener("click", () => void finishSketch());
    document.querySelector<HTMLButtonElement>("#active-tool-cancel")!.addEventListener("click", cancelSketch);
    installSketchConstraintManager();
    installConstraintFocusInteractions(host);
    installInspectorDisclosures();
    updateSketchToolInspectorState();
    syncSketchToolUi();
    return;
  }
  host.innerHTML = `<section class="inspector-tab-content active-tool-content" data-active-tool="${escapeHtml(context.key)}"><header class="active-tool-header"><span>${cadIcon(context.key, "settings-2")}</span><div><h2>${escapeHtml(context.label)}</h2><p>Active ribbon tool</p></div></header><section class="active-tool-prompt"><strong>${state.operation.status === "preview" ? "Adjust the tool parameters, then accept." : "Tool ready"}</strong><span>${escapeHtml(state.operation.status)}</span><code>Enter accepts · Escape cancels</code></section></section>`;
}

function renderConstraintsInspector(): void {
  if (sketchSession) {
    const sketch = sketchSession.draftView as Sketch;
    const activeIds = selectedConstraintIds(sketch, selectedSketchGeometry, selectedSketchPoints, selectedSketchConstraint);
    const redundant = new Set(sketchSession.solve?.redundant_constraints ?? []);
    const conflicting = new Set(sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints) ?? []);
    const constraints = Object.entries(sketch.constraints).filter(([id]) => activeIds.has(id));
    const rows = constraints.length
      ? constraints.map(([id, constraint]) => {
        const visualState = resolvedSketchConstraintState(sketch, id, redundant, conflicting);
        return `<li class="${visualState}" data-constraint-state="${visualState}" data-active-selection-constraint="${escapeHtml(id)}">${sketchConstraintIcon(constraint.kind)}<span><strong>${escapeHtml(constraintKindLabel(constraint.kind))}</strong><small>${escapeHtml(sketchConstraintStateLabel(visualState))}</small></span><b>${visualState === "driving" ? "✓" : visualState === "reference" || visualState === "suppressed" ? "—" : "!"}</b></li>`;
      }).join("")
      : `<li class="empty"><span><strong>${hasAnySketchSelection() ? "No constraints on this selection" : "Select sketch geometry"}</strong><small>${hasAnySketchSelection() ? "The selected section remains unconstrained." : "Its constraints will appear here and beside the selected geometry."}</small></span></li>`;
    const solveState = sketchSession.solve?.state.replaceAll("_", " ") ?? "ready";
    const inspector = document.querySelector<HTMLElement>("#inspector")!;
    inspector.innerHTML = `<section class="inspector-tab-content constraints-content selection-scoped"><h2>Selection constraints</h2><p class="feature-type">Sketch constraint system · active selection</p><div class="constraint-summary"><span>Constraints <b>${constraints.length}</b></span><span>Selected <b>${selectedSketchGeometry.length + selectedSketchPoints.length + (selectedSketchConstraint ? 1 : 0)}</b></span><span>Solver <b>${escapeHtml(solveState)}</b></span></div><ul class="constraint-list">${rows}</ul></section>`;
    installConstraintFocusInteractions(inspector);
    return;
  }
  const snapshot = adapter.getSnapshot();
  const selected = adapter.findFeature(state.selectedFeatureId);
  const sketchFeature = selected?.type === "sketch" ? selected : [...snapshot.features].reverse().find((feature) => feature.type === "sketch");
  const durable = adapter.durableDocument() as { sketches?: Record<string, { constraints?: unknown[]; entities?: unknown[]; status?: string }> };
  const sketchRecord = sketchFeature ? durable.sketches?.[sketchFeature.id] : undefined;
  const constraints = sketchRecord?.constraints ?? [];
  const entities = sketchRecord?.entities ?? [];
  const rows = constraints.length
    ? constraints.map((constraint, index) => {
      const record = constraint && typeof constraint === "object" ? constraint as Record<string, unknown> : {};
      const type = String(record.kind ?? record.type ?? `Constraint ${index + 1}`).replaceAll("_", " ");
      const detail = Object.entries(record).filter(([key]) => !["kind", "type", "id"].includes(key)).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
      return `<li><i>${index + 1}</i><span><strong>${escapeHtml(type)}</strong><small>${escapeHtml(detail || "Accepted sketch constraint")}</small></span><b>✓</b></li>`;
    }).join("")
    : `<li class="empty"><span><strong>No explicit constraints</strong><small>The selected sketch remains document-driven.</small></span></li>`;
  document.querySelector<HTMLElement>("#inspector")!.innerHTML = `<section class="inspector-tab-content constraints-content"><h2>${escapeHtml(sketchFeature?.name ?? "Constraints")}</h2><p class="feature-type">${sketchFeature ? "Sketch constraint system" : "No sketch selected"}</p><div class="constraint-summary"><span>Constraints <b>${constraints.length}</b></span><span>Entities <b>${entities.length}</b></span><span>Solver <b>${escapeHtml(sketchRecord?.status ?? "ready")}</b></span></div><ul class="constraint-list">${rows}</ul></section>`;
}

function renderAppearanceInspector(): void {
  const selected = adapter.findFeature(state.selectedFeatureId) ?? adapter.getSnapshot().features.at(-1);
  const unavailable = ["Material", "Density", "Young's Modulus", "Poisson Ratio"]
    .map((label) => renderUnavailableProperty(label))
    .join("");
  document.querySelector<HTMLElement>("#inspector")!.innerHTML = `<section class="inspector-tab-content appearance-content"><h2>${escapeHtml(selected?.name ?? "Body appearance")}</h2><p class="feature-type">Viewport appearance</p><section class="property-section"><h3>Material</h3>${unavailable}</section><section class="property-section"><h3>Display</h3><label>Opacity <span><input id="appearance-opacity" type="range" min="5" max="100" value="${Math.round(appearanceOpacity * 100)}" /><output>${Math.round(appearanceOpacity * 100)}%</output></span></label>${["Line Width", "Point Size", "Line Color"].map((label) => renderUnavailableProperty(label)).join("")}<label class="appearance-color">Shape Color <input id="appearance-color" type="color" value="${appearanceColor}" /></label></section></section>`;
  const apply = () => renderer?.setAppearance(appearanceColor, appearanceOpacity, appearanceEdgesVisible);
  document.querySelector<HTMLInputElement>("#appearance-color")!.addEventListener("input", (event) => { appearanceColor = (event.currentTarget as HTMLInputElement).value; apply(); });
  document.querySelector<HTMLInputElement>("#appearance-opacity")!.addEventListener("input", (event) => { const input = event.currentTarget as HTMLInputElement; appearanceOpacity = Number(input.value) / 100; input.nextElementSibling!.textContent = `${Math.round(appearanceOpacity * 100)}%`; apply(); });
  installInspectorDisclosures();
}

function renderUnavailableProperty(label: string, value = "Unavailable"): string {
  return `<div class="inspector-unavailable-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></div>`;
}

function inspectorFieldDisplay(value: unknown, kind: string): string {
  const text = String(value);
  if (/length/i.test(kind) && !/\b(?:mm|nm|cm|m)\b/i.test(text)) return `${text} mm`;
  if (/angle/i.test(kind) && !/[°]|deg/i.test(text)) return `${text}°`;
  return text;
}

function renderPlacementSection(): string {
  return `<section class="inspector-section placement-section"><h3>Placement</h3><div class="inspector-unavailable-list">${[
    ["Position X", "0.00 mm"], ["Position Y", "0.00 mm"], ["Position Z", "0.00 mm"], ["Rotation Axis", "Z"], ["Angle", "0.00°"],
  ].map(([label, value]) => renderUnavailableProperty(label, value)).join("")}</div></section>`;
}

function installInspectorDisclosures(): void {
  document.querySelectorAll<HTMLElement>("#inspector .inspector-section > h3, #inspector .operation-requirements > h3, #inspector .sketch-dimensions > h3, #inspector .history-services > h3, #inspector .step-import-evidence > h3, #inspector .property-section > h3").forEach((heading) => {
    if (heading.dataset.disclosureReady) return;
    heading.dataset.disclosureReady = "true";
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("aria-expanded", "true");
    const sectionName = heading.textContent?.trim() || "Inspector";
    const syncAccessibleName = (expanded: boolean) => heading.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${sectionName} section`);
    syncAccessibleName(true);
    const toggle = () => {
      const section = heading.parentElement!;
      const expanded = heading.getAttribute("aria-expanded") === "true";
      const nextExpanded = !expanded;
      heading.setAttribute("aria-expanded", String(nextExpanded));
      syncAccessibleName(nextExpanded);
      section.classList.toggle("collapsed", expanded);
    };
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
  });
}

function renderInspector(): void {
  if (activeOffsetConstructionPlane) {
    renderOffsetConstructionPlaneInspector();
    return;
  }
  if (selectedCatalogOperationId) {
    renderOperationInspector(operationById(selectedCatalogOperationId));
    return;
  }
  if (activeInspectorTab === "tool" && activeToolContext) { renderActiveToolInspector(); return; }
  if (activeInspectorTab === "constraints") { renderConstraintsInspector(); return; }
  if (activeInspectorTab === "appearance") { renderAppearanceInspector(); return; }
  const feature = adapter.findFeature(state.selectedFeatureId) ?? adapter.getSnapshot().features.at(-1);
  if (!feature) return;
  state.selectedFeatureId = feature.id;
  const selection = state.selection;
  const definition = operationForFeatureType(feature.type);
  const selectionDefinition = feature.type === "pad" && feature.parameters.result_mode === "cut"
    ? extrudeCutOperation
    : definition;
  const selectedSketch = feature.type === "sketch" ? sketchForFeature(feature.id) : undefined;
  const catalogFields = definition?.parameters.map((parameter) => ({ key: parameter.key, label: parameter.label, kind: valueKindLabel(parameter.value_kind), fallback: displayDefault(parameter) })) ?? [];
  if (feature.type === "pad" && feature.parameters.result_mode === "cut") {
    catalogFields.push({ key: "target_body", label: "Target body", kind: "Document value", fallback: "—" });
  }
  const fields = definition ? catalogFields : Object.keys(feature.parameters).sort().map((key) => ({ key, label: titleCaseField(key), kind: "Document value", fallback: "—" }));
  const sketchOverview = feature.type === "sketch" ? [
    { key: "support", label: "Support", kind: "Document value", fallback: "Unbound" },
    { key: "profile", label: "Geometry", kind: "Document value", fallback: "—" },
    { key: "constraints", label: "Constraints", kind: "Document value", fallback: "0" },
  ] : [];
  const isTimelineFeature = feature.id.startsWith("feature:");
  const isBaseFeature = feature.id === "feature:rectangle-sketch" || feature.id === "feature:extrude";
  const isEditableAdvancedFeature = Boolean(definition && isAdvancedFeatureOperation(definition.id) && durableAdvancedEditState(feature.id).request);
  const isEditableExtrudeFeature = definition?.id === extrudeOperation.id && feature.id.startsWith("feature:extrude:");
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
    ${repair ? `<section class="repair-preview" role="alert"><strong>Repair ${escapeHtml(repair.unresolved.input_name)}</strong><p>Evaluation stopped at ${escapeHtml(repair.unresolved.feature)}. ${repair.downstream_stop.blocked_features.length} feature(s) blocked.</p>${repair.candidates.length ? repair.candidates.map((ranked) => `<button type="button" data-repair-candidate="${escapeHtml(ranked.candidate.id)}" ${topologyRebindPreview ? "disabled" : ""}>Preview #${ranked.rank} ${escapeHtml(ranked.candidate.id)} · Δ ${ranked.score.position_delta}/${ranked.score.normal_delta}/${ranked.score.measure_delta}</button>`).join("") : `<p data-no-repair-candidate>No candidate available; the document remains unchanged.</p>`}${topologyRebindPreview ? `<div class="repair-geometry-preview" data-repair-preview-state="${topologyRebindPreview.phase}" data-repair-preview-candidate="${escapeHtml(topologyRebindPreview.selected)}"><p>${topologyRebindPreview.phase === "ready" ? "Native replacement geometry preview ready. Apply uses this exact accepted-document basis." : "Computing native replacement geometry without changing the document…"}</p><button type="button" data-apply-repair ${topologyRebindPreview.phase === "ready" ? "" : "disabled"}>Apply repair</button><button type="button" data-cancel-repair>Cancel preview</button></div>` : ""}</section>` : ""}
  </section>` : "";
  document.querySelector<HTMLElement>("#inspector")!.innerHTML = `
    <header class="inspector-selection-header"><i aria-hidden="true"></i><span><h2>${feature.type === "sketch" ? `Sketch — ${escapeHtml(selectedSketch?.name ?? feature.name)}` : escapeHtml(feature.name)}</h2><p class="feature-type">${escapeHtml(feature.type)} · ${escapeHtml(feature.status)}${definition ? ` · ${escapeHtml(lifecycleLabel(definition))}` : ""}</p></span></header>
    <section class="inspector-section inspector-parameters"><h3>${feature.type === "sketch" ? "Sketch" : "Parameters"}</h3>${selectedSketch ? `<div class="sketch-identity"><label><span>Alias</span><input id="sketch-alias" value="${escapeHtml(selectedSketch.name)}" data-accepted-value="${escapeHtml(selectedSketch.name)}" /></label><button type="button" data-rename-sketch-alias="${escapeHtml(selectedSketch.id)}">Rename</button><div><span>Sketch ID</span><code>${escapeHtml(sketchReferenceId(selectedSketch.id))}</code></div></div>` : ""}<dl>${(feature.type === "sketch" ? sketchOverview : fields).map((field) => `<div data-parameter-key="${escapeHtml(field.key)}"><dt>${escapeHtml(field.label)}<small>${escapeHtml(field.kind)}</small></dt><dd>${escapeHtml(inspectorFieldDisplay(feature.parameters[field.key] ?? field.fallback, field.kind))}</dd></div>`).join("")}</dl></section>
    ${renderPlacementSection()}
    ${selectionDefinition ? renderSelectionRequirements(selectionDefinition) : ""}
    ${feature.type === "sketch" ? renderSketchDimensions(feature.id) : ""}
    ${isTimelineFeature ? `<section class="feature-actions inspector-section" aria-label="feature actions"><h3>Feature</h3><label><span>${feature.type === "sketch" ? "Feature name" : "Name"}</span><input id="feature-name" value="${escapeHtml(feature.name)}" /></label><div><button data-feature-action="rename" type="button">Rename</button>${isEditableAdvancedFeature ? `<button data-feature-action="edit-parameters" type="button">Edit parameters</button>` : ""}${isEditableExtrudeFeature ? `<button data-feature-action="edit-extrude" type="button">Edit Extrude</button>` : ""}<button data-feature-action="suppress" type="button">${feature.status === "suppressed" ? "Resume" : "Suppress"}</button><button data-feature-action="rollback" type="button">Rollback here</button>${isBaseFeature ? "" : `<button data-feature-action="delete" type="button">Delete</button>`}</div></section>` : ""}
    ${historyServices}
    ${stepMeasurements}
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
    if (action === "edit-extrude") {
      beginExtrudeFeatureEdit(feature.id);
      return;
    }
    const changes: Record<string, unknown>[] = [];
    if (action === "rename") changes.push({ kind: "rename_entity", entity: { kind: "feature", id: feature.id }, display_name: document.querySelector<HTMLInputElement>("#feature-name")!.value.trim() });
    if (action === "suppress") changes.push({ kind: "set_feature_suppressed", feature: feature.id, suppressed: feature.status !== "suppressed" });
    if (action === "delete") changes.push({ kind: "delete_feature", component: "component:root", feature: feature.id });
    if (changes.length) worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}`, changes });
  }));
  const sketchAlias = document.querySelector<HTMLInputElement>("#sketch-alias");
  const renameSketchAlias = document.querySelector<HTMLButtonElement>("[data-rename-sketch-alias]");
  if (sketchAlias && renameSketchAlias) {
    const rename = () => {
      const displayName = sketchAlias.value.trim();
      if (!displayName) { sketchAlias.focus(); return; }
      worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}:rename-sketch`, changes: [{ kind: "rename_entity", entity: { kind: "sketch", id: renameSketchAlias.dataset.renameSketchAlias }, display_name: displayName }] });
    };
    renameSketchAlias.addEventListener("click", rename);
    sketchAlias.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); rename(); }
      if (event.key === "Escape") { event.preventDefault(); sketchAlias.value = sketchAlias.dataset.acceptedValue ?? ""; renameSketchAlias.focus(); }
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-history-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.historyAction;
    historyActionMessage = "";
    if (action === "recompute") worker?.postMessage({ type: "recompute-from-here", feature: feature.id });
    if (action === "rollback-end") worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "end" } });
    if (action === "group" && previousFeature) worker?.postMessage({ type: "commit-document-changes", operation: "group_features", transactionId: `transaction:${crypto.randomUUID()}:group`, changes: [{ kind: "group_features", group_id: `group:${crypto.randomUUID()}`, display_name: `${previousFeature.name} + ${feature.name}`, features: [previousFeature.id, feature.id] }] });
    if (action === "reorder" && previousFeature) worker?.postMessage({ type: "commit-document-changes", operation: "reorder_feature", transactionId: `transaction:${crypto.randomUUID()}:reorder`, changes: [{ kind: "reorder_feature", component: "component:root", feature: feature.id, before: previousFeature.id }] });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-repair-candidate]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.dataset.repairCandidate;
    if (!selected || topologyRebindPreview) return;
    topologyRebindPreview = { requestId: `topology-rebind-preview:${crypto.randomUUID()}`, selected, phase: "loading" };
    worker?.postMessage({ type: "preview-topology-rebind", requestId: topologyRebindPreview.requestId, selected, observedTopology: repairObservedTopology });
    renderInspector();
  }));
  document.querySelector<HTMLButtonElement>("[data-cancel-repair]")?.addEventListener("click", () => {
    const preview = topologyRebindPreview;
    if (!preview) return;
    topologyRebindPreview = undefined;
    const acceptedHash = adapter.checksum();
    if (lastAcceptedPacket?.semanticHash === acceptedHash) {
      // Restore immediately, then discard the worker's equivalent accepted
      // packet. Reinstalling both copies can force two GPU rebuilds into the
      // following preview action when users cycle quickly.
      suppressedRepairCancelPacketHash = acceptedHash;
      installAcceptedRenderPacket(lastAcceptedPacket);
    }
    worker?.postMessage({ type: "cancel-topology-rebind-preview", requestId: preview.requestId });
    renderInspector();
  });
  document.querySelector<HTMLButtonElement>("[data-apply-repair]")?.addEventListener("click", () => {
    const preview = topologyRebindPreview;
    if (!preview || preview.phase !== "ready" || preview.baseDocumentHash === undefined || preview.baseRevision === undefined) return;
    worker?.postMessage({
      type: "explicit-rebind", requestId: preview.requestId, transactionId: `transaction:${crypto.randomUUID()}:repair`,
      selected: preview.selected, baseDocumentHash: preview.baseDocumentHash, baseRevision: preview.baseRevision,
    });
  });
  installParameterControls();
  document.querySelectorAll<HTMLButtonElement>("#inspector [data-coming-soon]").forEach(installComingSoon);
  installInspectorDisclosures();
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
      ? `<div class="operation-actions"><button id="preview-advanced-feature" type="button">Preview ${escapeHtml(operation.label)}</button><button id="execute-advanced-feature" type="button" disabled>${editing ? "Apply update" : "Apply"} ${escapeHtml(operation.label)}</button><button id="cancel-advanced-feature" type="button">Cancel</button></div><p id="operation-execution-status" class="operation-schema-ready" role="status">${editing ? `Editing ${escapeHtml(editingAdvancedFeatureId!)}. Previewing preserves its stable feature and body identities.` : "Preparing a non-mutating geometry preview…"}</p>`
      : `<p class="operation-schema-ready" role="status">Schema ready. Execution is not connected for this command yet.</p>`}`;
  advancedFeaturePreviewReady = false;
  advancedFeatureApplyAfterPreviewRequest = undefined;
  document.querySelector<HTMLButtonElement>("#preview-advanced-feature")?.addEventListener("click", () => previewCatalogOperation(operation));
  document.querySelector<HTMLButtonElement>("#execute-advanced-feature")?.addEventListener("click", () => applyCatalogOperation());
  document.querySelector<HTMLButtonElement>("#cancel-advanced-feature")?.addEventListener("click", cancelAdvancedFeaturePreview);
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-operation-parameter], [data-advanced-axis], [data-advanced-source-body], [data-advanced-target-body], [data-advanced-tool-bodies], [data-advanced-profile-sketch], [data-advanced-profile-sketches], [data-advanced-path-sketch]").forEach((control) => {
    control.setAttribute("aria-describedby", "operation-execution-status");
    control.addEventListener(control instanceof HTMLSelectElement ? "change" : "input", () => {
      control.removeAttribute("aria-invalid");
      queueAdvancedFeaturePreview(operation);
    });
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-operation-parameter]").forEach((control) => {
    control.addEventListener("keydown", (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Enter" && !keyEvent.isComposing && !keyEvent.ctrlKey && !keyEvent.metaKey && !keyEvent.altKey) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        requestAdvancedFeatureApply(operation, control);
      } else if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        cancelAdvancedFeaturePreview();
        selectedCatalogOperationId = null;
        renderInspector();
        document.querySelector<HTMLButtonElement>("#command-button")?.focus();
      }
    });
  });
  if (!disabled && executable) queueAdvancedFeaturePreview(operation, 0);
  installInspectorDisclosures();
}

const advancedOperationIds = new Set<AdvancedFeatureOperationId>([
  "crawler.part.revolve",
  "crawler.part.loft",
  "crawler.part.sweep",
  "crawler.part.extrude.cut",
  "crawler.part.revolve.cut",
  "crawler.part.draft",
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
  return [...new Set(accepted)].filter((bodyId) => adapter.findBody(bodyId));
}

function bodyOptions(selectedBodyId?: string, multiple = false): string {
  const activeBodyId = renderer?.bodyId();
  return acceptedKernelBodyIds().map((bodyId) => `<option value="${escapeHtml(bodyId)}" ${(multiple ? bodyId !== selectedBodyId : bodyId === (selectedBodyId ?? activeBodyId)) ? "selected" : ""}>${escapeHtml(adapter.findBody(bodyId)?.name ?? bodyId)}</option>`).join("");
}

function extrudeSupportOwnerBodyId(support: SketchSupport): string | undefined {
  if (support.kind !== "topology") return undefined;
  const durable = adapter.durableDocument() as { topology_references?: Record<string, { body?: string }> };
  return durable.topology_references?.[support.reference]?.body;
}

function eligibleCutTargetBodyIds(source?: Pick<SketchExtrudeSource, "sketch" | "support">): string[] {
  if (!source) return [];
  const durable = adapter.durableDocument() as {
    sketches?: Record<string, { component?: string }>;
    bodies?: Record<string, { component?: string; generated_by?: string; suppressed?: boolean }>;
    features?: Record<string, { component?: string; suppressed?: boolean }>;
  };
  const component = durable.sketches?.[source.sketch.id]?.component;
  return acceptedKernelBodyIds().filter((bodyId) => {
    const body = durable.bodies?.[bodyId];
    const producer = body?.generated_by ? durable.features?.[body.generated_by] : undefined;
    return Boolean(body && !body.suppressed && producer && !producer.suppressed && component
      && body.component === component && producer.component === component);
  });
}

function selectedExtrudeResultMode(): ExtrudeResultMode {
  return parseExtrudeResultMode(document.querySelector<HTMLSelectElement>("#extrude-result-mode")!.value) ?? "new_body";
}

function syncExtrudeResultControls(mode = selectedExtrudeResultMode()): void {
  const result = document.querySelector<HTMLSelectElement>("#extrude-result-mode")!;
  result.value = mode;
  document.querySelector<HTMLElement>(".dimension-panel")!.dataset.resultMode = mode;
  document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.dataset.resultMode = mode;
  result.disabled = !activeSketchExtrudeSource || Boolean(activeSketchExtrudeSource.editing);
  const targetControl = document.querySelector<HTMLElement>("#extrude-target-control")!;
  const target = document.querySelector<HTMLSelectElement>("#extrude-target-body")!;
  targetControl.hidden = mode !== "cut";
  target.disabled = mode !== "cut" || Boolean(activeSketchExtrudeSource?.editing);
  const explicitlySelectedBody = state.selection?.kind === "body" ? state.selection.bodyId : undefined;
  const prior = activeSketchExtrudeSource?.targetBodyId ?? (target.value || explicitlySelectedBody);
  const eligible = eligibleCutTargetBodyIds(activeSketchExtrudeSource);
  target.innerHTML = `<option value="">Select target…</option>${eligible.map((bodyId) => `<option value="${escapeHtml(bodyId)}">${escapeHtml(adapter.findBody(bodyId)?.name ?? bodyId)}</option>`).join("")}`;
  if (prior && eligible.includes(prior)) target.value = prior;
}

function applyExtrudeResultSelection(): boolean {
  const source = activeSketchExtrudeSource;
  if (!source) return true;
  const mode = selectedExtrudeResultMode();
  if (mode === "new_body") {
    source.resultMode = mode;
    source.targetBodyId = undefined;
    source.bodyId = source.newBodyId;
    document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = "";
    return true;
  }
  // Cut is a two-stage explicit choice. Retain the selected mode while the
  // required target is still absent so the target control remains visible and
  // the user can recover without any implicit Boolean dispatch.
  source.resultMode = mode;
  try {
    const selected = document.querySelector<HTMLSelectElement>("#extrude-target-body")!.value || source.targetBodyId;
    const targetBodyId = requireSingleCutTarget(selected, eligibleCutTargetBodyIds(source), extrudeSupportOwnerBodyId(source.support));
    source.resultMode = mode;
    source.targetBodyId = targetBodyId;
    source.bodyId = targetBodyId;
    document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = "Cut retains the explicitly selected target body.";
    return true;
  } catch (error) {
    if (!(error instanceof ExtrudeTargetError)) throw error;
    document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = error.message;
    worker?.postMessage({ type: "restore-accepted-packet" });
    return false;
  }
}

function retainedConstructionAxisPolyline(): [number, number, number][] | undefined {
  if (!selectedSketchConstructionAxis) return undefined;
  const hydrated = hydrateSketchFromDocument(adapter.durableDocument(), selectedSketchConstructionAxis.sketchId);
  const entity = hydrated?.sketch.geometry[selectedSketchConstructionAxis.geometryId];
  if (!hydrated || !entity?.construction || entity.geometry.kind !== "line") return undefined;
  const resolution = resolveSketchPlane(hydrated.support, adapter.durableDocument() as SketchPlaneDocument, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities);
  if (resolution.status !== "ready") return undefined;
  const start = planeLocalToWorldMillimeters(entity.geometry.start, resolution.plane);
  const end = planeLocalToWorldMillimeters(entity.geometry.end, resolution.plane);
  return Math.hypot(...end.map((value, index) => value - start[index])) > 0 ? [[...start], [...end]] as [number, number, number][] : undefined;
}

function renderAdvancedSelectionControls(operation: AlphaOperation): string {
  const activeBodyId = renderer?.bodyId();
  const bodies = acceptedKernelBodyIds();
  const bodyHelp = bodies.length ? "Durable accepted body snapshots" : "Create or import a body-producing feature first.";
  const profiles = acceptedSketchFeatureSources(true);
  const sketches = acceptedSketchFeatureSources(false);
  const profileHelp = profiles.length ? "Accepted closed sketch profiles" : "Create and finish a closed sketch profile first.";
  const defaultRevolveAxis = (() => {
    const support = profiles[0]?.support;
    const plane = support?.kind === "origin_plane" || support?.kind === "origin_plane_reference" ? support.plane : "";
    return String(plane).endsWith("yz") ? "y" : "x";
  })();
  const constructionAxisReady = Boolean(retainedConstructionAxisPolyline());
  const axisControl = `<label>Axis <select data-advanced-axis><option value="x" ${!constructionAxisReady && defaultRevolveAxis === "x" ? "selected" : ""}>Origin X</option><option value="y" ${!constructionAxisReady && defaultRevolveAxis === "y" ? "selected" : ""}>Origin Y</option><option value="z">Origin Z</option>${constructionAxisReady ? `<option value="selected-construction" selected>Selected construction line</option>` : ""}${state.selections.some((selection) => selection.kind === "edge") ? `<option value="selected-edge">Selected straight edge</option>` : ""}</select></label>`;
  if (operation.id === "crawler.part.revolve" || operation.id === "crawler.part.revolve.cut") {
    const target = operation.id.endsWith(".cut") ? `<label>Target body <select data-advanced-target-body>${bodyOptions(activeBodyId)}</select></label>` : "";
    return `<section class="advanced-selection" aria-label="Resolved feature inputs">${target}<label>Profile <select data-advanced-profile-sketch>${sketchSourceOptions(profiles)}</select></label>${axisControl}<p>${escapeHtml(profileHelp)}. Choose an origin axis, a selected construction line, or one straight viewport edge.</p></section>`;
  }
  if (operation.id === "crawler.part.loft") {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Profiles in loft order <select data-advanced-profile-sketches multiple size="${Math.max(2, Math.min(6, profiles.length))}">${sketchSourceOptions(profiles, true)}</select></label><p>Select at least two ${escapeHtml(profileHelp.toLowerCase())} in section order.</p></section>`;
  }
  if (operation.id === "crawler.part.sweep") {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Profile <select data-advanced-profile-sketch>${sketchSourceOptions(profiles)}</select></label><label>Path sketch <select data-advanced-path-sketch>${sketchSourceOptions(sketches)}</select></label><p>${escapeHtml(profileHelp)}. The path sketch must contain one connected open curve chain.</p></section>`;
  }
  if (operation.id === "crawler.part.extrude.cut") {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Target body <select data-advanced-target-body>${bodyOptions(activeBodyId)}</select></label><label>Profile <select data-advanced-profile-sketch>${sketchSourceOptions(profiles)}</select></label><p>${escapeHtml(profileHelp)} · ${escapeHtml(bodyHelp)}</p></section>`;
  }
  if (operation.id.startsWith("crawler.part.boolean.")) {
    return `<section class="advanced-selection" aria-label="Resolved feature inputs"><label>Target body <select data-advanced-target-body>${bodyOptions(activeBodyId)}</select></label><label>Tool bodies <select data-advanced-tool-bodies multiple size="${Math.max(2, Math.min(5, bodies.length))}">${bodyOptions(activeBodyId, true)}</select></label><p>${escapeHtml(bodyHelp)}</p></section>`;
  }
  const edgeSummary = state.selections.filter((selection) => selection.kind === "edge").map((selection) => selection.stableId).join(", ");
  const faceSummary = state.selections.filter((selection) => selection.kind === "face").map((selection) => selection.stableId).join(", ");
  const selectedDraftFace = state.selections.find((selection) => selection.kind === "face");
  const selectedDraftEvidence = selectedDraftFace
    ? [...acceptedPlanarFaceEvidence.values()].find((evidence) => evidence.body === selectedDraftFace.bodyId && evidence.stable_kernel_id === selectedDraftFace.stableId)
    : undefined;
  const defaultDraftAxis = selectedDraftEvidence
    ? (["x", "y", "z"] as const).reduce((best, axis, index) => Math.abs(selectedDraftEvidence.normal_millionths[index]) < Math.abs(selectedDraftEvidence.normal_millionths[["x", "y", "z"].indexOf(best)]) ? axis : best, "z" as "x" | "y" | "z")
    : "z";
  const selectedPrincipalAxis = operation.id === "crawler.part.draft" ? defaultDraftAxis : "z";
  const axis = operation.id === "crawler.part.mirror" || operation.id.startsWith("crawler.part.pattern.") || operation.id === "crawler.part.draft"
    ? `<label>Principal axis <select data-advanced-axis><option value="z" ${selectedPrincipalAxis === "z" ? "selected" : ""}>Z</option><option value="x" ${selectedPrincipalAxis === "x" ? "selected" : ""}>X</option><option value="y" ${selectedPrincipalAxis === "y" ? "selected" : ""}>Y</option></select></label>`
    : "";
  const edges = operation.id === "crawler.part.fillet" || operation.id === "crawler.part.chamfer"
    ? `<p data-advanced-edge-selection>${edgeSummary ? `Selected edges: ${escapeHtml(edgeSummary)}` : "Select one or more viewport edges (Shift-click for multiple)."}</p>`
    : "";
  const faces = operation.id === "crawler.part.shell" || operation.id === "crawler.part.draft"
    ? `<p data-advanced-face-selection>${faceSummary ? `Selected face${state.selections.filter((selection) => selection.kind === "face").length === 1 ? "" : "s"}: ${escapeHtml(faceSummary)}` : operation.id === "crawler.part.draft" ? "Select one or more rectangular-prism side faces." : "Select one rectangular-prism viewport face."}</p>`
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

function queueAdvancedFeaturePreview(operation: AlphaOperation, delay = 120): void {
  const requestId = ++advancedFeaturePreviewRequest;
  advancedFeatureApplyAfterPreviewRequest = undefined;
  advancedFeaturePreviewReady = false;
  const apply = document.querySelector<HTMLButtonElement>("#execute-advanced-feature");
  if (apply) apply.disabled = true;
  if (advancedFeaturePreviewTimer !== undefined) clearTimeout(advancedFeaturePreviewTimer);
  advancedFeaturePreviewTimer = setTimeout(() => {
    advancedFeaturePreviewTimer = undefined;
    previewCatalogOperation(operation, requestId);
  }, delay);
}

function previewCatalogOperation(operation: AlphaOperation, requestId = ++advancedFeaturePreviewRequest): boolean {
  if (!worker || safeMode || !isAdvancedFeatureOperation(operation.id) || operation.enablement.state === "disabled") return false;
  const status = document.querySelector<HTMLElement>("#operation-execution-status");
  try {
    const target = document.querySelector<HTMLSelectElement>("[data-advanced-target-body]")?.value;
    const source = document.querySelector<HTMLSelectElement>("[data-advanced-source-body]")?.value;
    const toolBodies = Array.from(document.querySelector<HTMLSelectElement>("[data-advanced-tool-bodies]")?.selectedOptions ?? []).map((option) => option.value);
    const axisValue = document.querySelector<HTMLSelectElement>("[data-advanced-axis]")?.value;
    const axis = axisValue === "x" || axisValue === "y" || axisValue === "z" ? axisValue : undefined;
    const profileIds = [
      ...Array.from(document.querySelector<HTMLSelectElement>("[data-advanced-profile-sketches]")?.selectedOptions ?? []).map((option) => option.value),
      ...(document.querySelector<HTMLSelectElement>("[data-advanced-profile-sketch]")?.value ? [document.querySelector<HTMLSelectElement>("[data-advanced-profile-sketch]")!.value] : []),
    ];
    const availableSketches = acceptedSketchFeatureSources(false);
    const sourceRecord = (id: string) => availableSketches.find((candidate) => candidate.sketch.id === id);
    const profileSources = profileIds.map(sourceRecord).filter((candidate): candidate is AcceptedSketchFeatureSource => Boolean(candidate)).map(({ sketch, support, featureId, profileGeometryIds }) => ({ sketch, support, featureId, ...(profileGeometryIds ? { profileGeometryIds } : {}) }));
    const pathRecord = sourceRecord(document.querySelector<HTMLSelectElement>("[data-advanced-path-sketch]")?.value ?? "");
    const selectedAxisEdge = axisValue === "selected-edge" ? state.selections.find((selection) => selection.kind === "edge") : undefined;
    const axisPolyline = axisValue === "selected-construction" ? retainedConstructionAxisPolyline() ?? [] : selectedAxisEdge ? renderer?.edgePolyline(selectedAxisEdge.token) ?? [] : [];
    if (axisValue === "selected-edge" || axisValue === "selected-construction") {
      if (axisPolyline.length < 2) throw new Error("Selected revolve axis edge has no usable endpoints");
      const origin = axisPolyline[0];
      const direction = axisPolyline.at(-1)!.map((value, index) => value - origin[index]);
      const length = Math.hypot(...direction);
      const straight = length > 0 && axisPolyline.every((point) => {
        const offset = point.map((value, index) => value - origin[index]);
        const cross = [
          offset[1] * direction[2] - offset[2] * direction[1],
          offset[2] * direction[0] - offset[0] * direction[2],
          offset[0] * direction[1] - offset[1] * direction[0],
        ];
        return Math.hypot(...cross) / length <= 1e-6;
      });
      if (!straight) throw new Error("Revolve requires a straight selected axis edge");
    }
    const axisOriginNanometers = axisPolyline.length >= 2 ? axisPolyline[0].map((value) => Math.round(value * 1_000_000)) as [number, number, number] : undefined;
    const axisDirectionNanometers = axisPolyline.length >= 2 ? axisPolyline.at(-1)!.map((value, index) => Math.round((value - axisPolyline[0][index]) * 1_000_000)) as [number, number, number] : undefined;
    const neutralPlaneOriginNanometers = currentBounds.length === 6 ? [0, 1, 2].map((index) => Math.round(currentBounds[index] * 1_000_000)) as [number, number, number] : [0, 0, 0] as [number, number, number];
    const command: AdvancedFeatureCommand = {
      type: editingAdvancedFeatureId ? "preview-advanced-feature-edit" : "preview-advanced-feature",
      operationId: operation.id,
      displayName: operation.label,
      featureId: editingAdvancedFeatureId ?? undefined,
      outputBodyId: editingAdvancedFeatureId
        ? durableAdvancedEditState(editingAdvancedFeatureId).request?.output_body_id
        : ["crawler.part.revolve", "crawler.part.loft", "crawler.part.sweep", "crawler.part.extrude.cut", "crawler.part.revolve.cut"].includes(operation.id)
          ? undefined
          : source || target || renderer?.bodyId() || undefined,
      previewRequestId: requestId,
      parameters: collectOperationParameters(operation),
      selection: {
        sourceBodyId: source || undefined,
        targetBodyId: target || undefined,
        toolBodyIds: toolBodies,
        edgeStableIds: state.selections.filter((selection) => selection.kind === "edge").map((selection) => selection.stableId),
        removedFaceStableIds: state.selections.filter((selection) => selection.kind === "face").map((selection) => selection.stableId),
        axis,
        profileSources,
        ...(pathRecord ? { pathSource: { sketch: pathRecord.sketch, support: pathRecord.support, featureId: pathRecord.featureId } } : {}),
        ...(axisOriginNanometers && axisDirectionNanometers ? { axisOriginNanometers, axisDirectionNanometers } : {}),
        neutralPlaneOriginNanometers,
        draftFaceStableIds: state.selections.filter((selection) => selection.kind === "face").map((selection) => selection.stableId),
      },
    };
    activeAdvancedOperationLabel = operation.label;
    advancedFeaturePreviewReady = false;
    const apply = document.querySelector<HTMLButtonElement>("#execute-advanced-feature");
    if (apply) apply.disabled = true;
    setOperation("preview", "advanced");
    if (status) status.textContent = `Previewing ${operation.label} without changing the document…`;
    worker.postMessage(command);
    return true;
  } catch (error) {
    advancedFeatureApplyAfterPreviewRequest = undefined;
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function requestAdvancedFeatureApply(operation: AlphaOperation, control: HTMLInputElement | HTMLSelectElement): void {
  const status = document.querySelector<HTMLElement>("#operation-execution-status");
  if (control instanceof HTMLInputElement && !control.checkValidity()) {
    advancedFeaturePreviewRequest += 1;
    advancedFeatureApplyAfterPreviewRequest = undefined;
    advancedFeaturePreviewReady = false;
    if (advancedFeaturePreviewTimer !== undefined) clearTimeout(advancedFeaturePreviewTimer);
    advancedFeaturePreviewTimer = undefined;
    document.querySelector<HTMLButtonElement>("#execute-advanced-feature")?.setAttribute("disabled", "");
    control.setAttribute("aria-invalid", "true");
    const label = parameterByKey(operation, control.dataset.operationParameter!).label;
    if (status) status.textContent = `${label}: ${control.validationMessage || "Enter a valid value before applying."}`;
    return;
  }
  try {
    collectOperationParameters(operation);
  } catch (error) {
    advancedFeaturePreviewRequest += 1;
    advancedFeatureApplyAfterPreviewRequest = undefined;
    advancedFeaturePreviewReady = false;
    if (advancedFeaturePreviewTimer !== undefined) clearTimeout(advancedFeaturePreviewTimer);
    advancedFeaturePreviewTimer = undefined;
    document.querySelector<HTMLButtonElement>("#execute-advanced-feature")?.setAttribute("disabled", "");
    control.setAttribute("aria-invalid", "true");
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  control.removeAttribute("aria-invalid");
  if (advancedFeaturePreviewTimer !== undefined) clearTimeout(advancedFeaturePreviewTimer);
  advancedFeaturePreviewTimer = undefined;
  if (advancedFeaturePreviewReady) {
    document.querySelector<HTMLButtonElement>("#execute-advanced-feature")?.click();
    return;
  }
  if (previewCatalogOperation(operation)) {
    advancedFeatureApplyAfterPreviewRequest = advancedFeaturePreviewRequest;
    if (status) status.textContent = `Validating ${operation.label}; Apply will run when its geometry preview is ready…`;
  }
}

function applyCatalogOperation(): void {
  if (!worker || safeMode || !advancedFeaturePreviewReady) return;
  advancedFeatureApplyAfterPreviewRequest = undefined;
  advancedFeaturePreviewReady = false;
  const apply = document.querySelector<HTMLButtonElement>("#execute-advanced-feature");
  if (apply) apply.disabled = true;
  const status = document.querySelector<HTMLElement>("#operation-execution-status");
  if (status) status.textContent = `Applying ${activeAdvancedOperationLabel}…`;
  performanceEvidence.beginRecompute();
  worker.postMessage({ type: "apply-advanced-feature" });
}

function cancelAdvancedFeaturePreview(): void {
  advancedFeaturePreviewRequest += 1;
  if (advancedFeaturePreviewTimer !== undefined) clearTimeout(advancedFeaturePreviewTimer);
  advancedFeaturePreviewTimer = undefined;
  advancedFeatureApplyAfterPreviewRequest = undefined;
  advancedFeaturePreviewReady = false;
  worker?.postMessage({ type: "cancel-advanced-feature" });
  selectedCatalogOperationId = null;
  editingAdvancedFeatureId = null;
  setOperation("cancelled", "advanced");
}

function executeCatalogOperation(operation: AlphaOperation): void {
  if (advancedFeaturePreviewReady) applyCatalogOperation();
  else previewCatalogOperation(operation);
}

function applySelection(selection: Selection | null, additive = false): void {
  if (selection) selectedSketchId = undefined;
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
  document.querySelector("#selection-readout")!.setAttribute("data-active", String(Boolean(summary)));
  document.querySelector("#timeline-status")!.textContent = historyActionMessage || (state.selection ? `Solver: ready · selected ${state.selection.kind} ${state.selection.stableId}` : "Solver: ready");
  renderInspector();
  if (sketchSession && activeToolContext?.source === "sketch" && activeToolContext.key === "project") {
    setSketchToolPhase(state.selection?.kind === "edge" ? "ready" : "collecting");
    applyPendingSketchInvocation();
  } else if (sketchSession) syncSketchToolUi();
}

function applyPreselection(selection: Selection | null): void {
  state.preselection = selection;
  let projectReason: string | undefined;
  if (sketchSession && activeToolContext?.source === "sketch" && activeToolContext.key === "project") {
    let valid = selection?.kind === "edge";
    if (valid && activeSketchPlane && selection) {
      const world = renderer?.edgePolyline(selection.token) ?? [];
      if (world.length < 2) { valid = false; projectReason = "Edge has no projectable curve"; }
      else {
        const start = worldMillimetersToPlaneLocal(world[0], activeSketchPlane);
        const end = worldMillimetersToPlaneLocal(world.at(-1)!, activeSketchPlane);
        if (start.x_nm === end.x_nm && start.y_nm === end.y_nm) { valid = false; projectReason = "Edge projects to a point"; }
      }
    } else if (!valid) projectReason = "Project requires a model edge";
    sketchHoverTarget = { kind: "geometry", id: selection?.stableId, valid, reason: valid ? undefined : projectReason };
    syncSketchToolUi();
  }
  document.querySelector("#preselection-readout")!.textContent = selection ? `Hover: ${selection.kind}, stable ID ${selection.stableId}${projectReason ? ` · ${projectReason}` : ""}` : "Hover: none";
}

function installOrReplaceWorkspacePacket(packet: RenderPacket, body: { id: string; visible: boolean; selectable: boolean }): WorkspaceRenderer {
  if (renderer) {
    renderer.replacePacket(packet, body);
    return renderer;
  }
  const created = new WorkspaceRenderer(
    document.querySelector<HTMLCanvasElement>("#viewport")!,
    packet,
    body,
    applySelection,
    applyPreselection,
    viewportState,
  );
  viewportState = created.sharedViewportState();
  created.setViewChangedListener(renderSketchViewChanged);
  created.attachViewCube(document.querySelector<HTMLElement>("#view-cube")!);
  created.setBackground(viewportBackground);
  created.setGridVisible(viewportGridVisible);
  created.setDisplayMode(viewportDisplayMode);
  created.setAppearance(appearanceColor, appearanceOpacity, appearanceEdgesVisible);
  created.setFilters(state.selectionFilters);
  renderer = created;
  return created;
}

function installAcceptedRenderPacket(packet: Extract<WorkerResponse, { type: "packet" }>): void {
  if (packet.semanticHash !== adapter.checksum()) return;
  lastAcceptedPacket = packet;
  transferredBytes = packet.transferredBytes;
  performanceEvidence.setTransferBytes(transferredBytes);
  acceptedBodyId = packet.bodyId;
  lastPacketSemanticHash = packet.semanticHash;
  currentBounds = Array.from(packet.packet.bounds);
  viewportState ??= renderer?.sharedViewportState();
  renderer = installOrReplaceWorkspacePacket(packet.packet, renderBodyContext(packet.bodyId));
  acceptedPlanarFaceEvidence = renderer.planarFaceEvidenceMap();
  if (sketchChoosingSupport) renderer.setSketchSupportSelection(true, handleSketchSupportPick);
  else if (activeSketchPlane && sketchSession) resolveAndAlignSketchPlane(true);
  syncCommittedSketches();
  pendingAcceptedPacket = undefined;
  if (documentReady) { setReadiness("renderer", "ready"); setSafeMode(false); void performanceEvidence.sampleFrames(); }
}

function installAdvancedPreviewPacket(preview: Extract<WorkerResponse, { type: "advanced-feature-preview" }>): void {
  if (preview.semanticHash !== adapter.checksum()) throw new Error("Advanced feature preview is not based on the accepted document");
  transferredBytes = preview.transferredBytes;
  performanceEvidence.setTransferBytes(transferredBytes);
  currentBounds = Array.from(preview.packet.bounds);
  viewportState ??= renderer?.sharedViewportState();
  renderer = installOrReplaceWorkspacePacket(preview.packet, { id: preview.bodyId, visible: true, selectable: false });
  syncCommittedSketches();
}

function renderSketchSelectionInspectorChanged(): void {
  const dense = sketchSession && Object.keys(sketchSession.draftView.constraints).length > 500;
  if (!dense) {
    renderActiveToolInspector();
    return;
  }
  updateSketchToolInspectorState();
  if (denseSketchInspectorRefresh !== undefined) clearTimeout(denseSketchInspectorRefresh);
  denseSketchInspectorRefresh = setTimeout(() => {
    denseSketchInspectorRefresh = undefined;
    syncSketchToolUi();
    if (activeInspectorTab === "tool") renderActiveToolInspector();
  }, 500);
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
    if (event.data.type === "planar-face-frame" || event.data.type === "planar-face-frame-error") {
      const pending = pendingPlanarFaceFrameRequests.get(event.data.requestId);
      if (!pending) return;
      pendingPlanarFaceFrameRequests.delete(event.data.requestId);
      if (event.data.semanticHash !== adapter.checksum()) return;
      if (event.data.type === "planar-face-frame") {
        const authority = event.data.authority;
        if (authority.acceptedRevision !== pending.expectedAcceptedRevision || authority.bodyId !== pending.bodyId
          || authority.faceStableId !== pending.faceStableId || authority.producerFeatureId !== pending.expectedProducerFeatureId
          || authority.componentId !== pending.expectedComponentId) return;
        nativePlanarFaceAuthorities.set(planarFaceAuthorityKey(authority.bodyId, authority.faceStableId), authority);
        syncCommittedSketches();
        if (sketchSession?.support.kind === "topology" && sketchSession.support.reference === pending.topologyReferenceId) {
          resolveAndAlignSketchPlane(true);
          updateSketchStatus();
        }
      } else if (sketchSession?.support.kind === "topology" && sketchSession.support.reference === pending.topologyReferenceId) {
        activeSketchPlane = undefined;
        sketchChoosingSupport = false;
        sketchSolverStatus = `${event.data.diagnostic.field}: ${event.data.diagnostic.message}`;
        updateSketchToolInspectorState();
        renderSketchOverlay();
      }
      return;
    }
    if (event.data.type === "packet") {
      try {
        if (suppressedRepairCancelPacketHash === event.data.semanticHash) {
          suppressedRepairCancelPacketHash = undefined;
          lastAcceptedPacket = event.data;
          pendingAcceptedPacket = undefined;
          transferredBytes = event.data.transferredBytes;
          performanceEvidence.setTransferBytes(transferredBytes);
          return;
        }
        pendingAcceptedPacket = event.data;
        if (event.data.semanticHash === adapter.checksum()) installAcceptedRenderPacket(event.data);
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
        viewportState ??= renderer?.sharedViewportState();
        renderer = installOrReplaceWorkspacePacket(event.data.packet, { id: event.data.bodyId || acceptedBodyId, visible: true, selectable: false });
        renderer.setCutRemovalPreview(event.data.resultMode === "cut" ? event.data.removalPacket : undefined);
        acceptedCutPreviewBasis = event.data.resultMode === "cut"
          ? { semanticHash: event.data.semanticHash, baseRevision: event.data.baseRevision, requestId: event.data.requestId }
          : undefined;
        if (sketchChoosingSupport) renderer.setSketchSupportSelection(true, handleSketchSupportPick);
        else if (activeSketchPlane) renderer.alignToSketchPlane(activeSketchPlane);
        syncCommittedSketches();
        setExtrudeManipulatorValue(visibleExtrudeDistance(event.data.distanceNanometers, event.data.direction), event.data.direction);
        const operationState = document.querySelector<HTMLElement>("#operation-state")!;
        delete operationState.dataset.errorCode;
        delete operationState.dataset.errorCategory;
        delete operationState.dataset.errorField;
        delete operationState.dataset.errorReferences;
        operationState.setAttribute("data-preview-source", "worker-render-packet");
        operationState.dataset.resultMode = event.data.resultMode ?? "new_body";
        if (event.data.targetBodyId) {
          operationState.dataset.targetBodyId = event.data.targetBodyId;
          operationState.textContent = `Operation: Cut preview removes material from ${adapter.findBody(event.data.targetBodyId)?.name ?? event.data.targetBodyId}; the target body identity is retained.`;
        } else {
          delete operationState.dataset.targetBodyId;
        }
      } catch (error) { setReadiness("renderer", "error", error instanceof Error ? error.message : String(error)); }
    }
    if (event.data.type === "offset-construction-plane-preview") {
      const edit = activeOffsetConstructionPlane;
      if (!edit || event.data.requestId !== edit.requestId || event.data.requestId !== offsetConstructionPlaneRequest || state.operation.type !== "construction-plane") return;
      if (event.data.semanticHash !== adapter.checksum()) {
        edit.error = "The accepted document changed; cancel and reopen the plane command.";
        edit.previewReady = false;
      } else if (event.data.plane.suppressed !== edit.suppressed
        || (event.data.plane.suppressed ? event.data.frame !== null : event.data.frame === null)) {
        edit.error = "The construction-plane preview returned an inconsistent suppression frame.";
        edit.previewReady = false;
        edit.previewFrame = undefined;
      } else {
        edit.previewFrame = event.data.frame;
        edit.previewReady = true;
        edit.error = undefined;
      }
      syncConstructionPlaneDisplay();
      const status = document.querySelector<HTMLElement>("#construction-plane-status");
      if (status) status.textContent = edit.error ?? "Preview ready. Enter accepts; Escape cancels.";
      const apply = document.querySelector<HTMLButtonElement>("#apply-construction-plane");
      if (apply) apply.disabled = !edit.previewReady;
      document.querySelector("#operation-state")?.setAttribute("data-preview-source", "document-derived-frame");
    }
    if (event.data.type === "advanced-feature-preview") {
      if (event.data.requestId !== advancedFeaturePreviewRequest || selectedCatalogOperationId !== event.data.operationId || state.operation.type !== "advanced") return;
      try {
        installAdvancedPreviewPacket(event.data);
        advancedFeaturePreviewReady = true;
        const apply = document.querySelector<HTMLButtonElement>("#execute-advanced-feature");
        if (apply) apply.disabled = false;
        const status = document.querySelector<HTMLElement>("#operation-execution-status");
        if (status) status.textContent = `${activeAdvancedOperationLabel} non-mutating geometry preview ready. Apply commits this exact result; Cancel restores the accepted body.`;
        document.querySelector("#operation-state")!.setAttribute("data-preview-source", "worker-render-packet");
        if (advancedFeatureApplyAfterPreviewRequest === event.data.requestId) {
          advancedFeatureApplyAfterPreviewRequest = undefined;
          applyCatalogOperation();
        }
      } catch (error) { setReadiness("renderer", "error", error instanceof Error ? error.message : String(error)); }
    }
    if (event.data.type === "advanced-feature-preview-cancelled") {
      advancedFeaturePreviewReady = false;
      setOperation("cancelled", "advanced");
      const status = document.querySelector<HTMLElement>("#operation-execution-status");
      if (status) status.textContent = `${activeAdvancedOperationLabel} cancelled; the accepted document was unchanged.`;
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
        // Accepted feature payloads can be large. Keep one immutable parsed
        // value for adaptation, recovery, and persistence rather than cloning
        // and reparsing the complete history several times on the main thread.
        const documentJson = event.data.documentJson;
        const acceptedDocument = JSON.parse(documentJson) as { id: string };
        storage ??= await AppStorage.open();
        await importedSourcePersistence;
        if (!runtimeHydrated) {
          if (sessionRecoveryDocument) {
            runtimeHydrated = true; recoveryProvenance = "In-memory accepted runtime snapshot";
            worker?.postMessage({ type: "hydrate-document", documentJson: JSON.stringify(sessionRecoveryDocument) });
            return;
          }
          const result = await storage.initializeOrRecover(acceptedDocument, event.data.semanticHash);
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
        adapter = adapterFromWorkerSnapshot(event.data.documentJson, event.data.semanticHash, event.data.dimensionsJson, acceptedDocument);
        nativePlanarFaceAuthorities.clear();
        pendingPlanarFaceFrameRequests.clear();
        writeActiveDocumentId(acceptedDocument.id);
        if (pendingAcceptedPacket?.semanticHash === event.data.semanticHash) installAcceptedRenderPacket(pendingAcceptedPacket);
        await restoreImportedStepSources(acceptedDocument);
        currentParameters = event.data.parameters;
        if (!document.querySelector<HTMLElement>("#parameters-dialog")!.hidden) renderParametersDialog();
        if (renderer) renderer.setBodyContext(renderBodyContext(renderer.bodyId()));
        syncCommittedSketches();
        if (sketchSession?.support.kind === "topology") resolveAndAlignSketchPlane(true);
        if (state.selections.some((selection) => !adapter.selectionAllowed(selection.bodyId))) applySelection(null);
        const dimensions = JSON.parse(event.data.dimensionsJson) as { width_nanometers: number; height_nanometers: number; distance_nanometers: number } | null;
        hasBaseDimensions = dimensions !== null;
        currentDimensions = dimensions
          ? { widthNanometers: dimensions.width_nanometers, heightNanometers: dimensions.height_nanometers, distanceNanometers: dimensions.distance_nanometers }
          : { widthNanometers: 0, heightNanometers: 0, distanceNanometers: 0 };
        acceptedExtrudeDistanceNanometers = dimensions?.distance_nanometers ?? 0;
        document.querySelector<HTMLInputElement>("#part-width")!.value = dimensions ? String(dimensions.width_nanometers / 1_000_000) : "";
        document.querySelector<HTMLInputElement>("#part-height")!.value = dimensions ? String(dimensions.height_nanometers / 1_000_000) : "";
        document.querySelector<HTMLInputElement>("#pad-length")!.value = dimensions ? String(dimensions.distance_nanometers / 1_000_000) : "10";
        if (!adapter.findFeature(state.selectedFeatureId)) state.selectedFeatureId = "origin";
        updateBaseOperationAvailability();
        sessionRecoveryDocument = acceptedDocument;
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
          await storage.adoptPortableDocument(acceptedDocument, event.data.semanticHash, event.data.historyAction === "new" ? "new_document" : "open");
          runtimeHydrated = true;
          recoveryChoices = [];
          recoveryProvenance = event.data.historyAction === "open" ? "Opened portable part file" : "New canonical part";
          document.querySelector("#storage-status")!.textContent = event.data.historyAction === "open" ? "opened" : "new part";
        }
        if (event.data.historyAction === "undo" || event.data.historyAction === "redo") {
          const semanticHash = event.data.semanticHash;
          const historyAction = event.data.historyAction;
          const persistenceRevision = ++acceptedPersistenceRevision;
          const persistence = acceptedPersistence.then(() => persistAcceptedOffMainThread(documentJson, semanticHash, { action: historyAction }));
          acceptedPersistence = persistence;
          await persistence;
          if (persistenceRevision === acceptedPersistenceRevision) document.querySelector("#storage-status")!.textContent = lastExplicitSaveChecksum === adapter.checksum() ? "saved" : "autosaved";
        }
        if (event.data.transaction) {
          const committedOperationType = state.operation.type;
          performanceEvidence.finishRecompute();
          const transaction = event.data.transaction;
          const committedPadTransaction = committedOperationType === "pad" && (
            activeSketchExtrudeSource
              ? transaction.id === activeSketchExtrudeSource.transactionId
              : transaction.changes.some((change) => change.kind === "set_parameter_value" && change.parameter === "parameter:distance")
          );
          const semanticHash = event.data.semanticHash;
          const persistenceRevision = ++acceptedPersistenceRevision;
          const persistence = acceptedPersistence.then(() => persistAcceptedOffMainThread(documentJson, semanticHash, { transaction }));
          acceptedPersistence = persistence;
          await persistence;
          recordPersistedOperationHash(event.data.semanticHash);
          if (committedPadTransaction) notifyOnboardingAction("commit-extrude");
          if (state.operation.status === "preview" && (state.operation.type === "rectangle" || committedPadTransaction)) setOperation("committed");
          if (committedPadTransaction) {
            activeSketchExtrudeSource = undefined;
            acceptedExtrudeResultMode = "new_body";
            syncExtrudeResultControls("new_body");
          }
          if (committedPadTransaction || committedOperationType === "rectangle") document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
          if (persistenceRevision === acceptedPersistenceRevision) document.querySelector("#storage-status")!.textContent = lastExplicitSaveChecksum === adapter.checksum() ? "saved" : "autosaved";
        }
      } catch (error) { storageFailure(error); }
    }
    if (event.data.type === "offset-construction-plane-completed") {
      const edit = activeOffsetConstructionPlane;
      if (!edit || event.data.requestId !== edit.requestId || event.data.semanticHash !== adapter.checksum()) return;
      selectedConstructionPlaneId = event.data.plane.id;
      if (event.data.plane.suppressed) {
        if (selectedSketchSupport?.kind === "construction_plane_reference" && selectedSketchSupport.plane === event.data.plane.id) {
          selectedSketchSupport = undefined;
        }
        if (selectedSketchProfile) {
          const selectedProfileSketch = hydrateSketchFromDocument(adapter.durableDocument(), selectedSketchProfile.sketchId);
          if (selectedProfileSketch?.support.kind === "construction_plane_reference" && selectedProfileSketch.support.plane === event.data.plane.id) {
            selectedSketchProfile = undefined;
          }
        }
      } else {
        selectedSketchSupport = { kind: "construction_plane_reference", plane: event.data.plane.id };
      }
      activeOffsetConstructionPlane = undefined;
      setOperation("committed", "construction-plane");
      renderDocument();
    }
    if (event.data.type === "error") handleRuntimeFault(event.data.message);
    if (event.data.type === "operation-error") {
      if (event.data.operationId && event.data.requestId !== undefined && event.data.requestId !== advancedFeaturePreviewRequest) return;
      const detail = `${event.data.field ? `${event.data.field}: ` : ""}${event.data.message}${event.data.recovery ? ` — ${event.data.recovery}` : ""}`;
      if (event.data.code === "topology_rebind_preview_refused" || event.data.code === "topology_rebind_commit_refused") {
        if (typeof event.data.requestId === "string" && topologyRebindPreview?.requestId !== event.data.requestId) return;
        topologyRebindPreview = undefined;
        historyActionMessage = `Repair stopped: ${detail}`;
        worker?.postMessage({ type: "restore-accepted-packet" });
        renderInspector();
      } else if (isConstructionPlaneRuntimeErrorCode(event.data.code) && event.data.field?.startsWith("construction_plane.")) {
        const edit = activeOffsetConstructionPlane;
        if (!edit || event.data.requestId !== edit.requestId) return;
        edit.previewReady = false;
        edit.previewFrame = undefined;
        edit.error = detail;
        syncConstructionPlaneDisplay();
        const status = document.querySelector<HTMLElement>("#construction-plane-status");
        if (status) {
          status.textContent = detail;
          status.dataset.errorField = event.data.field ?? "";
          status.dataset.errorReferences = JSON.stringify(event.data.referencedEntityIds ?? []);
        }
        const apply = document.querySelector<HTMLButtonElement>("#apply-construction-plane");
        if (apply) apply.disabled = true;
      } else if (event.data.field?.startsWith("planar_face.") && state.operation.type === "sketch") {
        activeSketchPlane = undefined;
        sketchChoosingSupport = false;
        renderer?.setSketchSupportSelection(false);
        sketchSolverStatus = detail;
        renderSketchOverlay();
        updateSketchToolInspectorState();
      } else if (event.data.code.startsWith("extrude_") || isExtrudeCutErrorCode(event.data.code) || isConstructionPlaneSupportRuntimeErrorCode(event.data.code)
        || (event.data.field?.startsWith("planar_face.") && state.operation.type === "pad")) {
        setOperation("cancelled");
        acceptedCutPreviewBasis = undefined;
        activeSketchExtrudeSource = undefined;
        document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
        const operationState = document.querySelector<HTMLElement>("#operation-state")!;
        operationState.textContent = `Operation: Extrude stopped — ${detail}`;
        operationState.dataset.errorCode = event.data.code;
        operationState.dataset.errorCategory = event.data.category ?? "";
        operationState.dataset.errorField = event.data.field ?? "";
        operationState.dataset.errorReferences = JSON.stringify(event.data.referencedEntityIds ?? []);
        // Support preflight fails before a candidate packet exists. Keep the
        // last accepted display rather than replacing it with the currently
        // unevaluable accepted-history packet for the suppressed dependency.
        if (!isConstructionPlaneSupportRuntimeErrorCode(event.data.code)) {
          worker?.postMessage({ type: "restore-accepted-packet" });
        }
      } else if (event.data.operationId) {
        advancedFeatureApplyAfterPreviewRequest = undefined;
        advancedFeaturePreviewReady = false;
        const apply = document.querySelector<HTMLButtonElement>("#execute-advanced-feature");
        if (apply) apply.disabled = true;
        worker?.postMessage({ type: "restore-accepted-packet" });
        document.querySelector<HTMLElement>("#operation-execution-status")?.setAttribute("data-error-field", event.data.field ?? "");
        const status = document.querySelector<HTMLElement>("#operation-execution-status");
        if (status) status.textContent = explainAdvancedFeatureError(activeAdvancedOperationLabel, event.data.message, event.data.recovery);
        if (event.data.field?.startsWith("parameters.")) {
          document.querySelector(`[data-operation-parameter="${CSS.escape(event.data.field.slice("parameters.".length))}"]`)?.setAttribute("aria-invalid", "true");
        }
      } else if (event.data.code === "group_features" || event.data.code === "reorder_feature") {
        setOperation("cancelled");
        historyActionMessage = `${event.data.code.replaceAll("_", " ")} blocked: ${detail}`;
        renderInspector();
      } else if (stepImportRunning || state.operation.type === "step-import") {
        stepImportRunning = false;
        stepSourceRetained = true;
        updateStepImportControls();
        setOperation("failed", "step-import");
        const operationState = document.querySelector("#operation-state")!;
        operationState.textContent = `Operation: STEP import failed — ${detail}`;
        operationState.setAttribute("data-status", "failed");
        document.querySelector("#import-status")!.textContent = `${event.data.code}: ${detail}`;
        showActionError("STEP import", `${event.data.code}: ${detail}`);
      } else {
        setOperation("cancelled");
        document.querySelector("#import-status")!.textContent = `${event.data.code}: ${detail}`;
      }
    }
    if (event.data.type === "parameter-error") {
      setOperation("cancelled", "parameter");
      const input = document.querySelector<HTMLInputElement>(`[data-parameter-expression][data-field="${CSS.escape(event.data.diagnostic.field)}"], [data-dialog-expression][data-field="${CSS.escape(event.data.diagnostic.field)}"]`);
      input?.setAttribute("aria-invalid", "true");
      const cycle = event.data.diagnostic.cycle?.length ? ` Dependency path: ${event.data.diagnostic.cycle.join(" → ")}.` : "";
      currentParameterErrors.set(event.data.diagnostic.field, `${event.data.diagnostic.message}${cycle}`);
      const output = document.querySelector<HTMLElement>(`[data-parameter-error="${CSS.escape(event.data.diagnostic.field)}"]`);
      if (output) { output.textContent = `${event.data.diagnostic.message}${cycle}`; output.hidden = false; }
      const description = input?.closest(".dialog-parameter-row")?.querySelector<HTMLElement>(".parameter-description");
      if (description) { description.textContent = `${event.data.diagnostic.message}${cycle}`; description.classList.add("error"); }
      input?.focus();
    }
    if (event.data.type === "parameter-action-completed") completeOperationAfterPersistence("parameter", event.data.semanticHash);
    if (event.data.type === "advanced-feature-completed") {
      advancedFeaturePreviewReady = false;
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
    if (event.data.type === "topology-rebind-preview") {
      const preview = topologyRebindPreview;
      if (!preview || preview.requestId !== event.data.requestId || preview.selected !== event.data.selected
        || event.data.semanticHash !== adapter.checksum() || event.data.baseDocumentHash !== event.data.semanticHash) return;
      topologyRebindPreview = {
        ...preview,
        phase: "ready",
        baseDocumentHash: event.data.baseDocumentHash,
        baseRevision: event.data.baseRevision,
        candidateFrame: event.data.candidateFrame,
      };
      transferredBytes = event.data.transferredBytes;
      performanceEvidence.setTransferBytes(transferredBytes);
      currentBounds = Array.from(event.data.packet.bounds);
      viewportState ??= renderer?.sharedViewportState();
      renderer = installOrReplaceWorkspacePacket(event.data.packet, { id: event.data.bodyId, visible: true, selectable: false });
      syncCommittedSketches();
      renderInspector();
    }
    if (event.data.type === "topology-rebind-preview-cancelled") {
      if (topologyRebindPreview?.requestId === event.data.requestId) topologyRebindPreview = undefined;
      renderInspector();
    }
    if (event.data.type === "recompute-from-here") {
      lastRecomputeOutcome = structuredClone(event.data);
      lastRecompute = { dirtyRoots: [event.data.plan.requested_from], evaluationOrder: [...event.data.plan.evaluation_order] };
      historyActionMessage = event.data.accepted
        ? `Recomputed ${event.data.plan.evaluation_order.join(" → ") || "cached result"}`
        : `Recompute blocked: ${event.data.error?.message ?? "feature execution was refused"}`;
      document.querySelector("#timeline-status")!.textContent = historyActionMessage;
      renderInspector();
    }
    if (event.data.type === "repair-committed") {
      topologyRebindPreview = undefined;
      historyActionMessage = `Rebound explicitly to ${event.data.selected}; undo is available.`;
      document.querySelector("#timeline-status")!.textContent = historyActionMessage;
      requestFeatureServices();
    }
    if (event.data.type === "export") {
      const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
      const mediaType = event.data.format === "step" ? "model/step" : event.data.format === "stl" ? "model/stl" : "model/obj";
      const url = URL.createObjectURL(new Blob([event.data.content], { type: mediaType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${base}.${event.data.format}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    if (event.data.type === "export-error") {
      showActionError(`Export ${event.data.format.toUpperCase()}`, event.data.message);
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
  worker.postMessage({
    type: "initialize",
    fail: startupFailurePending,
    qualificationReferencePart,
    initialDocumentId: qualificationReferencePart ? undefined : readActiveDocumentId(),
  });
  startupFailurePending = false;
}

function setOperation(status: typeof state.operation.status, type: "rectangle" | "sketch" | "pad" | "step-import" | "advanced" | "parameter" | "construction-plane" | null = state.operation.type): void {
  if (status === "preview" || status === "idle" || status === "cancelled" || status === "failed") pendingOperationCompletion = undefined;
  state.operation.status = status;
  state.operation.type = status === "idle" || status === "cancelled" || status === "failed" ? null : type;
  const operationName = type === "rectangle" ? rectangleOperation.label : type === "sketch" ? activeSketchOperationLabel : type === "step-import" ? "STEP import" : type === "pad" ? extrudeOperation.label : type === "advanced" ? activeAdvancedOperationLabel : type === "parameter" ? activeParameterLabel : type === "construction-plane" ? "Offset plane" : "Document change";
  const labels = { idle: "Operation: idle", preview: type === "step-import" ? "Operation: STEP import running — Cancel import stops the worker" : type === "sketch" ? `Operation: ${operationName} active — Escape backs out one level` : `Operation: ${operationName} preview — Enter commits, Escape cancels`, committed: `Operation: ${operationName} committed`, cancelled: "Operation: cancelled", failed: `Operation: ${operationName} failed` };
  document.querySelector("#operation-state")!.textContent = labels[status];
  document.querySelector("#operation-state")!.setAttribute("data-status", status);
  const operationInput = document.querySelector<HTMLElement>(".dimension-panel")!;
  const inputType = status === "preview" && (type === "rectangle" || type === "pad") ? type : "idle";
  operationInput.dataset.operation = inputType;
  operationInput.setAttribute("aria-hidden", String(inputType === "idle"));
  // A base operation may be invoked from command search while another
  // workbench is selected. Its active dimensions must remain available.
  operationInput.hidden = inputType === "idle" && activeWorkbench !== "Part Design";
  if ((status === "committed" || status === "cancelled" || status === "failed" || status === "idle") && activeToolContext) deactivateToolContext();
  else if (status === "preview" && type !== "advanced" && activeInspectorTab === "tool" && activeToolContext) renderInspector();
}

function selectedExtrudeDirection(): ExtrudeDirection {
  const value = document.querySelector<HTMLSelectElement>("#extrude-direction-mode")!.value;
  return value === "negative" || value === "symmetric" ? value : "positive";
}

function setExtrudeDirectionUi(direction: ExtrudeDirection): void {
  const selector = document.querySelector<HTMLSelectElement>("#extrude-direction-mode")!;
  selector.value = direction;
  const symmetric = direction === "symmetric";
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  input.min = symmetric ? "0.002" : "0.001";
  input.setAttribute("aria-label", symmetric ? "Extrude total length in millimeters" : "Extrude distance in millimeters");
  document.querySelector("#extrude-distance-label")!.textContent = symmetric ? "Total length" : "Distance";
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.dataset.direction = direction;
  handle.setAttribute("aria-label", symmetric ? "Extrude symmetric total length" : direction === "negative" ? "Extrude reverse distance" : "Extrude forward distance");
}

function normalizedExtrudeField(): ReturnType<typeof normalizeExtrudeDistance> {
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  if (!Number.isFinite(input.valueAsNumber)) return undefined;
  const requestedVisibleNanometers = Math.round(input.valueAsNumber * 1_000_000);
  const normalized = normalizeExtrudeDistance(requestedVisibleNanometers, selectedExtrudeDirection());
  const status = document.querySelector<HTMLElement>("#extrude-normalization-status")!;
  if (!normalized) {
    status.textContent = "";
    return undefined;
  }
  if (normalized.normalized) {
    input.value = String(normalized.visibleNanometers / 1_000_000);
    status.textContent = `Symmetric total normalized to ${normalized.visibleNanometers / 1_000_000} mm so both sides remain exact.`;
  } else {
    status.textContent = "";
  }
  return normalized;
}

function setExtrudeManipulatorValue(valueNanometers: number, direction = selectedExtrudeDirection()): void {
  const millimeters = valueNanometers / 1_000_000;
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.setAttribute("aria-valuenow", String(millimeters));
  const mode = direction === "symmetric" ? "total · Symmetric" : direction === "negative" ? "· Reverse" : "· Forward";
  handle.setAttribute("aria-valuetext", `${Number(millimeters.toFixed(6))} millimeters ${direction}`);
  handle.querySelector("output")!.textContent = `${Number(millimeters.toFixed(6))} mm ${mode}`;
}

function resolveRetainedSketchProfile(sketch: Sketch): string[] | undefined {
  if (!selectedSketchProfile || selectedSketchProfile.sketchId !== sketch.id) return undefined;
  const match = closedProfileGeometryIds(sketch).find((geometryIds) => sketchProfileId(sketch.id, geometryIds) === selectedSketchProfile!.profileId);
  if (!match) {
    sketchProfileRepairMessage = "The selected profile is no longer closed. Edit the sketch and select a closed region again.";
    return undefined;
  }
  selectedSketchProfile = { ...selectedSketchProfile, geometryIds: [...match] };
  sketchProfileRepairMessage = undefined;
  return match;
}

function selectedSketchExtrudeProfile(): { sketch: Sketch; support: SketchSupport; profileGeometryIds?: readonly string[]; featureId: string } | undefined {
  const sketches = adapter.getSnapshot().components.flatMap((component) => component.sketches);
  if (selectedSketchProfile) {
    const summary = sketches.find((candidate) => candidate.id === selectedSketchProfile!.sketchId);
    const hydrated = summary ? hydrateSketchFromDocument(adapter.durableDocument(), summary.id) : undefined;
    if (!hydrated || !summary?.featureId) {
      sketchProfileRepairMessage = "The selected profile's sketch is unavailable. Select a closed region again.";
      return undefined;
    }
    const profileGeometryIds = resolveRetainedSketchProfile(hydrated.sketch);
    return profileGeometryIds ? { sketch: hydrated.sketch, support: hydrated.support, profileGeometryIds, featureId: summary.featureId } : undefined;
  }
  const ordered = [
    ...sketches.filter((sketch) => sketch.id === selectedSketchId),
    ...sketches.filter((sketch) => sketch.featureId === state.selectedFeatureId),
    ...sketches,
  ];
  const seen = new Set<string>();
  const matches = ordered.flatMap((summary) => {
    if (seen.has(summary.id)) return [];
    seen.add(summary.id);
    const hydrated = hydrateSketchFromDocument(adapter.durableDocument(), summary.id);
    if (!hydrated || !summary.featureId) return [];
    const profiles = closedProfileGeometryIds(hydrated.sketch);
    return profiles.length === 1
      ? [{ sketch: hydrated.sketch, support: hydrated.support, profileGeometryIds: profiles[0], featureId: summary.featureId }]
      : [];
  });
  const selected = matches.find((candidate) => candidate.sketch.id === selectedSketchId || candidate.featureId === state.selectedFeatureId);
  return selected ?? (matches.length === 1 ? matches[0] : undefined);
}

interface AcceptedSketchFeatureSource {
  sketch: Sketch;
  support: SketchSupport;
  featureId: string;
  name: string;
  profileGeometryIds?: readonly string[];
}

function acceptedSketchFeatureSources(profileOnly = false): AcceptedSketchFeatureSource[] {
  return adapter.getSnapshot().components.flatMap((component) => component.sketches).flatMap((summary) => {
    const hydrated = hydrateSketchFromDocument(adapter.durableDocument(), summary.id);
    if (!hydrated || !summary.featureId) return [];
    const retainedIds = resolveRetainedSketchProfile(hydrated.sketch);
    if (profileOnly && selectedSketchProfile?.sketchId === summary.id && !retainedIds) return [];
    if (profileOnly && !retainedIds && closedProfileGeometryIds(hydrated.sketch).length !== 1) return [];
    return [{ sketch: hydrated.sketch, support: hydrated.support, featureId: summary.featureId, name: summary.name, ...(retainedIds ? { profileGeometryIds: retainedIds } : {}) }];
  });
}

function sketchSourceOptions(sources: readonly AcceptedSketchFeatureSource[], multiple = false): string {
  return sources.map((source) => `<option value="${escapeHtml(source.sketch.id)}" ${source.sketch.id === selectedSketchId || (multiple && !selectedSketchId) ? "selected" : ""}>${escapeHtml(source.name)} · ${escapeHtml(source.sketch.id)}</option>`).join("");
}

function updateBaseOperationAvailability(): void {
  const ready = modelingRuntimeReady();
  let canExtrude = hasBaseDimensions || Boolean(activeSketchExtrudeSource);
  if (!canExtrude) {
    try { canExtrude = Boolean(selectedSketchExtrudeProfile()); } catch { canExtrude = false; }
  }
  for (const selector of ["#start-rectangle", "#part-width", "#part-height"]) document.querySelector<HTMLButtonElement | HTMLInputElement>(selector)!.disabled = !ready || !hasBaseDimensions;
  for (const selector of ["#start-pad", "#pad-length"]) document.querySelector<HTMLButtonElement | HTMLInputElement>(selector)!.disabled = !ready || !canExtrude;
  const plane = document.querySelector<HTMLButtonElement>("#create-offset-plane");
  if (plane) plane.disabled = !ready;
  const direction = document.querySelector<HTMLSelectElement>("#extrude-direction-mode")!;
  const baseDimensionExtrude = hasBaseDimensions && !activeSketchExtrudeSource;
  direction.disabled = !ready || !canExtrude || baseDimensionExtrude;
  if (baseDimensionExtrude) setExtrudeDirectionUi("positive");
  syncExtrudeResultControls(activeSketchExtrudeSource?.resultMode ?? acceptedExtrudeResultMode);
  const extrude = document.querySelector<HTMLButtonElement>("#start-pad");
  if (extrude) extrude.title = sketchProfileRepairMessage ?? (canExtrude ? "Extrude the selected closed profile" : "Select one closed sketch profile");
}

function requestExtrudePreview(valueNanometers: number): void {
  if (!worker || state.operation.status !== "preview" || state.operation.type !== "pad" || !Number.isSafeInteger(valueNanometers) || valueNanometers <= 0) return;
  if (!applyExtrudeResultSelection()) return;
  const direction = selectedExtrudeDirection();
  const normalized = normalizeExtrudeDistance(valueNanometers, direction);
  if (!normalized) return;
  if (normalized.normalized) {
    document.querySelector<HTMLInputElement>("#pad-length")!.value = String(normalized.visibleNanometers / 1_000_000);
    document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = `Symmetric total normalized to ${normalized.visibleNanometers / 1_000_000} mm so both sides remain exact.`;
  }
  const requestId = ++extrudePreviewRequest;
  latestExtrudePreviewRequest = requestId;
  acceptedCutPreviewBasis = undefined;
  extrudePreviewStarted.set(requestId, performance.now());
  setExtrudeManipulatorValue(normalized.visibleNanometers, direction);
  worker.postMessage({ type: "preview-extrude", requestId, valueNanometers: normalized.durableNanometers, direction, ...(activeSketchExtrudeSource ? { source: activeSketchExtrudeSource } : {}) });
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
  const normalized = normalizedExtrudeField();
  if (normalized) requestExtrudePreview(normalized.visibleNanometers);
}

function beginExtrudeFeatureEdit(featureId: string): void {
  type DurableExtrudeDefinition = {
    operation?: { kind?: string; profile?: { kind?: string; sketch?: string; region?: string }; extent?: { kind?: string; distance?: string; direction?: string } };
    result?: { mode?: string; body?: string };
    participant_bodies?: readonly { role?: string; body?: string }[];
  };
  type DurableRegion = { sketch?: string; outer_geometry_ids?: readonly string[] };
  type DurableParameter = { value?: { kind?: string; value?: number } };
  const durable = adapter.durableDocument() as {
    feature_definitions_v2?: Record<string, DurableExtrudeDefinition>;
    region_definitions_v2?: Record<string, DurableRegion>;
    parameters?: Record<string, DurableParameter>;
  };
  const definition = durable.feature_definitions_v2?.[featureId];
  const profile = definition?.operation?.profile;
  const extent = definition?.operation?.extent;
  let retained: { mode: ExtrudeResultMode; bodyId: string };
  try { retained = retainedExtrudeBody(definition ?? {}); }
  catch {
    showActionError("Edit Extrude", "This feature does not retain one exact Extrude result body.");
    return;
  }
  if (definition?.operation?.kind !== "extrude" || profile?.kind !== "sketch_region" || !profile.sketch || !profile.region || extent?.kind !== "blind" || !extent.distance) {
    showActionError("Edit Extrude", "This feature does not contain a complete Extrude V2 definition.");
    return;
  }
  const hydrated = hydrateSketchFromDocument(adapter.durableDocument(), profile.sketch);
  const region = durable.region_definitions_v2?.[profile.region];
  const retainedProfileGeometryIds = [...(region?.outer_geometry_ids ?? [])];
  const selectedReplacement = selectedSketchProfile ? selectedSketchExtrudeProfile() : undefined;
  const sketchPlaneDocument = adapter.durableDocument() as SketchPlaneDocument;
  const storedSupportResolution = hydrated
    ? resolveSketchPlane(hydrated.support, sketchPlaneDocument, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities)
    : undefined;
  const selectedSupportResolution = selectedReplacement
    ? resolveSketchPlane(selectedReplacement.support, sketchPlaneDocument, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities)
    : undefined;
  const explicitlySelectedReplacement = selectedReplacement
    && hydrated
    && selectedReplacement.sketch.id === profile.sketch
    && storedSupportResolution?.status === "ready"
    && selectedSupportResolution?.status === "ready"
    && resolvedSketchPlanesEqual(storedSupportResolution.plane, selectedSupportResolution.plane)
    ? selectedReplacement
    : undefined;
  if (selectedSketchProfile && !explicitlySelectedReplacement) {
    showActionError("Edit Extrude", "The selected replacement profile must belong to this Extrude's source sketch and resolved support.");
    return;
  }
  const value = durable.parameters?.[extent.distance]?.value;
  if ((!hydrated || !retainedProfileGeometryIds.length) && !explicitlySelectedReplacement) {
    showActionError("Edit Extrude", "The stored profile region cannot be resolved. Select a replacement closed region, then edit the feature again.");
    return;
  }
  if (value?.kind !== "length_nanometers" || typeof value.value !== "number" || value.value <= 0) {
    showActionError("Edit Extrude", "The stored profile region or distance cannot be resolved. Repair the feature references first.");
    return;
  }
  const direction: ExtrudeDirection = extent.direction === "negative" || extent.direction === "symmetric" ? extent.direction : "positive";
  acceptedExtrudeDirection = direction;
  acceptedExtrudeResultMode = retained.mode;
  acceptedExtrudeDistanceNanometers = visibleExtrudeDistance(value.value, direction);
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  input.value = String(acceptedExtrudeDistanceNanometers / 1_000_000);
  setExtrudeDirectionUi(direction);
  const source = explicitlySelectedReplacement ?? {
    sketch: hydrated!.sketch,
    support: hydrated!.support,
    profileGeometryIds: retainedProfileGeometryIds,
  };
  activeSketchExtrudeSource = {
    sketch: source.sketch,
    support: source.support,
    profileGeometryIds: source.profileGeometryIds,
    featureId,
    bodyId: retained.bodyId,
    newBodyId: retained.bodyId,
    resultMode: retained.mode,
    ...(retained.mode === "cut" ? { targetBodyId: retained.bodyId } : {}),
    transactionId: `transaction:${crypto.randomUUID()}:edit-extrude`,
    editing: true,
  };
  if (activeWorkbench !== "Part Design") setActiveWorkbench("Part Design");
  setOperation("preview", "pad");
  syncExtrudeResultControls(retained.mode);
  updateBaseOperationAvailability();
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.hidden = false;
  // A valid stored extent can reuse the accepted packet, but an unresolved
  // support must still cross the real runtime preview boundary so the editor
  // receives the stable, field-addressed repair diagnostic immediately.
  if (storedSupportResolution?.status !== "ready" || retained.mode === "cut") {
    requestExtrudePreview(acceptedExtrudeDistanceNanometers);
  }
  // For a resolved support, the accepted packet already represents the stored
  // extent. Defer kernel work until the user changes the distance so the first
  // measured edit is never queued behind a redundant preview.
  input.focus();
  input.select();
}

function beginExtrudePreview(initialResultMode: ExtrudeResultMode = "new_body"): void {
  const fieldNanometers = Math.round(document.querySelector<HTMLInputElement>("#pad-length")!.valueAsNumber * 1_000_000);
  acceptedExtrudeDirection = "positive";
  acceptedExtrudeResultMode = initialResultMode;
  acceptedCutPreviewBasis = undefined;
  setExtrudeDirectionUi("positive");
  // An explicitly selected closed sketch profile wins over the legacy
  // reference-part dimensions. Otherwise a face-supported sketch on an
  // existing body could only edit the seed Extrude and could never create its
  // own V2 feature.
  const selectedProfile = selectedSketchExtrudeProfile();
  acceptedExtrudeDistanceNanometers = selectedProfile ? fieldNanometers : hasBaseDimensions ? currentDimensions.distanceNanometers : fieldNanometers;
  const newBodyId = `body:extrude:${crypto.randomUUID()}`;
  activeSketchExtrudeSource = selectedProfile ? {
    ...selectedProfile,
    featureId: `feature:extrude:${crypto.randomUUID()}`,
    bodyId: newBodyId,
    newBodyId,
    resultMode: initialResultMode,
    transactionId: `transaction:${crypto.randomUUID()}:extrude`,
  } : undefined;
  if (!hasBaseDimensions && !activeSketchExtrudeSource) return;
  if (activeWorkbench !== "Part Design") setActiveWorkbench("Part Design");
  setOperation("preview", "pad");
  syncExtrudeResultControls(initialResultMode);
  notifyOnboardingAction("start-extrude");
  const handle = document.querySelector<HTMLButtonElement>("#extrude-manipulator")!;
  handle.hidden = false;
  updateExtrudePreviewFromField();
}

function commitExtrudePreview(): void {
  const normalized = normalizedExtrudeField();
  if (!normalized) return;
  if (!applyExtrudeResultSelection()) return;
  const direction = selectedExtrudeDirection();
  const cutBasis = activeSketchExtrudeSource?.resultMode === "cut" ? acceptedCutPreviewBasis : undefined;
  if (activeSketchExtrudeSource?.resultMode === "cut" && !cutBasis) {
    document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = "Wait for the Cut preview to finish before applying.";
    return;
  }
  document.querySelector<HTMLButtonElement>("#extrude-manipulator")!.hidden = true;
  latestExtrudePreviewRequest = ++extrudePreviewRequest;
  performanceEvidence.beginRecompute();
  worker?.postMessage({
    type: "commit-pad",
    valueNanometers: normalized.durableNanometers,
    direction,
    ...(activeSketchExtrudeSource ? { source: activeSketchExtrudeSource } : {}),
    ...(cutBasis ? { baseDocumentHash: cutBasis.semanticHash, baseRevision: cutBasis.baseRevision } : {}),
  });
}

function cancelExtrudePreview(): void {
  latestExtrudePreviewRequest = ++extrudePreviewRequest;
  extrudePreviewStarted.clear();
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  input.value = String(acceptedExtrudeDistanceNanometers / 1_000_000);
  setExtrudeDirectionUi(acceptedExtrudeDirection);
  acceptedExtrudeResultMode = "new_body";
  acceptedCutPreviewBasis = undefined;
  activeSketchExtrudeSource = undefined;
  syncExtrudeResultControls(acceptedExtrudeResultMode);
  document.querySelector<HTMLElement>("#extrude-normalization-status")!.textContent = "";
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

function startSketchEdit(tool?: SketchTool, operationLabel?: string): void {
  if (!sketchBridge) return;
  const requestedTool: SketchTool = tool ?? "line";
  const hasExplicitTool = Boolean(tool);
  sketchPreviousView ??= renderer?.captureView();
  sketchPreviousWorkbench ??= activeWorkbench;
  sketchReturnFocus = document.activeElement as HTMLElement;
  const allSketches = adapter.getSnapshot().components.flatMap((component) => component.sketches);
  const selectedSketch = allSketches.find((sketch) => sketch.id === selectedSketchId)
    ?? allSketches.find((sketch) => sketch.featureId === state.selectedFeatureId);
  const hydrated = selectedSketch ? hydrateSketchFromDocument(adapter.durableDocument(), selectedSketch.id) : undefined;
  if (!hydrated || selectedSketchProfile?.sketchId !== hydrated.sketch.id) {
    selectedSketchProfile = undefined;
    selectedSketchConstructionAxis = undefined;
    sketchProfileRepairMessage = undefined;
  }
  if (hydrated) {
    hiddenCommittedSketchIds.delete(hydrated.sketch.id);
    persistCommittedSketchVisibility();
  }
  const topologySelection = topologySupportFromSelection();
  const support = selectedSketchSupport ?? topologySelection?.support ?? (selectedSketch ? hydrated?.support : undefined);
  selectedSketchSupport = undefined;
  sketchSession = new SketchEditSession(
    hydrated?.sketch ?? { id: `sketch:${crypto.randomUUID()}`, revision: 0, geometry: {}, constraints: {} },
    support ?? originPlaneSupport("xy"),
    sketchBridge,
    topologySelection?.reference,
  );
  sketchAutoConstraintAudit = [];
  const diagnosticsSession = sketchSession;
  diagnosticsSession.setDiagnosticsChangedListener(() => {
    if (sketchSession !== diagnosticsSession) return;
    if (sketchDiagnosticsRenderFrame !== undefined) return;
    sketchDiagnosticsRenderFrame = requestAnimationFrame(() => {
      sketchDiagnosticsRenderFrame = undefined;
      if (sketchSession !== diagnosticsSession) return;
      updateSketchStatus();
      renderSketchOverlay();
    });
  });
  sketchChoosingSupport = !support;
  activeSketchPlane = undefined;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchPlacementGesture = undefined;
  sketchHoverSnap = undefined;
  selectedSketchConstraint = undefined;
  selectedSketchGeometry = [];
  selectedSketchPoints = [];
  sketchOriginSelected = false;
  selectedSketchSegments = [];
  pendingSketchConstraint = undefined;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchConstraintApplying = false;
  sketchPaletteExpanded = false;
  sketchToolArmed = Boolean(support && hasExplicitTool);
  sketchConstruction = requestedTool === "construction";
  sketchSession.activeTool = requestedTool === "construction" ? "line" : requestedTool;
  syncCommittedSketches();
  activeSketchOperationLabel = operationLabel ?? (hasExplicitTool ? SKETCH_TOOL_SCHEMA.find((entry) => entry.id === requestedTool)?.label : undefined) ?? "Sketch";
  sketchHoverPoint = undefined;
  sketchSolverStatus = "Under-constrained · click the plane to draw";
  sketchProfileStatus = "Profile: empty";
  sketchLastDrag = undefined;
  document.querySelector<HTMLElement>(".workspace")!.classList.add("sketch-active");
  syncEmptyDocumentActions();
  setActiveWorkbench("Sketcher");
  activateToolContext(hasExplicitTool
    ? { key: requestedTool, label: activeSketchOperationLabel, source: "sketch" }
    : { key: "sketch-select", label: "Select", source: "sketch" });
  if (support) resolveAndAlignSketchPlane(); else beginSketchSupportSelection(false);
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => {
    const selected = button.dataset.sketchTool;
    button.setAttribute("aria-pressed", String(hasExplicitTool && (selected === sketchSession?.activeTool || (selected === "construction" && sketchConstruction))));
  });
  setOperation("preview", "sketch");
  setSketchToolPhase(hasExplicitTool ? "collecting" : "idle");
  updateSketchStatus();
  if (hydrated) {
    const openingSession = sketchSession;
    void openingSession.initialize().then(() => {
      if (sketchSession !== openingSession) return;
      updateSketchStatus();
      if (activeInspectorTab === "tool") renderActiveToolInspector();
    }).catch((error) => {
      if (sketchSession !== openingSession) return;
      sketchSolverStatus = `Sketch state could not be initialized: ${error instanceof Error ? error.message : String(error)}`;
      updateSketchToolInspectorState();
    });
  }
  if (hasExplicitTool) document.querySelector<HTMLButtonElement>(`[data-sketch-tool="${CSS.escape(requestedTool)}"]`)?.focus();
  else if (support) document.querySelector<HTMLButtonElement>("#sketch-select-tool")?.focus();
  else document.querySelector<HTMLCanvasElement>("#viewport")?.focus();
}

function topologySupportFromSelection(selection: Selection | null = state.selection): { support: SketchSupport; reference?: SketchTopologyReference } | undefined {
  if (selection?.kind !== "face") return undefined;
  const documentValue = adapter.durableDocument() as SketchPlaneDocument;
  const reference = Object.entries(documentValue.topology_references ?? {})
    .find(([, candidate]) => candidate.kind === "face"
      && candidate.body === selection.bodyId
      && String(candidate.stable_kernel_id) === selection.stableId);
  if (reference) return { support: { kind: "topology", reference: reference[1].id ?? reference[0] } };
  const evidence = renderer?.planarFaceEvidence(selection);
  const body = documentValue.bodies?.[selection.bodyId];
  if (!evidence || !body?.generated_by || !body.component) return undefined;
  const id = `topology:sketch-face:${selection.bodyId}:${selection.stableId}`;
  const created: SketchTopologyReference = {
    schema_version: 1,
    id,
    component: body.component,
    body: body.id ?? selection.bodyId,
    producer: body.generated_by,
    kind: "face",
    stable_kernel_id: selection.stableId,
    stable_token: `sketch-face:${selection.stableId}`,
    fallback_signature: { kind: "face", ...evidence },
  };
  return { support: { kind: "topology", reference: id }, reference: created };
}

function handleSketchSupportPick(pick: SketchSupportPick): void {
  if (!sketchSession || !sketchChoosingSupport) return;
  const resolved = pick.kind === "origin_plane"
    ? { support: originPlaneSupport(pick.plane) }
    : pick.kind === "construction_plane"
      ? { support: { kind: "construction_plane_reference", plane: pick.plane } as SketchSupport }
      : topologySupportFromSelection(pick.selection);
  if (!resolved) {
    sketchSolverStatus = "That face has no stable planar reference";
    updateSketchToolInspectorState();
    return;
  }
  if (pick.kind === "face") applySelection(pick.selection);
  if (pick.kind === "construction_plane") {
    selectedConstructionPlaneId = pick.plane;
    selectedSketchSupport = { kind: "construction_plane_reference", plane: pick.plane };
  }
  sketchSession.support = resolved.support;
  sketchSession.supportReference = resolved.reference;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  sketchOriginSelected = false;
  sketchHoverPoint = undefined;
  sketchToolArmed = activeToolContext?.source === "sketch" && activeToolContext.key !== "sketch-select" && !sketchEditOperations.has(activeToolContext.key as SketchTool) && activeToolContext.key !== "project";
  resolveAndAlignSketchPlane();
  syncToolInspectorTab();
  updateSketchStatus();
  if (activeInspectorTab === "tool") renderActiveToolInspector();
}

function beginSketchSupportSelection(restoreView = true): void {
  if (!sketchSession) return;
  if (restoreView && activeSketchPlane) renderer?.restoreSketchView();
  activeSketchPlane = undefined;
  sketchChoosingSupport = true;
  syncToolInspectorTab();
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  sketchOriginSelected = false;
  sketchHoverPoint = undefined;
  sketchSolverStatus = "Choose an origin plane, construction plane, or verified planar face";
  renderer?.setSketchSupportSelection(true, handleSketchSupportPick);
  renderSketchOverlay();
  if (activeInspectorTab === "tool") renderActiveToolInspector();
  else updateSketchToolInspectorState();
}

function resolveAndAlignSketchPlane(refreshingAcceptedTopology = false): boolean {
  if (!sketchSession) return false;
  const previousPlane = activeSketchPlane;
  const documentValue = adapter.durableDocument() as SketchPlaneDocument;
  const planeDocument: SketchPlaneDocument = sketchSession.supportReference
    ? { ...documentValue, topology_references: { ...documentValue.topology_references, [sketchSession.supportReference.id]: sketchSession.supportReference } }
    : documentValue;
  if (sketchSession.support.kind === "topology"
    && !requestNativePlanarFaceFrame(sketchSession.support, sketchSession.supportReference)) {
    activeSketchPlane = undefined;
    sketchChoosingSupport = false;
    renderer?.setSketchSupportSelection(false);
    const topologyReferenceId = sketchSession.support.reference;
    const pending = [...pendingPlanarFaceFrameRequests.values()].some((request) => request.topologyReferenceId === topologyReferenceId);
    sketchSolverStatus = pending
      ? "Validating planar face with the native model runtime…"
      : "Planar face reference is missing, stale, nonplanar, or crosses a body/component boundary";
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return false;
  }
  const result = resolveSketchPlane(
    sketchSession.support,
    planeDocument,
    acceptedPlanarFaceEvidence,
    nativePlanarFaceAuthorities,
  );
  if (result.status !== "ready") {
    activeSketchPlane = undefined;
    sketchChoosingSupport = !refreshingAcceptedTopology;
    renderer?.setSketchSupportSelection(!refreshingAcceptedTopology, refreshingAcceptedTopology ? undefined : handleSketchSupportPick);
    sketchSolverStatus = result.status === "surface_evidence_required"
      ? refreshingAcceptedTopology
        ? "Sketch support changed · explicit rebind required"
        : "Select a verified planar face before sketching"
      : `Sketch plane reference ${result.reference} is missing · explicit rebind required`;
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return false;
  }
  sketchChoosingSupport = false;
  renderer?.setSketchSupportSelection(false);
  activeSketchPlane = result.plane;
  const sameFrame = previousPlane
    && previousPlane.origin_nanometers.every((value, index) => value === activeSketchPlane!.origin_nanometers[index])
    && previousPlane.x_axis_millionths.every((value, index) => value === activeSketchPlane!.x_axis_millionths[index])
    && previousPlane.y_axis_millionths.every((value, index) => value === activeSketchPlane!.y_axis_millionths[index])
    && previousPlane.normal_millionths.every((value, index) => value === activeSketchPlane!.normal_millionths[index]);
  if (!refreshingAcceptedTopology || !sameFrame) renderer?.alignToSketchPlane(activeSketchPlane);
  renderSketchOverlay();
  void refreshAssociativeSketchGeometry();
  return true;
}

async function refreshAssociativeSketchGeometry(): Promise<void> {
  if (!sketchSession || !activeSketchPlane) return;
  const draft = sketchSession.draft;
  const commands: SketchCommand[] = [];
  const missing: string[] = [];
  for (const [geometry, reference] of Object.entries(draft.external_references ?? {})) {
    const retainedProjection = Object.entries(draft.operations ?? {}).find(([, operation]) =>
      operation.kind === "project_include" && operation.results.includes(geometry));
    const projection = retainedProjection?.[1].kind === "project_include" ? retainedProjection[1] : undefined;
    let world: [number, number, number][] = [];
    if (projection?.source_kind === "point") {
      const selected = renderer?.topologySelectionByStableId("vertex", reference.stable_kernel_id);
      const point = selected ? renderer?.vertexPoint(selected.token) : undefined;
      if (point) world = [point];
    } else if (projection?.source_kind === "sketch") {
      try {
        const source = JSON.parse(reference.stable_kernel_id) as { sketch: string; geometry: string; segment: number };
        const documentValue = adapter.durableDocument() as SketchPlaneDocument;
        const hydrated = hydrateSketchFromDocument(documentValue, source.sketch);
        const resolution = hydrated ? resolveSketchPlane(hydrated.support, documentValue, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities) : undefined;
        const entity = hydrated?.sketch.geometry[source.geometry]; const path = entity ? sketchGeometrySelectionPath(entity.geometry) : [];
        if (resolution?.status === "ready" && source.segment === -1 && path[0]) world = [[...planeLocalToWorldMillimeters(path[0], resolution.plane)]] as [number, number, number][];
        else if (resolution?.status === "ready" && path[source.segment] && path[source.segment + 1]) world = [[...planeLocalToWorldMillimeters(path[source.segment], resolution.plane)], [...planeLocalToWorldMillimeters(path[source.segment + 1], resolution.plane)]] as [number, number, number][];
      } catch { world = []; }
    } else if (projection?.source_kind === "face" || projection?.source_kind === "body" || projection?.source_kind === "plane_intersection") {
      let operand: { kind: "edge" | "face" | "body"; stable_id: string } = { kind: projection.source_kind === "body" ? "body" : "face", stable_id: reference.stable_kernel_id };
      if (projection.source_kind === "plane_intersection") try { operand = JSON.parse(reference.stable_kernel_id); } catch { /* legacy face reference */ }
      let polylines = operand.kind === "edge"
        ? (() => { const selected = renderer?.topologySelectionByStableId("edge", operand.stable_id); return selected ? [renderer!.edgePolyline(selected.token)] : []; })()
        : operand.kind === "face"
          ? (() => { const selected = renderer?.topologySelectionByStableId("face", operand.stable_id); return selected ? renderer?.planarFaceBoundaryPolylines(selected) ?? [] : []; })()
        : renderer?.topologySelections("edge").map((edge) => renderer!.edgePolyline(edge.token)) ?? [];
      if (projection.source_kind === "plane_intersection") {
        const origin = activeSketchPlane.origin_nanometers.map((value) => value / 1_000_000); const normal = activeSketchPlane.normal_millionths.map((value) => value / 1_000_000);
        const hits: [number, number, number][] = []; const signed = (point: [number, number, number]) => point.reduce((sum, value, axis) => sum + (value - origin[axis]) * normal[axis], 0);
        for (const line of polylines) for (let index = 1; index < line.length; index += 1) { const a = line[index - 1], b = line[index], da = signed(a), db = signed(b); if (Math.abs(da) < 1e-8) hits.push(a); if (da * db < 0) { const t = da / (da - db); hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } }
        const unique = hits.filter((point, index) => hits.findIndex((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1], candidate[2] - point[2]) < 1e-7) === index);
        if (operand.kind === "edge" && unique.length === 1) { world = [unique[0]]; polylines = []; }
        else polylines = Array.from({ length: Math.floor(unique.length / 2) }, (_, index) => [unique[index * 2], unique[index * 2 + 1]]);
      }
      const segments = polylines.flatMap((polyline) => Array.from({ length: Math.max(0, polyline.length - 1) }, (_, index) => [polyline[index], polyline[index + 1]] as [typeof polyline[number], typeof polyline[number]]));
      const resultIndex = projection.results.indexOf(geometry); if (!world.length) world = segments[resultIndex] ?? [];
    } else world = renderer?.edgePolylineByStableId(reference.stable_kernel_id, reference.body) ?? [];
    if (world.length === 1 && draft.geometry[geometry]?.geometry.kind === "sketch_point") {
      const position = worldMillimetersToPlaneLocal(world[0], activeSketchPlane);
      const fixed = Object.entries(draft.constraints).filter(([, constraint]) => constraint.kind === "fixed" && constraint.point.geometry === geometry);
      commands.push(...fixed.map(([constraint]) => ({ kind: "remove_constraint", constraint } as SketchCommand)));
      commands.push({ kind: "move_point", point: { geometry, anchor: "position" }, to: position });
      for (const [constraint, value] of fixed) if (value.kind === "fixed") commands.push({ kind: "add_constraint", id: constraint, constraint: { ...value, x_nm: position.x_nm, y_nm: position.y_nm } });
      if (retainedProjection && projection?.missing) commands.push({ kind: "set_operation", id: retainedProjection[0], operation: { ...projection, missing: false } });
      continue;
    }
    if (world.length < 2) {
      missing.push(reference.stable_kernel_id);
      if (retainedProjection && retainedProjection[1].kind === "project_include" && !retainedProjection[1].missing) commands.push({ kind: "set_operation", id: retainedProjection[0], operation: { ...retainedProjection[1], missing: true } });
      continue;
    }
    const start = worldMillimetersToPlaneLocal(world[0], activeSketchPlane);
    const end = worldMillimetersToPlaneLocal(world.at(-1)!, activeSketchPlane);
    const fixed = Object.entries(draft.constraints).filter(([, constraint]) => constraint.kind === "fixed" && constraint.point.geometry === geometry);
    commands.push(...fixed.map(([constraint]) => ({ kind: "remove_constraint", constraint } as SketchCommand)));
    commands.push(
      { kind: "move_point", point: { geometry, anchor: "start" }, to: start },
      { kind: "move_point", point: { geometry, anchor: "end" }, to: end },
    );
    for (const [constraint, value] of fixed) {
      if (value.kind !== "fixed") continue;
      const target = value.point.anchor === "start" ? start : end;
      commands.push({ kind: "add_constraint", id: constraint, constraint: { ...value, x_nm: target.x_nm, y_nm: target.y_nm } });
    }
    if (retainedProjection && retainedProjection[1].kind === "project_include" && retainedProjection[1].missing) commands.push({ kind: "set_operation", id: retainedProjection[0], operation: { ...retainedProjection[1], missing: false } });
  }
  if (!commands.length) return;
  try {
    await sketchSession.refreshExternalGeometry(commands);
    updateSketchStatus();
    sketchSolverStatus = missing.length
      ? `External edge ${missing.join(", ")} is missing · select a replacement edge to repair`
      : "Associative projected geometry refreshed";
    updateSketchToolInspectorState();
  } catch {
    sketchSolverStatus = "Projected geometry refresh was refused; the accepted reference is unchanged";
    updateSketchToolInspectorState();
  }
}

function syncSketchBrowserConstraintStatus(): void {
  if (!sketchSession?.solve) return;
  const id = sketchSession.draftView.id;
  const row = document.querySelector<HTMLButtonElement>(`[data-sketch-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.dataset.constraintState = sketchSession.solve.state;
  const label = sketchSession.solve.degrees_of_freedom === 0 && sketchSession.solve.state === "fully_constrained"
    ? "fully constrained"
    : sketchSession.solve.state === "conflicting" || sketchSession.solve.state === "over_constrained"
      ? "constraint conflict"
      : `${sketchSession.solve.degrees_of_freedom} DOF`;
  const status = row.querySelector("small"); if (status) status.textContent = label;
  row.setAttribute("aria-label", `${row.querySelector("span")?.textContent ?? "Sketch"} · ${label}`);
}

function updateSketchStatus(): void {
  if (!sketchSession) {
    sketchSolverStatus = "Sketch editor idle";
    sketchProfileStatus = "Profile: empty";
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  if (!activeSketchPlane) return;
  sketchSolverStatus = sketchSession.solve
    ? `${sketchSession.solve.state.replaceAll("_", " ")} · ${sketchSession.solve.degrees_of_freedom} degrees of freedom · ${sketchSession.solve.solve_components?.length ?? 0} solve component(s)${sketchSession.solve.redundant_constraints.length ? ` · redundant ${sketchSession.solve.redundant_constraints.join(", ")}` : ""}${sketchSession.solve.conflicts.length ? ` · conflicting ${sketchSession.solve.conflicts.flatMap((conflict) => conflict.constraints).join(", ")} · suppress, delete, or convert a dimension to reference` : ""}`
    : "Under-constrained · click the plane to draw";
  const report = sketchSession.profile;
  if (selectedSketchProfile?.sketchId === sketchSession.draft.id && report) {
    const match = report.closed_profiles.find((geometryIds) => sketchProfileId(sketchSession!.draft.id, geometryIds) === selectedSketchProfile!.profileId);
    if (match) {
      selectedSketchProfile = { ...selectedSketchProfile, geometryIds: [...match] };
      sketchProfileRepairMessage = undefined;
    } else {
      sketchProfileRepairMessage = "The selected profile is no longer closed. Close it or select another region before creating a feature.";
    }
  }
  if (report?.closed_profiles.length && Object.values(sketchSession.draftView.geometry).filter((entity) => entity.geometry.kind === "line").length >= 4) {
    notifyOnboardingAction("draw-rectangle");
  }
  sketchProfileStatus = report
    ? `Profiles: ${report.closed_profiles.length} closed · ${report.diagnostics.length ? report.diagnostics.map((diagnostic) => diagnostic.kind.replaceAll("_", " ")).join(", ") : "no gaps"}`
    : "Profile: empty";
  if (sketchProfileRepairMessage) sketchProfileStatus = `Profile repair: ${sketchProfileRepairMessage}`;
  renderSketchOverlay();
  syncSketchBrowserConstraintStatus();
  updateSketchToolInspectorState();
}

function notifyOnboardingAction(action: OnboardingAction): void {
  document.dispatchEvent(new CustomEvent<OnboardingAction>("crawler:onboarding-action", { detail: action }));
}

function sketchPoint(event: PointerEvent): Point2 | undefined {
  return activeSketchPlane ? renderer?.sketchPointAt(event.clientX, event.clientY, activeSketchPlane) : undefined;
}

const sketchSnapSpatialIndex = new SketchSnapSpatialIndexCache();

function snappedSketchPoint(raw: Point2): SketchSnap {
  if (!sketchSession || !sketchSnapEnabled) return { point: raw, inferences: [], label: sketchSnapEnabled ? undefined : "Snap disabled" };
  const here = sketchOverlayPoint(raw);
  const offset = sketchOverlayPoint({ x_nm: raw.x_nm + 1_000_000, y_nm: raw.y_nm });
  const pixelsPerMillimeter = here && offset ? Math.hypot(offset.x - here.x, offset.y - here.y) : 10;
  const toleranceNm = Math.max(25_000, Math.min(5_000_000, 12 / Math.max(0.001, pixelsPerMillimeter) * 1_000_000));
  const fixed = sketchPoints.map((point, index) => ({ point, reference: sketchInferenceReference(sketchPointInferences[index]) }));
  const sketch = sketchSession.draftView as Sketch;
  const index = sketchSnapSpatialIndex.forSketch(sketch);
  const nearby = index.queryNearby(raw, toleranceNm);
  const datum = fixed.at(-1);
  const datumPoint = datum && "point" in datum ? datum.point : datum;
  const datumNearby = datumPoint ? index.queryNearby(datumPoint, toleranceNm) : [];
  const proximityGeometry = datumPoint
    ? [...new Map([...nearby, ...datumNearby].map((entity) => [entity.id, entity])).values()]
    : nearby;
  const dx = datumPoint ? raw.x_nm - datumPoint.x_nm : 0;
  const dy = datumPoint ? raw.y_nm - datumPoint.y_nm : 0;
  const length = Math.hypot(dx, dy);
  const angularTolerance = Math.min(0.12, toleranceNm / Math.max(length, toleranceNm));
  const directional = length > 0 ? index.queryDirectionalLines({ x: dx / length, y: dy / length }, length, angularTolerance, toleranceNm) : [];
  const relationGeometry = [...new Map([...datumNearby, ...directional].map((entity) => [entity.id, entity])).values()];
  return inferSketchPoint(sketch, raw, fixed, toleranceNm, sketchSession.activeTool, proximityGeometry, relationGeometry, datumNearby);
}

function sketchInferenceReference(inferences: readonly SketchInference[] | undefined): PointRef | undefined {
  return inferences?.[0]?.target;
}

function sketchInferenceConstraintKind(kind: SketchInference["kind"]): Constraint["kind"] {
  if (kind === "origin") return "point_on_origin";
  if (kind === "center") return "concentric";
  if (kind === "horizontal") return "horizontal_points";
  if (kind === "vertical") return "vertical_points";
  return kind;
}

function sketchOverlayPoint(point: Point2): { x: number; y: number } | undefined {
  return activeSketchPlane ? renderer?.sketchPointToScreen(point, activeSketchPlane) : undefined;
}

function inlineCreationVariant(tool: SketchTool): InlineCreationContext["variant"] {
  if (tool === "rectangle") return sketchCreationVariant.rectangle;
  if (tool === "circle") return sketchCreationVariant.circle;
  if (tool === "arc") return sketchCreationVariant.arc;
  if (tool === "polygon") return sketchCreationVariant.polygon;
  if (tool === "slot") return sketchCreationVariant.slot;
  return undefined;
}

function inlineCreationContext(points: readonly Point2[]): InlineCreationContext | undefined {
  if (!sketchSession || !["line", "rectangle", "circle", "arc", "polygon", "slot", "ellipse", "elliptical_arc"].includes(sketchSession.activeTool)) return undefined;
  return {
    tool: sketchSession.activeTool as InlineCreationContext["tool"],
    variant: inlineCreationVariant(sketchSession.activeTool),
    points,
    lockedFields: inlineCreationLocks,
    sides: sketchPolygonSides,
  };
}

function inlineCreationPreview(): ReturnType<typeof solveInlineCreation> | undefined {
  if (!sketchHoverPoint) return undefined;
  const context = inlineCreationContext([...sketchPoints, sketchHoverPoint]);
  return context ? solveInlineCreation(context) : undefined;
}

function inlineCreationFacsimiles(result: ReturnType<typeof solveInlineCreation> | undefined): Geometry[] {
  if (!result?.valid || !sketchSession || result.points.length < activeSketchPointRequirement(sketchSession.activeTool)) return [];
  const ids = new StableSketchIds("preview:inline");
  const tool = sketchSession.activeTool;
  try {
    let commands: SketchCommand[] = [];
    if (tool === "line") commands = toolCommands("line", ids, result.points);
    else if (tool === "rectangle") commands = rectangleVariantCommands(ids, sketchCreationVariant.rectangle, result.points);
    else if (tool === "circle") commands = circleVariantCommands(ids, sketchCreationVariant.circle, result.points, selectedSketchGeometry.filter(geometrySupportsCreationOperand), sketchSession.draft);
    else if (tool === "arc") commands = arcVariantCommands(ids, sketchCreationVariant.arc, result.points, sketchSession.draft, selectedSketchGeometry.find(geometrySupportsCreationOperand));
    else if (tool === "polygon") commands = polygonVariantCommands(ids, sketchCreationVariant.polygon, result.points[0], result.points[1], result.sides ?? sketchPolygonSides);
    else if (tool === "slot") commands = slotVariantCommands(ids, sketchCreationVariant.slot, result.points);
    else if (tool === "ellipse") commands = ellipseCommands(ids, result.points[0], result.points[1], result.points[2]);
    else if (tool === "elliptical_arc") commands = ellipticalArcCommands(ids, result.points[0], result.points[1], result.points[2], result.points[3], result.points[4]);
    return commands.flatMap((command) => command.kind === "add_geometry" ? [command.entity.geometry] : []);
  } catch { return []; }
}

function resetInlineCreationInput(): void {
  inlineCreationLocks = {};
  inlineCreationExpressions = {};
  inlineCreationActiveField = undefined;
}

function inlineFieldDisplay(field: InlineCreationField): string {
  if (field.unit === "nanometer") return `${Number((field.value / 1_000_000).toFixed(3))}`;
  if (field.unit === "microdegree") return `${Number((field.value / 1_000_000).toFixed(3))}`;
  return `${Math.round(field.value)}`;
}

function parseInlineCreationField(field: InlineCreationField, source: string): number | undefined {
  if (field.unit === "count") {
    const value = Number(source.trim());
    return Number.isInteger(value) && value >= 3 && value <= 128 ? value : undefined;
  }
  const value = parseSketchDimensionExpression(source, field.unit === "microdegree" ? "angle" : "length");
  if (value === undefined) return undefined;
  if (field.unit === "microdegree") return Math.abs(value) < 360 ? Math.round(value * 1_000_000) : undefined;
  if (value <= 0) return undefined;
  return Math.round(value * 1_000_000);
}

function lockInlineCreationField(field: InlineCreationField, input: HTMLInputElement): boolean {
  const value = parseInlineCreationField(field, input.value);
  input.setAttribute("aria-invalid", String(value === undefined));
  if (value === undefined) return false;
  inlineCreationLocks = { ...inlineCreationLocks, [field.key]: value };
  inlineCreationExpressions = { ...inlineCreationExpressions, [field.key]: input.value.trim() };
  if (field.key === "sides") sketchPolygonSides = value;
  return true;
}

function inlineCreationDimensionCommands(
  result: ReturnType<typeof solveInlineCreation>,
  commands: readonly SketchCommand[],
): SketchCommand[] {
  if (!sketchSession || !result.dimensionIntents.length) return [];
  const geometryIds = commands.flatMap((command) => command.kind === "add_geometry" ? [command.entity.id] : []);
  const added = new Set<string>();
  const output: SketchCommand[] = [];
  const add = (key: string, constraint: Constraint) => {
    if (added.has(key)) return;
    added.add(key);
    output.push({ kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint });
  };
  const lineDimension = (geometry: string | undefined, kind: "distance" | "distance_x" | "distance_y", valueNm?: number) => {
    if (!geometry) return;
    const entity = commands.find((command) => command.kind === "add_geometry" && command.entity.id === geometry);
    const line = entity?.kind === "add_geometry" && entity.entity.geometry.kind === "line" ? entity.entity.geometry : undefined;
    const measured = line ? Math.round(Math.hypot(line.end.x_nm - line.start.x_nm, line.end.y_nm - line.start.y_nm)) : 0;
    add(`${geometry}:${kind}`, { kind, a: { geometry, anchor: "start" }, b: { geometry, anchor: "end" }, distance_nm: Math.max(1, Math.round(valueNm ?? measured)) });
  };
  for (const intent of result.dimensionIntents) {
    const tool = sketchSession.activeTool;
    if (tool === "line") {
      if (intent.semantic === "axis_angle") add("line:angle", { kind: "angle_to_axis", line: geometryIds[0], axis: "x", angle_microdegrees: Math.round(intent.value) });
      else lineDimension(geometryIds[0], "distance", intent.value);
    } else if (tool === "rectangle") {
      if (intent.field === "width") lineDimension(geometryIds[0], sketchCreationVariant.rectangle === "three_point" ? "distance" : "distance_x", intent.value);
      else if (intent.field === "height") lineDimension(geometryIds[1], sketchCreationVariant.rectangle === "three_point" ? "distance" : "distance_y", intent.value);
    } else if (tool === "circle" && geometryIds[0]) {
      if (intent.semantic === "diameter") add("circle:diameter", { kind: "diameter", geometry: geometryIds[0], diameter_nm: Math.round(intent.value) });
      else add("circle:radius", { kind: "radius", geometry: geometryIds[0], radius_nm: Math.round(intent.value) });
    } else if (tool === "arc" && geometryIds[0]) {
      if (intent.semantic === "radius") add("arc:radius", { kind: "radius", geometry: geometryIds[0], radius_nm: Math.round(intent.value) });
      if (intent.semantic === "sweep_angle") {
        const arcCommand = commands.find((command) => command.kind === "add_geometry" && command.entity.id === geometryIds[0]);
        const arc = arcCommand?.kind === "add_geometry" && arcCommand.entity.geometry.kind === "arc" ? arcCommand.entity.geometry : undefined;
        if (arc) {
          const first = sketchSession.ids.next("geometry"); const second = sketchSession.ids.next("geometry");
          output.push(
            { kind: "add_geometry", entity: { id: first, construction: true, geometry: { kind: "line", start: arc.center, end: arc.start } } },
            { kind: "add_geometry", entity: { id: second, construction: true, geometry: { kind: "line", start: arc.center, end: arc.end } } },
          );
          add("arc:sweep:first-center", { kind: "coincident", a: { geometry: first, anchor: "start" }, b: { geometry: geometryIds[0], anchor: "center" } });
          add("arc:sweep:first-edge", { kind: "coincident", a: { geometry: first, anchor: "end" }, b: { geometry: geometryIds[0], anchor: "start" } });
          add("arc:sweep:second-center", { kind: "coincident", a: { geometry: second, anchor: "start" }, b: { geometry: geometryIds[0], anchor: "center" } });
          add("arc:sweep:second-edge", { kind: "coincident", a: { geometry: second, anchor: "end" }, b: { geometry: geometryIds[0], anchor: "end" } });
          add("arc:sweep", { kind: "angle", first, second, angle_microdegrees: Math.round(Math.abs(intent.value)) });
        }
      }
    } else if (tool === "polygon" && geometryIds[0] && intent.field === "radius") {
      const sides = result.sides ?? sketchPolygonSides;
      const side = intent.semantic === "polygon_apothem"
        ? intent.value * 2 * Math.tan(Math.PI / sides)
        : intent.value * 2 * Math.sin(Math.PI / sides);
      lineDimension(geometryIds[0], "distance", side);
    } else if (tool === "slot") {
      if (intent.field === "length" && sketchCreationVariant.slot !== "three_point_arc") {
        const straightLine = commands.find((command) => command.kind === "add_geometry" && command.entity.id === geometryIds[0]);
        const straight = straightLine?.kind === "add_geometry" && straightLine.entity.geometry.kind === "line" ? straightLine.entity.geometry : undefined;
        let target = intent.value;
        if (sketchCreationVariant.slot === "overall" && straight) {
          const cap = commands.find((command) => command.kind === "add_geometry" && command.entity.id === geometryIds[1]);
          const arc = cap?.kind === "add_geometry" && cap.entity.geometry.kind === "arc" ? cap.entity.geometry : undefined;
          const radius = arc ? Math.hypot(arc.start.x_nm - arc.center.x_nm, arc.start.y_nm - arc.center.y_nm) : 0;
          target = Math.max(1, intent.value - radius * 2);
        }
        lineDimension(geometryIds[0], "distance", target);
      }
      if (intent.field === "length" && sketchCreationVariant.slot === "three_point_arc" && geometryIds[0]) {
        const centerline = result.points.length >= 3 ? (() => {
          const [start, through, end] = result.points;
          const ax = start.x_nm; const ay = start.y_nm; const bx = through.x_nm; const by = through.y_nm; const cx = end.x_nm; const cy = end.y_nm;
          const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
          if (Math.abs(d) < 1) return undefined;
          const aa = ax * ax + ay * ay; const bb = bx * bx + by * by; const cc = cx * cx + cy * cy;
          return { x_nm: Math.round((aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) / d), y_nm: Math.round((aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / d) };
        })() : undefined;
        if (centerline) {
          const first = sketchSession.ids.next("geometry"); const second = sketchSession.ids.next("geometry");
          output.push(
            { kind: "add_geometry", entity: { id: first, construction: true, geometry: { kind: "line", start: centerline, end: result.points[0] } } },
            { kind: "add_geometry", entity: { id: second, construction: true, geometry: { kind: "line", start: centerline, end: result.points[2] } } },
          );
          const radius = Math.hypot(result.points[0].x_nm - centerline.x_nm, result.points[0].y_nm - centerline.y_nm);
          const sweep = Math.max(1, Math.min(359_999_999, Math.round(intent.value / Math.max(1, radius) * 180_000_000 / Math.PI)));
          add("slot:arc:first-center", { kind: "coincident", a: { geometry: first, anchor: "start" }, b: { geometry: geometryIds[0], anchor: "center" } });
          add("slot:arc:first-edge", { kind: "coincident", a: { geometry: first, anchor: "end" }, b: { geometry: geometryIds[3], anchor: "center" } });
          add("slot:arc:second-center", { kind: "coincident", a: { geometry: second, anchor: "start" }, b: { geometry: geometryIds[0], anchor: "center" } });
          add("slot:arc:second-edge", { kind: "coincident", a: { geometry: second, anchor: "end" }, b: { geometry: geometryIds[1], anchor: "center" } });
          add("slot:arc:length", { kind: "angle", first, second, angle_microdegrees: sweep });
        }
      }
      if (intent.field === "width" && geometryIds[1]) add("slot:width", { kind: "diameter", geometry: geometryIds[1], diameter_nm: Math.round(intent.value) });
    } else if ((tool === "ellipse" || tool === "elliptical_arc") && geometryIds[0]) {
      if (intent.field === "major_radius") add("ellipse:major", { kind: "ellipse_radius", geometry: geometryIds[0], axis: "major", radius_nm: Math.round(intent.value) });
      if (intent.field === "minor_radius") add("ellipse:minor", { kind: "ellipse_radius", geometry: geometryIds[0], axis: "minor", radius_nm: Math.round(intent.value) });
    }
  }
  return output;
}

function persistInlineCreationExpressionBindings(commands: readonly SketchCommand[], tool: SketchTool): void {
  const dimensional = commands.filter((command): command is Extract<SketchCommand, { kind: "add_constraint" }> => command.kind === "add_constraint" && dimensionConstraintValue(command.constraint) !== undefined);
  const bind = (command: Extract<SketchCommand, { kind: "add_constraint" }> | undefined, field: InlineCreationFieldKey) => {
    const expression = inlineCreationExpressions[field]?.trim();
    if (command && expression) sketchDimensionExpressions.set(command.id, expression);
  };
  if (tool === "line") {
    bind(dimensional.find((command) => command.constraint.kind === "distance"), "length");
    bind(dimensional.find((command) => command.constraint.kind === "angle_to_axis"), "angle");
  } else if (tool === "rectangle") {
    bind(dimensional.find((command) => command.constraint.kind === "distance_x") ?? dimensional.filter((command) => command.constraint.kind === "distance")[0], "width");
    bind(dimensional.find((command) => command.constraint.kind === "distance_y") ?? dimensional.filter((command) => command.constraint.kind === "distance")[1], "height");
  } else if (tool === "circle") {
    bind(dimensional.find((command) => command.constraint.kind === "diameter"), "diameter");
    bind(dimensional.find((command) => command.constraint.kind === "radius"), "radius");
  } else if (tool === "arc") {
    bind(dimensional.find((command) => command.constraint.kind === "radius"), "radius");
    bind(dimensional.find((command) => command.constraint.kind === "angle"), "angle");
  } else if (tool === "ellipse" || tool === "elliptical_arc") {
    const radii = dimensional.filter((command) => command.constraint.kind === "ellipse_radius");
    bind(radii.find((command) => command.constraint.kind === "ellipse_radius" && command.constraint.axis === "major"), "major_radius");
    bind(radii.find((command) => command.constraint.kind === "ellipse_radius" && command.constraint.axis === "minor"), "minor_radius");
  } else if (tool === "slot") {
    bind(dimensional.find((command) => command.constraint.kind === "distance"), "length");
    bind(dimensional.find((command) => command.constraint.kind === "diameter"), "width");
  }
  persistSketchDimensionExpressions();
}

function dimensionKindLabel(kind: ConstraintTool): string {
  const labels: Partial<Record<ConstraintTool, string>> = {
    distance: "Aligned distance",
    distance_x: "Horizontal distance",
    distance_y: "Vertical distance",
    point_line_distance: "Point to line",
    line_distance: "Line spacing",
    offset_distance: "Offset distance",
    radius: "Radius",
    diameter: "Diameter",
    ellipse_radius: "Ellipse radius",
    angle: "Angle",
  };
  return labels[kind] ?? kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function sketchDimensionAlias(constraintId: string): string | undefined {
  if (!sketchSession) return undefined;
  const ids = Object.entries(sketchSession.draft.constraints).filter(([, constraint]) => dimensionConstraintValue(constraint) !== undefined).map(([id]) => id);
  const index = ids.indexOf(constraintId);
  return index >= 0 ? `d${index + 1}` : undefined;
}

function parseCanvasDimensionExpression(source: string, kind: "length" | "angle", excludedConstraintId?: string): number | undefined {
  if (!sketchSession) return parseSketchDimensionExpression(source, kind);
  let resolved = source;
  for (const [id, constraint] of Object.entries(sketchSession.draft.constraints)) {
    if (id === excludedConstraintId) continue;
    const alias = sketchDimensionAlias(id); const measured = dimensionConstraintValue(constraint);
    if (!alias || !measured) continue;
    resolved = resolved.replace(new RegExp(`\\b${alias}\\b`, "gi"), `(${measured.value} ${measured.unit})`);
  }
  return parseSketchDimensionExpression(resolved, kind);
}

function pendingDimensionMode(): string | undefined {
  if (!pendingDimensionPlacement || pendingDimensionPlacement.command.kind !== "add_constraint") return undefined;
  const constraint = pendingDimensionPlacement.command.constraint;
  return constraint.kind === "ellipse_radius" ? `ellipse_${constraint.axis}` : constraint.kind;
}

function pendingDimensionModes(mode: string): Array<[string, string]> {
  if (["distance", "distance_x", "distance_y"].includes(mode)) return [["distance", "Aligned"], ["distance_x", "Horizontal"], ["distance_y", "Vertical"]];
  if (["radius", "diameter"].includes(mode)) return [["radius", "Radius"], ["diameter", "Diameter"]];
  if (mode.startsWith("ellipse_")) return [["ellipse_major", "Major radius"], ["ellipse_minor", "Minor radius"]];
  return [[mode, dimensionKindLabel(mode as ConstraintTool)]];
}

function rebuildPendingDimension(mode = pendingDimensionMode(), value = sketchConstraintValue, sketch?: Sketch): boolean {
  if (!sketchSession || !pendingDimensionPlacement || !mode) return false;
  const draft = sketch ?? sketchSession.draftView as Sketch;
  const pending = pendingDimensionPlacement;
  if (pending.command.kind !== "add_constraint") return false;
  const kind = (mode.startsWith("ellipse_") ? "ellipse_radius" : mode) as ConstraintTool;
  const current = pending.command.constraint;
  const directRound = (kind === "radius" || kind === "diameter") && (current.kind === "radius" || current.kind === "diameter")
    ? { kind: "add_constraint", id: pending.command.id, constraint: kind === "radius"
      ? { kind: "radius", geometry: current.geometry, radius_nm: Math.max(1, Math.round(value * 1_000_000)) } as Constraint
      : { kind: "diameter", geometry: current.geometry, diameter_nm: Math.max(2, Math.round(value * 1_000_000)) } as Constraint } satisfies SketchCommand
    : undefined;
  const command = directRound ?? constraintCommand(kind, pending.command.id, draft, { geometry: selectedSketchGeometry, points: selectedSketchPoints, origin: sketchOriginSelected }, value);
  if (!command || command.kind !== "add_constraint") return false;
  if (command.constraint.kind === "ellipse_radius") command.constraint.axis = mode === "ellipse_minor" ? "minor" : "major";
  pendingDimensionPlacement = { kind, command, position: pending.position, placed: pending.placed, valueEdited: pending.valueEdited };
  return true;
}

function pendingSmartDimensionLine(sketch?: Sketch): Extract<Geometry, { kind: "line" }> | undefined {
  if (!sketchSession || !sketchSmartDimensionActive || selectedSketchPoints.length || selectedSketchGeometry.length !== 1) return undefined;
  const geometry = (sketch ?? sketchSession.draftView as Sketch).geometry[selectedSketchGeometry[0]]?.geometry;
  return geometry?.kind === "line" ? geometry : undefined;
}

function updatePendingDimensionPlacement(point: Point2 | undefined): void {
  if (!point || !pendingDimensionPlacement || pendingDimensionPlacement.placed) return;
  if (!sketchSession) return;
  const sketch = sketchSession.draftView as Sketch;
  pendingDimensionPlacement.position = point;
  const line = pendingSmartDimensionLine(sketch);
  if (!line || !["distance", "distance_x", "distance_y"].includes(pendingDimensionPlacement.kind)) return;
  const mode = smartDimensionLinePlacementMode(line, point);
  if (pendingDimensionMode() === mode) return;
  const measured = measureSmartDimension(mode, sketch);
  if (measured !== undefined && Number.isFinite(measured)) sketchConstraintValue = measured;
  rebuildPendingDimension(mode, sketchConstraintValue, sketch);
}

function sketchDimensionEditorAnchor(constraintId?: string, sketch?: Sketch): Point2 | undefined {
  if (!sketchSession) return undefined;
  const draft = sketch ?? sketchSession.draftView as Sketch;
  if (pendingDimensionPlacement?.position) return pendingDimensionPlacement.position;
  if (constraintId) {
    const annotation = constraintAnnotations(draft).find((candidate) => candidate.id === constraintId);
    return draft.dimension_positions?.[constraintId] ?? sketchDimensionPositions.get(constraintId) ?? annotation?.position;
  }
  if (sketchHoverPoint) return sketchHoverPoint;
  const points = selectedSketchGeometry.flatMap((id) => sketchGeometrySelectionPoints(draft.geometry[id]?.geometry));
  if (!points.length) return undefined;
  return {
    x_nm: Math.round(points.reduce((sum, value) => sum + value.x_nm, 0) / points.length),
    y_nm: Math.round(points.reduce((sum, value) => sum + value.y_nm, 0) / points.length),
  };
}

function syncSketchDimensionEditor(sketch?: Sketch): void {
  const editor = document.querySelector<HTMLFormElement>("#sketch-dimension-editor")!;
  const creation = sketchToolArmed && sketchPoints.length > 0 ? inlineCreationPreview() : undefined;
  if (sketchSession && creation && creation.fields.length && !pendingDimensionPlacement && !selectedSketchConstraint) {
    const fields = creation.fields;
    const signature = fields.map((field) => `${field.key}:${field.unit}`).join("|");
    const fieldHost = editor.querySelector<HTMLElement>("#sketch-dimension-fields")!;
    if (fieldHost.dataset.fields !== signature) {
      fieldHost.innerHTML = fields.map((field, index) => `<label class="sketch-dimension-expression" data-inline-field-label="${escapeHtml(field.key)}" data-locked="${Object.hasOwn(inlineCreationLocks, field.key)}"><span>${escapeHtml(field.label)}</span><input ${index === 0 ? 'id="active-tool-constraint-value"' : ""} data-inline-creation-field="${escapeHtml(field.key)}" type="text" inputmode="${field.unit === "count" ? "numeric" : "decimal"}" autocomplete="off" aria-label="${escapeHtml(field.label)}" value="${escapeHtml(inlineCreationExpressions[field.key] ?? inlineFieldDisplay(field))}"/><b>${field.unit === "microdegree" ? "deg" : field.unit === "count" ? "" : "mm"}</b></label>`).join("");
      fieldHost.dataset.fields = signature;
      inlineCreationActiveField = inlineCreationActiveField && fields.some((field) => field.key === inlineCreationActiveField) ? inlineCreationActiveField : fields[0].key;
    }
    for (const field of fields) {
      const input = fieldHost.querySelector<HTMLInputElement>(`[data-inline-creation-field="${field.key}"]`);
      const label = input?.closest<HTMLElement>(".sketch-dimension-expression");
      label?.setAttribute("data-locked", String(Object.hasOwn(inlineCreationLocks, field.key)));
      if (input && document.activeElement !== input && !Object.hasOwn(inlineCreationExpressions, field.key)) input.value = inlineFieldDisplay(field);
    }
    editor.querySelector<HTMLElement>("#sketch-dimension-editor-title")!.textContent = `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === sketchSession!.activeTool)?.label ?? "Create"} dimensions`;
    editor.querySelector<HTMLElement>("#sketch-dimension-mode-field")!.hidden = true;
    editor.querySelector<HTMLElement>("#sketch-dimension-hint")!.textContent = "Tab locks field · Enter accept · Esc freeform";
    const screen = sketchOverlayPoint(creation.points.at(-1)!);
    const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
    const estimatedWidth = Math.min(340, 104 * fields.length + 38);
    const ellipseLike = sketchSession.activeTool === "ellipse" || sketchSession.activeTool === "elliptical_arc";
    const centerScreen = ellipseLike ? sketchOverlayPoint(creation.points[0]) : undefined;
    // Ellipse inputs naturally return to their axis endpoints. Put the HUD
    // outside the most recently defined radial point rather than over the
    // ellipse interior, so the next canvas point remains directly clickable.
    const radialX = screen && centerScreen ? screen.x - centerScreen.x : 0;
    const radialY = screen && centerScreen ? screen.y - centerScreen.y : 0;
    const preferredLeft = ellipseLike && screen && centerScreen
      ? (radialX < 0 ? screen.x - estimatedWidth - 16 : screen.x + 16)
      : (screen?.x ?? bounds.width / 2) - estimatedWidth - 16;
    const preferredTop = ellipseLike && screen && centerScreen
      ? (radialY < 0 ? screen.y - 68 : screen.y + 16)
      : (screen?.y ?? bounds.height / 2) - 68;
    editor.style.left = `${Math.max(8, Math.min(bounds.width - estimatedWidth, preferredLeft))}px`;
    editor.style.top = `${Math.max(8, Math.min(bounds.height - 76, preferredTop))}px`;
    editor.dataset.source = "creation";
    editor.dataset.valid = String(creation.valid);
    editor.hidden = false;
    return;
  }
  const fieldHost = editor.querySelector<HTMLElement>("#sketch-dimension-fields")!;
  if (fieldHost.dataset.fields && fieldHost.dataset.fields !== "dimension") {
    fieldHost.innerHTML = `<label class="sketch-dimension-expression"><span id="sketch-dimension-field-label">Value</span><input id="active-tool-constraint-value" type="text" inputmode="decimal" autocomplete="off" aria-label="Dimension value" /><b id="sketch-dimension-editor-unit">mm</b></label>`;
    fieldHost.dataset.fields = "dimension";
  }
  const draft = sketch ?? (sketchSession?.draftView as Sketch | undefined);
  const selectedValue = selectedSketchConstraint ? sketchConstraintDimension(selectedSketchConstraint, draft) : undefined;
  const isPending = pendingDimensionPlacement?.command.kind === "add_constraint";
  if (!sketchSession || (!isPending && selectedValue === undefined)) {
    editor.dataset.source = "";
    editor.hidden = true;
    return;
  }
  const constraintId = isPending ? (pendingDimensionPlacement!.command as Extract<SketchCommand, { kind: "add_constraint" }>).id : selectedSketchConstraint;
  const constraint = isPending ? (pendingDimensionPlacement!.command as Extract<SketchCommand, { kind: "add_constraint" }>).constraint : constraintId ? draft?.constraints[constraintId] : undefined;
  if (!constraint) { editor.hidden = true; return; }
  const rawKind = constraint.kind;
  // Axis-relative angles are durable dimensions, but they are intentionally not
  // exposed as a separate constraint toolbar tool. Reuse the ordinary angular
  // editor presentation while preserving the underlying constraint kind.
  const kind: ConstraintTool = rawKind === "angle_to_axis" ? "angle" : rawKind as ConstraintTool;
  const value = isPending ? sketchConstraintValue : selectedValue!;
  const unit = rawKind === "angle" || rawKind === "angle_to_axis" ? "deg" : "mm";
  const input = editor.querySelector<HTMLInputElement>("#active-tool-constraint-value")!;
  const select = editor.querySelector<HTMLSelectElement>("#sketch-dimension-editor-mode")!;
  const mode = pendingDimensionMode() ?? kind;
  const modes = isPending ? pendingDimensionModes(mode) : [[mode, dimensionKindLabel(kind)] as [string, string]];
  const signature = modes.map(([option]) => option).join("|");
  if (select.dataset.options !== signature) {
    select.innerHTML = modes.map(([option, label]) => `<option value="${escapeHtml(option)}">${escapeHtml(label)}</option>`).join("");
    select.dataset.options = signature;
  }
  select.value = mode;
  select.disabled = !isPending || modes.length < 2;
  editor.querySelector<HTMLElement>("#sketch-dimension-mode-field")!.toggleAttribute("hidden", modes.length < 2 && !isPending);
  editor.querySelector<HTMLElement>("#sketch-dimension-editor-title")!.textContent = isPending ? `Lock ${dimensionKindLabel(kind)}` : `Edit ${dimensionKindLabel(kind)}`;
  editor.querySelector<HTMLElement>("#sketch-dimension-hint")!.textContent = "Enter accept · Esc cancel";
  editor.querySelector<HTMLElement>("#sketch-dimension-editor-unit")!.textContent = unit;
  const display = constraintId && sketchDimensionExpressions.get(constraintId) ? sketchDimensionExpressions.get(constraintId)! : `${Number(value.toFixed(3))} ${unit}`;
  if (document.activeElement !== input) input.value = display;
  const editorAnchor = sketchDimensionEditorAnchor(selectedSketchConstraint, draft);
  const screen = editorAnchor ? sketchOverlayPoint(editorAnchor) : undefined;
  const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
  const x = Math.max(8, Math.min(bounds.width - 232, (screen?.x ?? bounds.width / 2) + 16));
  const anchorY = screen?.y ?? bounds.height / 2;
  const y = Math.max(8, Math.min(bounds.height - 160, anchorY > 180 ? anchorY - 168 : anchorY + 30));
  editor.style.left = `${x}px`;
  editor.style.top = `${y}px`;
  editor.dataset.source = isPending ? "smart_dimension" : "edit";
  editor.hidden = false;
}

function sketchGeometrySelectionPoints(value: Geometry): Point2[] {
  return sketchGeometrySelectionPath(value);
}

type SketchScreenPoint = { x: number; y: number };

function dimensionArrowPath(tip: SketchScreenPoint, direction: SketchScreenPoint): string {
  const normal = { x: -direction.y, y: direction.x };
  const back = { x: tip.x + direction.x * 9, y: tip.y + direction.y * 9 };
  return `M ${tip.x} ${tip.y} L ${back.x + normal.x * 4} ${back.y + normal.y * 4} L ${back.x - normal.x * 4} ${back.y - normal.y * 4} Z`;
}

function linearDimensionPreviewMarkup(
  a: SketchScreenPoint,
  b: SketchScreenPoint,
  placement: SketchScreenPoint,
  mode: "distance" | "distance_x" | "distance_y",
  value: number,
  snapLabel?: string,
): string {
  let first: SketchScreenPoint;
  let second: SketchScreenPoint;
  if (mode === "distance_x") {
    first = { x: a.x, y: placement.y };
    second = { x: b.x, y: placement.y };
  } else if (mode === "distance_y") {
    first = { x: placement.x, y: a.y };
    second = { x: placement.x, y: b.y };
  } else {
    const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.max(1, Math.hypot(dx, dy));
    const normal = { x: -dy / length, y: dx / length };
    const offset = (placement.x - a.x) * normal.x + (placement.y - a.y) * normal.y;
    first = { x: a.x + normal.x * offset, y: a.y + normal.y * offset };
    second = { x: b.x + normal.x * offset, y: b.y + normal.y * offset };
  }
  const dx = second.x - first.x; const dy = second.y - first.y; const length = Math.max(1, Math.hypot(dx, dy));
  const direction = { x: dx / length, y: dy / length };
  const normal = { x: -direction.y, y: direction.x };
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const label = `${Number(value.toFixed(3))} mm`;
  const labelWidth = Math.max(48, label.length * 7 + 12);
  const labelPosition = { x: midpoint.x - labelWidth / 2, y: midpoint.y - 24 };
  const modeName = mode === "distance_x" ? "horizontal" : mode === "distance_y" ? "vertical" : "aligned";
  return `<g class="sketch-dimension-placement-preview linear" data-dimension-preview-mode="${modeName}" aria-label="${modeName} dimension preview">
    <line class="dimension-witness" x1="${a.x}" y1="${a.y}" x2="${first.x + normal.x * 6}" y2="${first.y + normal.y * 6}" />
    <line class="dimension-witness" x1="${b.x}" y1="${b.y}" x2="${second.x + normal.x * 6}" y2="${second.y + normal.y * 6}" />
    <line class="dimension-measure" x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" />
    <path class="dimension-arrow" d="${dimensionArrowPath(first, direction)}" />
    <path class="dimension-arrow" d="${dimensionArrowPath(second, { x: -direction.x, y: -direction.y })}" />
    <circle class="dimension-origin-marker" cx="${a.x}" cy="${a.y}" r="3"/><circle class="dimension-origin-marker" cx="${b.x}" cy="${b.y}" r="3"/>
    <rect class="dimension-value-bg" x="${labelPosition.x}" y="${labelPosition.y}" width="${labelWidth}" height="19" rx="4"/>
    <text class="dimension-value" x="${midpoint.x}" y="${labelPosition.y + 13}" text-anchor="middle">${escapeHtml(label)}</text>
    ${snapLabel ? `<text class="dimension-snap-label" x="${placement.x + 12}" y="${placement.y + 20}">${escapeHtml(snapLabel)}</text>` : ""}
  </g>`;
}

function lineIntersection(a: SketchScreenPoint, b: SketchScreenPoint, c: SketchScreenPoint, d: SketchScreenPoint): SketchScreenPoint | undefined {
  const ab = { x: b.x - a.x, y: b.y - a.y }; const cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < 1e-6) return undefined;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = (ac.x * cd.y - ac.y * cd.x) / denominator;
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function angleDimensionPreviewMarkup(placement: SketchScreenPoint, sketch: Sketch): string {
  if (selectedSketchGeometry.length !== 2) return "";
  const lines = selectedSketchGeometry.map((id) => sketch.geometry[id]?.geometry).filter((value): value is Extract<Geometry, { kind: "line" }> => value?.kind === "line");
  if (lines.length !== 2) return "";
  const projected = lines.map((line) => [sketchOverlayPoint(line.start), sketchOverlayPoint(line.end)] as const);
  if (projected.some(([start, end]) => !start || !end)) return "";
  const [[a, b], [c, d]] = projected as [[SketchScreenPoint, SketchScreenPoint], [SketchScreenPoint, SketchScreenPoint]];
  const center = lineIntersection(a, b, c, d);
  if (!center) return "";
  const baseDirections = [[b.x - a.x, b.y - a.y], [d.x - c.x, d.y - c.y]].map(([x, y]) => {
    const length = Math.max(1, Math.hypot(x, y)); return { x: x / length, y: y / length };
  });
  const cursorAngle = Math.atan2(placement.y - center.y, placement.x - center.x);
  let best: { first: number; delta: number; score: number } | undefined;
  for (const firstSign of [1, -1]) for (const secondSign of [1, -1]) {
    const first = Math.atan2(baseDirections[0].y * firstSign, baseDirections[0].x * firstSign);
    const second = Math.atan2(baseDirections[1].y * secondSign, baseDirections[1].x * secondSign);
    let delta = second - first; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2;
    const bisector = first + delta / 2;
    const score = Math.cos(bisector - cursorAngle) - Math.abs(delta) * 0.01;
    if (!best || score > best.score) best = { first, delta, score };
  }
  if (!best) return "";
  const radius = Math.max(28, Math.min(110, Math.hypot(placement.x - center.x, placement.y - center.y)));
  const firstPoint = { x: center.x + Math.cos(best.first) * radius, y: center.y + Math.sin(best.first) * radius };
  const secondAngle = best.first + best.delta;
  const secondPoint = { x: center.x + Math.cos(secondAngle) * radius, y: center.y + Math.sin(secondAngle) * radius };
  const midpointAngle = best.first + best.delta / 2;
  const labelPoint = { x: center.x + Math.cos(midpointAngle) * (radius + 18), y: center.y + Math.sin(midpointAngle) * (radius + 18) };
  const label = `${Number(sketchConstraintValue.toFixed(3))}°`;
  return `<g class="sketch-dimension-placement-preview angle" data-dimension-preview-mode="angle" aria-label="angle dimension preview">
    <line class="dimension-witness" x1="${center.x}" y1="${center.y}" x2="${center.x + Math.cos(best.first) * (radius + 12)}" y2="${center.y + Math.sin(best.first) * (radius + 12)}"/>
    <line class="dimension-witness" x1="${center.x}" y1="${center.y}" x2="${center.x + Math.cos(secondAngle) * (radius + 12)}" y2="${center.y + Math.sin(secondAngle) * (radius + 12)}"/>
    <path class="dimension-measure" d="M ${firstPoint.x} ${firstPoint.y} A ${radius} ${radius} 0 0 ${best.delta >= 0 ? 1 : 0} ${secondPoint.x} ${secondPoint.y}"/>
    <rect class="dimension-value-bg" x="${labelPoint.x - 30}" y="${labelPoint.y - 11}" width="60" height="19" rx="4"/>
    <text class="dimension-value" x="${labelPoint.x}" y="${labelPoint.y + 3}" text-anchor="middle">${escapeHtml(label)}</text>
    <text class="dimension-snap-label" x="${placement.x + 12}" y="${placement.y + 20}">Angle</text>
  </g>`;
}

function screenLineIntersection(first: Extract<Geometry, { kind: "line" }>, second: Extract<Geometry, { kind: "line" }>): Point2 | undefined {
  const ax = first.start.x_nm; const ay = first.start.y_nm; const bx = first.end.x_nm; const by = first.end.y_nm;
  const cx = second.start.x_nm; const cy = second.start.y_nm; const dx = second.end.x_nm; const dy = second.end.y_nm;
  const denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator;
  return { x_nm: Math.round(ax + (bx - ax) * t), y_nm: Math.round(ay + (by - ay) * t) };
}

function dimensionLayoutInput(constraint: Constraint, placement: Point2, sketch: Sketch): SketchDimensionLayoutInput | undefined {
  const screen = (point: Point2 | undefined) => point ? sketchOverlayPoint(point) : undefined;
  const line = (id: string) => {
    const geometry = sketch.geometry[id]?.geometry;
    return geometry?.kind === "line" ? geometry : undefined;
  };
  const at = screen(placement);
  if (!at) return undefined;
  if (constraint.kind === "distance" || constraint.kind === "distance_x" || constraint.kind === "distance_y") {
    const first = screen(pointForRef(sketch, constraint.a)); const second = screen(pointForRef(sketch, constraint.b));
    return first && second ? { kind: "linear", first, second, placement: at, orientation: constraint.kind === "distance_x" ? "horizontal" : constraint.kind === "distance_y" ? "vertical" : "aligned" } : undefined;
  }
  if (constraint.kind === "point_line_distance") {
    const point = screen(pointForRef(sketch, constraint.point)); const target = line(constraint.line);
    const start = screen(target?.start); const end = screen(target?.end);
    return point && start && end ? { kind: "point-line", point, lineStart: start, lineEnd: end, placement: at } : undefined;
  }
  if (constraint.kind === "line_distance" || constraint.kind === "offset_distance") {
    const first = line(constraint.kind === "line_distance" ? constraint.first : constraint.source);
    const second = line(constraint.kind === "line_distance" ? constraint.second : constraint.offset);
    const firstStart = screen(first?.start); const firstEnd = screen(first?.end); const secondStart = screen(second?.start); const secondEnd = screen(second?.end);
    return firstStart && firstEnd && secondStart && secondEnd ? { kind: "parallel-lines", firstLineStart: firstStart, firstLineEnd: firstEnd, secondLineStart: secondStart, secondLineEnd: secondEnd, placement: at } : undefined;
  }
  if (constraint.kind === "radius" || constraint.kind === "diameter") {
    const geometry = sketch.geometry[constraint.geometry]?.geometry;
    if (!geometry || (geometry.kind !== "circle" && geometry.kind !== "arc")) return undefined;
    const center = screen(geometry.center); const edge = screen(geometry.kind === "circle" ? { x_nm: geometry.center.x_nm + geometry.radius_nm, y_nm: geometry.center.y_nm } : geometry.start);
    return center && edge ? { kind: constraint.kind, center, radius: Math.hypot(edge.x - center.x, edge.y - center.y), placement: at } : undefined;
  }
  if (constraint.kind === "ellipse_radius") {
    const geometry = sketch.geometry[constraint.geometry]?.geometry;
    if (!geometry || (geometry.kind !== "ellipse" && geometry.kind !== "elliptical_arc")) return undefined;
    const center = screen(geometry.center); const edge = screen(constraint.axis === "major" ? geometry.major : geometry.minor);
    return center && edge ? { kind: "radius", center, radius: Math.hypot(edge.x - center.x, edge.y - center.y), placement: at } : undefined;
  }
  if (constraint.kind === "angle") {
    const first = line(constraint.first); const second = line(constraint.second); if (!first || !second) return undefined;
    const vertexModel = screenLineIntersection(first, second); const vertex = screen(vertexModel); if (!vertex) return undefined;
    const firstEnd = screen(first.end); const secondEnd = screen(second.end); if (!firstEnd || !secondEnd) return undefined;
    const chooseRay = (candidate: { x: number; y: number }, alternate: Point2) => Math.hypot(candidate.x - vertex.x, candidate.y - vertex.y) > 1 ? candidate : screen(alternate)!;
    return { kind: "angular", vertex, firstRayPoint: chooseRay(firstEnd, first.start), secondRayPoint: chooseRay(secondEnd, second.start), placement: at };
  }
  if (constraint.kind === "angle_to_axis") {
    const target = line(constraint.line); if (!target) return undefined;
    const vertex = screen(target.start); const ray = screen(target.end); if (!vertex || !ray) return undefined;
    const distance = Math.max(24, Math.hypot(ray.x - vertex.x, ray.y - vertex.y));
    return { kind: "angular", vertex, firstRayPoint: { x: vertex.x + (constraint.axis === "x" ? distance : 0), y: vertex.y + (constraint.axis === "y" ? distance : 0) }, secondRayPoint: ray, placement: at };
  }
  return undefined;
}

function dimensionConstraintValue(constraint: Constraint): { value: number; unit: "mm" | "deg" } | undefined {
  if (constraint.kind === "distance" || constraint.kind === "distance_x" || constraint.kind === "distance_y" || constraint.kind === "point_line_distance" || constraint.kind === "line_distance" || constraint.kind === "offset_distance") return { value: constraint.distance_nm / 1_000_000, unit: "mm" };
  if (constraint.kind === "radius" || constraint.kind === "ellipse_radius") return { value: constraint.radius_nm / 1_000_000, unit: "mm" };
  if (constraint.kind === "diameter") return { value: constraint.diameter_nm / 1_000_000, unit: "mm" };
  if (constraint.kind === "angle" || constraint.kind === "angle_to_axis") return { value: constraint.angle_microdegrees / 1_000_000, unit: "deg" };
  return undefined;
}

function dimensionPrimitiveMarkup(primitive: DimensionPrimitive, labelValue: string): string {
  if (primitive.type === "line") return `<line class="dimension-${primitive.role}" x1="${primitive.start.x}" y1="${primitive.start.y}" x2="${primitive.end.x}" y2="${primitive.end.y}"/>`;
  if (primitive.type === "triangle") return `<path class="dimension-arrow" d="M ${primitive.tip.x} ${primitive.tip.y} L ${primitive.corners[0].x} ${primitive.corners[0].y} L ${primitive.corners[1].x} ${primitive.corners[1].y} Z"/>`;
  if (primitive.type === "marker") return `<circle class="dimension-marker ${primitive.role}" cx="${primitive.center.x}" cy="${primitive.center.y}" r="${primitive.radius}"/>`;
  if (primitive.type === "arc") {
    const start = { x: primitive.center.x + Math.cos(primitive.startAngleRadians) * primitive.radius, y: primitive.center.y + Math.sin(primitive.startAngleRadians) * primitive.radius };
    const endAngle = primitive.startAngleRadians + primitive.sweepRadians;
    const end = { x: primitive.center.x + Math.cos(endAngle) * primitive.radius, y: primitive.center.y + Math.sin(endAngle) * primitive.radius };
    return `<path class="dimension-arc" d="M ${start.x} ${start.y} A ${primitive.radius} ${primitive.radius} 0 ${Math.abs(primitive.sweepRadians) > Math.PI ? 1 : 0} ${primitive.sweepRadians >= 0 ? 1 : 0} ${end.x} ${end.y}"/>`;
  }
  const width = Math.max(34, labelValue.length * 6.5 + 10);
  return `<g class="dimension-label" transform="rotate(${primitive.rotationRadians * 180 / Math.PI} ${primitive.anchor.x} ${primitive.anchor.y})"><rect class="dimension-value-bg" x="${primitive.anchor.x - width / 2}" y="${primitive.anchor.y - 13}" width="${width}" height="17" rx="3"/><text class="dimension-value" x="${primitive.anchor.x}" y="${primitive.anchor.y}" text-anchor="middle">${escapeHtml(labelValue)}</text></g>`;
}

function semanticDimensionMarkup(constraint: Constraint, placement: Point2, className: string, attributes: string, sketch: Sketch, override?: { value: number; unit: "mm" | "deg" }): string {
  const input = dimensionLayoutInput(constraint, placement, sketch); if (!input) return "";
  const layout = layoutSketchDimension(input); if (layout.status !== "valid") return "";
  const measured = override ?? dimensionConstraintValue(constraint); if (!measured) return "";
  const label = `${Number(measured.value.toFixed(3))} ${measured.unit}`;
  const mode = input.kind === "linear" ? layout.orientation : input.kind === "angular" ? "angle" : input.kind;
  const extents = layout.primitives.flatMap((primitive): { x: number; y: number }[] => {
    if (primitive.type === "line") return [primitive.start, primitive.end];
    if (primitive.type === "triangle") return [primitive.tip, ...primitive.corners];
    if (primitive.type === "marker") return [{ x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius }, { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius }];
    if (primitive.type === "arc") return [{ x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius }, { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius }];
    return [{ x: primitive.anchor.x - 45, y: primitive.anchor.y - 15 }, { x: primitive.anchor.x + 45, y: primitive.anchor.y + 7 }];
  });
  const minX = Math.min(...extents.map((point) => point.x)) - 3; const maxX = Math.max(...extents.map((point) => point.x)) + 3;
  const minY = Math.min(...extents.map((point) => point.y)) - 3; const maxY = Math.max(...extents.map((point) => point.y)) + 3;
  const hitArea = `<circle class="dimension-hit-area" cx="${(minX + maxX) / 2}" cy="${(minY + maxY) / 2}" r="8"/>`;
  return `<g class="${className}" data-dimension-preview-mode="${escapeHtml(mode ?? input.kind)}" ${attributes}>${hitArea}${layout.primitives.map((primitive) => dimensionPrimitiveMarkup(primitive, label)).join("")}</g>`;
}

function pendingDimensionPreviewMarkup(sketch: Sketch): string {
  if (!pendingDimensionPlacement || pendingDimensionPlacement.command.kind !== "add_constraint" || !pendingDimensionPlacement.position) return "";
  const placement = sketchOverlayPoint(pendingDimensionPlacement.position);
  if (!placement) return "";
  const constraint = pendingDimensionPlacement.command.constraint;
  const semantic = semanticDimensionMarkup(constraint, pendingDimensionPlacement.position, "sketch-dimension-placement-preview", "", sketch, { value: sketchConstraintValue, unit: constraint.kind === "angle" || constraint.kind === "angle_to_axis" ? "deg" : "mm" });
  if (semantic) {
    const mode = constraint.kind === "distance_x" ? "Horizontal" : constraint.kind === "distance_y" ? "Vertical" : constraint.kind === "distance" ? "Aligned · parallel" : undefined;
    return mode && !pendingDimensionPlacement.placed ? `${semantic.slice(0, -4)}<text class="dimension-snap-label" x="${placement.x + 12}" y="${placement.y + 19}">${escapeHtml(mode)}</text></g>` : semantic;
  }
  if (["distance", "distance_x", "distance_y"].includes(constraint.kind)) {
    const linear = constraint as Extract<Constraint, { kind: "distance" | "distance_x" | "distance_y" }>;
    const first = sketchOverlayPoint(pointForRef(sketch, linear.a)!);
    const second = sketchOverlayPoint(pointForRef(sketch, linear.b)!);
    if (first && second) {
      const mode = linear.kind;
      const snapLabel = pendingDimensionPlacement.placed ? undefined : mode === "distance_x" ? "Horizontal" : mode === "distance_y" ? "Vertical" : "Aligned · parallel";
      return linearDimensionPreviewMarkup(first, second, placement, mode, sketchConstraintValue, snapLabel);
    }
  }
  if (constraint.kind === "angle") return angleDimensionPreviewMarkup(placement, sketch);
  return `<g class="sketch-dimension-placement-preview" data-dimension-preview-mode="${escapeHtml(constraint.kind)}"><rect x="${placement.x + 10}" y="${placement.y - 32}" width="88" height="20" rx="4"/><text x="${placement.x + 16}" y="${placement.y - 18}">${escapeHtml(`${sketchConstraintValue.toFixed(3)} mm`)}</text></g>`;
}

const sketchSvgLayerCache = new SketchSvgLayerCache();
const sketchRenderIndexCache = new SketchRenderIndexCache();

function ensureSketchSvgLayers(overlay: SVGSVGElement): Map<SketchSvgLayerName, SVGGElement> {
  const existing = new Map<SketchSvgLayerName, SVGGElement>();
  for (const child of Array.from(overlay.children)) {
    const name = child.getAttribute("data-sketch-layer") as SketchSvgLayerName | null;
    if (name && SKETCH_SVG_LAYER_NAMES.includes(name) && child instanceof SVGGElement) existing.set(name, child);
  }
  if (existing.size === SKETCH_SVG_LAYER_NAMES.length && overlay.children.length === SKETCH_SVG_LAYER_NAMES.length) return existing;
  const layers = SKETCH_SVG_LAYER_NAMES.map((name) => {
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("data-sketch-layer", name);
    return layer;
  });
  overlay.replaceChildren(...layers);
  sketchSvgLayerCache.invalidate();
  return new Map(layers.map((layer, index) => [SKETCH_SVG_LAYER_NAMES[index], layer]));
}

function updateSketchSvgLayer(layers: Map<SketchSvgLayerName, SVGGElement>, name: SketchSvgLayerName, markup: string): void {
  if (!sketchSvgLayerCache.update(name, markup)) return;
  layers.get(name)!.innerHTML = markup;
}

function updateKeyedSketchSvgLayer(layers: Map<SketchSvgLayerName, SVGGElement>, name: SketchSvgLayerName, fragments: readonly SketchSvgFragment[]): void {
  const signature = fragments.map(({ key, markup }) => `${key}\u0000${markup}`).join("\u0001");
  if (!sketchSvgLayerCache.update(name, signature)) return;
  reconcileSketchSvgFragments(layers.get(name)!, fragments);
}

function focusedSketchConstraintId(): string | undefined {
  return sketchHoverTarget?.kind === "constraint" && sketchHoverTarget.valid
    ? sketchHoverTarget.id
    : selectedSketchConstraint;
}

function sketchConstraintGlyphPlacements(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  project: (value: Point2) => { x: number; y: number } | undefined,
): ReadonlyMap<string, ConstraintGlyphPlacement> {
  const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
  const inputs = constraintAnnotations(sketch, ids).flatMap((annotation) => {
    if (annotation.dimension !== undefined ? !sketchVisibility.has("dimensions") : !sketchVisibility.has("constraints")) return [];
    const screen = project(sketch.dimension_positions?.[annotation.id] ?? sketchDimensionPositions.get(annotation.id) ?? annotation.position);
    if (!screen) return [];
    return annotation.dimension !== undefined
      ? [{ id: `dimension:${annotation.id}`, x: screen.x + 7, y: screen.y - 20, width: Math.max(42, annotation.label.length * 7 + 12), height: 22, fixed: true }]
      : [{ id: annotation.id, x: screen.x + 5, y: screen.y - 25 }];
  });
  return new Map(layoutConstraintGlyphs(inputs, { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }).map((placement) => [placement.id, placement]));
}

function sketchConstraintFocusMarkup(
  sketch: Sketch,
  project: (value: Point2) => { x: number; y: number } | undefined,
): string {
  const id = focusedSketchConstraintId();
  const constraint = id ? sketch.constraints[id] : undefined;
  if (!id || !constraint) return "";
  const annotation = constraintAnnotations(sketch, new Set([id]))[0];
  const annotationPoint = annotation
    ? project(sketch.dimension_positions?.[id] ?? sketchDimensionPositions.get(id) ?? annotation.position)
    : undefined;
  if (!annotationPoint) return "";
  const visibleIds = selectedConstraintIds(sketch, selectedSketchGeometry, selectedSketchPoints, selectedSketchConstraint);
  const placement = sketchConstraintGlyphPlacements(sketch, visibleIds, project).get(id);
  const source = placement ? { x: placement.x + 14, y: placement.y + 14 } : { x: annotationPoint.x + 19, y: annotationPoint.y - 11 };
  const operands = positionedConstraintVisualOperands(sketch, constraint)
    .map((operand) => ({ ...operand, screen: project(operand.point) }))
    .filter((operand): operand is typeof operand & { screen: { x: number; y: number } } => Boolean(operand.screen));
  const connectors = operands.flatMap((operand, index) => {
    const dx = operand.screen.x - source.x; const dy = operand.screen.y - source.y;
    if (Math.hypot(dx, dy) < 17) return [];
    return `<line data-constraint-operand-index="${index}" x1="${source.x}" y1="${source.y}" x2="${operand.screen.x}" y2="${operand.screen.y}"/>`;
  }).join("");
  const anchors = operands.map((operand, index) => `<circle data-constraint-operand-index="${index}" data-constraint-operand-role="${operand.role}" cx="${operand.screen.x}" cy="${operand.screen.y}" r="${operand.role === "point" ? 4.5 : 3.5}"/>`).join("");
  return `<g class="sketch-constraint-focus" data-focus-constraint="${escapeHtml(id)}" aria-hidden="true">${connectors}${anchors}</g>`;
}

function sketchConstraintToolbarMarkup(id: string, state: SketchConstraintVisualState, dimensional: boolean, x: number, y: number): string {
  const actions = [
    ...(dimensional ? [{ action: "edit", label: "Edit" }] : []),
    { action: "toggle", label: state === "reference" || state === "suppressed" ? "Enable" : dimensional ? "Reference" : "Suppress" },
    { action: "delete", label: "Delete" },
  ];
  const widths = actions.map((action) => Math.max(42, action.label.length * 6 + 12));
  const width = widths.reduce((sum, value) => sum + value, 0);
  const overlayBounds = document.querySelector<SVGSVGElement>("#sketch-overlay")!.getBoundingClientRect();
  const inspectorBounds = document.querySelector<HTMLElement>("#inspector")?.getBoundingClientRect();
  const rightEdge = inspectorBounds && inspectorBounds.left > overlayBounds.left && inspectorBounds.left < overlayBounds.right
    ? inspectorBounds.left - overlayBounds.left - 8
    : overlayBounds.width - 8;
  const leftEdge = Math.max(6, Math.min(Math.max(6, rightEdge - width), x - width / 2));
  const topEdge = Math.max(6, Math.min(Math.max(6, overlayBounds.height - 28), y));
  let offset = 0;
  const buttons = actions.map(({ action, label }, index) => {
    const buttonWidth = widths[index]; const left = leftEdge + offset; offset += buttonWidth;
    return `<g class="sketch-constraint-toolbar-action ${action}" data-constraint-canvas-action="${action}" data-constraint-action-id="${escapeHtml(id)}" role="button" tabindex="0" aria-label="${escapeHtml(label)} constraint"><rect x="${left}" y="${topEdge}" width="${buttonWidth}" height="22"/><text x="${left + buttonWidth / 2}" y="${topEdge + 15}" text-anchor="middle">${escapeHtml(label)}</text></g>`;
  }).join("");
  return `<g class="sketch-constraint-toolbar" data-constraint-toolbar-for="${escapeHtml(id)}" data-constraint-state="${state}" aria-label="Constraint actions">${buttons}</g>`;
}

function sketchMobilityHintMarkup(kind: SketchMobilityKind, position: { x: number; y: number }, geometry: string, anchor: string): string {
  if (kind === "none") return "";
  const horizontal = `<path d="M -14 0 H 14 M -10 -4 L -14 0 -10 4 M 10 -4 L 14 0 10 4"/>`;
  const vertical = `<path d="M 0 -14 V 14 M -4 -10 L 0 -14 4 -10 M -4 10 L 0 14 4 10"/>`;
  const body = kind === "xy" ? `${horizontal}${vertical}`
    : kind === "x" ? horizontal
      : kind === "y" ? vertical
        : kind === "angular" ? `<path d="M -10 6 A 12 12 0 0 1 9 -8 M 5 -10 L 10 -9 9 -4"/>`
          : kind === "radial" ? `<path d="M -10 10 10 -10 M -10 5 L -10 10 -5 10 M 5 -10 H 10 V -5"/>`
            : `<path d="M -13 5 Q 0 -8 13 5 M -10 0 L -13 5 -8 7 M 10 0 L 13 5 8 7"/>`;
  return `<g class="sketch-mobility-hint ${kind}" data-mobility-for="${escapeHtml(geometry)}:${escapeHtml(anchor)}" data-mobility-kind="${kind}" transform="translate(${position.x} ${position.y})" aria-label="${escapeHtml(kind)} movement remains">${body}</g>`;
}

type SketchDynamicClassState = {
  hoverId?: string;
  hoverClass?: "preselected" | "invalid-preselection";
  inferenceTargets: Set<string>;
  inferenceSources: Set<string>;
  selectedGeometry: Set<string>;
  selectedSegments: Set<string>;
  boxPreview: Set<string>;
  constraintOperands: Set<string>;
  constraintPoints: Set<string>;
};

const sketchDynamicClassState: SketchDynamicClassState = {
  inferenceTargets: new Set(),
  inferenceSources: new Set(),
  selectedGeometry: new Set(),
  selectedSegments: new Set(),
  boxPreview: new Set(),
  constraintOperands: new Set(),
  constraintPoints: new Set(),
};
const sketchDynamicEntityElements = new Map<string, SVGElement[]>();
const sketchDynamicClassCounters = { patchPasses: 0, geometryIdsPatched: 0, fullScans: 0 };

function syncSketchDynamicEntityClasses(
  overlay: SVGSVGElement,
  inferenceTargets: ReadonlySet<string>,
  inferenceSources: ReadonlySet<string>,
  force = false,
): void {
  const nextHoverId = sketchHoverTarget?.kind === "geometry" ? sketchHoverTarget.id : undefined;
  const nextHoverClass = nextHoverId ? (sketchHoverTarget?.valid ? "preselected" : "invalid-preselection") : undefined;
  const nextSelectedGeometry = new Set(selectedSketchGeometry);
  const nextSelectedSegments = new Set(selectedSketchSegments.map(({ geometry, segment }) => `${geometry}:${segment}`));
  const nextBoxPreview = new Set(sketchBoxSelectionHitIds());
  const focusedConstraint = focusedSketchConstraintId();
  const constraint = focusedConstraint && sketchSession ? sketchSession.draftView.constraints[focusedConstraint] : undefined;
  const constraintOperands = constraint ? constraintVisualOperands(constraint) : [];
  const nextConstraintOperands = new Set(constraintOperands.filter((operand) => operand.geometry !== "reference:origin").map((operand) => operand.geometry));
  const nextConstraintPoints = new Set(constraintOperands.filter((operand) => operand.anchor && operand.geometry !== "reference:origin").map((operand) => constraintPointKey({ geometry: operand.geometry, anchor: operand.anchor! })));
  const changed = new Set<string>();
  if (force) {
    // This is the only full enumeration: a stable layer may have inserted new
    // nodes whose dynamic state must be initialized. Pointer frames never use it.
    sketchDynamicEntityElements.clear();
    overlay.querySelectorAll<SVGElement>(".sketch-entity[data-sketch-geometry], .sketch-entity-hit[data-sketch-hit-geometry]").forEach((element) => {
      const id = element.dataset.sketchGeometry ?? element.dataset.sketchHitGeometry;
      if (!id) return;
      changed.add(id);
      const elements = sketchDynamicEntityElements.get(id) ?? [];
      elements.push(element);
      sketchDynamicEntityElements.set(id, elements);
    });
    sketchDynamicClassCounters.fullScans += 1;
  } else {
    if (sketchDynamicClassState.hoverId) changed.add(sketchDynamicClassState.hoverId);
    if (nextHoverId) changed.add(nextHoverId);
    for (const id of sketchDynamicClassState.inferenceTargets) if (!inferenceTargets.has(id)) changed.add(id);
    for (const id of inferenceTargets) if (!sketchDynamicClassState.inferenceTargets.has(id)) changed.add(id);
    for (const id of sketchDynamicClassState.inferenceSources) if (!inferenceSources.has(id)) changed.add(id);
    for (const id of inferenceSources) if (!sketchDynamicClassState.inferenceSources.has(id)) changed.add(id);
    for (const id of sketchDynamicClassState.selectedGeometry) if (!nextSelectedGeometry.has(id)) changed.add(id);
    for (const id of nextSelectedGeometry) if (!sketchDynamicClassState.selectedGeometry.has(id)) changed.add(id);
    for (const key of sketchDynamicClassState.selectedSegments) if (!nextSelectedSegments.has(key)) changed.add(key.slice(0, key.lastIndexOf(":")));
    for (const key of nextSelectedSegments) if (!sketchDynamicClassState.selectedSegments.has(key)) changed.add(key.slice(0, key.lastIndexOf(":")));
    for (const id of sketchDynamicClassState.boxPreview) if (!nextBoxPreview.has(id)) changed.add(id);
    for (const id of nextBoxPreview) if (!sketchDynamicClassState.boxPreview.has(id)) changed.add(id);
    for (const id of sketchDynamicClassState.constraintOperands) if (!nextConstraintOperands.has(id)) changed.add(id);
    for (const id of nextConstraintOperands) if (!sketchDynamicClassState.constraintOperands.has(id)) changed.add(id);
  }
  for (const id of changed) {
    const indexed = sketchDynamicEntityElements.get(id);
    const elements = indexed?.every((element) => element.isConnected)
      ? indexed
      : Array.from(overlay.querySelectorAll<SVGElement>(`.sketch-entity[data-sketch-geometry="${CSS.escape(id)}"], .sketch-entity-hit[data-sketch-hit-geometry="${CSS.escape(id)}"]`));
    if (!indexed || elements !== indexed) sketchDynamicEntityElements.set(id, elements);
    elements.forEach((element) => {
      const hovered = id === nextHoverId;
      element.classList.toggle("preselected", hovered && nextHoverClass === "preselected");
      element.classList.toggle("invalid-preselection", hovered && nextHoverClass === "invalid-preselection");
      element.classList.toggle("inference-target", inferenceTargets.has(id));
      element.classList.toggle("inference-source", inferenceSources.has(id));
      element.classList.toggle("selected", nextSelectedGeometry.has(id));
      element.classList.toggle("box-preview", nextBoxPreview.has(id));
      element.classList.toggle("constraint-operand", nextConstraintOperands.has(id));
      const segment = element.dataset.sketchSegment;
      element.classList.toggle("segment-selected", segment !== undefined && nextSelectedSegments.has(`${id}:${segment}`));
      const selected = nextSelectedGeometry.has(id) || (segment !== undefined && nextSelectedSegments.has(`${id}:${segment}`));
      if (element.classList.contains("sketch-entity")) {
        element.setAttribute("aria-pressed", String(selected));
        const baseLabel = element.dataset.baseAriaLabel ?? element.getAttribute("aria-label") ?? `Select ${id}`;
        element.dataset.baseAriaLabel = baseLabel;
        const interactionState = selected ? "Selected" : hovered && nextHoverClass === "preselected" ? "Preselected" : hovered ? "Invalid selection target" : "";
        element.setAttribute("aria-label", interactionState ? `${baseLabel} · ${interactionState}` : baseLabel);
      }
    });
  }
  const changedPoints = new Set([...sketchDynamicClassState.constraintPoints, ...nextConstraintPoints]);
  for (const key of changedPoints) {
    const separator = key.indexOf("\u0000");
    const geometry = key.slice(0, separator); const anchor = key.slice(separator + 1);
    overlay.querySelectorAll<SVGElement>(`.sketch-handle[data-geometry="${CSS.escape(geometry)}"][data-anchor="${CSS.escape(anchor)}"]`).forEach((element) => {
      element.classList.toggle("constraint-operand", nextConstraintPoints.has(key));
    });
  }
  overlay.querySelector<SVGElement>("[data-sketch-origin]")?.classList.toggle("constraint-operand", constraintOperands.some((operand) => operand.role === "origin"));
  sketchDynamicClassState.hoverId = nextHoverId;
  sketchDynamicClassState.hoverClass = nextHoverClass;
  sketchDynamicClassState.inferenceTargets = new Set(inferenceTargets);
  sketchDynamicClassState.inferenceSources = new Set(inferenceSources);
  sketchDynamicClassState.selectedGeometry = nextSelectedGeometry;
  sketchDynamicClassState.selectedSegments = nextSelectedSegments;
  sketchDynamicClassState.boxPreview = nextBoxPreview;
  sketchDynamicClassState.constraintOperands = nextConstraintOperands;
  sketchDynamicClassState.constraintPoints = nextConstraintPoints;
  sketchDynamicClassCounters.patchPasses += 1;
  sketchDynamicClassCounters.geometryIdsPatched += changed.size;
}

function resetSketchDynamicEntityClasses(): void {
  sketchDynamicClassState.hoverId = undefined;
  sketchDynamicClassState.hoverClass = undefined;
  sketchDynamicClassState.inferenceTargets.clear();
  sketchDynamicClassState.inferenceSources.clear();
  sketchDynamicClassState.selectedGeometry.clear();
  sketchDynamicClassState.selectedSegments.clear();
  sketchDynamicClassState.boxPreview.clear();
  sketchDynamicClassState.constraintOperands.clear();
  sketchDynamicClassState.constraintPoints.clear();
  sketchDynamicEntityElements.clear();
}


function buildSketchTransientMarkup(
  sketch: Sketch,
  activeTool: SketchTool,
  point: (value: Point2) => { x: number; y: number } | undefined,
  path: (values: readonly Point2[], close?: boolean) => string | undefined,
): string[] {
const facsimile: string[] = [];
const creationPreview = inlineCreationPreview();
const previewFixedPoints = creationPreview?.valid ? creationPreview.points.slice(0, -1) : sketchPoints;
const previewHoverPoint = creationPreview?.valid ? creationPreview.points.at(-1) : sketchHoverPoint;
const accurateCreationFacsimiles = inlineCreationFacsimiles(creationPreview);
for (const value of accurateCreationFacsimiles) {
  const points = sketchGeometrySelectionPath(value);
  const d = path(points, value.kind === "circle" || value.kind === "ellipse" || value.kind === "rectangle");
  if (d) facsimile.push(`<path class="sketch-facsimile" data-inline-creation-facsimile="${escapeHtml(value.kind)}" d="${d}"/>`);
}
const facsimileValue: Geometry | undefined = accurateCreationFacsimiles.length === 0 && sketchToolArmed && previewHoverPoint
  ? sketchToolFacsimile(activeTool, previewFixedPoints, previewHoverPoint)
  : undefined;
if (facsimileValue?.kind === "line") {
  const start = point(facsimileValue.start); const end = point(facsimileValue.end);
  if (start && end) facsimile.push(`<line class="sketch-facsimile" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`);
} else if (facsimileValue?.kind === "circle") {
  const samples = Array.from({ length: 65 }, (_, index) => {
    const angle = index * Math.PI * 2 / 64;
    return { x_nm: facsimileValue.center.x_nm + Math.round(Math.cos(angle) * facsimileValue.radius_nm), y_nm: facsimileValue.center.y_nm + Math.round(Math.sin(angle) * facsimileValue.radius_nm) };
  });
  const d = path(samples, true);
  if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "arc") {
  const radius = Math.hypot(facsimileValue.start.x_nm - facsimileValue.center.x_nm, facsimileValue.start.y_nm - facsimileValue.center.y_nm);
  const startAngle = Math.atan2(facsimileValue.start.y_nm - facsimileValue.center.y_nm, facsimileValue.start.x_nm - facsimileValue.center.x_nm);
  let sweep = Math.atan2(facsimileValue.end.y_nm - facsimileValue.center.y_nm, facsimileValue.end.x_nm - facsimileValue.center.x_nm) - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  const samples = Array.from({ length: 49 }, (_, index) => {
    const angle = startAngle + sweep * index / 48;
    return { x_nm: facsimileValue.center.x_nm + Math.round(Math.cos(angle) * radius), y_nm: facsimileValue.center.y_nm + Math.round(Math.sin(angle) * radius) };
  });
  const d = path(samples);
  if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "rectangle") {
  const d = path([facsimileValue.min, { x_nm: facsimileValue.max.x_nm, y_nm: facsimileValue.min.y_nm }, facsimileValue.max, { x_nm: facsimileValue.min.x_nm, y_nm: facsimileValue.max.y_nm }], true);
  if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "control_point_spline") {
  const d = path(sampleControlPointSpline(facsimileValue.control_points, 48, facsimileValue.degree, facsimileValue.knots_millionths));
  const controlPath = path(facsimileValue.control_points);
  if (controlPath && sketchShowSplineControlPolygon) facsimile.push(`<path class="sketch-spline-control-polygon facsimile" d="${controlPath}" />`);
  if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "fit_point_spline") {
  const d = path(sampleFitPointSpline(facsimileValue.fit_points)); if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "ellipse") {
  const d = path(sampleEllipse(facsimileValue.center, facsimileValue.major, facsimileValue.minor), true); if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "elliptical_arc") {
  const d = path(sampleEllipticalArc(facsimileValue.center, facsimileValue.major, facsimileValue.minor, facsimileValue.start, facsimileValue.end, facsimileValue.clockwise)); if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
} else if (facsimileValue?.kind === "conic") {
  const d = path(sampleConic(facsimileValue.start, facsimileValue.control, facsimileValue.end, facsimileValue.weight_millionths)); if (d) facsimile.push(`<path class="sketch-facsimile" d="${d}" />`);
}
const canonicalPreview = pendingSketchEditPreview?.prepared?.preview.sketch;
for (const geometryId of pendingSketchEditPreview?.canonicalGeometryIds ?? []) {
  const entity = canonicalPreview?.geometry[geometryId];
  if (!entity) continue;
  const previewPath = path(sketchGeometrySelectionPath(entity.geometry), entity.geometry.kind === "circle" || entity.geometry.kind === "ellipse" || entity.geometry.kind === "rectangle");
  if (previewPath) facsimile.push(`<path class="sketch-operation-preview" data-canonical-preview="true" data-preview-geometry="${escapeHtml(geometryId)}" d="${previewPath}" />`);
}
for (const command of pendingSketchEditPreview?.prepared ? [] : pendingSketchEditPreview?.commands ?? []) {
  if (command.kind === "add_geometry") {
    const previewPath = path(sketchGeometrySelectionPath(command.entity.geometry), command.entity.geometry.kind === "circle" || command.entity.geometry.kind === "rectangle");
    if (previewPath) facsimile.push(`<path class="sketch-operation-preview" d="${previewPath}" />`);
  } else if (command.kind === "move_point") {
    const from = pointForRef(sketch, command.point);
    const fromScreen = from ? point(from) : undefined;
    const toScreen = point(command.to);
    if (fromScreen && toScreen) facsimile.push(`<path class="sketch-operation-preview" d="M ${fromScreen.x} ${fromScreen.y} L ${toScreen.x} ${toScreen.y}"/><circle class="sketch-operation-preview-target" cx="${toScreen.x}" cy="${toScreen.y}" r="5"/>`);
  }
}
const dimensionPreview = pendingDimensionPreviewMarkup(sketch);
if (dimensionPreview) facsimile.push(dimensionPreview);
const cursor = sketchHoverPoint ? point(sketchHoverPoint) : undefined;
if (cursor) {
  const snapClass = sketchHoverSnap?.inferences.length ? " snapped" : "";
  const targetClass = sketchHoverTarget ? (sketchHoverTarget.valid ? " valid-target" : " invalid-target") : "";
  const showInferenceBadges = Boolean(activeSketchToolKey() && !pendingDimensionPlacement);
  const inferenceBadges = (showInferenceBadges ? sketchHoverSnap?.inferences ?? [] : []).map((inference, index) => {
    const label = inference.kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
    const x = cursor.x + 13 + index * 25; const y = cursor.y - 35;
    return `<g class="sketch-inference-badge" data-inference-kind="${inference.kind}" role="img" aria-label="Inferred ${escapeHtml(label)} constraint"><rect x="${x}" y="${y}" width="22" height="22" rx="5"/><svg x="${x + 1}" y="${y + 1}" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">${sketchConstraintIconBody(sketchInferenceConstraintKind(inference.kind))}</svg></g>`;
  }).join("");
  const cursorBadge = activeSketchToolKey() || pendingDimensionPlacement || (sketchHoverTarget && !sketchHoverTarget.valid)
    ? `<text class="sketch-cursor-badge" x="${cursor.x + 12}" y="${cursor.y + 20}">${escapeHtml(sketchHoverTarget && !sketchHoverTarget.valid ? `× ${sketchHoverTarget.reason ?? "invalid"}` : sketchCursorBadge())}</text>`
    : "";
  facsimile.push(`<g class="sketch-cursor${snapClass}${targetClass}${showInferenceBadges && sketchHoverSnap?.inferences.length ? " inference-source" : ""}"><circle cx="${cursor.x}" cy="${cursor.y}" r="5"/><path d="M ${cursor.x - 9} ${cursor.y} H ${cursor.x + 9} M ${cursor.x} ${cursor.y - 9} V ${cursor.y + 9}" />${inferenceBadges}${cursorBadge}</g>`);
  const datum = sketchPoints.at(-1); const datumPosition = datum ? point(datum) : undefined;
  if (datumPosition && sketchHoverSnap?.inferences.some((inference) => inference.kind === "horizontal")) facsimile.unshift(`<line class="sketch-inference-guide" x1="${datumPosition.x}" y1="${datumPosition.y}" x2="${cursor.x}" y2="${cursor.y}" />`);
  if (datumPosition && sketchHoverSnap?.inferences.some((inference) => inference.kind === "vertical")) facsimile.unshift(`<line class="sketch-inference-guide" x1="${datumPosition.x}" y1="${datumPosition.y}" x2="${cursor.x}" y2="${cursor.y}" />`);
}
for (const [index, fixed] of sketchPoints.entries()) {
  const position = point(fixed);
  const directionalTarget = index === sketchPoints.length - 1 && sketchHoverSnap?.inferences.some((inference) => inference.kind === "horizontal" || inference.kind === "vertical");
  if (position) facsimile.push(`<circle class="sketch-fixed-point${directionalTarget ? " inference-target" : ""}" cx="${position.x}" cy="${position.y}" r="4" />`);
}
  return facsimile;
}

function syncSketchPointerToolUi(): void {
  const workspace = document.querySelector<HTMLElement>(".workspace")!;
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  const cursorMode = sketchSession ? sketchCursorMode() : "select";
  const cursorTarget = sketchHoverTarget ? (sketchHoverTarget.valid ? "valid" : "invalid") : "none";
  setDatasetIfChanged(workspace, "sketchCursor", cursorMode);
  setDatasetIfChanged(overlay, "cursorState", cursorMode);
  setDatasetIfChanged(overlay, "cursorTarget", cursorTarget);
  setDatasetIfChanged(workspace, "sketchCursorTarget", cursorTarget);
}

function sketchInferenceGeometryIds(): { targets: Set<string>; sources: Set<string> } {
  return {
    targets: new Set((sketchHoverSnap?.inferences ?? []).map((inference) => inference.target.geometry).filter((id) => !id.startsWith("preview:") && !id.startsWith("reference:"))),
    sources: new Set((sketchHoverSnap?.inferences ?? []).map((inference) => inference.source.geometry).filter((id) => !id.startsWith("preview:") && !id.startsWith("reference:"))),
  };
}

function sketchBoxSelectionHitIds(): string[] {
  if (!sketchBoxSelection || !sketchSession) return [];
  const box = sketchBoxSelection;
  const minX = Math.min(box.start.x, box.current.x); const maxX = Math.max(box.start.x, box.current.x);
  const minY = Math.min(box.start.y, box.current.y); const maxY = Math.max(box.start.y, box.current.y);
  if (maxX - minX < 2 && maxY - minY < 2) return [];
  const containment = box.current.x >= box.start.x;
  const inside = (point: { x: number; y: number }) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  return Object.values(sketchSession.draft.geometry).filter((entity) => {
    if (!sketchEntityMatchesFilter(entity, sketchSelectionFilters)) return false;
    const points = sketchGeometrySelectionPath(entity.geometry).map(sketchOverlayPoint).filter((point): point is { x: number; y: number } => Boolean(point));
    if (!points.length) return false;
    if (containment) return points.every(inside);
    if (points.some(inside)) return true;
    const segments = points.slice(0, -1).map((point, index) => [point, points[index + 1]] as const);
    if (["circle", "ellipse", "rectangle"].includes(entity.geometry.kind) && points.length > 1) segments.push([points.at(-1)!, points[0]]);
    return segments.some(([a, b]) => screenSegmentIntersectsBox(a, b, minX, minY, maxX, maxY));
  }).map((entity) => entity.id);
}

function sketchSelectionBoxMarkup(): string {
  if (!sketchBoxSelection) return "";
  const box = sketchBoxSelection;
  const containment = box.current.x >= box.start.x;
  const x = Math.min(box.start.x, box.current.x); const y = Math.min(box.start.y, box.current.y);
  const width = Math.abs(box.current.x - box.start.x); const height = Math.abs(box.current.y - box.start.y);
  const count = sketchBoxSelectionHitIds().length;
  const operation = box.mode === "add" ? "Add" : box.mode === "remove" ? "Remove" : box.mode === "toggle" ? "Toggle" : undefined;
  const label = `${operation ? `${operation} · ` : ""}${containment ? "Window · fully inside" : "Crossing · touched"}${count ? ` · ${count}` : ""}`;
  const labelWidth = Math.max(112, label.length * 6.2 + 16);
  const labelX = Math.max(4, x); const labelY = Math.max(4, y - 25);
  return `<g class="sketch-box-selection-group ${containment ? "containment" : "crossing"}" aria-label="${escapeHtml(label)}"><rect class="sketch-box-selection ${containment ? "containment" : "crossing"}" x="${x}" y="${y}" width="${width}" height="${height}" /><rect class="sketch-box-selection-label-bg" x="${labelX}" y="${labelY}" width="${labelWidth}" height="20" rx="3"/><text class="sketch-box-selection-label" x="${labelX + 8}" y="${labelY + 14}">${escapeHtml(label)}</text></g>`;
}

function stableSketchRenderParts(): readonly unknown[] {
  if (!sketchSession) return [];
  const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
  return [
    sketchSession,
    sketchSession.draftView,
    sketchSession.solve,
    sketchSession.profile,
    sketchViewRevision,
    bounds.width,
    bounds.height,
    [...sketchVisibility].sort().join("\u0000"),
    sketchConflictIsolation,
    selectedSketchProfile?.profileId,
    sketchHoverTarget?.kind === "profile" ? `${sketchHoverTarget.id}:${sketchHoverTarget.valid}` : undefined,
  ];
}

const sketchPointerRenderCoordinator = new SketchPointerRenderCoordinator();
const sketchStableGeometryRevision = new IdentityRevisionTracker();
let sketchStableGeometryCache: { token: number; profileFills: string[]; geometry: string[]; hitGeometry: string[] } | undefined;
let sketchViewRevision = 0;

function renderSketchViewChanged(): void {
  sketchViewRevision += 1;
  scheduleSketchPointerInvalidation(SKETCH_POINTER_VIEW_INVALIDATION);
}

function renderSketchTransientOverlay(): void {
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  if (!sketchSession) {
    renderSketchOverlay();
    return;
  }
  const sketch = sketchSession.draftView as Sketch;
  const layers = ensureSketchSvgLayers(overlay);
  const point = (value: Point2) => sketchOverlayPoint(value);
  const path = (values: readonly Point2[], close = false): string | undefined => {
    const projected = values.map(point);
    if (projected.some((value) => !value)) return undefined;
    return `${projected.map((value, index) => `${index === 0 ? "M" : "L"} ${value!.x} ${value!.y}`).join(" ")}${close ? " Z" : ""}`;
  };
  updateSketchSvgLayer(layers, "transient", `${buildSketchTransientMarkup(sketch, sketchSession.activeTool, point, path).join("")}${sketchConstraintFocusMarkup(sketch, point)}`);
  updateSketchSvgLayer(layers, "selection", sketchSelectionBoxMarkup());
  const inference = sketchInferenceGeometryIds();
  syncSketchDynamicEntityClasses(overlay, inference.targets, inference.sources);
}

function renderSketchPointerOverlay(): void {
  sketchPointerRenderCoordinator.render(stableSketchRenderParts(), renderSketchOverlay, renderSketchTransientOverlay);
}

/** Selection now determines the visible relation set, so even dense sketches
 * reconcile their lightweight annotation layer when selection changes. */
function renderSketchSelectionChanged(): void {
  renderSketchOverlay();
}

function renderSketchOverlay(): void {
  const overlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
  if (!sketchSession) {
    overlay.setAttribute("hidden", "");
    overlay.replaceChildren();
    sketchSvgLayerCache.invalidate();
    sketchRenderIndexCache.invalidate();
    sketchPointerRenderCoordinator.invalidate();
    sketchStableGeometryRevision.invalidate();
    sketchStableGeometryCache = undefined;
    resetSketchDynamicEntityClasses();
    syncSketchDimensionEditor();
    return;
  }
  const stableLayerStartedAt = performance.now();
  const sketch = sketchSession.draftView as Sketch;
  sketchPointerRenderCoordinator.acceptFullRender(stableSketchRenderParts());
  const stableGeometryRevision = sketchStableGeometryRevision.resolve(stableSketchRenderParts());
  const generateStableGeometry = stableGeometryRevision.changed || !sketchStableGeometryCache;
  const revisionIndexes = sketchRenderIndexCache.resolveDraft(sketchSession.draftView);
  const solveIndexes = sketchRenderIndexCache.resolveSolve(sketchSession.solve);
  const suppressedConstraints = new Set(sketch.suppressed_constraints ?? []);
  const constrainedTargets = sketchConstraintCoverage(sketch);
  const bounds = document.querySelector<HTMLCanvasElement>("#viewport")!.getBoundingClientRect();
  overlay.removeAttribute("hidden");
  overlay.setAttribute("viewBox", `0 0 ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`);
  const geometry: string[] = generateStableGeometry ? [] : [...sketchStableGeometryCache!.geometry];
  const handles: string[] = [];
  const annotations: string[] = [];
  const constraintToolbars: string[] = [];
  const point = (value: Point2) => sketchOverlayPoint(value);
  const path = (values: readonly Point2[], close = false): string | undefined => {
    const projected = values.map(point);
    if (projected.some((value) => !value)) return undefined;
    return `${projected.map((value, index) => `${index === 0 ? "M" : "L"} ${value!.x} ${value!.y}`).join(" ")}${close ? " Z" : ""}`;
  };
  const handle = (geometryId: string, anchor: PointRef["anchor"], value: Point2) => {
    if (!sketchVisibility.has("points")) return;
    const pointCollection = sketchOperandCollectionActive() || sketchToolArmed;
    const directlySelectableCenter = anchor === "center";
    if (!pointCollection && !directlySelectableCenter && !selectedSketchGeometry.includes(geometryId) && !selectedSketchPoints.some((candidate) => candidate.geometry === geometryId)) return;
    const position = point(value);
    if (!position) return;
    const selected = selectedSketchPoints.some((candidate) => candidate.geometry === geometryId && candidate.anchor === anchor);
    const measurement = anchor.startsWith("parameter:");
    const constrained = constrainedTargets.points.has(constraintPointKey({ geometry: geometryId, anchor }));
    handles.push(`<circle class="sketch-handle${measurement ? " measurement-point" : ""}${constrained ? " constraint-target" : ""}${selected ? " selected" : ""}" data-sketch-handle="${escapeHtml(geometryId)}:${anchor}" data-geometry="${escapeHtml(geometryId)}" data-anchor="${anchor}" data-constraint-state="${constrained ? "constrained" : "unconstrained"}" cx="${position.x}" cy="${position.y}" r="${measurement ? 4 : 6}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${measurement ? "Select tangent measurement point" : "Select or drag"} ${escapeHtml(geometryId)} ${anchor} point · ${constrained ? "constrained" : "unconstrained"}" />`);
    const componentDof = solveIndexes.componentByGeometry.get(geometryId)?.structural_degrees_of_freedom ?? 1;
    const selectionOwnsHandle = selectedSketchGeometry.includes(geometryId) || selected;
    if (!measurement && selectionOwnsHandle && componentDof > 0 && !activeSketchToolKey()) {
      const mobility = sketchPointMobility(sketch, { geometry: geometryId, anchor });
      const markup = sketchMobilityHintMarkup(mobility, position, geometryId, anchor);
      if (markup) handles.push(markup);
    }
  };
  const measurementHandles = (geometryId: string, value: Geometry, parameters: readonly number[]) => {
    if (!sketchSmartDimensionActive && pendingSketchConstraint !== "distance") return;
    for (const parameter of parameters) handle(geometryId, `parameter:${Math.round(parameter * 1_000_000)}`, evaluateGeometryCurve(value, parameter));
  };
  const profileFills = generateStableGeometry ? (() => {
    if (!sketchVisibility.has("profiles")) return [];
    return (sketchSession.profile?.closed_profiles ?? []).flatMap((geometryIds) => {
      const profilePath = closedProfilePolylines(sketch, [geometryIds]).flatMap((profile) => path(profile, true) ?? []).join(" ");
      if (!profilePath) return [];
      const profileId = sketchProfileId(sketch.id, geometryIds);
      const selected = selectedSketchProfile?.sketchId === sketch.id && selectedSketchProfile.profileId === profileId;
      const preselected = sketchHoverTarget?.kind === "profile" && sketchHoverTarget.id === profileId;
      const stateClass = selected ? " selected" : preselected ? (sketchHoverTarget?.valid ? " preselected" : " invalid-preselection") : "";
      return [`<path class="sketch-profile-fill${stateClass}" fill-rule="evenodd" d="${profilePath}" data-sketch-profile-id="${escapeHtml(profileId)}" data-profile-geometry-ids="${escapeHtml(JSON.stringify(geometryIds))}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="Select closed profile ${escapeHtml(profileId)}" />`];
    });
  })() : [...sketchStableGeometryCache!.profileFills];
  const inference = sketchInferenceGeometryIds();
  const orphanedProjection = revisionIndexes.orphanedProjectionGeometry;
  const operationParticipation = revisionIndexes.operationParticipationByGeometry;
  const suppressedOperationGeometry = revisionIndexes.suppressedOperationGeometry;
  const conflictingConstraintIds = new Set(sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints) ?? []);
  for (const entity of Object.values(sketch.geometry)) {
    if (suppressedOperationGeometry.has(entity.id)) continue;
    if (entity.construction && !sketchVisibility.has("construction")) continue;
    if (entity.id.startsWith("external:") && !sketchVisibility.has("projection")) continue;
    const solveComponent = solveIndexes.componentByGeometry.get(entity.id);
    const entityConflicting = (revisionIndexes.constraintIdsByGeometry.get(entity.id) ?? []).some((constraintId) => conflictingConstraintIds.has(constraintId));
    const solveClass = entityConflicting ? " conflicting" : sketchSession.solve?.state === "over_constrained" ? " over-constrained" : (solveComponent?.structural_degrees_of_freedom ?? 1) === 0 ? " fully-constrained" : " under-constrained";
    const baseClass = `${entity.id.startsWith("external:") ? "sketch-entity external" : entity.construction ? "sketch-entity construction" : "sketch-entity"}${solveClass}`;
    const participation = (operationParticipation.get(entity.id) ?? 0) + (revisionIndexes.constraintParticipationByGeometry.get(entity.id) ?? 0);
    const bodyConstrained = constrainedTargets.geometry.has(entity.id);
    const cssClass = `${baseClass}${bodyConstrained ? " constraint-target" : ""}${orphanedProjection.has(entity.id) ? " orphaned-reference" : ""}${sketchConflictIsolation && conflictingConstraintIds.size && !entityConflicting ? " conflict-muted" : ""}`;
    const entityAttributes = `data-sketch-geometry="${escapeHtml(entity.id)}" data-degrees-of-freedom="${solveComponent?.structural_degrees_of_freedom ?? ""}" data-participation="${participation}" data-orphaned-reference="${orphanedProjection.has(entity.id)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(entity.id)} · ${participation} relation(s)"`;
    const value = entity.geometry;
    if (value.kind === "line") {
      const start = point(value.start); const end = point(value.end);
      if (generateStableGeometry && start && end) geometry.push(`<line class="${cssClass}" ${entityAttributes} data-sketch-segment="0" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`);
      handle(entity.id, "start", value.start); handle(entity.id, "end", value.end);
    } else if (value.kind === "circle") {
      const center = point(value.center);
      if (generateStableGeometry) {
        const samples = Array.from({ length: 65 }, (_, index) => {
          const angle = index * Math.PI * 2 / 64;
          return { x_nm: value.center.x_nm + Math.round(Math.cos(angle) * value.radius_nm), y_nm: value.center.y_nm + Math.round(Math.sin(angle) * value.radius_nm) };
        });
        const d = path(samples, true);
        if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`);
      }
      handle(entity.id, "center", value.center);
      const radiusHandle = point({ x_nm: value.center.x_nm + value.radius_nm, y_nm: value.center.y_nm });
      if (center && radiusHandle) {
        handles.push(`<circle class="sketch-handle radius${bodyConstrained ? " constraint-target" : ""}" data-sketch-radius="${escapeHtml(entity.id)}" data-geometry="${escapeHtml(entity.id)}" data-center-x="${value.center.x_nm}" data-center-y="${value.center.y_nm}" data-constraint-state="${bodyConstrained ? "constrained" : "unconstrained"}" cx="${radiusHandle.x}" cy="${radiusHandle.y}" r="6" tabindex="0" role="button" aria-label="Resize ${escapeHtml(entity.id)} radius · ${bodyConstrained ? "constrained" : "unconstrained"}" />`);
        const componentDof = solveIndexes.componentByGeometry.get(entity.id)?.structural_degrees_of_freedom ?? 1;
        if (!bodyConstrained && selectedSketchGeometry.includes(entity.id) && componentDof > 0 && !activeSketchToolKey()) handles.push(sketchMobilityHintMarkup("radial", radiusHandle, entity.id, "radius"));
      }
      measurementHandles(entity.id, value, [0, 0.25, 0.5, 0.75]);
    } else if (value.kind === "arc") {
      if (generateStableGeometry) {
        const radius = Math.hypot(value.start.x_nm - value.center.x_nm, value.start.y_nm - value.center.y_nm);
        const startAngle = Math.atan2(value.start.y_nm - value.center.y_nm, value.start.x_nm - value.center.x_nm);
        const endAngle = Math.atan2(value.end.y_nm - value.center.y_nm, value.end.x_nm - value.center.x_nm);
        let sweep = endAngle - startAngle;
        if (value.clockwise) while (sweep >= 0) sweep -= Math.PI * 2;
        else while (sweep <= 0) sweep += Math.PI * 2;
        const samples = Array.from({ length: 49 }, (_, index) => {
          const angle = startAngle + sweep * index / 48;
          return { x_nm: value.center.x_nm + Math.round(Math.cos(angle) * radius), y_nm: value.center.y_nm + Math.round(Math.sin(angle) * radius) };
        });
        const d = path(samples);
        if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`);
      }
      handle(entity.id, "center", value.center); handle(entity.id, "start", value.start); handle(entity.id, "end", value.end);
      measurementHandles(entity.id, value, [0.25, 0.5, 0.75]);
    } else if (value.kind === "control_point_spline") {
      if (generateStableGeometry) {
        const d = path(sampleControlPointSpline(value.control_points, 48, value.degree, value.knots_millionths));
        if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`);
      }
      if (sketchShowSplineControlPolygon && (selectedSketchGeometry.includes(entity.id) || sketchSession.activeTool === "spline")) {
        const controlPath = path(value.control_points);
        if (controlPath) handles.push(`<path class="sketch-spline-control-polygon" d="${controlPath}" aria-hidden="true" />`);
      }
      value.control_points.forEach((controlPoint, index) => handle(entity.id, `control:${index}`, controlPoint));
      measurementHandles(entity.id, value, [0.25, 0.5, 0.75]);
    } else if (value.kind === "fit_point_spline") {
      if (generateStableGeometry) { const d = path(sampleFitPointSpline(value.fit_points)); if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`); }
      value.fit_points.forEach((fitPoint, index) => handle(entity.id, `fit:${index}`, fitPoint));
      measurementHandles(entity.id, value, [0.25, 0.5, 0.75]);
    } else if (value.kind === "ellipse") {
      if (generateStableGeometry) { const d = path(sampleEllipse(value.center, value.major, value.minor), true); if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`); }
      handle(entity.id, "center", value.center); handle(entity.id, "major", value.major); handle(entity.id, "minor", value.minor);
      measurementHandles(entity.id, value, [0, 0.25, 0.5, 0.75]);
    } else if (value.kind === "elliptical_arc") {
      if (generateStableGeometry) { const d = path(sampleEllipticalArc(value.center, value.major, value.minor, value.start, value.end, value.clockwise)); if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`); }
      handle(entity.id, "center", value.center); handle(entity.id, "major", value.major); handle(entity.id, "minor", value.minor); handle(entity.id, "start", value.start); handle(entity.id, "end", value.end);
      measurementHandles(entity.id, value, [0.25, 0.5, 0.75]);
    } else if (value.kind === "conic") {
      if (generateStableGeometry) { const d = path(sampleConic(value.start, value.control, value.end, value.weight_millionths)); if (d) geometry.push(`<path class="${cssClass}" ${entityAttributes} d="${d}" />`); }
      const polygon = path([value.start, value.control, value.end]); if (polygon && selectedSketchGeometry.includes(entity.id)) handles.push(`<path class="sketch-spline-control-polygon" d="${polygon}" aria-hidden="true" />`);
      handle(entity.id, "start", value.start); handle(entity.id, "control", value.control); handle(entity.id, "end", value.end);
      measurementHandles(entity.id, value, [0.25, 0.5, 0.75]);
    } else if (value.kind === "sketch_point") {
      const sketchPoint = { x_nm: value.x_nm, y_nm: value.y_nm }; const position = generateStableGeometry ? point(sketchPoint) : undefined; if (position) geometry.push(`<circle class="${cssClass}" ${entityAttributes} cx="${position.x}" cy="${position.y}" r="4" />`);
      handle(entity.id, "position", sketchPoint);
    } else {
      if (generateStableGeometry) {
        const corners = [value.min, { x_nm: value.max.x_nm, y_nm: value.min.y_nm }, value.max, { x_nm: value.min.x_nm, y_nm: value.max.y_nm }];
        const projected = corners.map(point);
        if (projected.every(Boolean)) projected.forEach((start, segment) => {
          const end = projected[(segment + 1) % projected.length]!;
          geometry.push(`<line class="${cssClass}" ${entityAttributes} data-sketch-segment="${segment}" aria-label="Select ${escapeHtml(entity.id)} segment ${segment + 1}" x1="${start!.x}" y1="${start!.y}" x2="${end.x}" y2="${end.y}" />`);
        });
      }
      handle(entity.id, "min", value.min); handle(entity.id, "max", value.max);
    }
  }
  const stableLayerGenerationMs = performance.now() - stableLayerStartedAt;
  const facsimile = buildSketchTransientMarkup(sketch, sketchSession.activeTool, point, path);
  facsimile.push(sketchConstraintFocusMarkup(sketch, point));
  const origin = point(ABSOLUTE_SKETCH_ORIGIN);
  const originReference = origin
    ? `<g class="sketch-origin-reference${sketchOriginSelected ? " selected" : ""}" data-sketch-origin tabindex="0" role="button" aria-pressed="${sketchOriginSelected}" aria-label="Absolute origin reference"><circle cx="${origin.x}" cy="${origin.y}" r="7"/><path d="M ${origin.x - 13} ${origin.y} H ${origin.x + 13} M ${origin.x} ${origin.y - 13} V ${origin.y + 13}"/></g>`
    : "";
  const focusedAnnotationIds = visibleConstraintIds(sketch, selectedSketchGeometry, selectedSketchPoints, selectedSketchConstraint);
  const glyphPlacements = sketchConstraintGlyphPlacements(sketch, focusedAnnotationIds, point);
  const redundantConstraintIds = new Set(sketchSession.solve?.redundant_constraints ?? []);
  overlay.dataset.annotationDensity = "selection";
  overlay.dataset.renderedConstraintAnnotations = String(focusedAnnotationIds.size);
  for (const annotation of constraintAnnotations(sketch, focusedAnnotationIds)) {
    if (annotation.dimension !== undefined ? !sketchVisibility.has("dimensions") : !sketchVisibility.has("constraints")) continue;
    const position = point(sketch.dimension_positions?.[annotation.id] ?? sketchDimensionPositions.get(annotation.id) ?? annotation.position);
    if (!position) continue;
    const selected = selectedSketchConstraint === annotation.id;
    const visualState = resolvedSketchConstraintState(sketch, annotation.id, redundantConstraintIds, conflictingConstraintIds);
    const stateLabel = sketchConstraintStateLabel(visualState);
    if (annotation.dimension !== undefined) {
      const constraint = sketch.constraints[annotation.id];
      const semantic = constraint ? semanticDimensionMarkup(
        constraint,
        sketch.dimension_positions?.[annotation.id] ?? sketchDimensionPositions.get(annotation.id) ?? annotation.position,
        `sketch-constraint-annotation dimension ${visualState}${selected ? " selected" : ""}`,
        `data-sketch-constraint-id="${escapeHtml(annotation.id)}" data-constraint-state="${visualState}" tabindex="0" role="button" aria-label="${escapeHtml(stateLabel)} dimension ${escapeHtml(annotation.label)}"`,
        sketch,
      ) : "";
      if (semantic) {
        annotations.push(semantic);
        if (selected) constraintToolbars.push(sketchConstraintToolbarMarkup(annotation.id, visualState, true, position.x, position.y + 24));
        continue;
      }
    }
    const constraint = sketch.constraints[annotation.id];
    if (!constraint) continue;
    const label = constraintKindLabel(constraint.kind);
    const placement = glyphPlacements.get(annotation.id);
    const glyphX = placement?.x ?? position.x + 5; const glyphY = placement?.y ?? position.y - 25;
    const leader = placement?.displaced ? `<line class="sketch-constraint-glyph-leader" x1="${position.x}" y1="${position.y}" x2="${glyphX + 14}" y2="${glyphY + 14}"/>` : "";
    const stackBadge = placement && placement.clusterSize > 1 && placement.clusterIndex === 0 ? `<g class="sketch-constraint-stack-badge" aria-label="${placement.clusterSize} constraints at this location"><circle cx="${glyphX + 27}" cy="${glyphY + 1}" r="7"/><text x="${glyphX + 27}" y="${glyphY + 4}" text-anchor="middle">${placement.clusterSize}</text></g>` : "";
    annotations.push(`<g class="sketch-constraint-annotation icon ${visualState}${placement?.displaced ? " displaced" : ""}${selected ? " selected" : ""}" data-sketch-constraint-id="${escapeHtml(annotation.id)}" data-constraint-state="${visualState}" data-glyph-stack-depth="${placement?.stackDepth ?? 0}" data-glyph-cluster-index="${placement?.clusterIndex ?? 0}" data-glyph-cluster-size="${placement?.clusterSize ?? 1}" tabindex="0" role="button" aria-label="${escapeHtml(label)} constraint · ${escapeHtml(stateLabel)}${placement && placement.clusterSize > 1 ? ` · ${placement.clusterSize} constraints expanded from this location` : ""}">${leader}<rect x="${glyphX}" y="${glyphY}" width="28" height="28" rx="6"/><svg class="sketch-constraint-icon" x="${glyphX + 2}" y="${glyphY + 2}" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${sketchConstraintIconBody(constraint.kind)}</svg>${stackBadge}</g>`);
    if (selected) constraintToolbars.push(sketchConstraintToolbarMarkup(annotation.id, visualState, false, glyphX + 14, glyphY + 32));
  }
  for (const component of sketchSession.solve?.solve_components ?? []) {
    if (component.structural_degrees_of_freedom === 0) continue;
    if (activeSketchToolKey() || !component.geometry.some((id) => selectedSketchGeometry.includes(id))) continue;
    const points = component.geometry.flatMap((id) => sketchGeometrySelectionPoints(sketch.geometry[id]?.geometry).slice(0, 2));
    if (!points.length) continue;
    const center = point({ x_nm: Math.round(points.reduce((sum, value) => sum + value.x_nm, 0) / points.length), y_nm: Math.round(points.reduce((sum, value) => sum + value.y_nm, 0) / points.length) });
    if (center) annotations.push(`<g class="sketch-dof-badge" data-underconstrained-component="${component.id}" role="button" tabindex="0" aria-label="Select component with ${component.structural_degrees_of_freedom} remaining degrees of freedom"><rect x="${center.x - 21}" y="${center.y + 24}" width="42" height="17" rx="8"/><text x="${center.x}" y="${center.y + 36}" text-anchor="middle">DOF ${component.structural_degrees_of_freedom}</text></g>`);
  }
  for (const diagnostic of sketchSession.profile?.diagnostics ?? []) {
    // Open endpoints are the normal state of unconstrained construction and
    // are already summarized in the inspector. Reserve canvas callouts for
    // actionable profile faults such as crossings, overlaps, and orphaning.
    if (diagnostic.kind === "open_endpoint") continue;
    const ids = Array.isArray(diagnostic.geometry) ? diagnostic.geometry.filter((value): value is string => typeof value === "string") : [];
    const diagnosticPoints = ids.flatMap((id) => sketchSession ? sketchGeometrySelectionPoints(sketch.geometry[id]?.geometry).slice(0, 2) : []);
    if (!diagnosticPoints.length) continue;
    const center = point({ x_nm: Math.round(diagnosticPoints.reduce((sum, value) => sum + value.x_nm, 0) / diagnosticPoints.length), y_nm: Math.round(diagnosticPoints.reduce((sum, value) => sum + value.y_nm, 0) / diagnosticPoints.length) });
    if (center) annotations.push(`<g class="sketch-profile-diagnostic ${escapeHtml(diagnostic.kind)}" role="alert" aria-label="${escapeHtml(diagnostic.kind.replaceAll("_", " "))}"><circle cx="${center.x}" cy="${center.y}" r="8"/><text x="${center.x + 12}" y="${center.y + 4}">${escapeHtml(diagnostic.kind.replaceAll("_", " "))}</text></g>`);
  }
  for (const id of orphanedProjection) {
    const diagnosticPoint = sketch.geometry[id] ? sketchGeometrySelectionPoints(sketch.geometry[id].geometry)[0] : undefined;
    const center = diagnosticPoint ? point(diagnosticPoint) : undefined;
    if (center) annotations.push(`<g class="sketch-profile-diagnostic orphaned" role="alert" aria-label="Orphaned projected reference"><circle cx="${center.x}" cy="${center.y}" r="8"/><text x="${center.x + 12}" y="${center.y + 4}">missing reference</text></g>`);
  }
  const selectedOperationId = firstRetainedOperationId(revisionIndexes, selectedSketchGeometry);
  const selectedOperation = selectedOperationId && sketch.operations?.[selectedOperationId]
    ? [selectedOperationId, sketch.operations[selectedOperationId]] as const
    : undefined;
  if (selectedOperation?.[1].kind === "linear_pattern") {
    const operation = selectedOperation[1]; const base = sketchGeometrySelectionPoints(sketch.geometry[operation.sources[0]]?.geometry)[0];
    const multiplier = operation.extent ? 1 : Math.max(1, operation.count - 1);
    const end = base ? { x_nm: base.x_nm + operation.spacing.x_nm * multiplier, y_nm: base.y_nm + operation.spacing.y_nm * multiplier } : undefined;
    const a = base ? point(base) : undefined; const b = end ? point(end) : undefined;
    if (a && b) handles.push(`<g class="sketch-pattern-handle" data-pattern-handle="direction" data-operation-id="${escapeHtml(selectedOperation[0])}" tabindex="0" role="slider" aria-label="Pattern direction and extent handle"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle cx="${b.x}" cy="${b.y}" r="7"/></g>`);
  } else if (selectedOperation?.[1].kind === "circular_pattern") {
    const operation = selectedOperation[1]; const source = sketchGeometrySelectionPoints(sketch.geometry[operation.sources[0]]?.geometry)[0];
    const angle = operation.angle_microdegrees / 1_000_000 * Math.PI / 180;
    const end = source ? { x_nm: Math.round(operation.center.x_nm + (source.x_nm - operation.center.x_nm) * Math.cos(angle) - (source.y_nm - operation.center.y_nm) * Math.sin(angle)), y_nm: Math.round(operation.center.y_nm + (source.x_nm - operation.center.x_nm) * Math.sin(angle) + (source.y_nm - operation.center.y_nm) * Math.cos(angle)) } : undefined;
    const center = point(operation.center); const endpoint = end ? point(end) : undefined;
    if (center && endpoint) handles.push(`<g class="sketch-pattern-handle circular" data-pattern-handle="angle" data-operation-id="${escapeHtml(selectedOperation[0])}" tabindex="0" role="slider" aria-label="Pattern angle handle"><line x1="${center.x}" y1="${center.y}" x2="${endpoint.x}" y2="${endpoint.y}"/><circle cx="${center.x}" cy="${center.y}" r="5"/><circle cx="${endpoint.x}" cy="${endpoint.y}" r="7"/></g>`);
  }
  annotations.push(...constraintToolbars);
  const selectionBox = sketchSelectionBoxMarkup();
  const hitGeometry = generateStableGeometry
    ? geometry.filter((markup) => markup.includes("data-sketch-geometry")).map((markup) => markup
      .replace(/class="[^"]*sketch-entity[^"]*"/, 'class="sketch-entity-hit" aria-hidden="true"')
      .replace("data-sketch-geometry=", "data-sketch-hit-geometry=")
      .replace(/\s+tabindex="0"/g, "")
      .replace(/\s+role="button"/g, "")
      .replace(/\s+aria-label="[^"]*"/g, ""))
    : [...sketchStableGeometryCache!.hitGeometry];
  if (generateStableGeometry) {
    sketchStableGeometryCache = {
      token: stableGeometryRevision.token,
      profileFills: [...profileFills],
      geometry: [...geometry],
      hitGeometry: [...hitGeometry],
    };
  }
  const layers = ensureSketchSvgLayers(overlay);
  updateSketchSvgLayer(layers, "profiles", profileFills.join(""));
  updateKeyedSketchSvgLayer(layers, "hit-geometry", keyedSketchSvgMarkup(hitGeometry, "data-sketch-hit-geometry", "hit"));
  updateKeyedSketchSvgLayer(layers, "geometry", keyedSketchSvgMarkup(geometry, "data-sketch-geometry", "geometry"));
  updateSketchSvgLayer(layers, "transient", facsimile.join(""));
  updateSketchSvgLayer(layers, "references", originReference);
  updateKeyedSketchSvgLayer(layers, "handles", keyedSketchSvgMarkup(handles, "data-geometry", "handle"));
  updateKeyedSketchSvgLayer(layers, "annotations", keyedSketchSvgMarkup(annotations, "data-sketch-constraint-id", "annotation"));
  updateSketchSvgLayer(layers, "selection", selectionBox);
  syncSketchDynamicEntityClasses(overlay, inference.targets, inference.sources, generateStableGeometry);
  syncSketchDimensionEditor(sketch);
  if (generateStableGeometry) sketchRenderIndexCache.recordStableLayerGeneration(stableLayerGenerationMs, geometry.length);
}

function generatedPointReference(commands: readonly SketchCommand[], value: Point2): PointRef | undefined {
  for (const command of commands) {
    if (command.kind !== "add_geometry") continue;
    const geometry = command.entity.geometry;
    const anchors: PointRef["anchor"][] = geometry.kind === "line" ? ["start", "end"]
      : geometry.kind === "circle" ? ["center"]
        : geometry.kind === "arc" ? ["center", "start", "end"]
          : geometry.kind === "control_point_spline" ? geometry.control_points.map((_, index) => `control:${index}` as const)
            : geometry.kind === "fit_point_spline" ? geometry.fit_points.map((_, index) => `fit:${index}` as const)
              : geometry.kind === "ellipse" ? ["center", "major", "minor"]
                : geometry.kind === "elliptical_arc" ? ["center", "major", "minor", "start", "end"]
                  : geometry.kind === "conic" ? ["start", "control", "end"]
                    : geometry.kind === "sketch_point" ? ["position"]
            : ["min", "max"];
    const temporary = { id: "generated", revision: 0, geometry: { [command.entity.id]: command.entity }, constraints: {} };
    for (const anchor of anchors) {
      const point = pointForRef(temporary, { geometry: command.entity.id, anchor });
      if (point?.x_nm === value.x_nm && point.y_nm === value.y_nm) return { geometry: command.entity.id, anchor };
    }
  }
  return undefined;
}

function inferredConstraintCommands(
  commands: readonly SketchCommand[],
  inputPoints: readonly Point2[],
  inferenceSets: readonly SketchInference[][],
): SketchCommand[] {
  if (!sketchSession || !sketchAutoConstraints) return [];
  const addedGeometries = commands.filter((command): command is Extract<SketchCommand, { kind: "add_geometry" }> => command.kind === "add_geometry");
  // Direction/shape inferences describe the single curve being created. A
  // composite generator's first sub-entity is not the user's whole polygon or
  // slot, so applying those inferences to it creates accidental constraints.
  const addedGeometry = addedGeometries.length === 1 ? addedGeometries[0] : undefined;
  const output: SketchCommand[] = [];
  const emitted = new Set<string>();
  inferenceSets.forEach((inferences, index) => {
    const point = generatedPointReference(commands, inputPoints[index]);
    for (const inference of inferences) {
      let constraint: SketchCommand | undefined;
      if (inference.kind === "horizontal" || inference.kind === "vertical") {
        if (addedGeometry?.entity.geometry.kind === "line") constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: inference.kind, line: addedGeometry.entity.id } };
      } else if (point && inference.kind === "origin") {
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "point_on_origin", point } };
      } else if (point && (inference.kind === "coincident" || inference.kind === "center") && inference.target.geometry !== point.geometry) {
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "coincident", a: point, b: inference.target } };
      } else if (point && inference.kind === "midpoint" && inference.line !== point.geometry) {
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "midpoint", point, line: inference.line } };
      } else if (point && inference.kind === "point_on_object" && inference.geometry !== point.geometry) {
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "point_on_object", point, geometry: inference.geometry } };
      } else if (point && inference.kind === "collinear" && inference.geometry !== point.geometry) {
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "collinear", point, line: inference.geometry } };
      } else if (addedGeometry && (addedGeometry.entity.geometry.kind === "line" || inference.kind === "tangent") && (inference.kind === "parallel" || inference.kind === "perpendicular" || inference.kind === "tangent" || inference.kind === "equal") && inference.geometry !== addedGeometry.entity.id) {
        const targetParameter = /^parameter:(\d+)$/.exec(inference.target.anchor)?.[1];
        const sourceContact = pointForRef(sketchSession!.draft, inference.target);
        const sourceParameter = sourceContact ? Math.round(projectPointToGeometryCurve(addedGeometry.entity.geometry, sourceContact).parameter * 1_000_000) : undefined;
        constraint = { kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: inference.kind === "tangent" ? {
          kind: "tangent", first: inference.geometry, second: addedGeometry.entity.id,
          ...(targetParameter ? { first_parameter_millionths: Number(targetParameter) } : {}),
          ...(sourceParameter !== undefined ? { second_parameter_millionths: sourceParameter } : {}),
        } : { kind: inference.kind, first: inference.geometry, second: addedGeometry.entity.id } };
      }
      if (!constraint || constraint.kind !== "add_constraint") continue;
      const fingerprint = JSON.stringify(constraint.constraint);
      if (emitted.has(fingerprint)) continue;
      emitted.add(fingerprint);
      output.push(constraint);
    }
  });
  const additionalGeometry = Object.fromEntries(addedGeometries.map((command) => [command.entity.id, command.entity]));
  return filterCenterOnLineTangencies(sketchSession!.draft, output, additionalGeometry);
}

async function projectSelectedSketchEdge(): Promise<void> {
  if (sketchSession && activeSketchPlane && (sketchOriginSelected || sketchProjectWorkReference !== "none")) {
    const id = sketchSession.ids.next("geometry");
    const work = sketchOriginSelected ? "origin" : sketchProjectWorkReference;
    const geometry: Geometry = work === "origin" ? { kind: "sketch_point", x_nm: 0, y_nm: 0 }
      : work === "x_axis" ? { kind: "line", start: { x_nm: -100_000_000, y_nm: 0 }, end: { x_nm: 100_000_000, y_nm: 0 } }
        : { kind: "line", start: { x_nm: 0, y_nm: -100_000_000 }, end: { x_nm: 0, y_nm: 100_000_000 } };
    const fixed: SketchCommand[] = geometry.kind === "sketch_point"
      ? [{ kind: "add_constraint", id: sketchSession.ids.next("constraint"), constraint: { kind: "fixed", point: { geometry: id, anchor: "position" }, x_nm: 0, y_nm: 0 } }]
      : ["start", "end"].map((anchor) => ({ kind: "add_constraint", id: sketchSession!.ids.next("constraint"), constraint: { kind: "fixed", point: { geometry: id, anchor: anchor as "start" | "end" }, x_nm: anchor === "start" ? geometry.start.x_nm : geometry.end.x_nm, y_nm: anchor === "start" ? geometry.start.y_nm : geometry.end.y_nm } } as SketchCommand));
    await sketchSession.applyAll([
      { kind: "add_geometry", entity: { id, construction: true, geometry } }, ...fixed,
      { kind: "add_operation", id: sketchSession.ids.next("operation"), operation: { kind: "project_include", source_kind: "work_geometry", source_ids: [`reference:${work}`], results: [id], linked: true, locked: true, intersect_plane: false, missing: false } },
    ]);
    selectedSketchGeometry = [id]; sketchOriginSelected = false; sketchProjectWorkReference = "none"; setSketchToolPhase("complete"); updateSketchStatus();
    return;
  }
  if (sketchSession && activeSketchPlane && selectedSketchId && selectedSketchId !== sketchSession.draft.id) {
    const documentValue = adapter.durableDocument() as SketchPlaneDocument;
    const hydrated = hydrateSketchFromDocument(documentValue, selectedSketchId);
    const resolution = hydrated ? resolveSketchPlane(hydrated.support, documentValue, acceptedPlanarFaceEvidence, nativePlanarFaceAuthorities) : undefined;
    if (hydrated && resolution?.status === "ready") {
      const commands: SketchCommand[] = []; const results: string[] = []; const sourceIds: string[] = [];
      for (const entity of Object.values(hydrated.sketch.geometry)) {
        const path = sketchGeometrySelectionPath(entity.geometry);
        if (entity.geometry.kind === "sketch_point" && path[0]) {
          const position = worldMillimetersToPlaneLocal(planeLocalToWorldMillimeters(path[0], resolution.plane), activeSketchPlane);
          const id = sketchSession.ids.next("geometry"); results.push(id); sourceIds.push(JSON.stringify({ sketch: selectedSketchId, geometry: entity.id, segment: -1 }));
          commands.push({ kind: "add_geometry", entity: { id, construction: true, geometry: { kind: "sketch_point", x_nm: position.x_nm, y_nm: position.y_nm } } });
          continue;
        }
        for (let segment = 1; segment < path.length; segment += 1) {
          const start = worldMillimetersToPlaneLocal(planeLocalToWorldMillimeters(path[segment - 1], resolution.plane), activeSketchPlane);
          const end = worldMillimetersToPlaneLocal(planeLocalToWorldMillimeters(path[segment], resolution.plane), activeSketchPlane);
          if (start.x_nm === end.x_nm && start.y_nm === end.y_nm) continue;
          const id = sketchSession.ids.next("geometry"); results.push(id); sourceIds.push(JSON.stringify({ sketch: selectedSketchId, geometry: entity.id, segment: segment - 1 }));
          commands.push({ kind: "add_geometry", entity: { id, construction: true, geometry: { kind: "line", start, end } } });
        }
      }
      if (results.length) {
        commands.push({ kind: "add_operation", id: sketchSession.ids.next("operation"), operation: { kind: "project_include", source_kind: "sketch", source_ids: sourceIds, results, linked: true, locked: false, intersect_plane: false, missing: false } });
        await sketchSession.applyAll(commands);
        results.forEach((id, index) => sketchSession!.setExternalReference(id, { body: selectedSketchId!, stable_kernel_id: sourceIds[index] }));
        selectedSketchGeometry = results; setSketchToolPhase("complete"); updateSketchStatus(); return;
      }
    }
  }
  if (!sketchSession || !activeSketchPlane || !state.selection) {
    sketchSolverStatus = "Project is waiting for a model point, edge, face, or body";
    updateSketchToolInspectorState();
    setSketchToolPhase("collecting");
    return;
  }
  const selection = state.selection;
  const projected: Array<{ geometry: Geometry; source: string }> = [];
  if (selection.kind === "vertex") {
    const world = renderer?.vertexPoint(selection.token);
    if (world) {
      const point = worldMillimetersToPlaneLocal(world, activeSketchPlane);
      projected.push({ geometry: { kind: "sketch_point", x_nm: point.x_nm, y_nm: point.y_nm }, source: selection.stableId });
    }
  } else {
    let polylines = selection.kind === "edge"
      ? [renderer?.edgePolyline(selection.token) ?? []]
      : selection.kind === "face"
        ? renderer?.planarFaceBoundaryPolylines(selection) ?? []
        : renderer?.topologySelections("edge").map((edge) => renderer!.edgePolyline(edge.token)) ?? [];
    if (sketchProjectIntersectionMode) {
      const origin = activeSketchPlane.origin_nanometers.map((value) => value / 1_000_000) as [number, number, number];
      const normal = activeSketchPlane.normal_millionths.map((value) => value / 1_000_000) as [number, number, number];
      const hits: [number, number, number][] = [];
      const signed = (point: [number, number, number]) => (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] + (point[2] - origin[2]) * normal[2];
      for (const polyline of polylines) for (let index = 1; index < polyline.length; index += 1) {
        const a = polyline[index - 1]; const b = polyline[index]; const da = signed(a); const db = signed(b);
        if (Math.abs(da) < 1e-8) hits.push(a);
        if (da * db < 0) { const t = da / (da - db); hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      const unique = hits.filter((point, index) => hits.findIndex((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1], candidate[2] - point[2]) < 1e-7) === index);
      if (selection.kind === "edge" && unique.length === 1) {
        const local = worldMillimetersToPlaneLocal(unique[0], activeSketchPlane);
        projected.push({ geometry: { kind: "sketch_point", x_nm: local.x_nm, y_nm: local.y_nm }, source: JSON.stringify({ kind: "edge", stable_id: selection.stableId }) });
        polylines = [];
      } else polylines = Array.from({ length: Math.floor(unique.length / 2) }, (_, index) => [unique[index * 2], unique[index * 2 + 1]]);
    }
    for (const [index, world] of polylines.entries()) {
      if (world.length < 2) continue;
      const points = world.map((point) => worldMillimetersToPlaneLocal(point, activeSketchPlane!));
      for (let segment = 1; segment < points.length; segment += 1) {
        const start = points[segment - 1]; const end = points[segment];
        if (start.x_nm === end.x_nm && start.y_nm === end.y_nm) continue;
        projected.push({ geometry: { kind: "line", start, end }, source: sketchProjectIntersectionMode ? JSON.stringify({ kind: selection.kind, stable_id: selection.stableId }) : selection.stableId });
      }
    }
  }
  if (!projected.length) {
    sketchSolverStatus = "The selected reference has no geometry projectable onto this sketch plane";
    updateSketchToolInspectorState();
    return;
  }
  const selectedExternal = selectedSketchGeometry.length === 1 && sketchSession.draft.external_references?.[selectedSketchGeometry[0]]
    ? selectedSketchGeometry[0]
    : undefined;
  const results: string[] = [];
  const commands: SketchCommand[] = [];
  if (selectedExternal && projected.length === 1 && projected[0].geometry.kind === "line") {
    const id = selectedExternal; results.push(id);
    const { start, end } = projected[0].geometry;
    const fixed = Object.entries(sketchSession.draft.constraints).filter(([, constraint]) => constraint.kind === "fixed" && constraint.point.geometry === id);
    commands.push(...fixed.map(([constraint]) => ({ kind: "remove_constraint", constraint } as SketchCommand)));
    commands.push(
      { kind: "move_point", point: { geometry: id, anchor: "start" }, to: start },
      { kind: "move_point", point: { geometry: id, anchor: "end" }, to: end },
    );
    for (const [constraint, value] of fixed) {
      if (value.kind !== "fixed") continue;
      const target = value.point.anchor === "start" ? start : end;
      commands.push({ kind: "add_constraint", id: constraint, constraint: { ...value, x_nm: target.x_nm, y_nm: target.y_nm } });
    }
  } else {
    for (const item of projected) {
      const allocated = sketchSession.ids.next("geometry");
      const id = `external:${selection.stableId}:${allocated.split(":").at(-1)}`; results.push(id);
      commands.push({ kind: "add_geometry", entity: { id, construction: true, geometry: item.geometry } });
      if (item.geometry.kind === "sketch_point") {
        commands.push({ kind: "add_constraint", id: sketchSession.ids.next("constraint"), constraint: { kind: "fixed", point: { geometry: id, anchor: "position" }, x_nm: item.geometry.x_nm, y_nm: item.geometry.y_nm } });
      } else if (item.geometry.kind === "line") for (const anchor of ["start", "end"] as const) {
        const point = anchor === "start" ? item.geometry.start : item.geometry.end;
        commands.push({ kind: "add_constraint", id: sketchSession.ids.next("constraint"), constraint: { kind: "fixed", point: { geometry: id, anchor }, x_nm: point.x_nm, y_nm: point.y_nm } });
      }
    }
  }
  const retainedProjection = Object.entries(sketchSession.draft.operations ?? {}).find(([, operation]) =>
    operation.kind === "project_include" && results.some((id) => operation.results.includes(id)));
  const projectionOperation = {
    kind: "project_include" as const,
    source_kind: (sketchProjectIntersectionMode ? "plane_intersection" : selection.kind === "vertex" ? "point" : selection.kind) as "point" | "edge" | "face" | "body" | "plane_intersection",
    source_ids: results.map((_, index) => projected[index]?.source ?? selection.stableId),
    results,
    linked: true,
    locked: true,
    intersect_plane: sketchProjectIntersectionMode,
    missing: false,
  };
  commands.push(retainedProjection
    ? { kind: "set_operation", id: retainedProjection[0], operation: projectionOperation }
    : { kind: "add_operation", id: sketchSession.ids.next("operation"), operation: projectionOperation });
  setSketchToolPhase("applying");
  await sketchSession.applyAll(commands);
  results.forEach((id, index) => sketchSession!.setExternalReference(id, {
    body: selection.bodyId,
    stable_kernel_id: projected[index]?.source ?? selection.stableId,
  }));
  selectedSketchGeometry = results;
  sketchSolverStatus = selectedExternal ? "Projected reference rebound to the selected source" : `${results.length} projected ${selection.kind === "vertex" ? "point" : "curve"}${results.length === 1 ? "" : "s"} accepted as linked external references`;
  setSketchToolPhase("complete");
  updateSketchStatus();
}

const sketchEditOperations = new Set<SketchTool>(["offset", "extend", "sketch_fillet", "sketch_chamfer", "sketch_mirror", "sketch_linear_pattern", "sketch_circular_pattern", "sketch_break", "sketch_scale", "sketch_move_copy", "sketch_blend"]);

async function setSelectedSketchConstruction(construction: boolean): Promise<void> {
  if (!sketchSession || !selectedSketchGeometry.length) return;
  const selected = selectedSketchGeometry.flatMap((id) => sketchSession?.draft.geometry[id] ?? []);
  setSketchToolPhase("applying");
  try {
    await sketchSession.applyAll(selected.map((entity) => ({ kind: "set_construction", geometry: entity.id, construction } as SketchCommand)));
    sketchSolverStatus = `${selected.length} selected entit${selected.length === 1 ? "y" : "ies"} set to ${construction ? "construction" : "normal"} geometry`;
    setSketchToolPhase("complete");
    updateSketchStatus();
    renderActiveToolInspector();
  } catch {
    sketchSolverStatus = "Construction conversion was refused; the draft is unchanged";
    setSketchToolPhase("blocked");
    updateSketchToolInspectorState();
  }
}

async function applyConstructionModifier(): Promise<void> {
  if (!sketchSession) return;
  const selected = selectedSketchGeometry.flatMap((id) => sketchSession?.draft.geometry[id] ?? []);
  // While a creation command is active, Construction is a mode for the next
  // entity. Do not reinterpret the geometry that the just-completed command
  // leaves selected (for example, all four edges of a new rectangle).
  if (sketchToolArmed || !selected.length) {
    sketchConstruction = !sketchConstruction;
    sketchSolverStatus = `New geometry will be ${sketchConstruction ? "construction" : "standard"}`;
    setSketchToolPhase("complete");
    updateSketchToolInspectorState();
    syncSketchToolUi();
    return;
  }
  await setSelectedSketchConstruction(!selected.every((entity) => entity.construction));
}

async function applySketchEditOperation(tool: SketchTool): Promise<void> {
  if (!sketchSession || !sketchEditOperations.has(tool) || sketchSelectionToolApplying) return;
  cancelPendingSketchEditPreview();
  const previewSession = sketchSession;
  const requestId = sketchEditPreviewRequestId;
  const distanceNm = Math.max(1, Math.round(sketchConstraintValue * 1_000_000));
  let commands: SketchCommand[] = [];
  let offsetChain: OffsetChainInstrumentation | undefined;
  let commandConstructionMs: number | undefined;
  let offsetPlanMs: number | undefined;
  const planStartedAt = performance.now();
  if (tool === "offset") {
    const draft = sketchSession.draft;
    const plan = planConnectedOffsetChain(draft, selectedSketchGeometry.filter((id) => id in draft.geometry));
    offsetPlanMs = performance.now() - planStartedAt;
    offsetChain = plan.instrumentation;
    if (plan.rejection) {
      sketchSolverStatus = `Offset cannot use ${plan.rejection.geometry}: ${plan.rejection.reason.replaceAll("_", " ")}`;
      showActionError("Offset", sketchSolverStatus);
      setSketchToolPhase("blocked");
      updateSketchToolInspectorState();
      recordOffsetPerformance({
        stage: "preview",
        outcome: "rejected",
        planMs: offsetPlanMs,
        offsetChain,
        reason: plan.rejection.reason,
      });
      return;
    }
    const commandStartedAt = performance.now();
    commands = canonicalOffsetCommands(draft, selectedSketchGeometry, sketchSession.ids, distanceNm, { chainPlan: plan, chainInstrumentation: offsetChain });
    commandConstructionMs = performance.now() - commandStartedAt;
  }
  else if (tool === "extend") commands = extendCommands(sketchSession.draft, selectedSketchGeometry, distanceNm);
  else if (tool === "sketch_fillet") commands = filletCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, distanceNm);
  else if (tool === "sketch_chamfer") commands = chamferCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, distanceNm);
  else if (tool === "sketch_mirror") commands = mirrorCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids);
  else if (tool === "sketch_linear_pattern") commands = linearPatternCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, distanceNm, 3);
  else if (tool === "sketch_circular_pattern") commands = circularPatternCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, 4);
  else if (tool === "sketch_break") commands = breakCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids);
  else if (tool === "sketch_scale") commands = scaleCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, Math.max(0.01, sketchConstraintValue), sketchHoverPoint ?? { x_nm: 0, y_nm: 0 }, true);
  else if (tool === "sketch_move_copy") commands = moveCopyCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, { x_nm: distanceNm, y_nm: 0 }, true);
  else if (tool === "sketch_blend") commands = blendCommands(sketchSession.draft, selectedSketchGeometry, sketchSession.ids, distanceNm, "tangent");
  if (!commands.length) {
    sketchSolverStatus = tool === "sketch_fillet" || tool === "sketch_chamfer"
      ? "Select two intersecting lines for this corner operation"
      : "Select compatible sketch geometry first";
    updateSketchToolInspectorState();
    setSketchToolPhase("collecting");
    return;
  }
  const planMs = offsetPlanMs ?? performance.now() - planStartedAt;
  pendingSketchEditPreview = { tool, commands, state: tool === "offset" ? "loading" : "ready", requestId, ...(offsetChain ? { offsetChain, planMs, commandConstructionMs } : {}) };
  if (tool === "offset") {
    sketchSolverStatus = "Offset preview is computing on the canonical sketch model · Escape cancels";
    setSketchToolPhase("applying");
    renderSketchOverlay();
    renderActiveToolInspector();
    const controller = new AbortController();
    sketchEditPreviewAbort = controller;
    const bridgeStartedAt = performance.now();
    try {
      const prepared = await previewSession.previewAll(commands, { signal: controller.signal });
      if (controller.signal.aborted || sketchSession !== previewSession || requestId !== sketchEditPreviewRequestId || pendingSketchEditPreview?.requestId !== requestId) return;
      const operationIds = commands.flatMap((command) => command.kind === "add_operation" ? [command.id] : []);
      const canonicalGeometryIds = operationIds.flatMap((id) => {
        const operation = prepared.preview.sketch.operations?.[id];
        return operation?.kind === "offset" ? operation.result_chains.flat() : [];
      });
      pendingSketchEditPreview = {
        tool,
        commands,
        state: "ready",
        requestId,
        prepared,
        canonicalGeometryIds,
        bridgeMs: performance.now() - bridgeStartedAt,
        offsetChain,
        planMs,
        commandConstructionMs,
      };
      sketchEditPreviewAbort = undefined;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sketchEditPreviewRequestId || sketchSession !== previewSession) return;
      sketchEditPreviewAbort = undefined;
      cancelPendingSketchEditPreview();
      const detail = error instanceof Error ? error.message : String(error);
      sketchSolverStatus = `Offset preview was refused; the draft is unchanged${detail ? ` · ${detail}` : ""}`;
      showActionError("Offset", detail);
      setSketchToolPhase("blocked");
      updateSketchToolInspectorState();
      recordOffsetPerformance({ stage: "preview", outcome: "refused", planMs, commandConstructionMs, bridgeMs: performance.now() - bridgeStartedAt, offsetChain, reason: detail });
      return;
    }
  }
  sketchSolverStatus = `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === tool)?.label ?? tool} preview ready · Enter accepts · Escape cancels`;
  setSketchToolPhase("ready");
  const overlayStartedAt = performance.now();
  renderSketchOverlay();
  const overlayMs = performance.now() - overlayStartedAt;
  renderActiveToolInspector();
  if (tool === "offset") {
    const stablePaintStartedAt = performance.now();
    await waitForStableBrowserPaint();
    recordOffsetPerformance({
      stage: "preview",
      outcome: "ready",
      planMs,
      commandConstructionMs,
      bridgeMs: pendingSketchEditPreview?.bridgeMs,
      overlayMs,
      stablePaintMs: performance.now() - stablePaintStartedAt,
      offsetChain,
    });
  }
}

async function commitPendingSketchEditPreview(): Promise<boolean> {
  if (!sketchSession || !pendingSketchEditPreview || sketchSelectionToolApplying) return false;
  const preview = pendingSketchEditPreview;
  if (preview.state === "loading") {
    sketchSolverStatus = "The canonical preview is still computing · Escape cancels";
    updateSketchToolInspectorState();
    return false;
  }
  sketchSelectionToolApplying = true;
  setSketchToolPhase("applying");
  try {
    const bridgeStartedAt = performance.now();
    const stableBefore = sketchRenderIndexCache.counters().stableLayerGenerations;
    const acceptedPrepared = preview.prepared ? sketchSession.acceptPreview(preview.prepared) : undefined;
    if (acceptedPrepared === false) throw new Error("The preview is stale; recompute it from the current sketch");
    if (!preview.prepared) await sketchSession.applyAll(preview.commands);
    const bridgeMs = preview.prepared ? 0 : performance.now() - bridgeStartedAt;
    const diagnosticsStartedAt = performance.now();
    await sketchSession.diagnosticsReady();
    const diagnosticsMs = performance.now() - diagnosticsStartedAt;
    if (sketchDiagnosticsRenderFrame !== undefined) {
      cancelAnimationFrame(sketchDiagnosticsRenderFrame);
      sketchDiagnosticsRenderFrame = undefined;
    }
    cancelPendingSketchEditPreview();
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchSolverStatus = `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === preview.tool)?.label ?? preview.tool} accepted · select again to reuse the active tool`;
    setSketchToolPhase("complete");
    updateSketchStatus();
    const overlayStartedAt = performance.now();
    renderSketchOverlay();
    const overlayMs = performance.now() - overlayStartedAt;
    renderActiveToolInspector();
    const stablePaintStartedAt = performance.now();
    await waitForStableBrowserPaint();
    if (preview.tool === "offset") recordOffsetPerformance({
      stage: "commit",
      outcome: "accepted",
      planMs: preview.planMs ?? 0,
      commandConstructionMs: preview.commandConstructionMs,
      bridgeMs,
      diagnosticsMs,
      overlayMs,
      stablePaintMs: performance.now() - stablePaintStartedAt,
      stableLayerDelta: sketchRenderIndexCache.counters().stableLayerGenerations - stableBefore,
      offsetChain: preview.offsetChain,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sketchSolverStatus = `${SKETCH_TOOL_SCHEMA.find((entry) => entry.id === preview.tool)?.label ?? preview.tool} was refused; the draft is unchanged${detail ? ` · ${detail}` : ""}`;
    setSketchToolPhase("blocked");
    updateSketchToolInspectorState();
    if (preview.tool === "offset") recordOffsetPerformance({
      stage: "commit",
      outcome: "refused",
      planMs: preview.planMs ?? 0,
      reason: detail,
      offsetChain: preview.offsetChain,
    });
  } finally {
    sketchSelectionToolApplying = false;
    syncSketchToolUi();
  }
  return !pendingSketchEditPreview;
}

async function applySketchClick(point: Point2, absoluteOrigin = false, suppressInference = false): Promise<void> {
  if (!sketchSession || state.operation.type !== "sketch") return;
  const tool = sketchSession.activeTool;
  if (tool === "construction") {
    sketchConstruction = !sketchConstruction;
    document.querySelector<HTMLButtonElement>('[data-sketch-tool="construction"]')!.setAttribute("aria-pressed", String(sketchConstruction));
    return;
  }
  if (tool === "project") {
    await projectSelectedSketchEdge();
    return;
  }
  if (tool === "trim") {
    const source = selectedSketchGeometry
      .map((id) => sketchSession?.draft.geometry[id])
      .find((entity) => entity);
    if (!source) {
      sketchSolverStatus = "Trim is waiting for an explicit curve or shape segment selection";
      updateSketchToolInspectorState();
      return;
    }
    const selectedSegment = selectedSketchSegments.find((candidate) => candidate.geometry === source.id)?.segment;
    if (source.geometry.kind === "rectangle" && !Number.isInteger(selectedSegment)) {
      sketchSolverStatus = "Select the rectangle segment to trim";
      updateSketchToolInspectorState();
      return;
    }
    const plan = planIntersectionTrim(
      sketchSession.draft,
      source.id,
      selectedSegment,
      point,
      () => sketchSession!.ids.next("geometry"),
    );
    if (!plan) {
      sketchSolverStatus = "The selected segment cannot be trimmed at this point";
      updateSketchToolInspectorState();
      return;
    }
    try {
      setSketchToolPhase("applying");
      await sketchSession.applyAll(plan.commands);
    } catch {
      sketchSolverStatus = "Trim was refused; the accepted sketch is unchanged";
      setSketchToolPhase("blocked");
      updateSketchToolInspectorState();
      return;
    }
    selectedSketchGeometry = [];
    selectedSketchSegments = [];
    setSketchToolPhase("complete");
    updateSketchStatus();
    return;
  }
  setSketchToolPhase("collecting");
  const snap = absoluteOrigin ? { point: ABSOLUTE_SKETCH_ORIGIN, inferences: [{ kind: "origin", source: { geometry: "preview:cursor", anchor: "position" }, target: { geometry: "reference:origin", anchor: "center" } } satisfies SketchInference], label: "Origin" } : suppressInference ? { point, inferences: [], label: "Inference suppressed" } : snappedSketchPoint(point);
  sketchPoints.push(snap.point);
  sketchPointInferences.push(snap.inferences);
  const required = activeSketchPointRequirement(tool);
  if (sketchPoints.length < required) {
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  const inlineContext = inlineCreationContext(sketchPoints);
  const inlineResult = inlineContext ? solveInlineCreation(inlineContext) : undefined;
  if (inlineResult && !inlineResult.valid) {
    sketchPoints = sketchPoints.slice(0, -1);
    sketchPointInferences = sketchPointInferences.slice(0, -1);
    sketchSolverStatus = `${inlineResult.errors[0] ?? "Inline dimensions are invalid"} · correct the canvas value`;
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  if (inlineResult) sketchPoints = inlineResult.points;
  if (inlineResult?.dimensionIntents.some((intent) => intent.semantic === "axis_angle")) {
    sketchPointInferences[sketchPointInferences.length - 1] = (sketchPointInferences.at(-1) ?? []).filter((inference) => inference.kind !== "horizontal" && inference.kind !== "vertical");
  }
  let commands: SketchCommand[];
  try {
    if (tool === "rectangle") commands = rectangleVariantCommands(sketchSession.ids, sketchCreationVariant.rectangle, sketchPoints);
    else if (tool === "spline") commands = splineCommands(sketchSession.ids, sketchPoints);
    else if (tool === "fit_spline") commands = fitSplineCommands(sketchSession.ids, sketchPoints);
    else if (tool === "polygon") commands = polygonVariantCommands(sketchSession.ids, sketchCreationVariant.polygon, sketchPoints[0], sketchPoints[1], sketchPolygonSides);
    else if (tool === "slot") commands = slotVariantCommands(sketchSession.ids, sketchCreationVariant.slot, sketchPoints);
    else if (tool === "ellipse") commands = ellipseCommands(sketchSession.ids, sketchPoints[0], sketchPoints[1], sketchPoints[2]);
    else if (tool === "elliptical_arc") commands = ellipticalArcCommands(sketchSession.ids, sketchPoints[0], sketchPoints[1], sketchPoints[2], sketchPoints[3], sketchPoints[4]);
    else if (tool === "conic") commands = conicCommands(sketchSession.ids, sketchPoints[0], sketchPoints[1], sketchPoints[2]);
    else if (tool === "point") commands = pointCommands(sketchSession.ids, sketchPoints[0]);
    else if (tool === "text") commands = sketchTextCommands(sketchSession.ids, sketchSession.draft, { text: sketchTextValue, origin: sketchPoints[0], heightNm: sketchTextHeightNm, rotationMicrodegrees: sketchTextRotationMicrodegrees, horizontalAlignment: sketchTextAlignment, ...(sketchTextOnPath && selectedSketchGeometry.find(geometrySupportsCreationOperand) ? { path: selectedSketchGeometry.find(geometrySupportsCreationOperand)! } : {}), reversed: sketchTextReversed });
    else if (tool === "circle") commands = circleVariantCommands(sketchSession.ids, sketchCreationVariant.circle, sketchPoints, selectedSketchGeometry.filter(geometrySupportsCreationOperand), sketchSession.draft);
    else if (tool === "arc") commands = arcVariantCommands(sketchSession.ids, sketchCreationVariant.arc, sketchPoints, sketchSession.draft, selectedSketchGeometry.find(geometrySupportsCreationOperand));
    else if (tool === "line") commands = toolCommands(tool, sketchSession.ids, sketchPoints);
    else throw new Error(`Tool ${tool} does not accept viewport points`);
  } catch (error) {
    sketchPoints = sketchPoints.slice(0, -1);
    sketchPointInferences = sketchPointInferences.slice(0, -1);
    const message = error instanceof Error ? error.message : String(error);
    sketchSolverStatus = `${message} · choose a different point`;
    showActionError(SKETCH_TOOL_SCHEMA.find((entry) => entry.id === tool)?.label ?? "Sketch action", message);
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  if (sketchConstruction) {
    commands = commands.map((command) => command.kind === "add_geometry" ? { ...command, entity: { ...command.entity, construction: true } } : command);
  }
  if (inlineResult) commands.push(...inlineCreationDimensionCommands(inlineResult, commands));
  const inputPoints = [...sketchPoints];
  const inferenceSets = [...sketchPointInferences];
  sketchPoints = [];
  sketchPointInferences = [];
  sketchOriginSelected = false;
  const rawInferenceKinds = [...new Set(inferenceSets.flatMap((inferences) => inferences.map((inference) => inference.kind)))];
  const inferredCommands = inferredConstraintCommands(commands, inputPoints, inferenceSets);
  commands.push(...inferredCommands);
  try {
    setSketchToolPhase("applying");
    await sketchSession.applyAll(commands);
  } catch (error) {
    sketchPoints = inputPoints.slice(0, -1);
    sketchPointInferences = inferenceSets.slice(0, -1);
    const message = error instanceof Error ? error.message : String(error);
    sketchSolverStatus = `Geometry was not added: ${message}`;
    showActionError(SKETCH_TOOL_SCHEMA.find((entry) => entry.id === tool)?.label ?? "Sketch action", message);
    renderSketchOverlay();
    updateSketchToolInspectorState();
    setSketchToolPhase("collecting");
    return;
  }
  if (rawInferenceKinds.length) {
    sketchAutoConstraintAudit.push({
      tool,
      rawInferenceKinds,
      emittedConstraints: inferredCommands.flatMap((command) => command.kind === "add_constraint" ? [{ id: command.id, kind: command.constraint.kind }] : []),
      solveState: sketchSession.solve?.state ?? "idle",
      redundantConstraints: [...(sketchSession.solve?.redundant_constraints ?? [])],
      conflicts: structuredClone(sketchSession.solve?.conflicts ?? []),
    });
  }
  if (inlineResult) persistInlineCreationExpressionBindings(commands, tool);
  resetInlineCreationInput();
  selectedSketchGeometry = commands
    .filter((command) => command.kind === "add_geometry")
    .map((command) => command.kind === "add_geometry" ? command.entity.id : "");
  selectedSketchPoints = [];
  sketchOriginSelected = false;
  selectedSketchSegments = [];
  pendingSketchConstraint = undefined;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchConstraintApplying = false;
  hideActionError();
  if (tool === "line") {
    sketchPoints = [inputPoints.at(-1)!];
    sketchPointInferences = [[]];
    sketchSolverStatus = "Line accepted · continue the connected chain or press Enter to complete this use";
  }
  setSketchToolPhase("complete");
  updateSketchStatus();
  renderActiveToolInspector();
}

async function applySketchConstraint(kind: ConstraintTool): Promise<boolean> {
  if (!sketchSession || sketchConstraintApplying) return false;
  const dimension = sketchConstraintValue;
  const preview = constraintCommand(
    kind,
    "constraint:pending",
    sketchSession.draft,
    { geometry: selectedSketchGeometry, points: selectedSketchPoints, origin: sketchOriginSelected },
    dimension,
  );
  if (!preview) {
    pendingSketchConstraint = kind;
    sketchSolverStatus = `Constraint ${kind} is waiting for an explicit compatible selection`;
    renderSketchOverlay();
    updateSketchToolInspectorState();
    setSketchToolPhase("collecting");
    return false;
  }
  const command = { ...preview, id: sketchSession.ids.next("constraint") } as SketchCommand;
  if (SKETCH_CONSTRAINT_MANIFEST[kind].family === "dimension" && command.kind === "add_constraint") {
    pendingSketchConstraint = kind;
    pendingDimensionPlacement = { kind, command, position: sketchHoverPoint, placed: false, valueEdited: false };
    pendingReferenceDimension = undefined;
    selectedSketchConstraint = undefined;
    sketchSolverStatus = `${kind} ready · set the value on the sketch and lock it`;
    setSketchToolPhase("ready");
    renderSketchOverlay();
    // Smart Dimension owns its contextual value/mode editor on the canvas.
    // Rebuilding the entire properties inspector here added a second large DOM
    // pass after every operand click without changing the in-canvas control.
    updateSketchToolInspectorState();
    const pendingConstraintId = command.id;
    const pendingSession = sketchSession;
    requestAnimationFrame(() => {
      if (sketchSession !== pendingSession
        || sketchDimensionEditor.dataset.source !== "smart_dimension"
        || pendingDimensionPlacement?.command.kind !== "add_constraint"
        || pendingDimensionPlacement.command.id !== pendingConstraintId) return;
      const input = sketchDimensionInput();
      input.focus();
      input.select();
    });
    return false;
  }
  sketchConstraintApplying = true;
  setSketchToolPhase("applying");
  try {
    await sketchSession.apply(command);
    if (command.kind === "add_constraint" && command.constraint.kind === "point_on_origin") sketchOriginSelected = false;
    pendingSketchConstraint = kind;
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchOriginSelected = false;
    sketchSolverStatus = `Constraint ${kind} accepted · select again to reuse the active tool`;
    setSketchToolPhase("complete");
    updateSketchStatus();
    return true;
  } catch {
    sketchSolverStatus = `Constraint ${kind} was refused; the accepted sketch is unchanged`;
    setSketchToolPhase("blocked");
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return false;
  } finally {
    sketchConstraintApplying = false;
    syncSketchToolUi();
  }
}

async function commitPendingDimensionPlacement(position = sketchHoverPoint): Promise<boolean> {
  if (!sketchSession || !pendingDimensionPlacement || sketchConstraintApplying) return false;
  const pending = pendingDimensionPlacement;
  const acceptedExpression = sketchDimensionEditor.dataset.source === "smart_dimension" && pending.valueEdited ? sketchDimensionInput().value.trim() : "";
  pending.position = position;
  sketchConstraintApplying = true;
  setSketchToolPhase("applying");
  try {
    await sketchSession.applyAll([
      pending.command,
      ...(pending.position && pending.command.kind === "add_constraint"
        ? [{ kind: "set_dimension_position", constraint: pending.command.id, position: pending.position } as SketchCommand]
        : []),
    ]);
    if (pending.position && pending.command.kind === "add_constraint") {
      sketchDimensionPositions.set(pending.command.id, pending.position);
      persistSketchDimensionPositions();
    }
    if (acceptedExpression && pending.command.kind === "add_constraint") {
      sketchDimensionExpressions.set(pending.command.id, acceptedExpression);
      persistSketchDimensionExpressions();
    }
    pendingDimensionPlacement = undefined;
    pendingReferenceDimension = undefined;
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchOriginSelected = false;
    pendingSketchConstraint = sketchSmartDimensionActive ? undefined : pending.kind;
    sketchSolverStatus = `${pending.kind} dimension accepted · select again to reuse the active tool`;
    setSketchToolPhase("complete");
    updateSketchStatus();
    renderActiveToolInspector();
    return true;
  } catch {
    pendingDimensionPlacement = undefined;
    pendingReferenceDimension = pending.command.kind === "add_constraint" ? { kind: pending.kind, command: pending.command, position: pending.position } : undefined;
    sketchSolverStatus = `Driving ${pending.kind} would over-constrain the sketch · add it as a reference or change the selection`;
    setSketchToolPhase("blocked");
    renderSketchOverlay();
    renderActiveToolInspector();
    return false;
  } finally {
    sketchConstraintApplying = false;
    syncSketchToolUi();
  }
}

async function acceptPendingReferenceDimension(): Promise<void> {
  if (!sketchSession || !pendingReferenceDimension) return;
  const pending = pendingReferenceDimension;
  setSketchToolPhase("applying");
  try {
    await sketchSession.applyAll([
      pending.command,
      { kind: "set_constraint_suppressed", constraint: pending.command.id, suppressed: true },
      ...(pending.position ? [{ kind: "set_dimension_position", constraint: pending.command.id, position: pending.position } as SketchCommand] : []),
    ]);
    if (pending.position) {
      sketchDimensionPositions.set(pending.command.id, pending.position);
      persistSketchDimensionPositions();
    }
    pendingReferenceDimension = undefined;
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchOriginSelected = false;
    sketchSolverStatus = `${pending.kind} added as a non-driving reference dimension`;
    setSketchToolPhase("complete");
    updateSketchStatus();
    renderActiveToolInspector();
  } catch {
    sketchSolverStatus = "The reference dimension could not be added; the accepted sketch is unchanged";
    setSketchToolPhase("blocked");
    updateSketchToolInspectorState();
  }
}

function prepareSmartDimension(): void {
  if (!sketchSession || !sketchSmartDimensionActive || pendingDimensionPlacement) return;
  if (selectedSketchPoints.length === 1 && !sketchOriginSelected && selectedSketchGeometry.length === 1 && selectedSketchGeometry[0] === selectedSketchPoints[0].geometry) {
    sketchSolverStatus = "Select one more point for Smart Dimension";
    setSketchToolPhase("collecting");
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  const summary = summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected);
  const kind = smartDimensionKind(summary);
  if (!kind) {
    sketchSolverStatus = hasSketchSelection()
      ? "Smart Dimension needs a line, round or ellipse axis, two points, or two lines"
      : "Select geometry, a center, or a tangent point (Shift-click any curve location)";
    setSketchToolPhase("collecting");
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  if (kind === "offset_distance" && summary.retainedOffsetId) {
    selectedSketchConstraint = summary.retainedOffsetId;
    pendingSketchConstraint = kind;
    const value = sketchConstraintDimension(summary.retainedOffsetId);
    if (value !== undefined) sketchConstraintValue = value;
    sketchSolverStatus = "Retained offset dimension selected · edit its value or drag its annotation";
    setSketchToolPhase("ready");
    renderSketchOverlay();
    renderActiveToolInspector();
    return;
  }
  const measured = measureSmartDimension(kind);
  if (measured !== undefined && Number.isFinite(measured)) sketchConstraintValue = measured;
  void applySketchConstraint(kind);
}

function measureSmartDimension(kind: ConstraintTool, sketch?: Sketch): number | undefined {
  if (!sketchSession) return undefined;
  const draft = sketch ?? sketchSession.draftView as Sketch;
  const points = [...(sketchOriginSelected ? [ABSOLUTE_SKETCH_ORIGIN] : []), ...selectedSketchPoints.flatMap((ref) => pointForRef(draft, ref) ?? [])];
  const entities = selectedSketchGeometry.flatMap((id) => draft.geometry[id] ?? []);
  const lines = entities.filter((entity) => entity.geometry.kind === "line").map((entity) => entity.geometry as Extract<Geometry, { kind: "line" }>);
  if (["distance", "distance_x", "distance_y"].includes(kind)) {
    const pair = points.length >= 2 ? points.slice(-2) : lines.length === 1 ? [lines[0].start, lines[0].end] : [];
    if (pair.length !== 2) return undefined;
    const dx = Math.abs(pair[1].x_nm - pair[0].x_nm); const dy = Math.abs(pair[1].y_nm - pair[0].y_nm);
    return (kind === "distance_x" ? dx : kind === "distance_y" ? dy : Math.hypot(dx, dy)) / 1_000_000;
  }
  if (kind === "point_line_distance" && points.length && lines.length) {
    const point = points.at(-1)!; const line = lines.at(-1)!; const dx = line.end.x_nm - line.start.x_nm; const dy = line.end.y_nm - line.start.y_nm;
    return Math.abs((point.x_nm - line.start.x_nm) * dy - (point.y_nm - line.start.y_nm) * dx) / Math.max(1, Math.hypot(dx, dy)) / 1_000_000;
  }
  if (kind === "line_distance" && lines.length === 2) {
    const line = lines[0]; const point = lines[1].start; const dx = line.end.x_nm - line.start.x_nm; const dy = line.end.y_nm - line.start.y_nm;
    return Math.abs((point.x_nm - line.start.x_nm) * dy - (point.y_nm - line.start.y_nm) * dx) / Math.max(1, Math.hypot(dx, dy)) / 1_000_000;
  }
  if (kind === "offset_distance") {
    const selected = new Set(entities.map((entity) => entity.id));
    const relation = Object.values(draft.constraints).find((constraint) => constraint.kind === "offset_distance" && selected.has(constraint.source) && selected.has(constraint.offset));
    if (relation?.kind === "offset_distance") return relation.distance_nm / 1_000_000;
  }
  const round = entities.find((entity) => entity.geometry.kind === "circle" || entity.geometry.kind === "arc")?.geometry;
  if (round?.kind === "circle") return (kind === "diameter" ? round.radius_nm * 2 : round.radius_nm) / 1_000_000;
  if (round?.kind === "arc") return Math.hypot(round.start.x_nm - round.center.x_nm, round.start.y_nm - round.center.y_nm) * (kind === "diameter" ? 2 : 1) / 1_000_000;
  const ellipse = entities.find((entity) => entity.geometry.kind === "ellipse" || entity.geometry.kind === "elliptical_arc")?.geometry;
  if (kind === "ellipse_radius" && (ellipse?.kind === "ellipse" || ellipse?.kind === "elliptical_arc")) {
    const axis = [...selectedSketchPoints].reverse().find((point) => point.anchor === "major" || point.anchor === "minor")?.anchor;
    const endpoint = axis === "minor" ? ellipse.minor : ellipse.major;
    return Math.hypot(endpoint.x_nm - ellipse.center.x_nm, endpoint.y_nm - ellipse.center.y_nm) / 1_000_000;
  }
  if (kind === "angle" && lines.length === 2) {
    const angles = lines.map((line) => Math.atan2(line.end.y_nm - line.start.y_nm, line.end.x_nm - line.start.x_nm));
    let difference = Math.abs(angles[1] - angles[0]) % Math.PI; if (difference > Math.PI / 2) difference = Math.PI - difference;
    return difference * 180 / Math.PI;
  }
  return undefined;
}

function sketchConstraintDimension(constraintId: string, sketch?: Sketch): number | undefined {
  const constraint = (sketch ?? sketchSession?.draftView as Sketch | undefined)?.constraints[constraintId];
  if (!constraint) return undefined;
  if (["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance"].includes(constraint.kind)) return (constraint as Extract<typeof constraint, { distance_nm: number }>).distance_nm / 1_000_000;
  if (constraint.kind === "radius" || constraint.kind === "ellipse_radius") return constraint.radius_nm / 1_000_000;
  if (constraint.kind === "diameter") return constraint.diameter_nm / 1_000_000;
  if (constraint.kind === "angle" || constraint.kind === "angle_to_axis") return constraint.angle_microdegrees / 1_000_000;
  return undefined;
}

const CONSTRAINT_MANAGER_ROW_HEIGHT = 48;
const CONSTRAINT_MANAGER_WINDOW_ROWS = 14;
let sketchConstraintManagerSearch = "";
let sketchConstraintManagerScrollTop = 0;

function sketchConstraintManagerWindow(): { markup: string; total: number; first: number; last: number } {
  if (!sketchSession) return { markup: "", total: 0, first: 0, last: 0 };
  const sketch = sketchSession.draftView as Sketch;
  const suppressed = new Set(sketch.suppressed_constraints ?? []);
  const redundant = new Set(sketchSession.solve?.redundant_constraints ?? []);
  const conflicts = new Set(sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints) ?? []);
  const query = sketchConstraintManagerSearch.trim().toLowerCase();
  const entries = Object.entries(sketch.constraints).filter(([id, constraint]) => {
    if (!query) return true;
    const stateLabel = sketchConstraintStateLabel(resolvedSketchConstraintState(sketch, id, redundant, conflicts));
    return `${id} ${constraint.kind} ${stateLabel}`.toLowerCase().includes(query);
  });
  const total = entries.length;
  const requestedFirst = Math.max(0, Math.floor(sketchConstraintManagerScrollTop / CONSTRAINT_MANAGER_ROW_HEIGHT) - 3);
  const first = Math.min(requestedFirst, Math.max(0, total - CONSTRAINT_MANAGER_WINDOW_ROWS));
  const last = Math.min(total, first + CONSTRAINT_MANAGER_WINDOW_ROWS);
  const rows = entries.slice(first, last).map(([id, constraint]) => {
    const dimensional = ["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance", "radius", "diameter", "ellipse_radius", "angle", "angle_to_axis"].includes(constraint.kind);
    const visualState = resolvedSketchConstraintState(sketch, id, redundant, conflicts);
    const stateLabel = sketchConstraintStateLabel(visualState);
    return `<li data-constraint-row data-constraint-state="${visualState}" class="${visualState}" title="${escapeHtml(stateLabel)}">
      <button type="button" data-manage-constraint="${escapeHtml(id)}" aria-pressed="${selectedSketchConstraint === id}">${sketchConstraintIcon(constraint.kind)}<span><strong>${escapeHtml(constraintKindLabel(constraint.kind))}</strong><code>${escapeHtml(id)}</code><small>${escapeHtml(stateLabel)}</small></span></button>
      ${dimensional && !suppressed.has(id) ? `<button type="button" data-make-reference="${escapeHtml(id)}" title="Make this dimension non-driving">Reference</button>` : ""}
      <button type="button" data-toggle-constraint="${escapeHtml(id)}" aria-pressed="${suppressed.has(id)}" title="${suppressed.has(id) ? "Enable driving constraint" : "Suppress constraint"}">${suppressed.has(id) ? (dimensional ? "Make driving" : "Enable") : "Suppress"}</button>
      <button type="button" data-delete-constraint="${escapeHtml(id)}" title="Delete constraint">×</button>
    </li>`;
  }).join("");
  const before = first * CONSTRAINT_MANAGER_ROW_HEIGHT;
  const after = (total - last) * CONSTRAINT_MANAGER_ROW_HEIGHT;
  const markup = total
    ? `<li class="constraint-manager-spacer" aria-hidden="true" style="height:${before}px"></li>${rows}<li class="constraint-manager-spacer" aria-hidden="true" style="height:${after}px"></li>`
    : "<li class=empty>No matching constraints</li>";
  return { markup, total, first, last };
}

function resolvedSketchConstraintState(
  sketch: Sketch,
  id: string,
  redundant = new Set(sketchSession?.solve?.redundant_constraints ?? []),
  conflicting = new Set(sketchSession?.solve?.conflicts.flatMap((conflict) => conflict.constraints) ?? []),
): SketchConstraintVisualState {
  return sketchConstraintVisualState(sketch, id, { redundant, conflicting, solveState: sketchSession?.solve?.state });
}

function sketchConstraintStateLabel(state: SketchConstraintVisualState): string {
  return state === "unsolvable" ? "solver blocked" : state;
}

function updateSketchConstraintManagerWindow(manager: HTMLDetailsElement): void {
  const list = manager.querySelector<HTMLUListElement>("[data-constraint-list]");
  const status = manager.querySelector<HTMLElement>("[data-constraint-window]");
  if (!list || !status) return;
  const window = sketchConstraintManagerWindow();
  list.innerHTML = window.markup;
  list.setAttribute("aria-rowcount", String(window.total));
  status.textContent = window.total ? `${window.first + 1}–${window.last} of ${window.total}` : "0 matches";
  if (Math.abs(list.scrollTop - sketchConstraintManagerScrollTop) > 1) list.scrollTop = sketchConstraintManagerScrollTop;
}

function renderSketchConstraintManager(): string {
  if (!sketchSession) return "";
  const sketch = sketchSession.draftView as Sketch;
  const redundant = new Set(sketchSession.solve?.redundant_constraints ?? []);
  const conflicts = new Map(sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints.map((id) => [id, conflict.reason.kind] as const)) ?? []);
  const expanded = sketchConstraintManagerExpanded || Boolean(selectedSketchConstraint) || conflicts.size > 0;
  const solveState = sketchSession.solve?.state.replaceAll("_", " ") ?? "not solved";
  const window = expanded ? sketchConstraintManagerWindow() : undefined;
  const remainingDof = sketchSession.solve?.degrees_of_freedom ?? 0;
  const conflictActions = conflicts.size ? `<button type="button" data-isolate-conflicts aria-pressed="${sketchConflictIsolation}">${sketchConflictIsolation ? "Show all" : "Isolate conflicts"}</button><button type="button" data-repair-conflict>Repair next</button>` : "";
  const completionAction = remainingDof > 0 ? `<button type="button" data-next-underconstrained>Next free geometry · ${remainingDof} DOF</button>` : `<span class="fully-constrained-check">✓ Fully constrained</span>`;
  return `<details class="property-section sketch-constraint-manager" aria-label="Constraint manager" data-solve-state="${escapeHtml(sketchSession.solve?.state ?? "idle")}" ${expanded ? "open" : ""}><summary>Constraints <small>${Object.keys(sketch.constraints).length}</small></summary>${expanded ? `<p class="constraint-manager-state"><strong>${escapeHtml(solveState)}</strong><span>${redundant.size} redundant · ${conflicts.size} conflicting</span></p><div class="constraint-manager-actions">${completionAction}${conflictActions}</div><input type="search" data-constraint-search value="${escapeHtml(sketchConstraintManagerSearch)}" placeholder="Find constraint" aria-label="Find constraint"/><small data-constraint-window>${window!.total ? `${window!.first + 1}–${window!.last} of ${window!.total}` : "0 matches"}</small><ul data-constraint-list aria-rowcount="${window!.total}">${window!.markup}</ul>` : ""}</details>`;
}

function installConstraintFocusInteractions(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-selection-relation], [data-active-selection-constraint], [data-manage-constraint]").forEach((element) => {
    const constraintId = element.dataset.selectionRelation ?? element.dataset.activeSelectionConstraint ?? element.dataset.manageConstraint;
    if (!constraintId) return;
    element.addEventListener("pointerenter", () => {
      if (!sketchSession) return;
      sketchHoverTarget = { kind: "constraint", id: constraintId, valid: true };
      renderSketchPointerOverlay();
    });
    element.addEventListener("pointerleave", () => {
      if (sketchHoverTarget?.kind !== "constraint" || sketchHoverTarget.id !== constraintId) return;
      sketchHoverTarget = undefined;
      renderSketchPointerOverlay();
    });
    if (!element.dataset.selectionRelation && !element.dataset.activeSelectionConstraint) return;
    const select = () => {
      if (!sketchSession?.draft.constraints[constraintId]) return;
      selectedSketchConstraint = constraintId;
      const dimension = sketchConstraintDimension(constraintId);
      if (dimension !== undefined) sketchConstraintValue = dimension;
      renderSketchOverlay();
      if (activeInspectorTab === "tool") renderActiveToolInspector();
      else if (activeInspectorTab === "constraints") renderConstraintsInspector();
    };
    element.addEventListener("click", select);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault(); select();
    });
  });
}

async function toggleSketchConstraintState(id: string): Promise<void> {
  if (!sketchSession) return;
  const sketch = sketchSession.draftView as Sketch;
  const suppressed = (sketch.suppressed_constraints ?? []).includes(id);
  const current = sketch.constraints[id];
  const measured = suppressed ? constraintAnnotations(sketch, new Set([id])).find((annotation) => annotation.id === id)?.dimension : undefined;
  const updated = current && measured !== undefined ? dimensionConstraintWithCanonicalValue(current, measured) : undefined;
  await sketchSession.applyAll([
    ...(updated ? [{ kind: "set_constraint", id, constraint: updated } as SketchCommand] : []),
    { kind: "set_constraint_suppressed", constraint: id, suppressed: !suppressed },
  ]);
  sketchSolverStatus = suppressed ? "Constraint enabled" : sketchConstraintDimension(id, sketch) !== undefined ? "Dimension converted to a non-driving reference" : "Constraint suppressed";
  updateSketchStatus();
  renderActiveToolInspector();
}

async function deleteSketchConstraint(id: string): Promise<void> {
  if (!sketchSession?.draft.constraints[id]) return;
  await sketchSession.apply({ kind: "remove_constraint", constraint: id });
  sketchDimensionPositions.delete(id); persistSketchDimensionPositions();
  if (selectedSketchConstraint === id) selectedSketchConstraint = undefined;
  updateSketchStatus(); renderActiveToolInspector();
}

function selectUnderconstrainedGeometry(componentId?: number): void {
  if (!sketchSession) return;
  const components = (sketchSession.solve?.solve_components ?? []).filter((component) => component.structural_degrees_of_freedom > 0);
  const candidates = componentId === undefined
    ? [...new Set(components.flatMap((component) => component.geometry))]
    : [...new Set(components.find((component) => component.id === componentId)?.geometry ?? [])];
  const visible = candidates.filter((id) => Boolean(sketchSession?.draft.geometry[id]));
  if (!visible.length) return;
  sketchDofNavigationIndex = componentId === undefined ? (sketchDofNavigationIndex + 1) % visible.length : 0;
  const id = visible[sketchDofNavigationIndex % visible.length];
  selectedSketchGeometry = [id]; selectedSketchPoints = []; selectedSketchSegments = []; selectedSketchConstraint = undefined; sketchOriginSelected = false;
  sketchSolverStatus = `Under-constrained geometry selected · ${sketchSession.solve?.degrees_of_freedom ?? 0} sketch DOF remaining`;
  renderSketchOverlay(); renderActiveToolInspector();
}

function installSketchConstraintManager(): void {
  const manager = document.querySelector<HTMLDetailsElement>(".sketch-constraint-manager");
  manager?.addEventListener("toggle", () => {
    if (manager.open === sketchConstraintManagerExpanded) return;
    sketchConstraintManagerExpanded = manager.open;
    renderActiveToolInspector();
  });
  const search = document.querySelector<HTMLInputElement>("[data-constraint-search]");
  search?.addEventListener("input", () => {
    if (!manager) return;
    sketchConstraintManagerSearch = search.value;
    sketchConstraintManagerScrollTop = 0;
    updateSketchConstraintManagerWindow(manager);
  });
  const list = manager?.querySelector<HTMLUListElement>("[data-constraint-list]");
  let scrollFrame: number | undefined;
  if (list) {
    list.scrollTop = sketchConstraintManagerScrollTop;
    list.addEventListener("scroll", () => {
      sketchConstraintManagerScrollTop = list.scrollTop;
      if (scrollFrame !== undefined) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined;
        if (manager?.isConnected) updateSketchConstraintManagerWindow(manager);
      });
    }, { passive: true });
  }
  manager?.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button || !sketchSession) return;
    if (button.hasAttribute("data-next-underconstrained")) { selectUnderconstrainedGeometry(); return; }
    if (button.hasAttribute("data-isolate-conflicts")) {
      sketchConflictIsolation = !sketchConflictIsolation; renderSketchOverlay(); renderActiveToolInspector(); return;
    }
    if (button.hasAttribute("data-repair-conflict")) {
      const id = sketchSession.solve?.conflicts.flatMap((conflict) => conflict.constraints)[0];
      if (id) { selectedSketchConstraint = id; await toggleSketchConstraintState(id); }
      return;
    }
    if (button.dataset.manageConstraint) {
      selectedSketchConstraint = button.dataset.manageConstraint;
    const dimension = selectedSketchConstraint ? sketchConstraintDimension(selectedSketchConstraint) : undefined;
    if (dimension !== undefined) sketchConstraintValue = dimension;
    renderSketchOverlay();
    renderActiveToolInspector();
    document.querySelector<HTMLInputElement>("#active-tool-constraint-value")?.focus();
      return;
    }
    if (button.dataset.toggleConstraint) {
      const id = button.dataset.toggleConstraint;
      const sketch = sketchSession.draftView as Sketch;
      const suppressed = (sketch.suppressed_constraints ?? []).includes(id);
      const current = sketch.constraints[id];
      const measured = suppressed ? constraintAnnotations(sketch, new Set([id])).find((annotation) => annotation.id === id)?.dimension : undefined;
      const updated = current && measured !== undefined ? dimensionConstraintWithCanonicalValue(current, measured) : undefined;
      await sketchSession.applyAll([
        ...(updated ? [{ kind: "set_constraint", id, constraint: updated } as SketchCommand] : []),
        { kind: "set_constraint_suppressed", constraint: id, suppressed: !suppressed },
      ]);
      updateSketchStatus();
      renderActiveToolInspector();
      return;
    }
    if (button.dataset.makeReference) {
      await sketchSession.apply({ kind: "set_constraint_suppressed", constraint: button.dataset.makeReference, suppressed: true });
      sketchSolverStatus = "Dimension converted to a non-driving reference";
      updateSketchStatus();
      renderActiveToolInspector();
      return;
    }
    if (button.dataset.deleteConstraint) {
      await sketchSession.apply({ kind: "remove_constraint", constraint: button.dataset.deleteConstraint });
      sketchDimensionPositions.delete(button.dataset.deleteConstraint);
      persistSketchDimensionPositions();
      if (selectedSketchConstraint === button.dataset.deleteConstraint) selectedSketchConstraint = undefined;
      updateSketchStatus();
      renderActiveToolInspector();
    }
  });
}

async function updateSelectedSketchDimension(value: number): Promise<void> {
  if (!sketchSession || !selectedSketchConstraint) return;
  const current = sketchSession.draft.constraints[selectedSketchConstraint];
  if (!current || !["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance", "radius", "diameter", "ellipse_radius", "angle", "angle_to_axis"].includes(current.kind)) return;
  const next = ["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance"].includes(current.kind)
    ? { ...current, distance_nm: Math.round(value * 1_000_000) }
    : current.kind === "radius" || current.kind === "ellipse_radius"
      ? { ...current, radius_nm: Math.max(1, Math.round(value * 1_000_000)) }
      : current.kind === "diameter"
        ? { ...current, diameter_nm: Math.max(2, Math.round(value * 1_000_000)) }
        : { ...current, angle_microdegrees: Math.round(value * 1_000_000) };
  try {
    await sketchSession.apply({ kind: "set_constraint", id: selectedSketchConstraint, constraint: next });
    const expression = sketchDimensionEditor.dataset.source === "edit" ? sketchDimensionInput().value.trim() : "";
    if (expression) { sketchDimensionExpressions.set(selectedSketchConstraint, expression); persistSketchDimensionExpressions(); }
    sketchConstraintValue = value;
    updateSketchStatus();
  } catch {
    sketchSolverStatus = "Dimension edit was refused; the accepted sketch is unchanged";
    updateSketchToolInspectorState();
  }
}

function dimensionConstraintWithCanonicalValue(constraint: Constraint, value: number): Constraint | undefined {
  if (["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance"].includes(constraint.kind)) return { ...constraint, distance_nm: Math.round(value) } as Constraint;
  if (constraint.kind === "radius" || constraint.kind === "ellipse_radius") return { ...constraint, radius_nm: Math.max(1, Math.round(value)) };
  if (constraint.kind === "diameter") return { ...constraint, diameter_nm: Math.max(2, Math.round(value)) };
  if (constraint.kind === "angle" || constraint.kind === "angle_to_axis") return { ...constraint, angle_microdegrees: Math.round(value) };
  return undefined;
}

function applyPendingSketchInvocation(): void {
  if (sketchSmartDimensionActive) {
    prepareSmartDimension();
    return;
  }
  if (pendingDimensionPlacement) return;
  if (pendingSketchConstraint) {
    void applySketchConstraint(pendingSketchConstraint);
    return;
  }
  if (activeToolContext?.source !== "sketch") return;
  const tool = activeToolContext.key as SketchTool;
  if (sketchEditOperations.has(tool)) void applySketchEditOperation(tool);
  else if (tool === "project") void projectSelectedSketchEdge();
}

async function finishSketch(): Promise<void> {
  if (!sketchSession) return;
  if (sketchChoosingSupport || !activeSketchPlane) {
    sketchSolverStatus = "Choose a sketch plane before finishing";
    updateSketchToolInspectorState();
    return;
  }
  const committedSketchId = sketchSession.draft.id;
  const retainedProfile = selectedSketchProfile?.sketchId === committedSketchId ? structuredClone(selectedSketchProfile) : undefined;
  const retainedConstructionAxis = selectedSketchGeometry.find((id) => {
    const entity = sketchSession?.draft.geometry[id];
    return Boolean(entity?.construction && entity.geometry.kind === "line");
  });
  if (!(await sketchSession.commit())) {
    updateSketchStatus();
    return;
  }
  notifyOnboardingAction("finish-sketch");
  if (sketchPreviousView) renderer?.restoreView(sketchPreviousView);
  else renderer?.restoreSketchView();
  sketchPreviousView = undefined;
  renderer?.setSketchSupportSelection(false);
  activeSketchPlane = undefined;
  sketchChoosingSupport = false;
  sketchSession = undefined;
  syncEmptyDocumentActions();
  sketchRenderIndexCache.invalidate();
  sketchPlacementGesture = undefined;
  selectedSketchId = committedSketchId;
  sketchToolArmed = false;
  sketchPointInferences = [];
  sketchHoverSnap = undefined;
  selectedSketchConstraint = undefined;
  selectedSketchGeometry = [];
  selectedSketchPoints = [];
  sketchOriginSelected = false;
  selectedSketchSegments = [];
  selectedSketchProfile = retainedProfile;
  selectedSketchConstructionAxis = retainedConstructionAxis ? { sketchId: committedSketchId, geometryId: retainedConstructionAxis } : undefined;
  pendingSketchConstraint = undefined;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchConstraintApplying = false;
  sketchSelectionToolApplying = false;
  sketchHoverPoint = undefined;
  sketchHoverTarget = undefined;
  sketchHoverClientPoint = undefined;
  sketchSelectionMode = "replace";
  hiddenCommittedSketchIds.delete(committedSketchId);
  persistCommittedSketchVisibility();
  syncCommittedSketches();
  renderBrowser();
  document.querySelector<HTMLElement>(".workspace")!.classList.remove("sketch-active");
  if (sketchPreviousWorkbench) setActiveWorkbench(sketchPreviousWorkbench);
  sketchPreviousWorkbench = undefined;
  renderSketchOverlay();
  setOperation("committed", "sketch");
  setSketchToolPhase("idle");
  deactivateToolContext(false);
  syncSketchToolUi();
  syncSketchSelectionAssistUi();
  updateBaseOperationAvailability();
  const returnFocus = sketchReturnFocus;
  sketchReturnFocus = null;
  returnFocus?.focus();
}

function cancelSketch(): void {
  sketchSession?.cancel();
  renderer?.setSketchSupportSelection(false);
  if (sketchPreviousView) renderer?.restoreView(sketchPreviousView);
  else renderer?.restoreSketchView();
  sketchPreviousView = undefined;
  activeSketchPlane = undefined;
  sketchChoosingSupport = false;
  sketchSession = undefined;
  syncEmptyDocumentActions();
  sketchRenderIndexCache.invalidate();
  sketchPlacementGesture = undefined;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  selectedSketchConstraint = undefined;
  selectedSketchGeometry = [];
  selectedSketchPoints = [];
  sketchOriginSelected = false;
  selectedSketchSegments = [];
  pendingSketchConstraint = undefined;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchConstraintApplying = false;
  sketchSelectionToolApplying = false;
  sketchToolArmed = false;
  sketchHoverPoint = undefined;
  sketchHoverTarget = undefined;
  sketchHoverClientPoint = undefined;
  sketchSelectionMode = "replace";
  sketchDrag = undefined;
  syncCommittedSketches();
  document.querySelector<HTMLElement>(".workspace")!.classList.remove("sketch-active");
  renderSketchOverlay();
  if (sketchPreviousWorkbench) setActiveWorkbench(sketchPreviousWorkbench);
  sketchPreviousWorkbench = undefined;
  setOperation("cancelled", "sketch");
  setSketchToolPhase("idle");
  deactivateToolContext(false);
  syncSketchToolUi();
  syncSketchSelectionAssistUi();
  const returnFocus = sketchReturnFocus;
  sketchReturnFocus = null;
  returnFocus?.focus();
}

function clearActiveSketchTool(): void {
  sketchToolArmed = false;
  sketchPlacementGesture = undefined;
  pendingSketchConstraint = undefined;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchConstraintApplying = false;
  sketchSelectionToolApplying = false;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  sketchOriginSelected = false;
  sketchHoverPoint = undefined;
  sketchHoverTarget = undefined;
  sketchDrag = undefined;
  sketchToolPhase = "idle";
  activateToolContext({ key: "sketch-select", label: "Select", source: "sketch" });
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.sketchTool === "construction" && sketchConstruction));
  });
  sketchSolverStatus = "Tool cleared · select geometry or choose another tool";
  renderSketchOverlay();
  updateSketchToolInspectorState();
  syncSketchToolUi();
  document.querySelector<HTMLCanvasElement>("#viewport")?.focus();
}

async function completeActiveSketchInvocation(): Promise<boolean> {
  if (!sketchSession) return false;
  if (pendingDimensionPlacement) return commitPendingDimensionPlacement();
  if (pendingSketchEditPreview) return commitPendingSketchEditPreview();
  if (pendingReferenceDimension) {
    sketchSolverStatus = "Choose Add as reference dimension, change the selection, or press Escape";
    updateSketchToolInspectorState();
    return false;
  }
  if (sketchPoints.length) {
    sketchPoints = [];
    sketchPointInferences = [];
    resetInlineCreationInput();
    sketchPlacementGesture = undefined;
    sketchSolverStatus = `${sketchSession.activeTool === "line" ? "Line chain" : "Current tool use"} complete · the tool remains active for a new use`;
    setSketchToolPhase("complete");
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return true;
  }
  if (sketchSmartDimensionActive) { prepareSmartDimension(); return Boolean(pendingDimensionPlacement); }
  if (pendingSketchConstraint) return applySketchConstraint(pendingSketchConstraint);
  if (activeToolContext?.source === "sketch" && sketchEditOperations.has(activeToolContext.key as SketchTool)) {
    await applySketchEditOperation(activeToolContext.key as SketchTool);
    return Boolean(pendingSketchEditPreview);
  }
  if (sketchToolPhase === "complete" && (sketchToolArmed || pendingSketchConstraint || sketchSmartDimensionActive)) {
    setSketchToolPhase("collecting");
    return true;
  }
  sketchSolverStatus = "Nothing is ready to complete · Finish Sketch remains an explicit workspace action";
  updateSketchToolInspectorState();
  return false;
}

async function backOutOfSketch(): Promise<void> {
  if (!sketchSession) return;
  if (sketchDrag || sketchPoints.length > 0) {
    sketchDrag = undefined;
    sketchPoints = [];
    sketchPointInferences = [];
    resetInlineCreationInput();
    sketchHoverSnap = undefined;
    sketchHoverPoint = undefined;
    delete document.querySelector<SVGSVGElement>("#sketch-overlay")!.dataset.dragging;
    sketchSolverStatus = "Current tool action cancelled · completed geometry preserved";
    renderSketchOverlay();
    updateSketchToolInspectorState();
    return;
  }
  if (pendingDimensionPlacement || pendingSketchEditPreview || pendingReferenceDimension) {
    pendingDimensionPlacement = undefined;
    cancelPendingSketchEditPreview();
    pendingReferenceDimension = undefined;
    sketchSolverStatus = "Current preview cancelled · the active tool remains available";
    setSketchToolPhase("collecting");
    renderSketchOverlay();
    renderActiveToolInspector();
    return;
  }
  if (sketchToolArmed || (activeToolContext?.key !== "sketch-select" && (activeToolContext?.source === "sketch" || activeToolContext?.source === "constraint"))) {
    clearActiveSketchTool();
    return;
  }
  if (sketchChoosingSupport || !activeSketchPlane) cancelSketch();
  else if (hasSketchSelection() || selectedSketchConstraint) {
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchOriginSelected = false;
    selectedSketchConstraint = undefined;
    selectedSketchProfile = undefined;
    selectedSketchConstructionAxis = undefined;
    sketchProfileRepairMessage = undefined;
    sketchSelectionMode = "replace";
    sketchSolverStatus = "Selection cleared · no active tool";
    renderSketchOverlay();
    setSketchToolPhase("idle");
    renderActiveToolInspector();
  }
  else {
    sketchSolverStatus = "No active tool · use Finish Sketch to leave the workspace";
    updateSketchToolInspectorState();
    document.querySelector<HTMLButtonElement>("#finish-sketch-ribbon")?.focus();
  }
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

async function exportPortableFile(associateWithDocument: boolean): Promise<void> {
  const picker = (window as PortablePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const base = adapter.getSnapshot().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
      const selectedHandle = await picker({ suggestedName: `${base}.crawlerpart`, types: [portablePickerType] });
      if (associateWithDocument) portableFileHandle = selectedHandle;
      pendingPortableSaveHandle = selectedHandle;
      document.querySelector("#storage-status")!.textContent = "saving";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      storageFailure(error);
      return;
    }
  }
  worker?.postMessage({ type: "export-package" });
}

async function saveAsPortable(): Promise<void> {
  await exportPortableFile(true);
}

async function savePortableCopy(): Promise<void> {
  await exportPortableFile(false);
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

let activeManagedDialog: HTMLElement | null = null;
const dialogReturnFocus = new WeakMap<HTMLElement, HTMLElement | null>();

function preferredReturnFocus(trigger?: HTMLElement | null): HTMLElement | null {
  const candidate = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return candidate?.closest<HTMLDetailsElement>(".app-menu")?.querySelector<HTMLElement>("summary") ?? candidate;
}

function setApplicationInert(dialog: HTMLElement | null): void {
  const shell = document.querySelector<HTMLElement>(".shell")!;
  const scrim = document.querySelector<HTMLElement>("#modal-scrim")!;
  Array.from(shell.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    child.inert = Boolean(dialog && child !== dialog && child !== scrim);
  });
}

function dismissTransientSurfaces(): void {
  closeToolbarCustomization(false);
  toolbarMenus.forEach((menu) => { menu.open = false; });
  document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((flyout) => { flyout.hidden = true; });
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  toolbarCommandContextMenu.hidden = true;
  viewportContextMenu.hidden = true;
  treeContextMenu.hidden = true;
  viewportBackgroundMenu.hidden = true;
  viewportBackgroundButton.setAttribute("aria-expanded", "false");
}

function closeManagedDialog(dialog: HTMLElement, restoreFocus = true): void {
  if (dialog.hidden) return;
  dialog.hidden = true;
  if (activeManagedDialog === dialog) {
    activeManagedDialog = null;
    document.querySelector<HTMLElement>("#modal-scrim")!.hidden = true;
    setApplicationInert(null);
  }
  if (!restoreFocus) return;
  const target = dialogReturnFocus.get(dialog);
  if (target?.isConnected && !target.closest("[hidden], [inert]")) target.focus();
}

function openManagedDialog(dialog: HTMLElement, trigger: HTMLElement | null, initialFocus: HTMLElement): void {
  const inheritedReturnFocus = activeManagedDialog
    ? dialogReturnFocus.get(activeManagedDialog) ?? preferredReturnFocus(trigger)
    : preferredReturnFocus(trigger);
  if (activeManagedDialog && activeManagedDialog !== dialog) closeManagedDialog(activeManagedDialog, false);
  dismissTransientSurfaces();
  dialogReturnFocus.set(dialog, inheritedReturnFocus);
  activeManagedDialog = dialog;
  document.querySelector<HTMLElement>("#modal-scrim")!.hidden = false;
  dialog.hidden = false;
  setApplicationInert(dialog);
  initialFocus.focus();
}

function focusableDialogElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

document.querySelectorAll<HTMLElement>("#command-search, #parameters-dialog").forEach((dialog) => dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeManagedDialog(dialog);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableDialogElements(dialog);
  if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}));
document.querySelector<HTMLElement>("#modal-scrim")!.addEventListener("click", () => {
  if (activeManagedDialog) closeManagedDialog(activeManagedDialog);
});

let onboarding: ReturnType<typeof installOnboarding>;
interface AppCommand {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
  operationId?: string;
  group: string;
  workbenches?: readonly WorkbenchId[];
  priority?: number;
  disabledReason?: () => string | undefined;
  run: () => void;
}

function openCatalogOperation(operation: AlphaOperation): void {
  if (operation.id.startsWith("crawler.part.") && !modelingRuntimeReady()) {
    showActionError(operation.label, "The document runtime is not ready for modeling yet.");
    return;
  }
  const sketchTool = ({
    "crawler.sketch.line": "line",
    "crawler.sketch.circle": "circle",
    "crawler.sketch.arc": "arc",
    "crawler.sketch.rectangle": "rectangle",
    "crawler.sketch.trim": "trim",
    "crawler.sketch.construction": "construction",
  } as const)[operation.id as "crawler.sketch.line" | "crawler.sketch.circle" | "crawler.sketch.arc" | "crawler.sketch.rectangle" | "crawler.sketch.trim" | "crawler.sketch.construction"];
  if (sketchTool) {
    selectedCatalogOperationId = null;
    renderDocument();
    startSketchEdit(sketchTool, operation.label);
    return;
  }
  activateToolContext({ key: operation.id, label: operation.label, source: "catalog" });
  if (operation.id === extrudeOperation.id || operation.id === extrudeCutOperation.id) {
    beginExtrudePreview(operation.id === extrudeCutOperation.id ? "cut" : "new_body");
    document.querySelector<HTMLInputElement>("#pad-length")!.focus();
    document.querySelector<HTMLInputElement>("#pad-length")!.select();
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
  id: operation.id,
  label: operation.label,
  detail: operation.enablement.state === "disabled"
    ? operation.enablement.reason ?? "This operation is disabled."
    : operation.group.replaceAll("_", " "),
  enabled: operation.enablement.state === "enabled",
  operationId: operation.id,
  group: operation.id.startsWith("crawler.sketch.") ? "Sketch commands" : "Model commands",
  workbenches: operation.id.startsWith("crawler.sketch.") ? ["Sketcher"] : ["Part Design"],
  priority: operation.id === "crawler.part.extrude" || operation.id === "crawler.sketch.rectangle" ? 35 : 0,
  run: () => openCatalogOperation(operation),
}));

const catalogBackedSketchToolKeys = new Set(["line", "circle", "arc", "rect", "trim", "construction"]);
const sketcherSurfaceTools = workbenchSpecs
  .find((spec) => spec.id === "Sketcher")!
  .sections.flatMap((section) => section.tools)
  .filter((tool) => !tool.comingSoon && (tool.sketchTool || tool.sketchConstraint || tool.id === "smart-sketch-dimension" || tool.id === "sketch-select-tool"));

function sketchSurfaceDisabledReason(tool: RibbonTool): string | undefined {
  if (safeMode || !sketchBridge) return "Sketch editing is available after the runtime is ready";
  if (tool.id === "sketch-select-tool") return sketchSession && !sketchChoosingSupport ? undefined : "Start or edit a sketch to select sketch geometry";
  if (tool.sketchConstraint) {
    if (!sketchSession) return "Start or edit a sketch to use constraints";
    if (sketchChoosingSupport) return "Choose a sketch plane before applying constraints";
    const summary = summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected);
    return constraintDisabledReason(tool.sketchConstraint, summary);
  }
  if (tool.id === "smart-sketch-dimension") {
    if (!sketchSession || sketchChoosingSupport) return undefined;
    return smartDimensionDisabledReason(summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected));
  }
  if (tool.sketchTool && sketchEditOperations.has(tool.sketchTool)) {
    if (!sketchSession) return "Start or edit a sketch and select geometry to modify";
    if (sketchChoosingSupport) return "Choose a sketch plane before modifying geometry";
    return toolDisabledReason(tool.sketchTool, summarizeSketchSelection(sketchSession.draft, selectedSketchGeometry, selectedSketchPoints, sketchOriginSelected));
  }
  return undefined;
}

const sketchSurfaceCommands: AppCommand[] = sketcherSurfaceTools
  .filter((tool) => !catalogBackedSketchToolKeys.has(tool.key))
  .map((tool) => ({
    id: `sketch-surface:${tool.key}`,
    label: tool.label,
    detail: tool.sketchConstraint ? "Sketch constraint" : tool.id === "smart-sketch-dimension" ? "Contextual sketch dimension" : "Sketcher tool",
    enabled: true,
    group: "Sketch commands",
    workbenches: ["Sketcher"],
    priority: tool.id === "smart-sketch-dimension" ? 35 : 0,
    disabledReason: () => sketchSurfaceDisabledReason(tool),
    run: () => document.querySelector<HTMLButtonElement>(`[data-workbench-ribbon="Sketcher"] [data-ribbon-tool="${CSS.escape(tool.key)}"]`)?.click(),
  }));

document.querySelector("#select-tool")!.addEventListener("click", () => {
  document.querySelector<HTMLCanvasElement>("#viewport")!.focus();
});
document.querySelector("#sketch-select-tool")!.addEventListener("click", () => {
  if (!sketchSession || sketchChoosingSupport) return;
  clearActiveSketchTool();
});
document.querySelector("#sketch-selection-filter-toggle")!.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const host = button.closest<HTMLElement>(".sketch-selection-filters")!;
  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  host.classList.toggle("expanded", expanded);
});
document.querySelectorAll<HTMLButtonElement>("[data-sketch-selection-mode]").forEach((button) => button.addEventListener("click", () => {
  const requested = button.dataset.sketchSelectionMode as "add" | "remove";
  sketchSelectionMode = sketchSelectionMode === requested ? "replace" : requested;
  syncSketchSelectionAssistUi();
  sketchViewport.focus();
}));
document.querySelector<HTMLButtonElement>("[data-sketch-selection-clear]")!.addEventListener("click", () => {
  clearSketchSelection();
  sketchSelectionMode = "replace";
  syncSketchSelectionAssistUi();
  sketchViewport.focus();
});
document.querySelector(".commandbar")!.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-disabled-reason]");
  if (!button || !sketchSession) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  sketchSolverStatus = button.dataset.disabledReason ?? "This command is not compatible with the current selection";
  setSketchToolPhase("blocked");
  updateSketchToolInspectorState();
  if (activeInspectorTab === "tool") renderActiveToolInspector();
}, { capture: true });
document.querySelectorAll<HTMLButtonElement>(".ribbon-tool").forEach((button) => button.addEventListener("click", () => {
  if (button.getAttribute("aria-disabled") === "true") return;
  if (button.matches("[data-sketch-tool], [data-sketch-constraint], #smart-sketch-dimension, #sketch-select-tool")) return;
  const label = button.querySelector("span:last-child")?.textContent?.trim() || button.title || "Tool";
  activateToolContext({ key: button.dataset.ribbonTool ?? label.toLowerCase(), label, source: "ribbon" });
}, { capture: true }));
document.querySelectorAll<HTMLButtonElement>("[data-catalog-operation]").forEach((button) => {
  button.addEventListener("click", () => {
    if (safeMode) return;
    const operationId = button.dataset.catalogOperation;
    const operation = alphaOperations.find((candidate) => candidate.id === operationId);
    if (operation?.enablement.state === "enabled") openCatalogOperation(operation);
  });
});
function installComingSoon(button: HTMLButtonElement): void {
  const tooltip = document.querySelector<HTMLElement>("#coming-soon-tooltip")!;
  const show = () => {
    const bounds = button.getBoundingClientRect();
    tooltip.textContent = button.dataset.comingSoon ?? "Coming soon!";
    tooltip.style.left = `${Math.min(window.innerWidth - 210, Math.max(8, bounds.left + bounds.width / 2 - 90))}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 42, bounds.bottom + 8)}px`;
    tooltip.hidden = false;
  };
  const hide = () => { tooltip.hidden = true; };
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("pointerenter", show);
  button.addEventListener("pointerleave", hide);
  button.addEventListener("focus", show);
  button.addEventListener("blur", hide);
}
function pruneFutureCapabilityControls(scope: ParentNode): void {
  if (exposeFutureCapabilities) return;
  scope.querySelectorAll<HTMLElement>("[data-coming-soon]").forEach((control) => control.remove());
  scope.querySelectorAll<HTMLElement>(":scope > small").forEach((heading) => {
    let next = heading.nextElementSibling;
    let hasAction = false;
    while (next && next.tagName !== "SMALL") {
      if (next.matches("button, [role='menuitem']")) { hasAction = true; break; }
      next = next.nextElementSibling;
    }
    if (!hasAction) heading.remove();
  });
}
pruneFutureCapabilityControls(document.querySelector<HTMLElement>("#viewport-context-menu")!);
document.querySelectorAll<HTMLButtonElement>("[data-coming-soon]").forEach(installComingSoon);

function renderParametersDialog(): void {
  const host = document.querySelector<HTMLElement>("#parameters-dialog-list")!;
  const snapshot = adapter.getSnapshot();
  const namedParameters = definedParameters();
  const sketchFeatureIds = new Set(snapshot.features.filter((feature) => feature.type === "sketch").map((feature) => feature.id));
  document.querySelector("#parameters-document-name")!.textContent = snapshot.name;
  document.querySelector("#parameter-health")!.textContent = `${namedParameters.length} defined`;
  const groups = new Map<string, NamedParameterView[]>();
  for (const parameter of namedParameters) {
    const references = parameterBindings().filter((binding) => binding.parameter === parameter.id).length;
    const group = references > 1 ? "Shared" : "Defined";
    groups.set(group, [...(groups.get(group) ?? []), parameter]);
  }
  host.innerHTML = namedParameters.length
    ? [...groups.entries()].map(([group, parameters]) => `<section class="dialog-parameter-group" data-parameter-group="${group}"><button type="button" class="dialog-group-header" aria-expanded="true"><i>⌄</i><span>${group}</span><small>(${parameters.length})</small></button><div>${parameters.map((parameter) => {
      const bindings = parameterBindings().filter((binding) => binding.parameter === parameter.id);
      const binding = bindings.find((candidate) => sketchFeatureIds.has(candidate.feature)) ?? bindings[0];
      const editable = Boolean(binding) && !["boolean", "text"].includes(parameter.kind);
      const display = exactParameterDisplay(parameter);
      const unit = display.includes(" mm") ? "mm" : display.includes(" deg") ? "deg" : "—";
      const value = display.replace(/\s+(mm|deg|mm tolerance)$/i, "");
      const expression = parameterExpressionDisplay(parameter);
      const parameterError = currentParameterErrors.get(binding?.field ?? parameter.id) ?? "";
      return `<article class="dialog-parameter-row" data-dialog-parameter="${escapeHtml(parameter.id)}" data-filter-text="${escapeHtml(`${parameter.name} ${parameter.source} ${parameter.display_expression}`.toLowerCase())}"><i class="parameter-status-dot"></i><span class="parameter-name"><strong>${escapeHtml(parameter.name)}</strong><code>${escapeHtml(parameter.id)}</code></span><input class="parameter-source" data-dialog-expression="${escapeHtml(parameter.id)}" data-feature="${escapeHtml(binding?.feature ?? "")}" data-field="${escapeHtml(binding?.field ?? parameter.id)}" value="${escapeHtml(expression)}" data-accepted-value="${escapeHtml(expression)}" ${parameterError ? 'aria-invalid="true"' : ""} ${editable ? "" : "disabled"} /><output>${escapeHtml(value)}</output><span class="parameter-unit">${unit}</span><span class="parameter-refs">${bindings.length || "—"}</span><span class="parameter-description${parameterError ? " error" : ""}">${escapeHtml(parameterError || expression)}</span></article>`;
    }).join("")}</div></section>`).join("")
    : `<div class="parameters-empty"><strong>No defined parameters</strong><p>Sketch dimensions remain implicit until you give one a reusable name.</p></div>`;
  host.querySelectorAll<HTMLButtonElement>(".dialog-group-header").forEach((button) => button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.nextElementSibling?.toggleAttribute("hidden", !expanded);
    button.querySelector("i")!.textContent = expanded ? "⌄" : "›";
  }));
  host.querySelectorAll<HTMLElement>(".dialog-parameter-row").forEach((row) => row.addEventListener("click", () => {
    host.querySelectorAll(".dialog-parameter-row.selected").forEach((selected) => selected.classList.remove("selected"));
    row.classList.add("selected");
  }));
  host.querySelectorAll<HTMLInputElement>("[data-dialog-expression]").forEach((input) => {
    input.addEventListener("dblclick", () => input.select());
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      currentParameterErrors.delete(input.dataset.field!);
      const description = input.closest(".dialog-parameter-row")?.querySelector<HTMLElement>(".parameter-description");
      if (description) { description.textContent = input.value; description.classList.remove("error"); }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = input.dataset.acceptedValue ?? "";
        input.removeAttribute("aria-invalid");
        currentParameterErrors.delete(input.dataset.field!);
        const description = input.closest(".dialog-parameter-row")?.querySelector<HTMLElement>(".parameter-description");
        if (description) { description.textContent = input.value; description.classList.remove("error"); }
        input.blur();
      }
      if (event.key === "Enter" && input.dataset.feature) {
        event.preventDefault();
        beginParameterOperation(`Edit ${input.dataset.field}`);
        worker?.postMessage({ type: "set-parameter-expression", feature: input.dataset.feature, field: input.dataset.field, source: input.value });
      }
    });
  });
}

function openParametersDialog(trigger?: HTMLElement): void {
  renderParametersDialog();
  const dialog = document.querySelector<HTMLElement>("#parameters-dialog")!;
  openManagedDialog(dialog, trigger ?? null, document.querySelector<HTMLButtonElement>("#close-parameters")!);
}
function closeParametersDialog(): void {
  closeManagedDialog(document.querySelector<HTMLElement>("#parameters-dialog")!);
}
document.querySelectorAll<HTMLButtonElement>("[data-open-parameters]").forEach((button) => button.addEventListener("click", () => openParametersDialog(button)));
document.querySelectorAll<HTMLButtonElement>("#close-parameters, [data-close-parameters]").forEach((button) => button.addEventListener("click", closeParametersDialog));
document.querySelector<HTMLInputElement>("#parameters-filter")!.addEventListener("input", (event) => {
  const query = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".dialog-parameter-row").forEach((row) => { row.hidden = Boolean(query) && !(row.dataset.filterText ?? "").includes(query); });
  document.querySelectorAll<HTMLElement>(".dialog-parameter-group").forEach((group) => { group.hidden = !Array.from(group.querySelectorAll<HTMLElement>(".dialog-parameter-row")).some((row) => !row.hidden); });
});
document.querySelector("#parameters-edit-inspector")!.addEventListener("click", () => {
  closeParametersDialog();
  if (!state.panels.inspector) document.querySelector<HTMLButtonElement>("[data-panel-toggle='inspector']")?.click();
  const sketchFeature = adapter.getSnapshot().features.find((feature) => feature.type === "sketch");
  if (sketchFeature) {
    state.selectedFeatureId = sketchFeature.id;
    activeInspectorTab = "properties";
    renderInspector();
  }
  const panel = document.querySelector<HTMLElement>(".inspector-panel")!;
  const target = panel.querySelector<HTMLElement>(".sketch-dimensions");
  target?.scrollIntoView({ block: "start" });
  target?.querySelector<HTMLButtonElement>("[data-start-define-parameter]")?.focus();
});

function mirrorStatus(sourceSelector: string, targetSelector: string): void {
  const source = document.querySelector<HTMLElement>(sourceSelector)!;
  const target = document.querySelector<HTMLElement>(targetSelector)!;
  const sync = () => { target.textContent = source.textContent; };
  sync();
  new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
}
mirrorStatus("#selection-readout", "#statusbar-selection");
mirrorStatus("#operation-state", "#statusbar-operation");
mirrorStatus("#storage-status", "#statusbar-storage");

type InspectorLayout = "docked" | "floating";
const INSPECTOR_LAYOUT_STORAGE_KEY = "crawler.inspector-layout.v1";
const inspectorPanel = document.querySelector<HTMLElement>(".inspector-panel")!;
const inspectorLayoutButton = document.querySelector<HTMLButtonElement>("#inspector-layout")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
let inspectorLayout: InspectorLayout = (() => {
  try { return localStorage.getItem(INSPECTOR_LAYOUT_STORAGE_KEY) === "floating" ? "floating" : "docked"; }
  catch { return "docked"; }
})();

function applyInspectorLayout(layout: InspectorLayout, persist = true): void {
  inspectorLayout = layout;
  const floating = layout === "floating";
  workspace.classList.toggle("inspector-docked", !floating);
  workspace.classList.toggle("inspector-floating", floating);
  inspectorPanel.style.removeProperty("left");
  inspectorPanel.style.removeProperty("top");
  inspectorPanel.style.removeProperty("right");
  inspectorLayoutButton.setAttribute("aria-pressed", String(floating));
  inspectorLayoutButton.setAttribute("aria-label", floating ? "Dock properties panel" : "Float properties panel");
  inspectorLayoutButton.title = floating ? "Dock properties panel" : "Float properties panel";
  inspectorLayoutButton.querySelector("span")!.textContent = floating ? "Dock" : "Float";
  if (persist) {
    try { localStorage.setItem(INSPECTOR_LAYOUT_STORAGE_KEY, layout); } catch { /* Layout preference is optional. */ }
  }
}

applyInspectorLayout(inspectorLayout, false);
inspectorLayoutButton.addEventListener("click", () => applyInspectorLayout(inspectorLayout === "docked" ? "floating" : "docked"));
const inspectorTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]"));
inspectorTabs.forEach((button) => {
  button.addEventListener("click", () => setInspectorTab(button.dataset.inspectorTab as InspectorTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const visibleTabs = inspectorTabs.filter((candidate) => !candidate.hidden);
    const current = visibleTabs.indexOf(button);
    const target = event.key === "Home" ? visibleTabs[0]
      : event.key === "End" ? visibleTabs.at(-1)
        : visibleTabs[(current + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length];
    if (!target) return;
    event.preventDefault();
    setInspectorTab(target.dataset.inspectorTab as InspectorTab);
    target.focus();
  });
});

const inspectorHandle = document.querySelector<HTMLElement>(".inspector-drag-handle")!;
inspectorHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || inspectorLayout !== "floating") return;
  event.preventDefault();
  const workspaceBounds = workspace.getBoundingClientRect();
  const panelBounds = inspectorPanel.getBoundingClientRect();
  const offsetX = event.clientX - panelBounds.left;
  const offsetY = event.clientY - panelBounds.top;
  inspectorHandle.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent) => {
    const left = Math.max(8, Math.min(workspaceBounds.width - panelBounds.width - 8, moveEvent.clientX - workspaceBounds.left - offsetX));
    const top = Math.max(8, Math.min(workspaceBounds.height - panelBounds.height - 8, moveEvent.clientY - workspaceBounds.top - offsetY));
    inspectorPanel.style.left = `${left}px`;
    inspectorPanel.style.top = `${top}px`;
    inspectorPanel.style.right = "auto";
  };
  const finish = (upEvent: PointerEvent) => {
    inspectorHandle.removeEventListener("pointermove", move);
    inspectorHandle.removeEventListener("pointerup", finish);
    inspectorHandle.removeEventListener("pointercancel", cancel);
    if (inspectorHandle.hasPointerCapture(upEvent.pointerId)) inspectorHandle.releasePointerCapture(upEvent.pointerId);
  };
  const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent);
  inspectorHandle.addEventListener("pointermove", move);
  inspectorHandle.addEventListener("pointerup", finish);
  inspectorHandle.addEventListener("pointercancel", cancel, { once: true });
});

const viewportContextMenu = document.querySelector<HTMLElement>("#viewport-context-menu")!;
const treeContextMenu = document.querySelector<HTMLElement>("#tree-context-menu")!;
function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = Math.min(menu.scrollHeight, window.innerHeight - 12);
  menu.style.left = `${Math.max(6, Math.min(window.innerWidth - width - 6, clientX))}px`;
  menu.style.top = `${Math.max(6, Math.min(window.innerHeight - height - 6, clientY))}px`;
  menu.querySelector<HTMLInputElement>("[data-context-filter]")?.focus();
}
function installContextSearch(menu: HTMLElement): void {
  const input = menu.querySelector<HTMLInputElement>("[data-context-filter]");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button[data-context-label]"));
    let visible = 0;
    buttons.forEach((button) => {
      const match = !query || (button.dataset.contextLabel ?? button.textContent ?? "").toLowerCase().includes(query);
      button.hidden = !match;
      if (match) visible += 1;
    });
    menu.querySelectorAll<HTMLElement>(":scope > small").forEach((heading) => { heading.hidden = Boolean(query); });
    const empty = menu.querySelector<HTMLElement>(".context-no-results");
    if (empty) empty.hidden = visible > 0;
  });
}
installContextSearch(viewportContextMenu);
function viewportProducerFeature(): ReturnType<typeof adapter.findFeature> {
  const features = adapter.getSnapshot().features;
  const activeBodyId = acceptedBodyId;
  const acceptedAdvancedFeature = [...features].reverse().find((feature) => durableAdvancedEditState(feature.id).request?.output_body_id === activeBodyId);
  if (acceptedAdvancedFeature) return acceptedAdvancedFeature;
  const body = adapter.findBody(activeBodyId);
  const bodyProducer = body?.generatedBy ? adapter.findFeature(body.generatedBy) : undefined;
  const producerRequest = bodyProducer ? durableAdvancedEditState(bodyProducer.id).request : undefined;
  return producerRequest?.output_body_id === activeBodyId ? bodyProducer : undefined;
}
document.querySelector("#viewport")!.addEventListener("contextmenu", (event) => {
  const pointer = event as MouseEvent;
  event.preventDefault();
  dismissTransientSurfaces();
  const extrude = viewportContextMenu.querySelector<HTMLButtonElement>("[data-invoke='#start-pad']");
  if (extrude) {
    extrude.disabled = document.querySelector<HTMLButtonElement>("#start-pad")?.disabled ?? true;
    extrude.title = extrude.disabled ? "Select a closed sketch profile to extrude" : "Extrude the selected sketch profile";
  }
  const visibility = viewportContextMenu.querySelector<HTMLButtonElement>("#viewport-toggle-visibility");
  if (visibility) {
    visibility.disabled = !document.querySelector(`[data-body-visibility="${CSS.escape(acceptedBodyId)}"]`);
    visibility.title = visibility.disabled ? "No active body is available" : "Show or hide the active body";
  }
  const editFeature = viewportContextMenu.querySelector<HTMLButtonElement>("#viewport-edit-feature");
  if (editFeature) {
    const feature = viewportProducerFeature();
    const definition = feature ? operationForFeatureType(feature.type) : undefined;
    const available = Boolean(feature && definition && isAdvancedFeatureOperation(definition.id) && durableAdvancedEditState(feature.id).request);
    editFeature.disabled = !available;
    editFeature.setAttribute("aria-disabled", String(!available));
    editFeature.title = available ? `Edit ${feature!.name}` : "The active body is not produced by an editable feature";
  }
  positionContextMenu(viewportContextMenu, pointer.clientX, pointer.clientY);
});
const openTreeContextMenu = (event: Event): void => {
  const pointer = event as MouseEvent;
  const row = (event.target as Element).closest<HTMLElement>("[data-feature-id], [data-body-id]");
  if (!row) return;
  event.preventDefault();
  row.click();
  const contextRow = row.dataset.bodyId
    ? document.querySelector<HTMLElement>(`[data-body-id="${CSS.escape(row.dataset.bodyId)}"]`) ?? row
    : row;
  dismissTransientSurfaces();
  const isFeature = Boolean(row.dataset.featureId);
  const contextBody = row.dataset.bodyId ? adapter.findBody(row.dataset.bodyId) : undefined;
  const visibility = row.closest("li")?.querySelector<HTMLButtonElement>("[data-body-visibility]");
  treeContextMenu.innerHTML = isFeature
    ? `<label class="context-search"><i data-lucide="search"></i><input type="search" data-context-filter="tree" placeholder="Search commands…" aria-label="Search feature commands" /></label>
       <small>Feature</small>
       <button type="button" role="menuitem" data-context-label="Edit Feature" data-tree-action="edit"><span>Edit Feature</span><kbd>E</kbd></button>
       <button type="button" role="menuitem" data-context-label="Rename" data-tree-action="rename"><span>Rename</span><kbd>F2</kbd></button>
       <button class="coming-soon" type="button" role="menuitem" data-context-label="Duplicate" aria-disabled="true" data-coming-soon="Duplicate - coming soon!" title="Duplicate - coming soon!"><span>Duplicate</span><kbd>Ctrl+D</kbd></button>
       <small>State</small><button type="button" role="menuitem" data-context-label="Suppress Feature" data-tree-action="suppress"><span>Suppress / activate</span><kbd>⇧S</kbd></button>
       <small>Order</small><button type="button" role="menuitem" data-context-label="Move Up" data-tree-action="move-up"><span>Move Up</span><kbd>Alt+↑</kbd></button><button type="button" role="menuitem" data-context-label="Move Down" data-tree-action="move-down"><span>Move Down</span><kbd>Alt+↓</kbd></button>
       <small>Inspect</small><button type="button" role="menuitem" data-context-label="Dependencies" data-tree-action="dependencies"><span>Dependencies</span></button><button type="button" role="menuitem" data-context-label="Properties" data-tree-action="properties"><span>Properties</span><kbd>Alt+Enter</kbd></button>
       <small>Danger</small><button type="button" role="menuitem" class="danger" data-context-label="Delete" data-tree-action="delete"><span>Delete</span><kbd>Del</kbd></button><p class="context-no-results" hidden>No matching commands</p>`
    : `<label class="context-search"><i data-lucide="search"></i><input type="search" data-context-filter="tree" placeholder="Search commands…" aria-label="Search body commands" /></label>
       <small>Body</small><button type="button" role="menuitem" data-context-label="Rename" data-tree-action="rename-body"><span>Rename</span><kbd>F2</kbd></button><button type="button" role="menuitem" data-context-label="Set Appearance" data-tree-action="appearance"><span>Set Appearance</span></button>
       <small>Visibility</small><button type="button" role="menuitem" data-context-label="${visibility?.getAttribute("aria-pressed") === "true" ? "Hide" : "Show"}" data-tree-action="visibility"><span>${visibility?.getAttribute("aria-pressed") === "true" ? "Hide" : "Show"}</span><kbd>Space</kbd></button>
       <small>Inspect</small><button type="button" role="menuitem" data-context-label="Dependencies" data-tree-action="body-dependencies"><span>Dependencies</span></button><button type="button" role="menuitem" data-context-label="Properties" data-tree-action="properties"><span>Properties</span><kbd>Alt+Enter</kbd></button>
       <p class="context-no-results" hidden>No matching commands</p>`;
  pruneFutureCapabilityControls(treeContextMenu);
  createIcons({ icons: { Search } });
  treeContextMenu.querySelectorAll<HTMLButtonElement>("[data-coming-soon]").forEach(installComingSoon);
  if (isFeature) {
    const orderedFeatures = adapter.getSnapshot().features;
    const contextFeatureIndex = orderedFeatures.findIndex((feature) => feature.id === row.dataset.featureId);
    const availableActions: Record<string, boolean> = {
      edit: Boolean(document.querySelector("[data-feature-action='edit-parameters']")),
      rename: Boolean(document.querySelector("#feature-name")),
      suppress: Boolean(document.querySelector("[data-feature-action='suppress']")),
      "move-up": Boolean(document.querySelector("[data-history-action='reorder']")),
      "move-down": contextFeatureIndex >= 0 && contextFeatureIndex < orderedFeatures.length - 1 && Boolean(worker && documentReady && !safeMode),
      dependencies: Boolean(document.querySelector(".history-services")),
      properties: true,
      delete: Boolean(document.querySelector("[data-feature-action='delete']")),
    };
    treeContextMenu.querySelectorAll<HTMLButtonElement>("[data-tree-action]").forEach((button) => {
      const available = availableActions[button.dataset.treeAction ?? ""] ?? true;
      button.setAttribute("aria-disabled", String(!available));
      if (!available) {
        button.title = "Not available for this feature";
        button.setAttribute("aria-description", "Not available for this feature");
      }
    });
  } else {
    const availableActions: Record<string, boolean> = {
      "rename-body": Boolean(contextBody && worker && documentReady && !safeMode),
      "body-dependencies": Boolean(contextBody?.generatedBy && adapter.findFeature(contextBody.generatedBy)),
    };
    treeContextMenu.querySelectorAll<HTMLButtonElement>("[data-tree-action]").forEach((button) => {
      const available = availableActions[button.dataset.treeAction ?? ""] ?? true;
      button.disabled = !available;
      button.setAttribute("aria-disabled", String(!available));
      if (!available) button.title = "Not available for this body";
    });
  }
  installContextSearch(treeContextMenu);
  treeContextMenu.querySelectorAll<HTMLButtonElement>("[data-tree-action]").forEach((button) => button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    const action = button.dataset.treeAction;
    if (action === "visibility") visibility?.click();
    if (action === "rename") document.querySelector<HTMLInputElement>("#feature-name")?.focus();
    if (action === "rename-body" && contextBody) {
      const name = contextRow.querySelector<HTMLElement>(":scope > span");
      if (name) {
        const input = document.createElement("input");
        input.className = "tree-inline-rename";
        input.type = "text";
        input.value = contextBody.name;
        input.setAttribute("aria-label", `Rename ${contextBody.name}`);
        name.replaceWith(input);
        const finish = (commit: boolean) => {
          const displayName = input.value.trim();
          if (commit && displayName) {
            worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}:rename-body`, changes: [{ kind: "rename_entity", entity: { kind: "body", id: contextBody.id }, display_name: displayName }] });
          }
          const replacement = document.createElement("span");
          replacement.textContent = commit && displayName ? displayName : contextBody.name;
          input.replaceWith(replacement);
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); finish(true); }
          if (event.key === "Escape") { event.preventDefault(); finish(false); contextRow.focus(); }
        });
        input.focus();
        input.select();
      }
    }
    if (action === "edit") document.querySelector<HTMLButtonElement>("[data-feature-action='edit-parameters']")?.click();
    if (action === "suppress") document.querySelector<HTMLButtonElement>("[data-feature-action='suppress']")?.click();
    if (action === "move-up") document.querySelector<HTMLButtonElement>("[data-history-action='reorder']")?.click();
    if (action === "move-down" && row.dataset.featureId) {
      const orderedFeatures = adapter.getSnapshot().features;
      const featureIndex = orderedFeatures.findIndex((feature) => feature.id === row.dataset.featureId);
      if (featureIndex >= 0 && featureIndex < orderedFeatures.length - 1) {
        const before = orderedFeatures[featureIndex + 2]?.id ?? null;
        historyActionMessage = "";
        worker?.postMessage({ type: "commit-document-changes", operation: "reorder_feature", transactionId: `transaction:${crypto.randomUUID()}:reorder-down`, changes: [{ kind: "reorder_feature", component: "component:root", feature: row.dataset.featureId, before }] });
      }
    }
    if (action === "dependencies") document.querySelector<HTMLElement>(".history-services")?.scrollIntoView({ block: "start" });
    if (action === "body-dependencies" && contextBody?.generatedBy) {
      featureServices = undefined;
      state.selectedFeatureId = contextBody.generatedBy;
      activeInspectorTab = "properties";
      renderDocument();
      requestFeatureServices();
      document.querySelector<HTMLElement>(".history-services")?.scrollIntoView({ block: "start" });
    }
    if (action === "properties") { activeInspectorTab = "properties"; setInspectorTab("properties"); }
    if (action === "appearance") { activeInspectorTab = "appearance"; setInspectorTab("appearance"); }
    if (action === "delete") document.querySelector<HTMLButtonElement>("[data-feature-action='delete']")?.click();
    treeContextMenu.hidden = true;
  }));
  positionContextMenu(treeContextMenu, pointer.clientX, pointer.clientY);
};
document.querySelector("#feature-browser")!.addEventListener("contextmenu", openTreeContextMenu);
document.querySelector("#timeline")!.addEventListener("contextmenu", openTreeContextMenu);
document.querySelector("#viewport-edit-feature")!.addEventListener("click", () => {
  const feature = viewportProducerFeature();
  if (!feature) return;
  featureServices = undefined;
  state.selectedFeatureId = feature.id;
  activeInspectorTab = "properties";
  renderDocument();
  requestFeatureServices();
  document.querySelector<HTMLButtonElement>("[data-feature-action='edit-parameters']")?.click();
});
document.addEventListener("pointerdown", (event) => {
  if (!(event.target as Element).closest(".context-surface")) { viewportContextMenu.hidden = true; treeContextMenu.hidden = true; }
});
document.querySelectorAll<HTMLElement>(".context-surface").forEach((menu) => menu.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!button || button.dataset.comingSoon) return;
  viewportContextMenu.hidden = true;
  treeContextMenu.hidden = true;
}));

const utilityCommands: AppCommand[] = [
  { id: "utility:timeline", label: "Focus feature timeline", group: "Navigation", priority: 15, run: () => { const timeline = document.querySelector<HTMLElement>("#timeline")!; timeline.tabIndex = -1; timeline.focus(); } },
  { id: "utility:save", label: "Save part", group: "File actions", priority: 55, run: () => void savePart() },
  { id: "utility:save-as", label: "Save As portable part", group: "File actions", priority: 30, run: saveAsPortable },
  { id: "utility:new", label: "New part", group: "File actions", priority: 45, run: newPortablePart },
  { id: "utility:open", label: "Open portable part", group: "File actions", priority: 45, run: () => void openPortablePart() },
  { id: "utility:import-step", label: "Import STEP body", group: "File actions", priority: 25, run: () => document.querySelector<HTMLInputElement>("#import-step-file")!.click() },
  { id: "utility:restore", label: "Restore last good model state", group: "Recovery", priority: 20, run: () => startRuntime() },
  { id: "utility:tour", label: "Restart quick tour", group: "Help", priority: 5, run: () => onboarding.restart() },
].map((command) => ({ ...command, enabled: true }));

const commands: AppCommand[] = [...operationCommands, ...sketchSurfaceCommands, ...utilityCommands];
const RECENT_COMMANDS_KEY = "crawler.command-search.recent";
let recentCommandIds: string[] = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 6) : [];
  } catch { return []; }
})();

function rememberCommand(command: AppCommand): void {
  recentCommandIds = [command.id, ...recentCommandIds.filter((id) => id !== command.id)].slice(0, 6);
  try { localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(recentCommandIds)); } catch { /* In-memory recency still improves this session. */ }
}

function commandSelectionBoost(command: AppCommand): number {
  const operation = command.operationId ? alphaOperations.find((candidate) => candidate.id === command.operationId) : undefined;
  if (activeWorkbench === "Sketcher" && (selectedSketchGeometry.length || selectedSketchPoints.length || selectedSketchConstraint)) {
    return /constraint|constrain|dimension|modify|trim|construction|offset|fillet|chamfer|mirror|pattern|scale|move|blend/i.test(`${operation?.group ?? command.group} ${command.label} ${command.detail ?? ""}`) ? 220 : 0;
  }
  if (!operation) return 0;
  if (activeWorkbench === "Part Design" && state.selectedFeatureId) {
    return /modify|pattern|boolean|fillet|chamfer|shell|draft|transform/i.test(`${operation.group} ${operation.label}`) ? 220 : 0;
  }
  return 0;
}

function commandTextScore(command: AppCommand, query: string): number {
  if (!query) return 0;
  const label = command.label.toLowerCase();
  // An exact typed command must outrank workbench and selection boosts from
  // merely related commands (for example Line versus Linear Pattern).
  if (label === query) return 900;
  if (label.startsWith(query)) return 260;
  if (label.includes(query)) return 130;
  return 30;
}

function commandCurrentlyEnabled(command: AppCommand): boolean {
  if (!command.enabled) return false;
  if (command.disabledReason?.()) return false;
  if (command.operationId?.startsWith("crawler.part.")) return modelingRuntimeReady();
  if (["utility:save", "utility:save-as", "utility:import-step"].includes(command.id)) return modelingRuntimeReady();
  if (command.id === "utility:restore") {
    return safeMode || Object.values(state.readiness).some((status) => status === "error");
  }
  return true;
}

function commandCurrentDetail(command: AppCommand): string | undefined {
  return command.disabledReason?.() ?? command.detail;
}

function commandContextScore(command: AppCommand, query: string): number {
  const recentIndex = recentCommandIds.indexOf(command.id);
  const recent = recentIndex >= 0 ? 300 - recentIndex * 35 : 0;
  const currentWorkbench = command.workbenches?.includes(activeWorkbench) ? 160 : 0;
  return (commandCurrentlyEnabled(command) ? 1_000 : 0) + commandTextScore(command, query) + recent + currentWorkbench + commandSelectionBoost(command) + (command.priority ?? 0);
}

function commandResultGroup(command: AppCommand, query: string): string {
  if (!commandCurrentlyEnabled(command)) return "Unavailable";
  const recent = recentCommandIds.includes(command.id);
  const selectionRelevant = commandSelectionBoost(command) > 0;
  const exactQuery = Boolean(query) && command.label.toLowerCase() === query;
  const contextualHighValue = Boolean(command.workbenches?.includes(activeWorkbench) && (command.priority ?? 0) >= 30);
  if (recent || selectionRelevant || exactQuery || contextualHighValue || (command.priority ?? 0) >= 40) return "Suggested";
  if (command.workbenches?.includes(activeWorkbench)) return `${activeWorkbench} commands`;
  return "Other commands";
}

function closeCommands(): void {
  const dialog = document.querySelector<HTMLElement>("#command-search")!;
  document.querySelector<HTMLInputElement>("#command-query")!.setAttribute("aria-expanded", "false");
  closeManagedDialog(dialog);
}

function setActiveCommandOption(option: HTMLButtonElement | null): void {
  const input = document.querySelector<HTMLInputElement>("#command-query")!;
  const options = Array.from(document.querySelectorAll<HTMLButtonElement>("#command-results [role='option']"));
  options.forEach((candidate) => {
    const active = candidate === option;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-selected", String(active));
  });
  if (option) input.setAttribute("aria-activedescendant", option.id);
  else input.removeAttribute("aria-activedescendant");
}

function renderCommands(): void {
  const query = document.querySelector<HTMLInputElement>("#command-query")!.value.trim().toLowerCase();
  const matches = commands
    .filter((command) => `${command.label} ${commandCurrentDetail(command) ?? ""}`.toLowerCase().includes(query))
    .map((command, index) => ({ command, index, score: commandContextScore(command, query), group: commandResultGroup(command, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const host = document.querySelector<HTMLElement>("#command-results")!;
  const firstEnabled = matches.find(({ command }) => commandCurrentlyEnabled(command))?.command;
  const groupOrder = ["Suggested", `${activeWorkbench} commands`, "Other commands", "Unavailable"];
  const groups = groupOrder
    .map((label) => ({ label, matches: matches.filter((match) => match.group === label) }))
    .filter(({ matches: groupMatches }) => groupMatches.length);
  host.innerHTML = matches.length
    ? groups.map(({ label, matches: groupMatches }, groupIndex) => {
      const groupId = `command-result-group-${groupIndex}`;
      return `<section class="command-result-group" role="group" aria-labelledby="${groupId}" data-command-group="${escapeHtml(label)}"><div id="${groupId}" class="command-result-group-label"><span>${escapeHtml(label)}</span><small>${groupMatches.length}</small></div>${groupMatches.map(({ command }) => {
        const commandIndex = commands.indexOf(command);
        const active = command === firstEnabled;
        const enabled = commandCurrentlyEnabled(command);
        const detail = commandCurrentDetail(command);
        return `<button id="command-option-${commandIndex}" role="option" aria-selected="${active}" aria-disabled="${!enabled}" tabindex="-1" data-command="${commandIndex}" data-operation-id="${command.operationId ?? ""}" class="${active ? "active" : ""}" type="button" ${enabled ? "" : "disabled"}><span>${escapeHtml(command.label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</button>`;
      }).join("")}</section>`;
    }).join("")
    : `<p class="command-no-results">No matching commands</p>`;
  const active = host.querySelector<HTMLButtonElement>("[role='option'].active");
  setActiveCommandOption(active);
  const activeLabel = active?.querySelector<HTMLElement>(":scope > span")?.textContent?.trim();
  document.querySelector<HTMLOutputElement>("#command-result-status")!.textContent = matches.length
    ? `${matches.length} ${matches.length === 1 ? "result" : "results"} in ${groups.length} ${groups.length === 1 ? "group" : "groups"}. ${activeLabel ? `${activeLabel} selected.` : "No available command selected."}`
    : "No matching commands.";
  host.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
    button.addEventListener("pointerenter", () => { if (!button.disabled) setActiveCommandOption(button); });
    button.addEventListener("click", () => {
      const command = commands[Number(button.dataset.command)];
      if (!commandCurrentlyEnabled(command)) return;
      rememberCommand(command);
      closeCommands();
      command.run();
    });
  });
}

function openCommands(trigger?: HTMLElement | null): void {
  const dialog = document.querySelector<HTMLElement>("#command-search")!;
  const input = document.querySelector<HTMLInputElement>("#command-query")!;
  input.value = "";
  input.setAttribute("aria-expanded", "true");
  renderCommands();
  openManagedDialog(dialog, trigger ?? null, input);
}

document.querySelector("#retry-runtime")!.addEventListener("click", startRuntime);
document.querySelector("#save-part")!.addEventListener("click", () => void savePart());
document.querySelector("#save-as-part")!.addEventListener("click", saveAsPortable);
document.querySelector("#save-copy-part")!.addEventListener("click", (event) => {
  (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  void savePortableCopy();
});
document.querySelector("#new-part")!.addEventListener("click", newPortablePart);
document.querySelector("#open-part")!.addEventListener("click", () => void openPortablePart());
function openSketchImport(): void {
  if (!sketchSession) {
    showActionError("Sketch import", "Start or edit a sketch before importing SVG or DXF geometry.");
    return;
  }
  document.querySelector<HTMLButtonElement>("#sketch-import-file")?.click();
}
document.querySelector("#import-sketch-command")!.addEventListener("click", (event) => {
  openSketchImport();
  (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
});
document.querySelectorAll<HTMLButtonElement>("[data-import-sketch-proxy]").forEach((button) => button.addEventListener("click", () => {
  openSketchImport();
  button.closest("details")?.removeAttribute("open");
}));
document.querySelectorAll<HTMLButtonElement>("[data-sketch-export-proxy]").forEach((button) => button.addEventListener("click", () => {
  if (!sketchSession) showActionError("Sketch export", "Start or edit a sketch before exporting SVG or DXF geometry.");
  else document.querySelector<HTMLButtonElement>(`#sketch-export-${CSS.escape(button.dataset.sketchExportProxy ?? "")}`)?.click();
  button.closest("details")?.removeAttribute("open");
}));
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
  const input = document.querySelector<HTMLInputElement>("#pad-length")!;
  // Focus synchronously so an immediate follow-up Enter is delivered to the
  // dimension field rather than re-activating the Extrude toolbar button.
  if (state.operation.status === "preview" && state.operation.type === "pad") {
    input.focus();
    input.select();
  }
});
document.querySelector<HTMLInputElement>("#pad-length")!.addEventListener("input", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad") return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  updateExtrudePreviewFromField();
});
document.querySelector<HTMLSelectElement>("#extrude-direction-mode")!.addEventListener("change", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad") return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  setExtrudeDirectionUi(selectedExtrudeDirection());
  updateExtrudePreviewFromField();
});
document.querySelector<HTMLSelectElement>("#extrude-result-mode")!.addEventListener("change", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad" || !activeSketchExtrudeSource?.sketch) return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  syncExtrudeResultControls(selectedExtrudeResultMode());
  updateExtrudePreviewFromField();
});
document.querySelector<HTMLSelectElement>("#extrude-target-body")!.addEventListener("change", (event) => {
  if (state.operation.status !== "preview" || state.operation.type !== "pad" || selectedExtrudeResultMode() !== "cut") return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  if (activeSketchExtrudeSource) activeSketchExtrudeSource.targetBodyId = (event.currentTarget as HTMLSelectElement).value || undefined;
  updateExtrudePreviewFromField();
});
document.querySelector<HTMLInputElement>("#pad-length")!.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || state.operation.status !== "preview" || state.operation.type !== "pad") return;
  event.preventDefault();
  event.stopPropagation();
  commitExtrudePreview();
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
  const minimumVisibleNanometers = selectedExtrudeDirection() === "symmetric" ? 2_000 : 1_000;
  const valueNanometers = Math.max(minimumVisibleNanometers, drag.startNanometers + Math.round((drag.startY - event.clientY) * 100_000));
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
  const minimumMillimeters = selectedExtrudeDirection() === "symmetric" ? 0.002 : 0.001;
  input.value = String(Math.max(minimumMillimeters, input.valueAsNumber + (event.key === "ArrowUp" ? stepMillimeters : -stepMillimeters)));
  requestExtrudePreview(Math.round(input.valueAsNumber * 1_000_000));
});
document.querySelector("#start-rectangle")!.addEventListener("click", (event) => {
  if (safeMode) return;
  performanceEvidence.record("input", performance.now() - event.timeStamp);
  const previewStarted = performance.now(); setOperation("preview", "rectangle"); performanceEvidence.record("preview", performance.now() - previewStarted);
  const input = document.querySelector<HTMLInputElement>("#part-width")!;
  requestAnimationFrame(() => { input.focus(); input.select(); });
});
function commitRectanglePreview(): void {
  const width = document.querySelector<HTMLInputElement>("#part-width")!.valueAsNumber;
  const height = document.querySelector<HTMLInputElement>("#part-height")!.valueAsNumber;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
  performanceEvidence.beginRecompute();
  worker?.postMessage({ type: "commit-dimensions", widthNanometers: Math.round(width * 1_000_000), heightNanometers: Math.round(height * 1_000_000) });
}
for (const selector of ["#part-width", "#part-height"]) {
  document.querySelector<HTMLInputElement>(selector)!.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || state.operation.status !== "preview" || state.operation.type !== "rectangle") return;
    event.preventDefault();
    event.stopPropagation();
    commitRectanglePreview();
  });
}
document.querySelector("#edit-sketch")!.addEventListener("click", () => { if (!safeMode) startSketchEdit(); });
document.querySelector("#create-offset-plane")!.addEventListener("click", () => { if (!safeMode) startOffsetConstructionPlaneEdit(); });
const sketchViewport = document.querySelector<HTMLCanvasElement>("#viewport")!;
const sketchViewportRegion = document.querySelector<HTMLElement>(".viewport-region")!;

// Inline creation fields intentionally remain mouse-editable. When the HUD is
// positioned over an already placed definition point, however, that point is
// still a valid next placement (for example an elliptical-arc start at its
// major-axis endpoint). Give the visible point marker authority over the HUD's
// hit box without making the rest of the inline editor click-through.
sketchViewportRegion.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !sketchSession || !sketchToolArmed || !sketchPoints.length) return;
  const target = event.target as Element | null;
  if (!target?.closest('#sketch-dimension-editor[data-source="creation"]')) return;
  const bounds = sketchViewport.getBoundingClientRect();
  const local = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const definingPoint = sketchPoints.find((point) => {
    const screen = sketchOverlayPoint(point);
    return Boolean(screen && Math.hypot(screen.x - local.x, screen.y - local.y) <= 9);
  });
  if (!definingPoint) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void applySketchClick(definingPoint, false, event.altKey);
}, { capture: true });
const sketchDimensionEditor = document.querySelector<HTMLFormElement>("#sketch-dimension-editor")!;
const sketchDimensionInput = () => sketchDimensionEditor.querySelector<HTMLInputElement>("#active-tool-constraint-value")!;
const parseCanvasDimension = (): number | undefined => {
  const input = sketchDimensionInput();
  const kind = pendingDimensionPlacement?.kind ?? (selectedSketchConstraint ? sketchSession?.draft.constraints[selectedSketchConstraint]?.kind : undefined);
  const value = parseCanvasDimensionExpression(input.value, kind === "angle" || kind === "angle_to_axis" ? "angle" : "length", selectedSketchConstraint);
  input.setAttribute("aria-invalid", String(value === undefined || value < 0));
  if (value === undefined || value < 0) return undefined;
  sketchConstraintValue = value;
  if (pendingDimensionPlacement) rebuildPendingDimension(undefined, value);
  return value;
};

type SketchPointerFrame = {
  source: "viewport" | "overlay";
  raw?: Point2;
  altKey?: boolean;
  shiftKey?: boolean;
  toggleKey?: boolean;
  client?: { x: number; y: number };
  target?: Element | null;
};

const SKETCH_POINTER_VIEW_INVALIDATION = 1;
const SKETCH_POINTER_BOX_INVALIDATION = 2;
type SketchPointerFrameWork = LatestPointerFrameWork<SketchPointerFrame>;

function processSketchPointerFrame(work: SketchPointerFrameWork): void {
  if (!sketchSession) return;
  const update = work.pointer;
  if (!update) {
    renderSketchPointerOverlay();
    return;
  }
  const raw = update.raw;
  sketchHoverClientPoint = update.client;
  sketchHoverModifiers = { shift: Boolean(update.shiftKey), toggle: Boolean(update.toggleKey) };
  sketchHoverSnap = raw ? (update.altKey ? { point: raw, inferences: [], label: "Inference suppressed" } : snappedSketchPoint(raw)) : undefined;
  sketchHoverPoint = sketchHoverSnap?.point;
  updatePendingDimensionPlacement(raw);
  if (update.source === "viewport") {
    sketchHoverTarget = { kind: "plane", valid: Boolean(sketchToolArmed || pendingDimensionPlacement), reason: sketchToolArmed || pendingDimensionPlacement ? undefined : "Select compatible geometry" };
    renderSketchPointerOverlay();
  } else {
    sketchHoverTarget = sketchHoverEligibility(update.target ?? null);
    renderSketchPointerOverlay();
  }
  syncSketchPointerToolUi();
  syncSketchSelectionAssistUi();
  updateSketchToolInspectorState();
}

const sketchPointerFrames = new LatestFrameCoordinator<SketchPointerFrameWork>(
  processSketchPointerFrame,
  (callback) => requestAnimationFrame(callback),
  (handle) => cancelAnimationFrame(handle),
  mergeLatestPointerFrameWork,
);

function scheduleSketchPointerFrame(update: SketchPointerFrame): void {
  sketchPointerFrames.schedule({ pointer: update, invalidations: 0 });
}

function scheduleSketchPointerInvalidation(invalidation: number): void {
  sketchPointerFrames.schedule({ invalidations: invalidation });
}

function flushSketchPointerFrame(): void {
  sketchPointerFrames.flush();
}

function cancelSketchPointerFrame(): void {
  sketchPointerFrames.cancel();
}
sketchDimensionEditor.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "sketch-dimension-editor-mode") return;
  if (target.dataset.inlineCreationField) {
    const key = target.dataset.inlineCreationField as InlineCreationFieldKey;
    inlineCreationExpressions = { ...inlineCreationExpressions, [key]: target.value };
    delete inlineCreationLocks[key];
    target.closest<HTMLElement>(".sketch-dimension-expression")?.setAttribute("data-locked", "false");
    renderSketchOverlay();
    return;
  }
  if (pendingDimensionPlacement) pendingDimensionPlacement.valueEdited = true;
  if (parseCanvasDimension() !== undefined) renderSketchOverlay();
});
sketchDimensionEditor.querySelector<HTMLSelectElement>("#sketch-dimension-editor-mode")!.addEventListener("change", (event) => {
  const mode = (event.currentTarget as HTMLSelectElement).value;
  if (!rebuildPendingDimension(mode)) return;
  renderSketchOverlay();
  updateSketchToolInspectorState();
  sketchDimensionInput().focus();
  sketchDimensionInput().select();
});
sketchDimensionEditor.addEventListener("input", (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.id !== "sketch-dimension-editor-mode") return;
  if (!rebuildPendingDimension(select.value)) return;
  renderSketchOverlay();
  updateSketchToolInspectorState();
});
sketchDimensionEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (sketchDimensionEditor.dataset.source === "creation") {
    const active = sketchDimensionEditor.querySelector<HTMLInputElement>("[data-inline-creation-field]:focus") ?? sketchDimensionEditor.querySelector<HTMLInputElement>("[data-inline-creation-field]");
    const preview = inlineCreationPreview();
    const field = preview?.fields.find((candidate) => candidate.key === active?.dataset.inlineCreationField);
    if (active && field && lockInlineCreationField(field, active)) {
      renderSketchOverlay();
      sketchViewport.focus();
    }
    return;
  }
  if (pendingDimensionPlacement && !pendingDimensionPlacement.valueEdited) {
    void commitPendingDimensionPlacement(pendingDimensionPlacement.position);
    return;
  }
  const value = parseCanvasDimension();
  if (value === undefined) return;
  if (pendingDimensionPlacement) void commitPendingDimensionPlacement(pendingDimensionPlacement.position);
  else if (selectedSketchConstraint) void updateSelectedSketchDimension(value).then(() => renderSketchOverlay());
});
sketchDimensionEditor.addEventListener("keydown", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.inlineCreationField && event.key === "Tab") {
    const preview = inlineCreationPreview();
    const field = preview?.fields.find((candidate) => candidate.key === input.dataset.inlineCreationField);
    if (!field || !lockInlineCreationField(field, input)) { event.preventDefault(); return; }
    event.preventDefault(); event.stopPropagation();
    const fields = Array.from(sketchDimensionEditor.querySelectorAll<HTMLInputElement>("[data-inline-creation-field]"));
    const index = fields.indexOf(input); const next = fields[(index + (event.shiftKey ? -1 : 1) + fields.length) % fields.length];
    inlineCreationActiveField = next.dataset.inlineCreationField as InlineCreationFieldKey;
    renderSketchOverlay();
    requestAnimationFrame(() => { const target = sketchDimensionEditor.querySelector<HTMLInputElement>(`[data-inline-creation-field="${inlineCreationActiveField}"]`); target?.focus(); target?.select(); });
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault(); event.stopPropagation();
  if (sketchDimensionEditor.dataset.source === "creation") {
    resetInlineCreationInput();
    renderSketchOverlay();
    sketchViewport.focus();
  } else void backOutOfSketch();
});

function beginSketchPlacementGesture(event: PointerEvent, point: Point2, absoluteOrigin = false): void {
  if (!sketchSession || !sketchToolArmed) return;
  const required = activeSketchPointRequirement(sketchSession.activeTool);
  const captureTarget = event.currentTarget as Element;
  if (sketchPoints.length === 0 && required >= 2) {
    sketchPlacementGesture = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      tool: sketchSession.activeTool,
      captureTarget,
    };
    captureTarget.setPointerCapture(event.pointerId);
  }
  void applySketchClick(point, absoluteOrigin, event.altKey);
}

async function finishSketchPlacementGesture(event: PointerEvent): Promise<boolean> {
  const gesture = sketchPlacementGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  sketchPlacementGesture = undefined;
  if (gesture.captureTarget.hasPointerCapture(event.pointerId)) gesture.captureTarget.releasePointerCapture(event.pointerId);
  const moved = Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) >= 4;
  if (moved && sketchSession?.activeTool === gesture.tool) {
    const point = sketchPoint(event);
    if (point) await applySketchClick(point, false, event.altKey);
  }
  return true;
}

function cancelSketchPlacementGesture(event: PointerEvent): boolean {
  const gesture = sketchPlacementGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  sketchPlacementGesture = undefined;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  if (gesture.captureTarget.hasPointerCapture(event.pointerId)) gesture.captureTarget.releasePointerCapture(event.pointerId);
  renderSketchOverlay();
  updateSketchToolInspectorState();
  return true;
}

sketchViewport.addEventListener("pointermove", (event) => {
  if (!sketchSession) return;
  if ((event.target as Element | null)?.closest("#sketch-overlay [data-sketch-profile-id], #sketch-overlay [data-sketch-geometry], #sketch-overlay [data-sketch-hit-geometry], #sketch-overlay [data-sketch-handle], #sketch-overlay [data-sketch-origin], #sketch-overlay [data-sketch-constraint-id]")) return;
  if (sketchBoxSelection?.pointerId === event.pointerId) {
    const bounds = sketchViewport.getBoundingClientRect();
    sketchBoxSelection.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    scheduleSketchPointerInvalidation(SKETCH_POINTER_BOX_INVALIDATION);
    return;
  }
  const raw = sketchPoint(event);
  scheduleSketchPointerFrame({ source: "viewport", raw, altKey: event.altKey, shiftKey: event.shiftKey, toggleKey: event.ctrlKey || event.metaKey, client: { x: event.clientX, y: event.clientY } });
});
sketchViewport.addEventListener("pointerleave", (event) => {
  if (!sketchSession) return;
  if ((event.relatedTarget as Element | null)?.closest?.("#sketch-dimension-editor")) return;
  cancelSketchPointerFrame();
  sketchHoverPoint = undefined;
  sketchHoverSnap = undefined;
  sketchHoverTarget = undefined;
  sketchHoverClientPoint = undefined;
  renderSketchOverlay();
  syncSketchSelectionAssistUi();
  updateSketchToolInspectorState();
});
sketchViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  flushSketchPointerFrame();
  closeSketchSelectOther();
  if (state.operation.type === "sketch") {
    if (sketchChoosingSupport) return;
    event.stopImmediatePropagation();
    if (pendingDimensionPlacement) {
      const point = sketchPoint(event);
      if (point) {
        updatePendingDimensionPlacement(point);
        pendingDimensionPlacement.position = point;
        pendingDimensionPlacement.placed = true;
        renderSketchOverlay();
        sketchDimensionInput().focus();
        sketchDimensionInput().select();
      }
      return;
    }
    if (!sketchToolArmed) {
      const bounds = sketchViewport.getBoundingClientRect();
      const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      sketchBoxSelection = { pointerId: event.pointerId, start, current: start, mode: sketchSelectionModeForEvent(event) };
      sketchViewport.setPointerCapture(event.pointerId);
      renderSketchOverlay();
      return;
    }
    const point = sketchPoint(event);
    if (point) beginSketchPlacementGesture(event, point);
  }
}, { capture: true });
sketchViewport.addEventListener("pointerup", async (event) => {
  if (await finishSketchPlacementGesture(event)) return;
  const box = sketchBoxSelection;
  if (!box || box.pointerId !== event.pointerId || !sketchSession) return;
  const selected = sketchBoxSelectionHitIds();
  sketchBoxSelection = undefined;
  if (sketchViewport.hasPointerCapture(event.pointerId)) sketchViewport.releasePointerCapture(event.pointerId);
  if (box.mode === "replace") selectedSketchGeometry = selected;
  else if (box.mode === "add") selectedSketchGeometry = [...new Set([...selectedSketchGeometry, ...selected])];
  else if (box.mode === "remove") selectedSketchGeometry = selectedSketchGeometry.filter((id) => !selected.includes(id));
  else selectedSketchGeometry = selected.reduce((current, id) => updateSketchIdSelection(current, id, "toggle"), selectedSketchGeometry);
  selectedSketchSegments = selectedSketchSegments.filter((segment) => selectedSketchGeometry.includes(segment.geometry));
  selectedSketchPoints = selectedSketchPoints.filter((point) => selectedSketchGeometry.includes(point.geometry));
  if (box.mode === "replace") {
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    selectedSketchConstraint = undefined;
    sketchOriginSelected = false;
  }
  renderSketchOverlay();
  setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
  applyPendingSketchInvocation();
});
sketchViewport.addEventListener("pointercancel", (event) => {
  cancelSketchPlacementGesture(event);
});

function screenSegmentIntersectsBox(a: { x: number; y: number }, b: { x: number; y: number }, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const edges = [[{ x: minX, y: minY }, { x: maxX, y: minY }], [{ x: maxX, y: minY }, { x: maxX, y: maxY }], [{ x: maxX, y: maxY }, { x: minX, y: maxY }], [{ x: minX, y: maxY }, { x: minX, y: minY }]] as const;
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return edges.some(([c, d]) => Math.sign(cross(a, b, c)) !== Math.sign(cross(a, b, d)) && Math.sign(cross(c, d, a)) !== Math.sign(cross(c, d, b)));
}
const sketchOverlay = document.querySelector<SVGSVGElement>("#sketch-overlay")!;
function beginSketchDimensionDrag(event: PointerEvent, constraint: string): void {
  const start = { x: event.clientX, y: event.clientY };
  let moved = false;
  let position: Point2 | undefined;
  const move = (moveEvent: PointerEvent) => {
    if (!sketchSession) return;
    if (!moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 3) return;
    moved = true;
    position = sketchPoint(moveEvent);
    if (!position) return;
    sketchDimensionPositions.set(constraint, position);
    renderSketchOverlay();
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    if (!moved || !position || !sketchSession) return;
    const target = position;
    void sketchSession.apply({ kind: "set_dimension_position", constraint, position: target }).then(() => {
      sketchDimensionPositions.delete(constraint);
      persistSketchDimensionPositions();
      sketchSolverStatus = "Dimension annotation placement accepted";
      updateSketchStatus();
    }).catch(() => {
      sketchSolverStatus = "Dimension annotation placement was refused; the accepted placement is unchanged";
      renderSketchOverlay();
      updateSketchToolInspectorState();
    });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}
function closeSketchSelectOther(): void {
  const menu = document.querySelector<HTMLElement>("#sketch-select-other")!;
  menu.hidden = true;
  menu.replaceChildren();
}

function openSketchSelectOther(candidates: readonly string[], clientX: number, clientY: number): void {
  if (!sketchSession || candidates.length < 2) return;
  const startedAt = performance.now();
  const menu = document.querySelector<HTMLElement>("#sketch-select-other")!;
  const bounds = document.querySelector<HTMLElement>(".viewport-region")!.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(bounds.width - 210, clientX - bounds.left + 10))}px`;
  menu.style.top = `${Math.max(8, Math.min(bounds.height - 160, clientY - bounds.top + 10))}px`;
  menu.innerHTML = `<header><strong>Select other</strong><small>Alt click only</small></header>${candidates.map((id) => `<button type="button" role="menuitem" data-select-other="${escapeHtml(id)}"><span>${escapeHtml(sketchSession!.draft.geometry[id]?.geometry.kind.replaceAll("_", " ") ?? "geometry")}</span><code>${escapeHtml(id)}</code></button>`).join("")}`;
  menu.hidden = false;
  menu.dataset.populateMs = (performance.now() - startedAt).toFixed(2);
  menu.querySelectorAll<HTMLButtonElement>("[data-select-other]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.selectOther;
    if (!id) return;
    selectedSketchGeometry = updateSketchIdSelection(selectedSketchGeometry, id, sketchSelectionMode);
    if (sketchSelectionMode === "replace") {
      selectedSketchPoints = [];
      selectedSketchSegments = [];
      selectedSketchConstraint = undefined;
      sketchOriginSelected = false;
    }
    closeSketchSelectOther();
    renderSketchOverlay();
    setSketchToolPhase("ready");
    if (activeInspectorTab === "tool") renderActiveToolInspector();
  }));
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

sketchOverlay.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (!sketchSession) return;
  if (sketchSmartDimensionActive) {
    // The pointerdown target and plane coordinate are already authoritative.
    // Discard a queued hover-only frame so operand selection and its
    // measurement preview publish together instead of painting twice.
    cancelSketchPointerFrame();
    sketchHoverPoint = sketchPoint(event) ?? sketchHoverPoint;
  } else flushSketchPointerFrame();
  const target = event.target as Element;
  if (pendingDimensionPlacement) {
    const geometryTarget = target.closest<SVGGeometryElement>("[data-sketch-geometry], [data-sketch-hit-geometry]");
    const geometryId = geometryTarget?.dataset.sketchGeometry ?? geometryTarget?.dataset.sketchHitGeometry;
    const existingLine = pendingSmartDimensionLine();
    const additionalLine = geometryId ? sketchSession.draft.geometry[geometryId]?.geometry : undefined;
    if (existingLine && additionalLine?.kind === "line" && !selectedSketchGeometry.includes(geometryId!)) {
      event.preventDefault(); event.stopPropagation();
      pendingDimensionPlacement = undefined;
      selectedSketchGeometry = [...selectedSketchGeometry, geometryId!];
      selectedSketchPoints = [];
      selectedSketchSegments = [];
      sketchOriginSelected = false;
      sketchSolverStatus = "Two line segments selected · place their angle or parallel spacing dimension";
      setSketchToolPhase("ready");
      prepareSmartDimension();
      return;
    }
    const placement = sketchPoint(event);
    if (placement) {
      event.preventDefault(); event.stopPropagation();
      updatePendingDimensionPlacement(placement);
      pendingDimensionPlacement.position = placement;
      pendingDimensionPlacement.placed = true;
      renderSketchOverlay();
      sketchDimensionInput().focus();
      sketchDimensionInput().select();
    }
    return;
  }
  const dofTarget = target.closest<SVGGElement>("[data-underconstrained-component]");
  if (dofTarget?.dataset.underconstrainedComponent) {
    event.preventDefault(); event.stopPropagation();
    selectUnderconstrainedGeometry(Number(dofTarget.dataset.underconstrainedComponent));
    return;
  }
  const constraintAction = target.closest<SVGGElement>("[data-constraint-canvas-action]");
  if (constraintAction?.dataset.constraintCanvasAction && constraintAction.dataset.constraintActionId) {
    event.preventDefault(); event.stopPropagation();
    const id = constraintAction.dataset.constraintActionId;
    const action = constraintAction.dataset.constraintCanvasAction;
    if (action === "delete") void deleteSketchConstraint(id);
    else if (action === "toggle") void toggleSketchConstraintState(id);
    else if (action === "edit") {
      selectedSketchConstraint = id;
      const dimension = sketchConstraintDimension(id);
      if (dimension !== undefined) sketchConstraintValue = dimension;
      renderSketchOverlay(); renderActiveToolInspector();
      requestAnimationFrame(() => { sketchDimensionInput().focus(); sketchDimensionInput().select(); });
    }
    return;
  }
  const eligibility = sketchHoverEligibility(target);
  if (eligibility && !eligibility.valid) {
    event.preventDefault(); event.stopPropagation();
    sketchSolverStatus = eligibility.reason ?? "That target is not valid for the active tool";
    setSketchToolPhase("blocked");
    updateSketchToolInspectorState();
    return;
  }
  const constraintTarget = target.closest<SVGGElement>("[data-sketch-constraint-id]");
  const profileTarget = target.closest<SVGPathElement>("[data-sketch-profile-id]");
  const originReference = target.closest<SVGGElement>("[data-sketch-origin]");
  const radiusHandle = target.closest<SVGCircleElement>("[data-sketch-radius]");
  const handle = target.closest<SVGCircleElement>("[data-sketch-handle]");
  const geometryTarget = target.closest<SVGGeometryElement>("[data-sketch-geometry], [data-sketch-hit-geometry]");
  const requestedSelectionMode = sketchSelectionModeForEvent(event);
  const collectingOperands = sketchOperandCollectionActive();
  const selectionMode: SketchSelectionMode = collectingOperands ? "add" : requestedSelectionMode;
  if (profileTarget?.dataset.sketchProfileId) {
    event.preventDefault(); event.stopPropagation();
    const profileId = profileTarget.dataset.sketchProfileId;
    let geometryIds: string[];
    try {
      const parsed = JSON.parse(profileTarget.dataset.profileGeometryIds ?? "[]");
      geometryIds = Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : [];
    } catch { geometryIds = []; }
    if (!geometryIds.length) return;
    const alreadySelected = selectedSketchProfile?.sketchId === sketchSession.draft.id && selectedSketchProfile.profileId === profileId;
    const remove = selectionMode === "remove" || (selectionMode === "toggle" && alreadySelected);
    if (selectionMode === "replace") {
      selectedSketchGeometry = [];
      selectedSketchPoints = [];
      selectedSketchSegments = [];
      selectedSketchConstraint = undefined;
      sketchOriginSelected = false;
    }
    selectedSketchProfile = remove ? undefined : { sketchId: sketchSession.draft.id, profileId, geometryIds: [...geometryIds].sort() };
    sketchProfileRepairMessage = undefined;
    sketchSolverStatus = selectedSketchProfile ? "Closed profile selected · Shift-click a construction line to pair an axis" : "Closed profile selection cleared";
    renderSketchSelectionChanged();
    setSketchSelectionPhase(hasSketchSelection() ? "ready" : "collecting");
    updateSketchToolInspectorState();
    if (activeInspectorTab === "tool") renderSketchSelectionInspectorChanged();
    return;
  }
  if (selectionMode === "replace") selectedSketchProfile = undefined;
  if (constraintTarget?.dataset.sketchConstraintId) {
    event.preventDefault(); event.stopPropagation();
    const referencedId = constraintTarget.dataset.sketchConstraintId;
    const activeDimensionInput = document.activeElement instanceof HTMLInputElement && document.activeElement.closest("#sketch-dimension-editor") ? document.activeElement : undefined;
    const editingId = selectedSketchConstraint;
    if (activeDimensionInput && referencedId !== editingId) {
      const alias = sketchDimensionAlias(referencedId);
      if (alias) {
        const start = activeDimensionInput.selectionStart ?? activeDimensionInput.value.length;
        const end = activeDimensionInput.selectionEnd ?? start;
        activeDimensionInput.setRangeText(alias, start, end, "end");
        activeDimensionInput.dispatchEvent(new Event("input", { bubbles: true }));
        activeDimensionInput.focus();
        return;
      }
    }
    const nextConstraint = constraintTarget.dataset.sketchConstraintId;
    if (selectionMode === "remove" || (selectionMode === "toggle" && selectedSketchConstraint === nextConstraint)) {
      selectedSketchConstraint = undefined;
      renderSketchOverlay();
      syncSketchSelectionAssistUi();
      return;
    }
    if (selectionMode === "replace") {
      selectedSketchGeometry = [];
      selectedSketchPoints = [];
      selectedSketchSegments = [];
      sketchOriginSelected = false;
    }
    selectedSketchConstraint = nextConstraint;
    const dimension = sketchConstraintDimension(selectedSketchConstraint);
    if (dimension !== undefined) sketchConstraintValue = dimension;
    if (dimension !== undefined) beginSketchDimensionDrag(event, selectedSketchConstraint);
    renderSketchOverlay();
    if (activeInspectorTab === "tool") renderActiveToolInspector();
    requestAnimationFrame(() => { sketchDimensionInput().focus(); sketchDimensionInput().select(); });
    return;
  }
  const creationOperands = activeCreationOperandRequirement();
  const creationOperandId = geometryTarget?.dataset.sketchGeometry ?? geometryTarget?.dataset.sketchHitGeometry;
  if (creationOperands && creationOperandId && selectedSketchGeometry.filter(geometrySupportsCreationOperand).length < creationOperands.count) {
    event.preventDefault(); event.stopPropagation();
    if (!geometrySupportsCreationOperand(creationOperandId)) {
      sketchSolverStatus = "This entity cannot serve as a curve operand";
      setSketchToolPhase("blocked");
    } else {
      selectedSketchGeometry = [...new Set([...selectedSketchGeometry.filter(geometrySupportsCreationOperand), creationOperandId])].slice(0, creationOperands.count);
      selectedSketchPoints = []; sketchOriginSelected = false;
      sketchSolverStatus = selectedSketchGeometry.length < creationOperands.count ? `Select ${creationOperands.count - selectedSketchGeometry.length} more ${creationOperands.label}` : `${creationOperands.label} ready · place the remaining viewport input`;
      setSketchToolPhase("collecting");
    }
    renderSketchOverlay(); updateSketchToolInspectorState();
    if (activeInspectorTab === "tool") renderActiveToolInspector();
    return;
  }
  if (sketchToolArmed && sketchSession.activeTool !== "trim") {
    const point = originReference ? ABSOLUTE_SKETCH_ORIGIN : sketchPoint(event);
    if (point) {
      event.preventDefault();
      event.stopPropagation();
      beginSketchPlacementGesture(event, point, Boolean(originReference));
      return;
    }
  }
  if (originReference) {
    event.preventDefault(); event.stopPropagation();
    if (selectionMode === "replace") selectedSketchConstraint = undefined;
    if (sketchToolArmed && sketchSession.activeTool !== "trim") void applySketchClick(ABSOLUTE_SKETCH_ORIGIN, true);
    else {
      if (selectionMode === "replace") {
        selectedSketchGeometry = [];
        selectedSketchPoints = [];
        selectedSketchSegments = [];
        selectedSketchConstraint = undefined;
        sketchOriginSelected = true;
      } else if (selectionMode === "add") sketchOriginSelected = true;
      else if (selectionMode === "remove") sketchOriginSelected = false;
      else sketchOriginSelected = !sketchOriginSelected;
      renderSketchOverlay();
      setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
      applyPendingSketchInvocation();
      if (activeInspectorTab === "tool") renderActiveToolInspector();
    }
    return;
  }
  if (radiusHandle?.dataset.geometry) {
    event.preventDefault(); event.stopPropagation();
    if (selectionMode === "replace") selectedSketchConstraint = undefined;
    const geometry = radiusHandle.dataset.geometry;
    const alreadySelected = selectedSketchGeometry.includes(geometry);
    selectedSketchGeometry = updateSketchIdSelection(selectedSketchGeometry, geometry, selectionMode);
    const removed = !selectedSketchGeometry.includes(geometry);
    if (selectionMode === "replace") {
      selectedSketchPoints = [];
      selectedSketchSegments = [];
      sketchOriginSelected = false;
    } else if (removed) {
      selectedSketchPoints = selectedSketchPoints.filter((point) => point.geometry !== geometry);
      selectedSketchSegments = selectedSketchSegments.filter((segment) => segment.geometry !== geometry);
    }
    if (collectingOperands) {
      setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
      if (sketchSmartDimensionActive) applyPendingSketchInvocation();
      else { renderSketchSelectionChanged(); applyPendingSketchInvocation(); }
      return;
    }
    if (removed || selectionMode === "add" || selectionMode === "toggle") {
      setSketchSelectionPhase(hasSketchSelection() ? "ready" : "collecting");
      renderSketchSelectionChanged();
      return;
    }
    sketchDrag = {
      kind: "radius",
      pointerId: event.pointerId,
      geometry,
      center: {
        x_nm: Number(radiusHandle.dataset.centerX),
        y_nm: Number(radiusHandle.dataset.centerY),
      },
      handle: radiusHandle,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    radiusHandle.setPointerCapture(event.pointerId);
    sketchOverlay.dataset.dragging = "true";
    return;
  }
  if (!handle && (geometryTarget?.dataset.sketchGeometry || geometryTarget?.dataset.sketchHitGeometry)) {
    event.preventDefault(); event.stopPropagation();
    if (selectionMode === "replace") selectedSketchConstraint = undefined;
    let geometry = geometryTarget.dataset.sketchGeometry ?? geometryTarget.dataset.sketchHitGeometry!;
    if (event.altKey) {
      const candidates = [...new Set(document.elementsFromPoint(event.clientX, event.clientY)
        .map((element) => (element as HTMLElement).dataset?.sketchGeometry ?? (element as HTMLElement).dataset?.sketchHitGeometry)
        .filter((value): value is string => Boolean(value)))];
      if (candidates.length > 1) {
        openSketchSelectOther(candidates, event.clientX, event.clientY);
        return;
      }
    }
    const clickedEntity = sketchSession.draft.geometry[geometry];
    const clickedPoint = sketchPoint(event);
    const freeformCurve = clickedEntity && ["control_point_spline", "fit_point_spline", "elliptical_arc", "conic"].includes(clickedEntity.geometry.kind);
    const parameterMeasurement = collectingOperands
      && clickedEntity
      && clickedPoint
      && !["line", "rectangle", "sketch_point"].includes(clickedEntity.geometry.kind)
      && (selectedSketchPoints.length > 0 || event.shiftKey || freeformCurve);
    if (parameterMeasurement) {
      const projection = projectPointToGeometryCurve(clickedEntity.geometry, clickedPoint);
      const pointRef: PointRef = { geometry, anchor: `parameter:${Math.round(projection.parameter * 1_000_000)}` };
      selectedSketchGeometry = [...new Set([...selectedSketchGeometry, geometry])];
      selectedSketchPoints = [...selectedSketchPoints.filter((candidate) => candidate.geometry !== geometry || candidate.anchor !== pointRef.anchor), pointRef];
      selectedSketchSegments = [];
      renderSketchOverlay();
      setSketchToolPhase("ready");
      applyPendingSketchInvocation();
      return;
    }
    const segment = Number(geometryTarget.dataset.sketchSegment);
    const selectedSegmentsForGeometry = selectedSketchSegments.filter((candidate) => candidate.geometry === geometry);
    const alreadySelected = selectedSketchGeometry.includes(geometry) && (!Number.isInteger(segment)
      || selectedSegmentsForGeometry.length === 0
      || selectedSegmentsForGeometry.some((candidate) => candidate.segment === segment));
    selectedSketchGeometry = updateSketchIdSelection(selectedSketchGeometry, geometry, selectionMode);
    const removed = !selectedSketchGeometry.includes(geometry);
    if (selectionMode === "replace") {
      selectedSketchPoints = [];
      sketchOriginSelected = false;
    } else if (removed) selectedSketchPoints = selectedSketchPoints.filter((point) => point.geometry !== geometry);
    selectedSketchSegments = Number.isInteger(segment)
      ? (removed || selectionMode === "remove" || (selectionMode === "toggle" && alreadySelected)
        ? selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry || candidate.segment !== segment)
        : selectionMode === "replace"
          ? [{ geometry, segment }]
          : [...selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry || candidate.segment !== segment), { geometry, segment }])
      : (selectionMode === "replace" ? [] : removed ? selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry) : selectedSketchSegments);
    let point = sketchPoint(event);
    if (sketchSession.activeTool === "trim" && point) {
      const source = sketchSession.draft.geometry[geometry];
      const path = source ? sketchGeometrySelectionPath(source.geometry) : [];
      const segmentIndex = Number.isInteger(segment) ? segment : 0;
      const a = path[segmentIndex];
      const b = path[source?.geometry.kind === "rectangle" ? (segmentIndex + 1) % path.length : Math.min(path.length - 1, segmentIndex + 1)];
      const screenA = a ? sketchOverlayPoint(a) : undefined;
      const screenB = b ? sketchOverlayPoint(b) : undefined;
      if (a && b && screenA && screenB) {
        const overlayBounds = sketchOverlay.getBoundingClientRect();
        const x = event.clientX - overlayBounds.left; const y = event.clientY - overlayBounds.top;
        const dx = screenB.x - screenA.x; const dy = screenB.y - screenA.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - screenA.x) * dx + (y - screenA.y) * dy) / lengthSquared)) : 0;
        point = { x_nm: Math.round(a.x_nm + (b.x_nm - a.x_nm) * t), y_nm: Math.round(a.y_nm + (b.y_nm - a.y_nm) * t) };
      }
      void applySketchClick(point);
    }
    else {
      if (!removed && selectionMode === "replace" && !sketchToolArmed && !pendingSketchConstraint && activeToolContext?.key === "sketch-select" && point) {
        const revisionIndexes = sketchRenderIndexCache.resolveDraft(sketchSession.draftView);
        const solveIndexes = sketchRenderIndexCache.resolveSolve(sketchSession.solve);
        const connectedGeometry = new Set(selectedSketchGeometry);
        for (const id of selectedSketchGeometry) {
          solveIndexes.componentByGeometry.get(id)?.geometry.forEach((componentId) => connectedGeometry.add(componentId));
        }
        const draggableGeometry = [...connectedGeometry].filter((id) => {
          if (sketchSession!.draftView.external_references?.[id]) return false;
          return (solveIndexes.componentByGeometry.get(id)?.structural_degrees_of_freedom ?? 1) > 0;
        });
        if (!draggableGeometry.length) {
          sketchSolverStatus = "The selected geometry is fully constrained";
          updateSketchToolInspectorState();
          renderSketchOverlay();
          return;
        }
        const drivePoint = geometryPointRefs(sketchSession.draftView as Sketch, geometry)
          .filter((ref) => !ref.anchor.startsWith("knot:") && !ref.anchor.startsWith("parameter:"))
          .map((ref) => ({ ref, value: pointForRef(sketchSession!.draftView as Sketch, ref) }))
          .filter((candidate): candidate is { ref: PointRef; value: Point2 } => Boolean(candidate.value))
          .sort((a, b) => Number(sketchPointMobility(sketchSession!.draftView as Sketch, a.ref) === "none") - Number(sketchPointMobility(sketchSession!.draftView as Sketch, b.ref) === "none")
            || Math.hypot(a.value.x_nm - point!.x_nm, a.value.y_nm - point!.y_nm) - Math.hypot(b.value.x_nm - point!.x_nm, b.value.y_nm - point!.y_nm))[0];
        if (!drivePoint) {
          sketchSolverStatus = "The selected geometry has no draggable point";
          updateSketchToolInspectorState();
          renderSketchOverlay();
          return;
        }
        sketchDrag = {
          kind: "entity",
          pointerId: event.pointerId,
          geometry: draggableGeometry,
          point: drivePoint.ref,
          pointStart: drivePoint.value,
          startPlane: point,
          currentPlane: point,
          startClient: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        sketchOverlay.setPointerCapture(event.pointerId);
        sketchOverlay.dataset.dragging = "true";
      }
      setSketchSelectionPhase(hasSketchSelection() ? "ready" : "collecting");
      if (sketchSmartDimensionActive) applyPendingSketchInvocation();
      else { renderSketchSelectionChanged(); applyPendingSketchInvocation(); }
      if (activeInspectorTab === "tool") renderSketchSelectionInspectorChanged();
    }
    return;
  }
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  if (selectionMode === "replace") selectedSketchConstraint = undefined;
  const geometry = handle.dataset.geometry;
  const anchor = handle.dataset.anchor as PointRef["anchor"] | undefined;
  if (!geometry || !anchor) return;
  const point = { geometry, anchor };
  const pointSelected = selectedSketchPoints.some((candidate) => candidate.geometry === geometry && candidate.anchor === anchor);
  const removingPoint = selectionMode === "remove" || (selectionMode === "toggle" && pointSelected);
  if (selectionMode === "replace") {
    selectedSketchGeometry = [geometry];
    selectedSketchPoints = [point];
  } else if (removingPoint) {
    selectedSketchPoints = selectedSketchPoints.filter((candidate) => candidate.geometry !== geometry || candidate.anchor !== anchor);
    if (!selectedSketchPoints.some((candidate) => candidate.geometry === geometry)) selectedSketchGeometry = selectedSketchGeometry.filter((id) => id !== geometry);
  } else {
    selectedSketchGeometry = [...new Set([...selectedSketchGeometry, geometry])];
    if (!pointSelected) selectedSketchPoints = [...selectedSketchPoints, point];
  }
  selectedSketchSegments = [];
  if (!removingPoint && selectedSketchPoints.some((candidate) => candidate.geometry === geometry && candidate.anchor === anchor) && selectionMode === "replace" && !anchor.startsWith("parameter:")) {
    sketchDrag = { kind: "point", pointerId: event.pointerId, point: { geometry, anchor }, handle, startClient: { x: event.clientX, y: event.clientY }, moved: false };
    handle.setPointerCapture(event.pointerId);
    sketchOverlay.dataset.dragging = "true";
  }
});
sketchOverlay.addEventListener("pointermove", (event) => {
  if (sketchSession && !sketchDrag) {
    event.stopPropagation();
    const raw = sketchPoint(event);
    scheduleSketchPointerFrame({ source: "overlay", raw, altKey: event.altKey, shiftKey: event.shiftKey, toggleKey: event.ctrlKey || event.metaKey, client: { x: event.clientX, y: event.clientY }, target: event.target as Element });
  }
  if (!sketchDrag || sketchDrag.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - sketchDrag.startClient.x, event.clientY - sketchDrag.startClient.y) >= 7) sketchDrag.moved = true;
  if (!sketchDrag.moved) return;
  const target = sketchPoint(event);
  if (sketchDrag.kind === "entity") {
    if (!target) return;
    sketchDrag.currentPlane = target;
    const dx = event.clientX - sketchDrag.startClient.x; const dy = event.clientY - sketchDrag.startClient.y;
    for (const geometry of sketchDrag.geometry) {
      sketchOverlay.querySelectorAll<SVGElement>(`[data-geometry="${CSS.escape(geometry)}"], [data-sketch-geometry="${CSS.escape(geometry)}"]`).forEach((element) => element.setAttribute("transform", `translate(${dx} ${dy})`));
    }
    return;
  }
  const position = target ? sketchOverlayPoint(target) : undefined;
  if (!position) return;
  sketchDrag.handle.setAttribute("cx", String(position.x));
  sketchDrag.handle.setAttribute("cy", String(position.y));
});
sketchOverlay.addEventListener("pointerup", async (event) => {
  flushSketchPointerFrame();
  if (await finishSketchPlacementGesture(event)) return;
  const active = sketchDrag;
  if (!active || active.pointerId !== event.pointerId || !sketchSession) return;
  sketchDrag = undefined;
  delete sketchOverlay.dataset.dragging;
  if (!active.moved) {
    setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
    if (sketchSmartDimensionActive) applyPendingSketchInvocation();
    else { renderSketchSelectionChanged(); applyPendingSketchInvocation(); }
    return;
  }
  const started = performance.now();
  let accepted: boolean;
  if (active.kind === "entity") {
    const dx = active.currentPlane.x_nm - active.startPlane.x_nm;
    const dy = active.currentPlane.y_nm - active.startPlane.y_nm;
    accepted = await sketchSession.drag(active.point, {
      x_nm: active.pointStart.x_nm + dx,
      y_nm: active.pointStart.y_nm + dy,
    });
  } else if (active.kind === "radius") {
    const target = sketchPoint(event);
    if (!target) { renderSketchOverlay(); return; }
    const radius_nm = Math.max(1, Math.round(Math.hypot(target.x_nm - active.center.x_nm, target.y_nm - active.center.y_nm)));
    try {
      await sketchSession.apply({ kind: "set_radius", geometry: active.geometry, radius_nm });
      accepted = true;
    } catch {
      accepted = false;
    }
  } else {
    const target = sketchPoint(event);
    if (!target) { renderSketchOverlay(); return; }
    accepted = await sketchSession.drag(active.point, target);
  }
  performanceEvidence.record("preview", performance.now() - started);
  sketchLastDrag = accepted ? "accepted" : "refused";
  updateSketchStatus();
});
sketchOverlay.addEventListener("pointercancel", (event) => {
  if (cancelSketchPlacementGesture(event)) return;
  sketchDrag = undefined;
  delete sketchOverlay.dataset.dragging;
  renderSketchOverlay();
});
[sketchOverlay, sketchViewport].forEach((surface) => surface.addEventListener("contextmenu", (event) => {
  if (!sketchSession || (!sketchToolArmed && !pendingSketchConstraint && !sketchSmartDimensionActive && !pendingSketchEditPreview && !pendingDimensionPlacement)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void completeActiveSketchInvocation();
}, { capture: true }));
sketchOverlay.addEventListener("keydown", (event) => {
  const patternHandle = (event.target as SVGElement).closest<SVGGElement>("[data-pattern-handle]");
  if (patternHandle?.dataset.operationId && sketchSession && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const id = patternHandle.dataset.operationId; const current = sketchSession.draft.operations?.[id];
    if (!current || (current.kind !== "linear_pattern" && current.kind !== "circular_pattern")) return;
    const operation = structuredClone(current); const sign = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    if (operation.kind === "linear_pattern") operation.spacing.x_nm += sign * 1_000_000;
    else operation.angle_microdegrees += sign * 5_000_000;
    void sketchSession.apply({ kind: "set_operation", id, operation }).then(() => { renderSketchOverlay(); renderActiveToolInspector(); });
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target as SVGElement;
  const dofTarget = target.closest<SVGGElement>("[data-underconstrained-component]");
  if (dofTarget?.dataset.underconstrainedComponent) {
    event.preventDefault(); selectUnderconstrainedGeometry(Number(dofTarget.dataset.underconstrainedComponent)); return;
  }
  const constraintAction = target.closest<SVGGElement>("[data-constraint-canvas-action]");
  if (constraintAction?.dataset.constraintCanvasAction && constraintAction.dataset.constraintActionId) {
    event.preventDefault();
    const id = constraintAction.dataset.constraintActionId; const action = constraintAction.dataset.constraintCanvasAction;
    if (action === "delete") void deleteSketchConstraint(id);
    else if (action === "toggle") void toggleSketchConstraintState(id);
    else { selectedSketchConstraint = id; renderSketchOverlay(); renderActiveToolInspector(); requestAnimationFrame(() => sketchDimensionInput().focus()); }
    return;
  }
  if (patternHandle?.dataset.operationId) {
    event.preventDefault();
    const operation = sketchSession?.draft.operations?.[patternHandle.dataset.operationId];
    if (operation) selectedSketchGeometry = retainedOperationGeometry(operation).slice(0, 1);
    renderActiveToolInspector();
    document.querySelector<HTMLInputElement>(operation?.kind === "linear_pattern" ? '[data-operation-field="spacing_x"]' : '[data-operation-field="angle_microdegrees"]')?.focus();
    return;
  }
  const profileTarget = target.closest<SVGPathElement>("[data-sketch-profile-id]");
  if (profileTarget?.dataset.sketchProfileId && sketchSession) {
    event.preventDefault();
    let geometryIds: string[] = [];
    try {
      const parsed = JSON.parse(profileTarget.dataset.profileGeometryIds ?? "[]");
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) geometryIds = parsed;
    } catch { /* malformed markup cannot create a semantic selection */ }
    if (!geometryIds.length) return;
    const mode = sketchSelectionModeForEvent(event);
    const alreadySelected = selectedSketchProfile?.profileId === profileTarget.dataset.sketchProfileId;
    if (mode === "replace") clearSketchSelection(false);
    selectedSketchProfile = mode === "remove" || (mode === "toggle" && alreadySelected)
      ? undefined
      : { sketchId: sketchSession.draft.id, profileId: profileTarget.dataset.sketchProfileId, geometryIds: [...geometryIds].sort() };
    sketchProfileRepairMessage = undefined;
    renderSketchSelectionChanged();
    setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
    if (activeInspectorTab === "tool") renderSketchSelectionInspectorChanged();
    return;
  }
  if (target.closest("[data-sketch-origin]")) {
    event.preventDefault();
    if (sketchToolArmed && sketchSession?.activeTool !== "trim") void applySketchClick(ABSOLUTE_SKETCH_ORIGIN, true);
    else {
      const mode = sketchSelectionModeForEvent(event);
      if (mode === "replace") clearSketchSelection(false);
      sketchOriginSelected = mode === "remove" ? false : mode === "toggle" ? !sketchOriginSelected : true;
      renderSketchOverlay();
      setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
      applyPendingSketchInvocation();
    }
    return;
  }
  const geometry = target.dataset.geometry ?? target.dataset.sketchGeometry ?? target.dataset.sketchHitGeometry;
  if (!geometry) return;
  event.preventDefault();
  const collectingOperands = sketchOperandCollectionActive();
  const mode: SketchSelectionMode = collectingOperands ? "add" : sketchSelectionModeForEvent(event);
  const anchor = target.dataset.anchor as PointRef["anchor"] | undefined;
  if (anchor) {
    const point = { geometry, anchor };
    const selected = selectedSketchPoints.some((candidate) => candidate.geometry === geometry && candidate.anchor === anchor);
    if (mode === "replace") { selectedSketchGeometry = [geometry]; selectedSketchPoints = [point]; selectedSketchConstraint = undefined; sketchOriginSelected = false; }
    else if (mode === "remove" || (mode === "toggle" && selected)) {
      selectedSketchPoints = selectedSketchPoints.filter((candidate) => candidate.geometry !== geometry || candidate.anchor !== anchor);
      if (!selectedSketchPoints.some((candidate) => candidate.geometry === geometry)) selectedSketchGeometry = selectedSketchGeometry.filter((id) => id !== geometry);
    } else {
      selectedSketchGeometry = [...new Set([...selectedSketchGeometry, geometry])];
      if (!selected) selectedSketchPoints = [...selectedSketchPoints, point];
    }
    selectedSketchSegments = [];
  } else {
    const segment = Number(target.dataset.sketchSegment);
    const wasSelected = selectedSketchGeometry.includes(geometry);
    selectedSketchGeometry = updateSketchIdSelection(selectedSketchGeometry, geometry, mode);
    if (mode === "replace") { selectedSketchPoints = []; selectedSketchConstraint = undefined; sketchOriginSelected = false; }
    else if (!selectedSketchGeometry.includes(geometry)) selectedSketchPoints = selectedSketchPoints.filter((point) => point.geometry !== geometry);
    selectedSketchSegments = Number.isInteger(segment) && selectedSketchGeometry.includes(geometry)
      ? (mode === "replace" ? [{ geometry, segment }] : mode === "toggle" && wasSelected ? selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry || candidate.segment !== segment) : [...selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry || candidate.segment !== segment), { geometry, segment }])
      : selectedSketchSegments.filter((candidate) => candidate.geometry !== geometry);
  }
  setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
  if (sketchSmartDimensionActive) applyPendingSketchInvocation();
  else { renderSketchSelectionChanged(); applyPendingSketchInvocation(); }
  document.querySelector<SVGElement>(`#sketch-overlay [data-geometry="${CSS.escape(geometry)}"]${anchor ? `[data-anchor="${CSS.escape(anchor)}"]` : ""}`)?.focus();
});
window.addEventListener("resize", renderSketchViewChanged);
document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((button) => button.addEventListener("click", () => {
  const selected = button.dataset.sketchTool!;
  const label = SKETCH_TOOL_SCHEMA.find((entry) => entry.id === selected)?.label ?? button.textContent?.trim() ?? "Sketch";
  if (!sketchSession) {
    if (!safeMode) startSketchEdit(selected as SketchTool, label);
    return;
  }
  if (selected === "construction") {
    void applyConstructionModifier();
    return;
  }
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  if (sketchEditOperations.has(selected as SketchTool)) {
    pendingSketchConstraint = undefined;
    sketchToolArmed = false;
    sketchSession.activeTool = selected as SketchTool;
    sketchPoints = [];
    sketchPointInferences = [];
    resetInlineCreationInput();
    activeSketchOperationLabel = label;
    activateToolContext({ key: selected, label, source: "sketch" });
    setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
    void applySketchEditOperation(selected as SketchTool);
    return;
  }
  if (selected === "project") {
    pendingSketchConstraint = undefined;
    sketchToolArmed = false;
    sketchSession.activeTool = selected as SketchTool;
    activeSketchOperationLabel = label;
    activateToolContext({ key: selected, label, source: "sketch" });
    setSketchToolPhase(state.selection?.kind === "edge" ? "ready" : "collecting");
    void projectSelectedSketchEdge();
    return;
  }
  pendingSketchConstraint = undefined;
  sketchToolArmed = true;
  sketchSession.activeTool = selected as typeof sketchSession.activeTool;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  sketchHoverPoint = undefined;
  activeSketchOperationLabel = label;
  activateToolContext({ key: selected, label, source: "sketch" });
  document.querySelectorAll<HTMLButtonElement>("[data-sketch-tool]").forEach((candidate) => {
    candidate.setAttribute("aria-pressed", String(candidate.dataset.sketchTool === "construction" ? sketchConstruction : candidate === button));
  });
  renderSketchOverlay();
  setSketchToolPhase("collecting");
}));
document.querySelector<HTMLButtonElement>("#smart-sketch-dimension")!.addEventListener("click", () => {
  if (!sketchSession) {
    if (safeMode) return;
    startSketchEdit("line", "Smart Dimension");
  }
  if (!sketchSession) return;
  sketchToolArmed = false;
  sketchSmartDimensionActive = true;
  pendingSketchConstraint = undefined;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  activateToolContext({ key: "smart-sketch-dimension", label: "Smart Dimension", source: "sketch" });
  setSketchToolPhase(hasSketchSelection() ? "ready" : "collecting");
  prepareSmartDimension();
});
document.querySelectorAll<HTMLButtonElement>("[data-smart-dimension-proxy]").forEach((button) => button.addEventListener("click", () => {
  const target = document.querySelector<HTMLButtonElement>("#smart-sketch-dimension")!;
  if (button.getAttribute("aria-disabled") === "true") {
    sketchSolverStatus = button.dataset.disabledReason ?? "Smart Dimension is not available for the current selection";
    updateSketchToolInspectorState();
    return;
  }
  button.closest("details")?.removeAttribute("open");
  target.click();
}));
document.querySelectorAll<HTMLButtonElement>("[data-sketch-constraint]").forEach((button) => button.addEventListener("click", () => {
  if (button.getAttribute("aria-disabled") === "true" || !sketchSession) {
    sketchSolverStatus = button.dataset.disabledReason ?? "Start or edit a sketch to use constraints";
    updateSketchToolInspectorState();
    return;
  }
  button.closest("details")?.removeAttribute("open");
  sketchToolArmed = false;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverSnap = undefined;
  sketchHoverPoint = undefined;
  const kind = button.dataset.sketchConstraint as ConstraintTool;
  sketchSmartDimensionActive = false;
  pendingDimensionPlacement = undefined;
  pendingReferenceDimension = undefined;
  cancelPendingSketchEditPreview();
  pendingSketchConstraint = kind;
  activateToolContext({ key: kind, label: button.title || button.textContent?.trim() || kind, source: "constraint" });
  setSketchToolPhase(constraintCommand(kind, "constraint:pending", sketchSession.draft, { geometry: selectedSketchGeometry, points: selectedSketchPoints, origin: sketchOriginSelected }, sketchConstraintValue) ? "ready" : "collecting");
  renderSketchOverlay();
  void applySketchConstraint(kind);
}));
document.querySelectorAll<HTMLInputElement>("[data-sketch-filter]").forEach((input) => input.addEventListener("change", () => {
  const filter = input.dataset.sketchFilter!;
  if (input.checked) sketchSelectionFilters.add(filter); else sketchSelectionFilters.delete(filter);
  selectedSketchGeometry = selectedSketchGeometry.filter((id) => {
    const entity = sketchSession?.draft.geometry[id];
    return Boolean(entity && sketchEntityMatchesFilter(entity, sketchSelectionFilters));
  });
  if (!sketchSelectionFilters.has("points")) selectedSketchPoints = [];
  if (!sketchSelectionFilters.has("constraints") && !sketchSelectionFilters.has("dimensions")) selectedSketchConstraint = undefined;
  sketchSolverStatus = `${input.nextElementSibling?.textContent ?? filter} selection ${input.checked ? "enabled" : "filtered out"}`;
  renderSketchOverlay();
  syncSketchToolUi();
  updateSketchToolInspectorState();
}));
document.querySelector("#finish-sketch-ribbon")!.addEventListener("click", () => void finishSketch());
document.querySelector("#finish-sketch-menu")!.addEventListener("click", () => void finishSketch());
function applySketchHistory(direction: "undo" | "redo"): boolean {
  if (!sketchSession) return false;
  const changed = direction === "undo" ? sketchSession.undo() : sketchSession.redo();
  if (!changed) return true;
  sketchPoints = [];
  sketchPointInferences = [];
  resetInlineCreationInput();
  sketchHoverPoint = undefined;
  sketchHoverSnap = undefined;
  selectedSketchGeometry = [];
  selectedSketchPoints = [];
  selectedSketchSegments = [];
  selectedSketchConstraint = undefined;
  sketchSolverStatus = direction === "undo" ? "Sketch edit undone" : "Sketch edit redone";
  updateSketchStatus();
  return true;
}
document.querySelector("#undo")!.addEventListener("click", () => {
  if (applySketchHistory("undo")) return;
  document.querySelector("#storage-status")!.textContent = "saving";
  worker?.postMessage({ type: "undo" });
});
document.querySelector("#redo")!.addEventListener("click", () => {
  if (applySketchHistory("redo")) return;
  document.querySelector("#storage-status")!.textContent = "saving";
  worker?.postMessage({ type: "redo" });
});
document.querySelector("#recover-runtime")!.addEventListener("click", startRuntime);
document.querySelector("#stay-safe")!.addEventListener("click", () => {
  document.querySelector("#safe-reason")!.textContent = "You’re viewing the last good model state without editing.";
});
document.querySelector("#dismiss-action-error")!.addEventListener("click", hideActionError);
document.querySelector("#restart-tour")!.addEventListener("click", () => onboarding.restart());
document.querySelectorAll<HTMLButtonElement>("[data-empty-action]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.emptyAction === "sketch") document.querySelector<HTMLButtonElement>("#edit-sketch")?.click();
  if (button.dataset.emptyAction === "import") document.querySelector<HTMLButtonElement>("#import-step")?.click();
  if (button.dataset.emptyAction === "open") document.querySelector<HTMLButtonElement>("#open-part")?.click();
}));
document.querySelectorAll<HTMLButtonElement>("[data-open-command-search]").forEach((button) => button.addEventListener("click", () => openCommands(button)));
document.querySelectorAll<HTMLButtonElement>("[data-invoke]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>(button.dataset.invoke!)?.click();
  button.closest("details")?.removeAttribute("open");
}));
function setActiveWorkbench(workbench: WorkbenchId): void {
  activeWorkbench = workbench;
  document.querySelectorAll<HTMLButtonElement>("[data-workbench]").forEach((candidate) => {
    const active = candidate.dataset.workbench === activeWorkbench;
    candidate.classList.toggle("active", active);
    if (active) candidate.setAttribute("aria-current", "page"); else candidate.removeAttribute("aria-current");
    if (active) document.querySelector<HTMLElement>(".workbench-tabs")!.style.setProperty("--workbench-color", candidate.dataset.workbenchColor ?? "#0ea5e9");
  });
  document.querySelectorAll<HTMLElement>("[data-workbench-ribbon]").forEach((ribbon) => { ribbon.hidden = ribbon.dataset.workbenchRibbon !== activeWorkbench; });
  const baseOperationActive = state.operation.status === "preview" && (state.operation.type === "rectangle" || state.operation.type === "pad");
  document.querySelector<HTMLElement>(".dimension-panel")!.hidden = activeWorkbench !== "Part Design" && !baseOperationActive;
  document.querySelector<HTMLElement>(".commandbar")!.setAttribute("aria-label", `${activeWorkbench} commands`);
  document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((flyout) => { flyout.hidden = true; });
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  if (!toolbarCustomizePanel.hidden) renderToolbarCustomization();
}
document.querySelectorAll<HTMLButtonElement>("[data-workbench]").forEach((button) => button.addEventListener("click", () => {
  if (sketchSession && button.dataset.workbench !== "Sketcher") return;
  setActiveWorkbench(button.dataset.workbench as WorkbenchId);
  if (!sketchSession) deactivateToolContext();
}));

document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.addEventListener("click", () => {
  closeToolbarCustomization(false);
  toolbarMenus.forEach((menu) => { menu.open = false; });
  const group = trigger.closest<HTMLElement>(".ribbon-group")!;
  const panel = group.querySelector<HTMLElement>(".ribbon-flyout")!;
  const opening = panel.hidden;
  document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((candidate) => { candidate.hidden = true; });
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((candidate) => candidate.setAttribute("aria-expanded", "false"));
  panel.hidden = !opening;
  trigger.setAttribute("aria-expanded", String(opening));
  if (opening) {
    const bounds = trigger.getBoundingClientRect();
    panel.style.left = `${Math.min(window.innerWidth - 204, Math.max(6, bounds.left))}px`;
    panel.style.top = `${Math.min(window.innerHeight - 48, bounds.bottom + 4)}px`;
    panel.querySelector<HTMLButtonElement>("[data-ribbon-run]")?.focus();
  }
}));
document.querySelectorAll<HTMLButtonElement>("[data-ribbon-run]").forEach((button) => button.addEventListener("click", () => {
  if (button.getAttribute("aria-disabled") === "true") return;
  const ribbon = button.closest<HTMLElement>("[data-workbench-ribbon]")!;
  ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(button.dataset.ribbonRun!)}"]`)?.click();
  button.closest<HTMLElement>(".ribbon-flyout")!.hidden = true;
}));

const toolbarCustomizeTrigger = document.querySelector<HTMLButtonElement>("#toolbar-customize")!;
const toolbarCustomizePanel = document.querySelector<HTMLElement>("#toolbar-customize-panel")!;
let toolbarCustomizeReturnFocus: HTMLElement | null = null;

function currentWorkbenchSpec(): WorkbenchSpec {
  return availableWorkbenchSpecs.find((spec) => spec.id === activeWorkbench) ?? availableWorkbenchSpecs[0];
}

function persistCurrentToolbarPreferences(): void {
  const spec = currentWorkbenchSpec();
  const ribbon = document.querySelector<HTMLElement>(`[data-workbench-ribbon="${CSS.escape(spec.id)}"]`)!;
  toolbarPreferences[spec.id] = Array.from(ribbon.querySelectorAll<HTMLButtonElement>("[data-ribbon-tool].pinned"), (tool) => tool.dataset.ribbonTool!).filter(Boolean);
  writeToolbarPreferences();
}

function setToolbarToolShown(key: string, shown: boolean): void {
  const ribbon = document.querySelector<HTMLElement>(`[data-workbench-ribbon="${CSS.escape(activeWorkbench)}"]`)!;
  const tool = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(key)}"]`);
  if (!tool) return;
  tool.classList.toggle("pinned", shown);
  tool.draggable = shown && !toolbarCustomizePanel.hidden;
  const pin = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-pin="${CSS.escape(key)}"]`);
  if (pin) {
    const label = tool.textContent?.trim() || key;
    const action = shown ? "Unpin" : "Pin";
    const direction = shown ? "from" : "to";
    pin.setAttribute("aria-pressed", String(shown));
    pin.setAttribute("aria-label", `${action} ${label} ${direction} toolbar`);
    pin.title = `${action} ${label} ${direction} toolbar`;
  }
  persistCurrentToolbarPreferences();
}

document.querySelectorAll<HTMLButtonElement>("[data-ribbon-pin]").forEach((button) => button.addEventListener("click", (event) => {
  event.stopPropagation();
  const key = button.dataset.ribbonPin;
  if (!key) return;
  setToolbarToolShown(key, button.getAttribute("aria-pressed") !== "true");
  button.focus();
}));

const toolbarCommandContextMenu = document.querySelector<HTMLElement>("#toolbar-command-context-menu")!;
const toolbarContextPin = document.querySelector<HTMLButtonElement>("#toolbar-context-pin")!;
let toolbarContextCommandKey: string | null = null;
let toolbarContextReturnFocus: HTMLElement | null = null;

function openToolbarCommandContext(event: MouseEvent, commandKey: string, returnFocus: HTMLElement): void {
  event.preventDefault();
  dismissTransientSurfaces();
  toolbarContextCommandKey = commandKey;
  toolbarContextReturnFocus = returnFocus;
  const ribbon = document.querySelector<HTMLElement>(`[data-workbench-ribbon="${CSS.escape(activeWorkbench)}"]`)!;
  const tool = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(commandKey)}"]`);
  if (!tool) return;
  const pinned = tool.classList.contains("pinned");
  toolbarContextPin.querySelector<HTMLElement>("span")!.textContent = pinned ? "Unpin from toolbar" : "Pin to toolbar";
  toolbarContextPin.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${tool.textContent?.trim() || commandKey} ${pinned ? "from" : "to"} toolbar`);
  positionContextMenu(toolbarCommandContextMenu, event.clientX, event.clientY);
  toolbarContextPin.focus();
}

document.querySelectorAll<HTMLButtonElement>("[data-ribbon-tool], [data-ribbon-run]").forEach((button) => button.addEventListener("contextmenu", (event) => {
  const commandKey = button.dataset.ribbonTool ?? button.dataset.ribbonRun;
  if (commandKey) openToolbarCommandContext(event, commandKey, button);
}));
toolbarContextPin.addEventListener("click", () => {
  if (!toolbarContextCommandKey) return;
  const ribbon = document.querySelector<HTMLElement>(`[data-workbench-ribbon="${CSS.escape(activeWorkbench)}"]`)!;
  const tool = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(toolbarContextCommandKey)}"]`);
  if (!tool) return;
  setToolbarToolShown(toolbarContextCommandKey, !tool.classList.contains("pinned"));
  toolbarCommandContextMenu.hidden = true;
  toolbarContextReturnFocus?.focus();
});
document.querySelector<HTMLButtonElement>("#toolbar-context-customize")!.addEventListener("click", () => {
  toolbarCommandContextMenu.hidden = true;
  openToolbarCustomization();
});
toolbarCommandContextMenu.addEventListener("keydown", (event) => {
  const items = Array.from(toolbarCommandContextMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") {
    event.preventDefault();
    toolbarCommandContextMenu.hidden = true;
    toolbarContextReturnFocus?.focus();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!toolbarCommandContextMenu.hidden && !(event.target as Element).closest("#toolbar-command-context-menu")) toolbarCommandContextMenu.hidden = true;
});

function setRibbonCustomizationMode(active: boolean): void {
  document.querySelector<HTMLElement>(".commandbar")!.toggleAttribute("data-customizing", active);
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-tool]").forEach((tool) => {
    tool.draggable = active && tool.classList.contains("pinned");
  });
}

function renderToolbarCustomization(): void {
  const spec = currentWorkbenchSpec();
  const ribbon = document.querySelector<HTMLElement>(`[data-workbench-ribbon="${CSS.escape(spec.id)}"]`)!;
  document.querySelector<HTMLElement>("#toolbar-customize-context")!.textContent = spec.id;
  const host = document.querySelector<HTMLElement>("#toolbar-customize-list")!;
  host.innerHTML = spec.sections.map((section, sectionIndex) => {
    const availableTools = section.tools.filter((tool) => !tool.comingSoon);
    if (!availableTools.length) return "";
    const headingId = `toolbar-customize-section-${sectionIndex}`;
    return `<section class="toolbar-customize-group" aria-labelledby="${headingId}"><h3 id="${headingId}">${escapeHtml(section.label)}</h3>${availableTools.map((definition) => {
      const tool = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(definition.key)}"]`);
      const shown = tool?.classList.contains("pinned") ?? false;
      return `<button type="button" data-toolbar-visibility="${escapeHtml(definition.key)}" aria-pressed="${shown}" aria-label="${shown ? "Hide" : "Show"} ${escapeHtml(definition.label)} in toolbar"><span>${escapeHtml(definition.label)}</span><small class="toolbar-customize-state">${shown ? "Shown" : "Hidden"}</small></button>`;
    }).join("")}</section>`;
  }).join("");
  host.querySelectorAll<HTMLButtonElement>("[data-toolbar-visibility]").forEach((button) => button.addEventListener("click", () => {
    const tool = ribbon.querySelector<HTMLButtonElement>(`[data-ribbon-tool="${CSS.escape(button.dataset.toolbarVisibility!)}"]`);
    if (!tool) return;
    const shown = !tool.classList.contains("pinned");
    setToolbarToolShown(button.dataset.toolbarVisibility!, shown);
    button.setAttribute("aria-pressed", String(shown));
    const label = button.querySelector<HTMLElement>("span")!.textContent ?? "command";
    button.setAttribute("aria-label", `${shown ? "Hide" : "Show"} ${label} in toolbar`);
    button.querySelector<HTMLElement>(".toolbar-customize-state")!.textContent = shown ? "Shown" : "Hidden";
  }));
}

function closeToolbarCustomization(restoreFocus = true): void {
  if (toolbarCustomizePanel.hidden) return;
  toolbarCustomizePanel.hidden = true;
  toolbarCustomizeTrigger.setAttribute("aria-expanded", "false");
  setRibbonCustomizationMode(false);
  if (restoreFocus) toolbarCustomizeReturnFocus?.focus();
}

function openToolbarCustomization(): void {
  dismissTransientSurfaces();
  toolbarCustomizeReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : toolbarCustomizeTrigger;
  renderToolbarCustomization();
  toolbarCustomizePanel.hidden = false;
  toolbarCustomizeTrigger.setAttribute("aria-expanded", "true");
  setRibbonCustomizationMode(true);
  document.querySelector<HTMLButtonElement>("#close-toolbar-customize")!.focus();
}

toolbarCustomizeTrigger.addEventListener("click", () => {
  if (toolbarCustomizePanel.hidden) openToolbarCustomization(); else closeToolbarCustomization();
});
document.querySelectorAll<HTMLButtonElement>("#close-toolbar-customize, #done-toolbar-customize").forEach((button) => button.addEventListener("click", () => closeToolbarCustomization()));
document.querySelector<HTMLButtonElement>("#reset-toolbar-customize")!.addEventListener("click", () => {
  const spec = currentWorkbenchSpec();
  const defaults = new Set(spec.pinned);
  delete toolbarPreferences[spec.id];
  writeToolbarPreferences();
  document.querySelectorAll<HTMLButtonElement>(`[data-workbench-ribbon="${CSS.escape(spec.id)}"] [data-ribbon-tool]`).forEach((tool) => {
    const shown = defaults.has(tool.dataset.ribbonTool!);
    tool.classList.toggle("pinned", shown);
    tool.draggable = shown;
    const pin = tool.closest<HTMLElement>("[data-workbench-ribbon]")?.querySelector<HTMLButtonElement>(`[data-ribbon-pin="${CSS.escape(tool.dataset.ribbonTool!)}"]`);
    if (pin) {
      const label = tool.textContent?.trim() || tool.dataset.ribbonTool!;
      pin.setAttribute("aria-pressed", String(shown));
      pin.setAttribute("aria-label", `${shown ? "Unpin" : "Pin"} ${label} ${shown ? "from" : "to"} toolbar`);
      pin.title = `${shown ? "Unpin" : "Pin"} ${label} ${shown ? "from" : "to"} toolbar`;
    }
  });
  renderToolbarCustomization();
  document.querySelector<HTMLButtonElement>("#reset-toolbar-customize")!.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (toolbarCustomizePanel.hidden || (event.target as Element).closest("#toolbar-customize-panel, #toolbar-customize")) return;
  closeToolbarCustomization(false);
});

let draggedRibbonTool: HTMLButtonElement | null = null;
document.querySelectorAll<HTMLButtonElement>("[data-ribbon-tool]").forEach((tool) => {
  tool.addEventListener("dragstart", (event) => { if (!tool.classList.contains("pinned")) { event.preventDefault(); return; } draggedRibbonTool = tool; tool.classList.add("dragging"); });
  tool.addEventListener("dragover", (event) => { if (draggedRibbonTool?.closest(".ribbon-group") === tool.closest(".ribbon-group")) event.preventDefault(); });
  tool.addEventListener("drop", (event) => { event.preventDefault(); if (draggedRibbonTool && draggedRibbonTool !== tool && draggedRibbonTool.closest(".ribbon-group") === tool.closest(".ribbon-group")) tool.before(draggedRibbonTool); });
  tool.addEventListener("dragend", () => { draggedRibbonTool?.classList.remove("dragging"); draggedRibbonTool = null; persistCurrentToolbarPreferences(); });
});
document.querySelectorAll<HTMLButtonElement>("[data-export-proxy]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>(`[data-export="${button.dataset.exportProxy}"]`)?.click();
  button.closest("details")?.removeAttribute("open");
}));
const toolbarMenus = Array.from(document.querySelectorAll<HTMLDetailsElement>(".app-menu, .tool-overflow"));
const appMenuSummaries = Array.from(document.querySelectorAll<HTMLElement>(".app-menu > summary"));
toolbarMenus.forEach((menu, index) => {
  const summary = menu.querySelector<HTMLElement>(":scope > summary")!;
  const popover = menu.querySelector<HTMLElement>(":scope > .menu-popover");
  const menuId = popover?.id || `application-menu-${index + 1}`;
  if (popover) popover.id = menuId;
  summary.setAttribute("aria-haspopup", "menu");
  summary.setAttribute("aria-expanded", String(menu.open));
  if (popover) summary.setAttribute("aria-controls", menuId);
  menu.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(menu.open));
    if (!menu.open) return;
    closeToolbarCustomization(false);
    toolbarMenus.forEach((candidate) => { if (candidate !== menu) candidate.open = false; });
    document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((flyout) => { flyout.hidden = true; });
    document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    viewportContextMenu.hidden = true;
    treeContextMenu.hidden = true;
    viewportBackgroundMenu.hidden = true;
    viewportBackgroundButton.setAttribute("aria-expanded", "false");
  });
});

function moveBetweenAppMenus(current: HTMLElement, offset: -1 | 1, open = false): void {
  const visibleSummaries = appMenuSummaries.filter((summary) => !summary.closest<HTMLDetailsElement>("details")?.hidden);
  const currentIndex = visibleSummaries.indexOf(current);
  const next = visibleSummaries[(Math.max(0, currentIndex) + offset + visibleSummaries.length) % visibleSummaries.length];
  current.closest<HTMLDetailsElement>("details")!.open = false;
  next.focus();
  if (open) {
    next.closest<HTMLDetailsElement>("details")!.open = true;
    next.closest<HTMLDetailsElement>("details")!.querySelector<HTMLButtonElement>(".menu-popover button:not([hidden])")?.focus();
  }
}

appMenuSummaries.forEach((summary) => summary.addEventListener("keydown", (event) => {
  const menu = summary.closest<HTMLDetailsElement>("details")!;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".menu-popover button:not([hidden])"));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    menu.open = true;
    (event.key === "ArrowDown" ? items[0] : items.at(-1))?.focus();
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    moveBetweenAppMenus(summary, event.key === "ArrowRight" ? 1 : -1);
  } else if (event.key === "Escape" && menu.open) {
    event.preventDefault();
    menu.open = false;
  }
}));

document.querySelectorAll<HTMLElement>(".app-menu .menu-popover").forEach((popover) => {
  popover.addEventListener("keydown", (event) => {
    const menu = popover.closest<HTMLDetailsElement>("details")!;
    const summary = menu.querySelector<HTMLElement>(":scope > summary")!;
    const items = Array.from(popover.querySelectorAll<HTMLButtonElement>("button:not([hidden])"));
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(current + offset + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveBetweenAppMenus(summary, event.key === "ArrowRight" ? 1 : -1, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      menu.open = false;
      summary.focus();
    } else if (event.key === "Tab") {
      menu.open = false;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const character = event.key.toLocaleLowerCase();
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) => (item.textContent?.trim().toLocaleLowerCase() ?? "").startsWith(character));
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  });
  popover.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (button && !button.dataset.comingSoon) button.closest<HTMLDetailsElement>("details")!.open = false;
  }, { capture: true });
});
document.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element && event.target.closest(".app-menu, .tool-overflow")) return;
  toolbarMenus.forEach((menu) => { menu.open = false; });
  if (event.target instanceof Element && event.target.closest(".ribbon-group, #viewport-background, #viewport-background-menu")) return;
  document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((flyout) => { flyout.hidden = true; });
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  viewportBackgroundMenu.hidden = true;
  viewportBackgroundButton.setAttribute("aria-expanded", "false");
});
document.querySelector("#command-query")!.addEventListener("input", renderCommands);
document.querySelector("#command-query")!.addEventListener("keydown", (event) => {
  const key = (event as KeyboardEvent).key;
  if (["Escape", "Enter", "ArrowDown", "ArrowUp"].includes(key)) event.stopPropagation();
  if (key === "Escape") { event.preventDefault(); closeCommands(); }
  if (key === "Enter") { event.preventDefault(); document.querySelector<HTMLButtonElement>("#command-results .active")?.click(); }
  if (["ArrowDown", "ArrowUp"].includes(key)) {
    event.preventDefault();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>("#command-results button:not(:disabled)"));
    if (!items.length) return;
    const active = items.findIndex((item) => item.classList.contains("active"));
    const start = active >= 0 ? active : (key === "ArrowDown" ? -1 : 0);
    const next = (start + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    setActiveCommandOption(items[next]);
    document.querySelector<HTMLOutputElement>("#command-result-status")!.textContent = `${items[next].querySelector<HTMLElement>(":scope > span")?.textContent?.trim()} selected.`;
  }
});
document.querySelector("#fit-view")!.addEventListener("click", () => renderer?.fit());
document.querySelector("#fullscreen-command")!.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen();
});
document.querySelector<HTMLButtonElement>("#toggle-grid")!.addEventListener("click", (event) => {
  viewportGridVisible = !viewportGridVisible;
  renderer?.setGridVisible(viewportGridVisible);
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(viewportGridVisible));
});
const viewportBackgroundButton = document.querySelector<HTMLButtonElement>("#viewport-background")!;
const viewportBackgroundMenu = document.querySelector<HTMLElement>("#viewport-background-menu")!;
viewportBackgroundButton.addEventListener("click", () => {
  closeToolbarCustomization(false);
  toolbarMenus.forEach((menu) => { menu.open = false; });
  document.querySelectorAll<HTMLElement>(".ribbon-flyout").forEach((flyout) => { flyout.hidden = true; });
  document.querySelectorAll<HTMLButtonElement>("[data-ribbon-flyout]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  viewportContextMenu.hidden = true;
  treeContextMenu.hidden = true;
  viewportBackgroundMenu.hidden = !viewportBackgroundMenu.hidden;
  viewportBackgroundButton.setAttribute("aria-expanded", String(!viewportBackgroundMenu.hidden));
});
function applyViewportBackground(color: string): boolean {
  const input = document.querySelector<HTMLInputElement>("#viewport-background-custom")!;
  const valid = /^#[0-9a-f]{6}$/i.test(color);
  input.setAttribute("aria-invalid", String(!valid));
  if (!valid) return false;
  viewportBackground = color;
  renderer?.setBackground(color);
  document.querySelector<HTMLElement>(".viewport-region")!.style.background = color;
  viewportBackgroundButton.querySelector<HTMLElement>("span")!.style.background = color;
  input.value = color;
  return true;
}
document.querySelectorAll<HTMLButtonElement>("[data-viewport-bg]").forEach((button) => button.addEventListener("click", () => {
  applyViewportBackground(button.dataset.viewportBg!);
  viewportBackgroundMenu.hidden = true;
  viewportBackgroundButton.setAttribute("aria-expanded", "false");
}));
const viewportBackgroundCustom = document.querySelector<HTMLInputElement>("#viewport-background-custom")!;
function commitCustomViewportBackground(): void {
  if (!applyViewportBackground(viewportBackgroundCustom.value.trim())) return;
  viewportBackgroundMenu.hidden = true;
  viewportBackgroundButton.setAttribute("aria-expanded", "false");
}
viewportBackgroundCustom.addEventListener("input", () => viewportBackgroundCustom.setAttribute("aria-invalid", String(!/^#[0-9a-f]{6}$/i.test(viewportBackgroundCustom.value.trim()))));
viewportBackgroundCustom.addEventListener("change", commitCustomViewportBackground);
viewportBackgroundCustom.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  commitCustomViewportBackground();
});
function applyTheme(theme: ColorTheme): void {
  activeTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = themePreference ?? "system";
  const light = theme === "light";
  const shell = document.querySelector<HTMLElement>(".shell")!;
  shell.classList.toggle("light", light);
  shell.classList.toggle("dark", !light);
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
  button.setAttribute("aria-pressed", String(light));
  button.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  button.title = light ? "Switch to Dark Mode" : "Switch to Light Mode";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", light ? "#e8eaf0" : "#0c0d10");
  viewportBackground = light ? "#b8bec8" : "#0c0d10";
  renderer?.setBackground(viewportBackground);
  document.querySelector<HTMLElement>(".viewport-region")!.style.background = viewportBackground;
  document.querySelector<HTMLElement>(".viewport-background-button > span")!.style.background = viewportBackground;
  document.querySelector<HTMLInputElement>("#viewport-background-custom")!.value = viewportBackground;
}

applyTheme(activeTheme);
const themeManager = installThemeManager({ applyBaseMode: applyTheme });

document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", () => {
  themePreference = activeTheme === "light" ? "dark" : "light";
  try { localStorage.setItem(THEME_STORAGE_KEY, themePreference); } catch { /* The in-memory preference still applies. */ }
  applyTheme(themePreference);
});

systemTheme.addEventListener("change", (event) => {
  if (!themePreference) applyTheme(event.matches ? "light" : "dark");
});

window.addEventListener("storage", (event) => {
  if (event.key !== THEME_STORAGE_KEY) return;
  themePreference = event.newValue === "light" || event.newValue === "dark" ? event.newValue : undefined;
  applyTheme(themePreference ?? (systemTheme.matches ? "light" : "dark"));
});
document.querySelector("#projection-mode")!.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const mode = renderer?.projectionMode() === "perspective" ? "orthographic" : "perspective";
  renderer?.setProjection(mode);
  button.querySelector("span")!.textContent = mode === "orthographic" ? "Orthographic" : "Perspective";
  button.title = `${mode === "orthographic" ? "Orthographic" : "Perspective"} projection`;
  button.setAttribute("aria-pressed", String(mode === "orthographic"));
});
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => renderer?.standardView(button.dataset.view as "front" | "top" | "right" | "isometric")));
document.querySelectorAll<HTMLButtonElement>("[data-context-view]").forEach((button) => button.addEventListener("click", () => renderer?.standardView(button.dataset.contextView as "front" | "back" | "top" | "bottom" | "left" | "right" | "isometric")));
document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach((button) => button.addEventListener("click", () => {
  viewportDisplayMode = button.dataset.displayMode as typeof viewportDisplayMode;
  renderer?.setDisplayMode(viewportDisplayMode);
  document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach((candidate) => candidate.classList.toggle("checked", candidate === button));
}));
document.querySelector("#viewport-toggle-visibility")!.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>(`[data-body-visibility="${CSS.escape(acceptedBodyId)}"]`)?.click();
});
document.querySelectorAll<HTMLInputElement>("[data-filter]").forEach((input) => input.addEventListener("change", () => {
  state.selectionFilters[input.dataset.filter as TopologyKind] = input.checked;
  renderer?.setFilters(state.selectionFilters); applySelection(null);
}));
document.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]").forEach((button) => button.addEventListener("click", () => {
  const panel = button.dataset.panelToggle as keyof typeof state.panels;
  state.panels[panel] = !state.panels[panel];
  document.querySelector(".workspace")!.classList.toggle(`hide-${panel}`, !state.panels[panel]);
  document.querySelectorAll<HTMLButtonElement>(`[data-panel-toggle="${panel}"]`).forEach((toggle) => {
    toggle.classList.toggle("inactive", !state.panels[panel]);
    toggle.classList.toggle("active", state.panels[panel]);
    toggle.setAttribute("aria-pressed", String(state.panels[panel]));
  });
  if (panel === "browser") document.querySelector(".browser-rail button")?.classList.toggle("active", state.panels.browser);
}));
function rollbackToTimelineIndex(index: number): void {
  if (!documentReady) return;
  const features = adapter.getSnapshot().features;
  const feature = features[Math.max(0, Math.min(features.length - 1, index))];
  if (!feature) return;
  state.selectedFeatureId = feature.id;
  renderDocument();
  worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "after", feature: feature.id } });
}
document.querySelector("#history-start")!.addEventListener("click", () => rollbackToTimelineIndex(0));
document.querySelector("#history-back")!.addEventListener("click", () => {
  if (!documentReady) return;
  const features = adapter.getSnapshot().features;
  rollbackToTimelineIndex(Math.max(0, features.findIndex((feature) => feature.id === state.selectedFeatureId) - 1));
});
document.querySelector("#history-forward")!.addEventListener("click", () => {
  if (!documentReady) return;
  const features = adapter.getSnapshot().features;
  const current = features.findIndex((feature) => feature.id === state.selectedFeatureId);
  if (current >= features.length - 1) worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "end" } });
  else rollbackToTimelineIndex(current + 1);
});
document.querySelector("#history-end")!.addEventListener("click", () => { if (documentReady) worker?.postMessage({ type: "timeline-rollback", rollback: { kind: "end" } }); });
document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((button) => button.addEventListener("click", () => {
  if (!modelingRuntimeReady()) {
    showActionError("Export", "The model runtime is not ready for export");
    return;
  }
  if (!hasExportableBody()) {
    showActionError("Export", "Create or import a body before exporting STEP, STL, or OBJ.");
    return;
  }
  worker?.postMessage({ type: "export", format: button.dataset.export as ExportFormat });
}));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeManagedDialog) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeManagedDialog(activeManagedDialog);
    return;
  }
  if (event.key === "Escape" && !toolbarCustomizePanel.hidden) {
    event.preventDefault();
    closeToolbarCustomization();
    return;
  }
  const parametersDialog = document.querySelector<HTMLElement>("#parameters-dialog")!;
  if (event.key === "Escape" && !parametersDialog.hidden) { event.preventDefault(); event.stopImmediatePropagation(); closeParametersDialog(); return; }
  if (event.key === "Escape" && (!viewportContextMenu.hidden || !treeContextMenu.hidden)) { event.preventDefault(); viewportContextMenu.hidden = true; treeContextMenu.hidden = true; return; }
  if (event.key === "Escape" && sketchSession && !sketchChoosingSupport && !activeSketchToolKey() && (hasSketchSelection() || selectedSketchConstraint)) {
    event.preventDefault();
    selectedSketchGeometry = [];
    selectedSketchPoints = [];
    selectedSketchSegments = [];
    sketchOriginSelected = false;
    selectedSketchConstraint = undefined;
    selectedSketchProfile = undefined;
    selectedSketchConstructionAxis = undefined;
    sketchProfileRepairMessage = undefined;
    sketchSolverStatus = "Selection cleared · no active tool";
    renderSketchOverlay();
    setSketchToolPhase("idle");
    renderActiveToolInspector();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommands(); return; }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); document.querySelector<HTMLButtonElement>("#undo")!.click(); return; }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); document.querySelector<HTMLButtonElement>("#redo")!.click(); return; }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); saveAsPortable(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void savePart(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newPortablePart(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); void openPortablePart(); return; }
  if ((event.key === "Delete" || event.key === "Backspace") && sketchSession && !(event.target as Element | null)?.closest("input, textarea, [contenteditable=true]")) {
    const commands: SketchCommand[] = selectedSketchConstraint
      ? [{ kind: "remove_constraint", constraint: selectedSketchConstraint }]
      : selectedSketchGeometry.map((geometry) => ({ kind: "remove_geometry", geometry } as SketchCommand));
    if (commands.length) {
      event.preventDefault();
      void sketchSession.applyAll(commands).then(() => {
        selectedSketchConstraint = undefined;
        selectedSketchGeometry = [];
        selectedSketchPoints = [];
        selectedSketchSegments = [];
        updateSketchStatus();
      });
      return;
    }
  }
  if (event.key === "Enter" && sketchSession && (pendingDimensionPlacement || pendingSketchEditPreview) && (event.target as Element | null)?.closest("button:not(#active-tool-finish):not(#active-tool-cancel)")) {
    event.preventDefault();
    void completeActiveSketchInvocation();
    return;
  }
  if (event.key === "Enter" && (event.target as Element | null)?.closest("button, input, select, textarea, a, [contenteditable=true]")) return;
  if (event.key === "Enter" && state.operation.status === "preview") {
    if (state.operation.type === "sketch") { event.preventDefault(); void completeActiveSketchInvocation(); return; }
    if (state.operation.type === "rectangle") {
      commitRectanglePreview();
    } else if (state.operation.type === "pad") {
      commitExtrudePreview();
    } else if (state.operation.type === "construction-plane") {
      commitOffsetConstructionPlane();
    } else if (state.operation.type === "advanced" && selectedCatalogOperationId && isAdvancedFeatureOperation(selectedCatalogOperationId)) executeCatalogOperation(operationById(selectedCatalogOperationId));
  }
  if (event.key === "Escape" && state.operation.status === "preview") {
    if (state.operation.type === "sketch") { event.preventDefault(); void backOutOfSketch(); return; }
    if (state.operation.type === "pad") { event.preventDefault(); cancelExtrudePreview(); return; }
    if (state.operation.type === "construction-plane") { event.preventDefault(); cancelOffsetConstructionPlane(); return; }
    if (state.operation.type === "advanced") {
      event.preventDefault();
      cancelAdvancedFeaturePreview();
      selectedCatalogOperationId = null;
      renderInspector();
      document.querySelector<HTMLButtonElement>("#command-button")?.focus();
      return;
    }
    const trigger = state.operation.type === "rectangle" ? "#start-rectangle" : state.operation.type === "parameter" ? "#inspector [data-apply-parameter]" : "#command-button";
    selectedCatalogOperationId = null;
    setOperation("cancelled"); renderInspector(); document.querySelector<HTMLButtonElement>(trigger)?.focus();
  }
});

syncSketchToolUi();
adapter = await loadDocumentAdapter();
const durableChecksum = adapter.checksum();
setReadiness("ui", "ready");
renderDocument();
const onboardingHost = document.querySelector<HTMLElement>("#onboarding")!;
onboarding = installOnboarding(onboardingHost, { autoStart: qualificationReferencePart });
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
  durableDocument: () => structuredClone(adapter.durableDocument()),
  hydrateDocument: (document: unknown) => worker?.postMessage({ type: "hydrate-document", documentJson: JSON.stringify(document) }),
  geometryBounds: () => [...currentBounds],
  recompute: () => structuredClone(lastRecompute),
  recomputeOutcome: () => lastRecomputeOutcome ? structuredClone(lastRecomputeOutcome) : undefined,
  selectFirst: (kind: TopologyKind, additive = false) => renderer?.selectFirst(kind, additive) ?? null,
  selectTopology: (kind: TopologyKind, stableId: string) => {
    const selection = renderer?.topologySelectionByStableId(kind, stableId) ?? null;
    applySelection(selection);
    return selection;
  },
  cameraPosition: () => renderer?.cameraPosition() ?? [],
  projectionMode: () => renderer?.projectionMode() ?? "perspective",
  viewportSnapshot: () => renderer?.viewportSnapshot(),
  rendererPacketResources: () => renderer?.packetResourceState(),
  rendererTopologyFingerprint: () => renderer?.packetTopologyFingerprint() ?? "",
  cutRemovalPreviewState: () => renderer?.cutRemovalPreviewState(),
  constructionPlaneRendererState: () => renderer?.constructionPlaneState() ?? [],
  constructionPlanes: () => adapter.getSnapshot().components.flatMap((component) => component.constructionPlanes).map((plane) => ({ ...plane })),
  constructionPlaneEditState: () => activeOffsetConstructionPlane ? structuredClone(activeOffsetConstructionPlane) : undefined,
  viewportProbeAt: (clientX: number, clientY: number) => renderer?.viewportProbeAt(clientX, clientY) ?? {},
  committedSketchCount: () => renderer?.committedSketchCount() ?? 0,
  committedSketchState: () => renderer?.committedSketchState() ?? [],
  sketchPlane: () => activeSketchPlane ? structuredClone(activeSketchPlane) : undefined,
  sketchSupportSelection: () => ({ active: sketchChoosingSupport, surfacesVisible: renderer?.isSketchSupportSelectionActive() ?? false }),
  selectedSketchSupport: () => selectedSketchSupport ? structuredClone(selectedSketchSupport) : undefined,
  extrudeSelectionContext: () => ({
    selectedFeatureId: state.selectedFeatureId,
    ...(selectedSketchId ? { selectedSketchId } : {}),
    ...(selectedSketchProfile ? { selectedProfile: structuredClone(selectedSketchProfile) } : {}),
  }),
  chooseOriginSketchSupport: (plane: "xy" | "xz" | "yz") => handleSketchSupportPick({ kind: "origin_plane", plane }),
  chooseConstructionSketchSupport: (plane: string) => handleSketchSupportPick({ kind: "construction_plane", plane }),
  choosePlanarFaceSketchSupport: (selection?: Selection) => {
    const face = selection?.kind === "face" ? selection : renderer?.selectFirst("face") ?? undefined;
    if (face?.kind === "face") handleSketchSupportPick({ kind: "face", selection: face });
  },
  sketchSolverContract: () => sketchBridge?.solverContract(),
  sketchDecomposition: () => {
    const sketch = sketchSession?.draft ?? hydrateSketchFromDocument(adapter.durableDocument(), selectedSketchId)?.sketch;
    return sketch && sketchBridge ? sketchBridge.decompose(sketch) : undefined;
  },
  sketchDraft: () => sketchSession ? structuredClone(sketchSession.draft) : undefined,
  sketchSolve: () => sketchSession?.solve ? structuredClone(sketchSession.solve) : undefined,
  sketchAutoConstraintAudit: () => structuredClone(sketchAutoConstraintAudit),
  applySketchCommands: async (commands: readonly SketchCommand[]) => {
    if (!sketchSession || !activeSketchPlane) throw new Error("Open a resolved sketch before applying sketch commands");
    const totalStartedAt = performance.now();
    const solverStartedAt = performance.now();
    await sketchSession.applyAll(commands);
    const solverMs = performance.now() - solverStartedAt;
    const workerRecord = sketchBridge?.performanceSnapshot().filter((record) => record.type === "apply-sketch-commands" && record.outcome === "resolved").at(-1);
    const workerRuntimeMs = workerRecord?.workerRuntimeMs ?? 0;
    const bridgeOverheadMs = Math.max(0, solverMs - workerRuntimeMs);
    const enginePhases = workerRecord?.enginePhases;
    const diagnosticsStartedAt = performance.now();
    await sketchSession.diagnosticsReady();
    const diagnosticsMs = performance.now() - diagnosticsStartedAt;
    if (sketchDiagnosticsRenderFrame !== undefined) {
      cancelAnimationFrame(sketchDiagnosticsRenderFrame);
      sketchDiagnosticsRenderFrame = undefined;
    }
    const overlayStartedAt = performance.now();
    updateSketchStatus();
    const overlayMs = performance.now() - overlayStartedAt;
    const inspectorStartedAt = performance.now();
    renderActiveToolInspector();
    const inspectorMs = performance.now() - inspectorStartedAt;
    const stablePaintStartedAt = performance.now();
    await waitForStableBrowserPaint();
    const stablePaintMs = performance.now() - stablePaintStartedAt;
    const draft = sketchSession.draftView;
    return {
      totalMs: performance.now() - totalStartedAt,
      solverMs,
      workerRuntimeMs,
      bridgeOverheadMs,
      requestParseMs: enginePhases?.requestParseMs ?? 0,
      applyBatchMs: enginePhases?.applyBatchMs ?? 0,
      ezpzSolveMs: enginePhases?.solveMs ?? 0,
      profileBuildMs: enginePhases?.profileMs ?? 0,
      documentHashMs: enginePhases?.documentHashMs ?? 0,
      wasmBoundaryAndSerializeMs: workerRecord?.wasmBoundaryAndSerializeMs ?? 0,
      responseParseMs: workerRecord?.responseParseMs ?? 0,
      diagnosticsMs,
      overlayMs,
      inspectorMs,
      stablePaintMs,
      geometryCount: Object.keys(draft.geometry).length,
      constraintCount: Object.keys(draft.constraints).length,
      profileCount: sketchSession.profile?.closed_profiles.length ?? 0,
      solveComponentCount: sketchSession.solve?.solve_components?.length ?? 0,
      solveState: sketchSession.solve?.state ?? ("idle" as const),
    };
  },
  sketchDxfRoundTrip: async (sketchId: string, dxf: string) => {
    if (!sketchBridge) throw new Error("Sketch runtime is not ready");
    const imported = await sketchBridge.importDxf(sketchId, dxf);
    return { ...imported, normalized: await sketchBridge.exportDxf(imported.sketch) };
  },
  hasExplicitSave: async () => storage?.hasExplicitSave((adapter.durableDocument() as { id: string }).id) ?? false,
  pwaStatus: () => pwaStatus(),
  onboarding: () => onboarding.state(),
  safeMode: () => safeMode,
  recoveryProvenance: () => recoveryProvenance,
  recoveryChoices: () => structuredClone(recoveryChoices),
  parameters: () => structuredClone(currentParameters),
  historyServices: () => ({ services: structuredClone(featureServices), repair: structuredClone(repairInspection), message: historyActionMessage }),
  observedTopology: () => structuredClone(currentObservedTopology()),
  topologyRebindPreview: () => structuredClone(topologyRebindPreview),
  inspectRepair: (observedTopology: readonly TopologyReferenceView[]) => requestFeatureServices(observedTopology),
  commitDocumentChanges: (changes: readonly Record<string, unknown>[]) => worker?.postMessage({ type: "commit-document-changes", transactionId: `transaction:${crypto.randomUUID()}:integration`, changes }),
  performanceEvidence: () => performanceEvidence.snapshot(),
  sketchRenderIndexCounters: () => sketchRenderIndexCache.counters(),
  sketchPointerRenderCounters: () => ({
    ...sketchPointerRenderCoordinator.counters(),
    pointerFrames: sketchPointerFrames.counters(),
    dynamicClasses: { ...sketchDynamicClassCounters },
  }),
  offsetPerformanceCounters: () => structuredClone(offsetPerformanceRecords),
  sketchBridgePerformance: () => sketchBridge?.performanceSnapshot() ?? [],
  themeStatus: () => themeManager.status(),
  faultWorker: (message = "forced runtime fault") => worker?.postMessage({ type: "force-fault", message }),
  simulateQuotaFailure: () => storageFailure(new DOMException("quota exhausted", "QuotaExceededError")),
};

window.__crawlerApp = api;
