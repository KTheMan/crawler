import * as THREE from "three";
import { ViewportGizmo } from "three-viewport-gizmo";

import type { RenderPacket, Selection, TopologyKind } from "./protocol";
import { viewportGridMetrics, viewportModelRadius, viewportPointerAction, wheelZoomScale, type ViewportPointerAction } from "./renderer-navigation";
import { intersectRayWithSketchPlane, planarFaceEvidenceKey, planeLocalToWorldMillimeters, type CurrentPlanarFaceEvidence, type CurrentPlanarFaceEvidenceLookup, type ResolvedSketchPlane } from "./sketch-plane";
import type { Point2, Sketch } from "./sketch-editor";
import { committedSketchWorldPolylines } from "./sketch-display";
import { DemandRenderScheduler } from "./renderer-demand";
import {
  ViewportStateController,
  type ViewportModelView,
  type ViewportSnapshot,
  type ViewportWorkingSketchFrame,
} from "./viewport-state";

const kindByCode: Record<number, TopologyKind> = { 1: "face", 2: "edge", 3: "vertex" };
const SELECTION_DRAG_THRESHOLD_PX = 5;

export interface RenderBodyContext {
  readonly id: string;
  readonly visible: boolean;
  readonly selectable: boolean;
}

export type SketchSupportPick =
  | { kind: "origin_plane"; plane: "xy" | "xz" | "yz" }
  | { kind: "face"; selection: Selection };

export type PlanarFaceEvidence = {
  centroid_nanometers: [number, number, number];
  normal_millionths: [number, number, number];
  area_square_nanometers: number;
};

export type WorkspaceViewState = ViewportModelView;

export type CommittedSketchDisplay = {
  id: string;
  plane: ResolvedSketchPlane;
  sketch: Sketch;
  selected?: boolean;
  visible?: boolean;
};

export class WorkspaceRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(38, 1, 0.001, 10_000);
  private readonly viewportState: ViewportStateController;
  private readonly unsubscribeViewportState: () => void;
  private modelRadius = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly eventController = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly pointer = new THREE.Vector2();
  private readonly faceMesh: THREE.Mesh;
  private readonly faceMaterial = new THREE.MeshStandardMaterial({ color: 0x6c93cf, roughness: 0.62, side: THREE.DoubleSide });
  private readonly baseFaceColor = new THREE.Color(0x6c93cf);
  private readonly grid: THREE.GridHelper;
  private readonly edges: THREE.LineSegments[] = [];
  private readonly vertices: THREE.Points[] = [];
  private readonly faceRanges: Uint32Array;
  private readonly sketchSupportGroup = new THREE.Group();
  private readonly sketchSupportPlanes: THREE.Mesh[] = [];
  private readonly committedSketchGroup = new THREE.Group();
  private sketchSupportSelection = false;
  private sketchSupportListener: ((pick: SketchSupportPick) => void) | undefined;
  private readonly records = new Map<number, Omit<Selection, "bodyId">>();
  private body: RenderBodyContext;
  private filters: Record<TopologyKind, boolean> = { body: true, face: true, edge: true, vertex: true };
  private drag: { pointerId: number; x: number; y: number; action: ViewportPointerAction; moved: boolean } | null = null;
  private viewCube?: ViewportGizmo;
  private viewCubeInteracting = false;
  private readonly renderScheduler: DemandRenderScheduler;
  private displayMode: "shaded-edges" | "shaded" | "wireframe" | "hidden-line" | "no-shading" = "shaded-edges";
  private viewChanged: () => void = () => {};
  private readonly modelGridPosition = new THREE.Vector3();
  private readonly modelGridQuaternion = new THREE.Quaternion();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    packet: RenderPacket,
    body: RenderBodyContext,
    private readonly onSelection: (selection: Selection | null, additive: boolean) => void,
    private readonly onPreselection: (selection: Selection | null) => void,
    sharedViewportState?: ViewportStateController,
  ) {
    this.body = body;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderScheduler = new DemandRenderScheduler(
      () => this.drawFrame(),
      () => this.viewCubeInteracting || Boolean(this.viewCube?.animating),
    );
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0c111b, 1);
    const hasBounds = packet.bounds.length >= 6;
    const boundsMin = hasBounds
      ? new THREE.Vector3(packet.bounds[0], packet.bounds[1], packet.bounds[2])
      : new THREE.Vector3();
    const boundsMax = hasBounds
      ? new THREE.Vector3(packet.bounds[3], packet.bounds[4], packet.bounds[5])
      : new THREE.Vector3();
    const initialTarget = boundsMin.clone().add(boundsMax).multiplyScalar(0.5);
    this.modelRadius = viewportModelRadius(boundsMin.distanceTo(boundsMax));
    const initialPosition = initialTarget.clone().addScaledVector(new THREE.Vector3(1, 0.82, 1.08).normalize(), this.modelRadius * 3.6);
    this.camera.position.copy(initialPosition);
    this.camera.lookAt(initialTarget);
    this.viewportState = sharedViewportState ?? new ViewportStateController({
      cameraPose: { position: initialPosition.toArray(), orientation: this.camera.quaternion.toArray() },
      projection: { kind: "perspective", verticalFieldOfViewDegrees: 38, near: Math.max(this.modelRadius / 10_000, 0.000_001), far: Math.max(this.modelRadius * 1_000, 10) },
      pivot: { point: initialTarget.toArray() },
      workingSketchFrame: null,
      navigationMode: "model",
    });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x22324a, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.6);
    light.position.set(4, 5, 6);
    this.scene.add(light);
    const gridMetrics = viewportGridMetrics(this.modelRadius);
    this.grid = new THREE.GridHelper(gridMetrics.size, gridMetrics.divisions, 0x27384d, 0x182331);
    this.grid.position.y = boundsMin.y;
    this.modelGridPosition.copy(this.grid.position);
    this.modelGridQuaternion.copy(this.grid.quaternion);
    this.scene.add(this.grid);
    this.committedSketchGroup.renderOrder = 3;
    this.scene.add(this.committedSketchGroup);

    for (let offset = 0; offset < packet.pickTable.length; offset += 4) {
      const token = packet.pickTable[offset];
      const kind = kindByCode[packet.pickTable[offset + 1]];
      const stableId = ((BigInt(packet.pickTable[offset + 3]) << 32n) | BigInt(packet.pickTable[offset + 2])).toString();
      this.records.set(token, { token, kind, stableId });
    }
    this.faceRanges = packet.faceRanges;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(packet.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(packet.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(packet.triangleIndices, 1));
    for (let offset = 0; offset < packet.faceRanges.length; offset += 3) geometry.addGroup(packet.faceRanges[offset], packet.faceRanges[offset + 1], 0);
    this.faceMesh = new THREE.Mesh(geometry, this.faceMaterial);
    this.scene.add(this.faceMesh);
    this.createOriginPlaneSurfaces();

    for (let offset = 0; offset < packet.edgeRanges.length; offset += 3) {
      const first = packet.edgeRanges[offset];
      const count = packet.edgeRanges[offset + 1];
      const item = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(packet.edgePositions.subarray(first * 3, (first + count) * 3), 3)),
        new THREE.LineBasicMaterial({ color: 0xe8f0ff }),
      );
      item.userData.pickToken = packet.edgeRanges[offset + 2];
      this.edges.push(item);
      this.scene.add(item);
    }
    for (let index = 0; index < packet.vertexPickTokens.length; index += 1) {
      const item = new THREE.Points(
        new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(packet.vertexPositions.subarray(index * 3, index * 3 + 3), 3)),
        new THREE.PointsMaterial({ color: 0xffffff, size: this.modelRadius * 0.07, sizeAttenuation: true }),
      );
      item.userData.pickToken = packet.vertexPickTokens[index];
      this.vertices.push(item);
      this.scene.add(item);
    }
    this.raycaster.params.Line = { threshold: this.modelRadius * 0.04 };
    this.raycaster.params.Points = { threshold: this.modelRadius * 0.065 };
    this.unsubscribeViewportState = this.viewportState.subscribe((snapshot) => this.applyViewportState(snapshot), true);
    this.installNavigation();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.applyBodyVisibility();
  }

  setFilters(filters: Record<TopologyKind, boolean>): void { this.filters = { ...filters }; }

  setSketchSlice(plane: ResolvedSketchPlane | undefined, enabled: boolean): void {
    const clipping = enabled && plane ? [new THREE.Plane(
      new THREE.Vector3(...plane.normal_millionths).normalize(),
      -new THREE.Vector3(...plane.normal_millionths).normalize().dot(new THREE.Vector3(...plane.origin_nanometers).multiplyScalar(1 / 1_000_000)),
    )] : [];
    this.renderer.localClippingEnabled = clipping.length > 0;
    this.faceMaterial.clippingPlanes = clipping;
    for (const edge of this.edges) (edge.material as THREE.Material).clippingPlanes = clipping;
    this.render();
  }

  /** Render accepted sketches in their durable 3D planes outside the editor. */
  setCommittedSketches(sketches: readonly CommittedSketchDisplay[], editingSketchId?: string): void {
    for (const child of [...this.committedSketchGroup.children]) {
      this.committedSketchGroup.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
    for (const display of sketches) {
      if (display.id === editingSketchId) continue;
      const group = new THREE.Group();
      group.name = `Committed sketch ${display.id}`;
      group.userData.sketchId = display.id;
      group.visible = display.visible !== false;
      const polylines = committedSketchWorldPolylines(display.sketch, display.plane);
      group.userData.polylineCount = polylines.length;
      group.userData.pointCount = polylines.reduce((count, polyline) => count + polyline.points.length, 0);
      for (const polyline of polylines) {
          const color = display.selected ? 0xffd166 : polyline.construction ? 0x7ba9db : 0x8b9bea;
          const positions = polyline.points.map((point) => new THREE.Vector3(...point));
          if (positions.length < 2) continue;
          const geometry = new THREE.BufferGeometry().setFromPoints(positions);
          const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: display.selected ? 1 : 0.9, depthTest: false });
          const line = new THREE.Line(geometry, material);
          line.renderOrder = 3;
          group.add(line);
      }
      this.committedSketchGroup.add(group);
    }
    this.render();
  }

  committedSketchCount(): number { return this.committedSketchGroup.children.length; }

  committedSketchState(): { id: string; visible: boolean; polylineCount: number; pointCount: number }[] {
    return this.committedSketchGroup.children.map((group) => ({
      id: String(group.userData.sketchId ?? ""),
      visible: group.visible,
      polylineCount: Number(group.userData.polylineCount ?? 0),
      pointCount: Number(group.userData.pointCount ?? 0),
    }));
  }

  edgePolyline(token: number): [number, number, number][] {
    const edge = this.edges.find((candidate) => candidate.userData.pickToken === token);
    const positions = edge?.geometry.getAttribute("position");
    if (!positions) return [];
    return Array.from({ length: positions.count }, (_, index) => [positions.getX(index), positions.getY(index), positions.getZ(index)] as [number, number, number]);
  }

  edgePolylineByStableId(stableId: string, bodyId?: string): [number, number, number][] {
    if (bodyId && bodyId !== this.body.id) return [];
    const token = [...this.records.values()].find((record) => record.kind === "edge" && record.stableId === stableId)?.token;
    return token === undefined ? [] : this.edgePolyline(token);
  }

  topologySelections(kind: TopologyKind): Selection[] {
    return [...this.records.values()]
      .filter((record) => record.kind === kind)
      .map((record) => ({ ...record, bodyId: this.body.id }));
  }

  topologySelectionByStableId(kind: TopologyKind, stableId: string): Selection | undefined {
    if (kind === "body" && stableId === this.body.id) return { kind, stableId, token: 0, bodyId: this.body.id };
    return this.topologySelections(kind).find((selection) => selection.stableId === stableId);
  }

  vertexPoint(token: number): [number, number, number] | undefined {
    const vertex = this.vertices.find((candidate) => candidate.userData.pickToken === token);
    const positions = vertex?.geometry.getAttribute("position");
    return positions?.count ? [positions.getX(0), positions.getY(0), positions.getZ(0)] : undefined;
  }

  /** Boundary polylines for a selected planar face, derived from exact packet edges. */
  planarFaceBoundaryPolylines(selection: Selection): [number, number, number][][] {
    const evidence = this.planarFaceEvidence(selection);
    if (!evidence) return [];
    const origin = new THREE.Vector3(...evidence.centroid_nanometers).multiplyScalar(1 / 1_000_000);
    const normal = new THREE.Vector3(...evidence.normal_millionths).normalize();
    const tolerance = Math.max(this.modelRadius * 1e-5, 1e-6);
    const faceVertices = this.faceVertices(selection.token);
    const belongsToFace = (point: [number, number, number]) => faceVertices.some((vertex) => vertex.distanceTo(new THREE.Vector3(...point)) <= tolerance);
    return this.topologySelections("edge").map((edge) => this.edgePolyline(edge.token)).filter((points) =>
      points.length >= 2 && points.every((point) => Math.abs(normal.dot(new THREE.Vector3(...point).sub(origin))) <= tolerance)
      && belongsToFace(points[0]) && belongsToFace(points.at(-1)!));
  }

  /** Show selectable datum planes without changing the camera or grid. */
  setSketchSupportSelection(enabled: boolean, listener?: (pick: SketchSupportPick) => void): void {
    this.sketchSupportSelection = enabled;
    this.sketchSupportListener = enabled ? listener : undefined;
    this.sketchSupportGroup.visible = enabled;
    if (!enabled) this.highlightSketchSupport(undefined);
    this.render();
  }

  isSketchSupportSelectionActive(): boolean { return this.sketchSupportSelection; }

  setViewChangedListener(listener: () => void): void { this.viewChanged = listener; }

  sharedViewportState(): ViewportStateController { return this.viewportState; }

  viewportSnapshot(): ViewportSnapshot { return this.viewportState.snapshot(); }

  viewportProbeAt(clientX: number, clientY: number): { world?: [number, number, number]; local?: Point2 } {
    const world = this.navigationPointAt(clientX, clientY);
    const local = this.sketchPointAt(clientX, clientY);
    return { ...(world ? { world: world.toArray() } : {}), ...(local ? { local } : {}) };
  }

  setBackground(color: string): void {
    this.renderer.setClearColor(new THREE.Color(color), 1);
    this.render();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.render();
  }

  setDisplayMode(mode: "shaded-edges" | "shaded" | "wireframe" | "hidden-line" | "no-shading"): void {
    this.displayMode = mode;
    this.faceMaterial.wireframe = false;
    this.faceMaterial.roughness = mode === "no-shading" ? 1 : 0.62;
    this.faceMaterial.metalness = 0;
    this.faceMaterial.opacity = mode === "hidden-line" ? 0.18 : 1;
    this.faceMaterial.transparent = mode === "hidden-line";
    this.applyBodyVisibility();
  }

  setAppearance(color: string, opacity: number, edgesVisible: boolean): void {
    this.baseFaceColor.set(color);
    this.faceMaterial.color.copy(this.baseFaceColor);
    this.faceMaterial.opacity = THREE.MathUtils.clamp(opacity, 0.05, 1);
    this.faceMaterial.transparent = this.faceMaterial.opacity < 1;
    for (const edge of this.edges) edge.userData.appearanceVisible = edgesVisible;
    this.applyBodyVisibility();
  }

  attachViewCube(container: HTMLElement): void {
    this.viewCube?.dispose();
    this.viewCubeInteracting = false;
    const viewCube = new ViewportGizmo(this.camera, this.renderer, {
      container,
      type: "cube",
      size: 92,
      placement: "bottom-right",
      animated: true,
      speed: 1,
      lineWidth: 2,
      background: {
        enabled: true,
        color: 0x111827,
        opacity: 1,
        hover: { color: 0x172033, opacity: 1 },
      },
    });
    this.viewCube = viewCube;
    viewCube.target.fromArray(this.viewportState.snapshot().pivot.point);
    viewCube.addEventListener("start", () => {
      if (this.viewCube !== viewCube) return;
      this.viewCubeInteracting = true;
      this.render();
    });
    viewCube.addEventListener("change", () => {
      if (this.viewCube !== viewCube) return;
      this.viewportState.setCameraPose({ position: this.camera.position.toArray(), orientation: this.camera.quaternion.toArray() });
    });
    viewCube.addEventListener("end", () => {
      if (this.viewCube !== viewCube) return;
      this.viewCubeInteracting = false;
      this.viewportState.setCameraPose({ position: this.camera.position.toArray(), orientation: this.camera.quaternion.toArray() });
    });
    this.render();
  }

  setBodyContext(body: RenderBodyContext): void {
    this.body = body;
    this.applyBodyVisibility();
    if (!body.selectable) {
      this.showPreselection(null);
      this.onPreselection(null);
    }
  }

  selectFirst(kind: TopologyKind, additive = false): Selection | null {
    if (!this.filters[kind]) return null;
    if (!this.body.selectable) return null;
    const record = kind === "body" ? { kind: "body" as const, stableId: this.body.id, token: 0 } : [...this.records.values()].find((candidate) => candidate.kind === kind);
    const selection = record ? { ...record, bodyId: this.body.id } : null;
    this.onSelection(selection, additive);
    return selection;
  }

  private resolveAt(clientX: number, clientY: number): Selection | null {
    if (!this.body.visible || !this.body.selectable) return null;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let token = 0;
    const vertex = this.filters.vertex ? this.raycaster.intersectObjects(this.vertices, false)[0] : undefined;
    const edge = this.filters.edge ? this.raycaster.intersectObjects(this.edges, false)[0] : undefined;
    const surface = this.filters.face || this.filters.body ? this.raycaster.intersectObject(this.faceMesh, false)[0] : undefined;
    const face = this.filters.face ? surface : undefined;
    if (vertex && (!edge || vertex.distance <= edge.distance + 0.025) && (!face || vertex.distance <= face.distance + 0.04)) token = vertex.object.userData.pickToken as number;
    else if (edge && (!face || edge.distance <= face.distance + 0.04)) token = edge.object.userData.pickToken as number;
    else if (typeof face?.faceIndex === "number") {
      const indexOffset = face.faceIndex * 3;
      for (let offset = 0; offset < this.faceRanges.length; offset += 3) {
        if (indexOffset >= this.faceRanges[offset] && indexOffset < this.faceRanges[offset] + this.faceRanges[offset + 1]) { token = this.faceRanges[offset + 2]; break; }
      }
    }
    const record = this.records.get(token) ?? (this.filters.body && surface ? { kind: "body" as const, stableId: this.body.id, token: 0 } : null);
    return record ? { ...record, bodyId: this.body.id } : null;
  }

  private faceSelectionFromIntersection(intersection: THREE.Intersection | undefined): Selection | undefined {
    if (typeof intersection?.faceIndex !== "number") return undefined;
    const indexOffset = intersection.faceIndex * 3;
    let token = 0;
    for (let offset = 0; offset < this.faceRanges.length; offset += 3) {
      if (indexOffset >= this.faceRanges[offset] && indexOffset < this.faceRanges[offset] + this.faceRanges[offset + 1]) {
        token = this.faceRanges[offset + 2];
        break;
      }
    }
    const record = this.records.get(token);
    return record?.kind === "face" ? { ...record, bodyId: this.body.id } : undefined;
  }

  private resolveSketchSupportAt(clientX: number, clientY: number): SketchSupportPick | undefined {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    this.pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const planeIntersection = this.raycaster.intersectObjects(this.sketchSupportPlanes, false)[0];
    const plane = (planeIntersection?.object as THREE.Mesh | undefined)?.userData.originPlane as "xy" | "xz" | "yz" | undefined;
    // A visible planar model face wins only when it is actually in front of the datum surface.
    if (this.body.visible && this.body.selectable) {
      const faceIntersection = this.raycaster.intersectObject(this.faceMesh, false)[0];
      const face = this.faceSelectionFromIntersection(faceIntersection);
      if (face && this.faceTokenIsPlanar(face.token) && (!planeIntersection || faceIntersection.distance <= planeIntersection.distance)) {
        return { kind: "face", selection: face };
      }
    }
    return plane ? { kind: "origin_plane", plane } : undefined;
  }

  pickAt(clientX: number, clientY: number, additive = false): Selection | null {
    const selection = this.resolveAt(clientX, clientY);
    this.onSelection(selection, additive);
    return selection;
  }

  standardView(view: "front" | "back" | "top" | "bottom" | "left" | "right" | "isometric"): void {
    const directions = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      isometric: new THREE.Vector3(1, 0.82, 1.08).normalize(),
    } as const;
    const pivot = new THREE.Vector3(...this.viewportState.snapshot().pivot.point);
    const position = pivot.clone().addScaledVector(directions[view], this.modelRadius * 3.6);
    const up = Math.abs(directions[view].y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    this.viewportState.update({ cameraPose: this.lookAtPose(position, pivot, up), navigationMode: "model", workingSketchFrame: null });
  }

  fit(): void { this.standardView("isometric"); }
  cameraPosition(): number[] { return this.camera.position.toArray(); }
  bodyId(): string { return this.body.id; }
  projectionMode(): "perspective" | "orthographic" { return this.viewportState.snapshot().projection.kind; }

  captureView(): WorkspaceViewState {
    const { cameraPose, projection, pivot, workingSketchFrame, navigationMode } = this.viewportState.snapshot();
    return { cameraPose, projection, pivot, workingSketchFrame, navigationMode };
  }

  restoreView(state: WorkspaceViewState): void {
    this.viewportState.replaceState(state);
    this.viewportState.clearSavedModelView();
  }

  /** Convert a viewport pointer ray into deterministic plane-local nanometers. */
  sketchPointAt(clientX: number, clientY: number, plane = this.resolvedWorkingSketchPlane()): Point2 | undefined {
    if (!plane) return undefined;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    this.pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    return intersectRayWithSketchPlane(
      [ray.origin.x, ray.origin.y, ray.origin.z],
      [ray.direction.x, ray.direction.y, ray.direction.z],
      plane,
    );
  }

  /** Project solved plane-local geometry into viewport-relative CSS pixels. */
  sketchPointToScreen(point: Point2, plane = this.resolvedWorkingSketchPlane()): { x: number; y: number } | undefined {
    if (!plane) return undefined;
    const world = planeLocalToWorldMillimeters(point, plane);
    const projected = new THREE.Vector3(...world).project(this.camera);
    if (![projected.x, projected.y, projected.z].every(Number.isFinite) || projected.z < -1 || projected.z > 1) return undefined;
    const bounds = this.canvas.getBoundingClientRect();
    return { x: (projected.x + 1) * bounds.width / 2, y: (1 - projected.y) * bounds.height / 2 };
  }

  /** Enter a normal-to sketch view while preserving the user's prior camera. */
  alignToSketchPlane(plane: ResolvedSketchPlane): void {
    const before = this.viewportState.snapshot();
    if (!before.savedModelView && before.navigationMode === "model") this.viewportState.saveModelView();
    const origin = new THREE.Vector3(...plane.origin_nanometers.map((value) => value / 1_000_000) as [number, number, number]);
    const xAxis = new THREE.Vector3(...plane.x_axis_millionths.map((value) => value / 1_000_000) as [number, number, number]).normalize();
    const yAxis = new THREE.Vector3(...plane.y_axis_millionths.map((value) => value / 1_000_000) as [number, number, number]).normalize();
    const normal = new THREE.Vector3(...plane.normal_millionths.map((value) => value / 1_000_000) as [number, number, number]).normalize();
    const current = this.viewportState.snapshot();
    const currentPivot = new THREE.Vector3(...current.pivot.point);
    const distance = Math.max(this.camera.position.distanceTo(currentPivot), this.modelRadius * 3.6);
    const position = origin.clone().addScaledVector(normal, distance);
    const frame: ViewportWorkingSketchFrame = { origin: origin.toArray(), xAxis: xAxis.toArray(), yAxis: yAxis.toArray(), normal: normal.toArray() };
    this.viewportState.update({
      cameraPose: this.lookAtPose(position, origin, yAxis),
      projection: { kind: "orthographic", viewHeight: current.projection.kind === "orthographic" ? current.projection.viewHeight : this.modelRadius * 2.7, near: Math.max(this.modelRadius / 10_000, 0.000_001), far: Math.max(this.modelRadius * 1_000, 10) },
      pivot: { point: origin.toArray(), anchor: { kind: "sketch-support", key: JSON.stringify(plane.support) } },
      workingSketchFrame: frame,
      navigationMode: "sketch",
    });
  }

  restoreSketchView(): void {
    this.viewportState.restoreModelView();
  }

  /** Kernel IDs whose current render triangles provide coplanarity evidence. */
  planarFaceKernelIds(): ReadonlySet<string> {
    const result = new Set<string>();
    for (const record of this.records.values()) {
      if (record.kind === "face" && this.faceTokenIsPlanar(record.token)) result.add(record.stableId);
    }
    return result;
  }

  planarFaceEvidenceMap(): CurrentPlanarFaceEvidenceLookup {
    const result = new Map<string, CurrentPlanarFaceEvidence>();
    for (const selection of this.topologySelections("face")) {
      const evidence = this.planarFaceEvidence(selection);
      if (!evidence) continue;
      const current: CurrentPlanarFaceEvidence = { body: selection.bodyId, stable_kernel_id: selection.stableId, ...evidence };
      result.set(planarFaceEvidenceKey(selection.bodyId, selection.stableId), current);
    }
    return result;
  }

  planarFaceEvidence(selection: Selection): PlanarFaceEvidence | undefined {
    if (selection.kind !== "face") return undefined;
    const vertices = this.faceVertices(selection.token);
    if (vertices.length < 3 || !this.faceTokenIsPlanar(selection.token)) return undefined;
    let area = 0;
    const centroid = new THREE.Vector3();
    let normal: THREE.Vector3 | undefined;
    for (let index = 0; index + 2 < vertices.length; index += 3) {
      const a = vertices[index]; const b = vertices[index + 1]; const c = vertices[index + 2];
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      const triangleArea = cross.length() * 0.5;
      if (triangleArea <= 0) continue;
      normal ??= cross.normalize();
      area += triangleArea;
      centroid.add(a.clone().add(b).add(c).multiplyScalar(triangleArea / 3));
    }
    if (!normal || area <= 0) return undefined;
    centroid.multiplyScalar(1 / area);
    const integers = (value: THREE.Vector3, scale: number) => value.toArray().map((component) => Math.round(component * scale)) as [number, number, number];
    return {
      centroid_nanometers: integers(centroid, 1_000_000),
      normal_millionths: integers(normal, 1_000_000),
      area_square_nanometers: Math.round(area * 1_000_000_000_000),
    };
  }

  /** Match a picked planar face to a durable fallback plane when kernel IDs were remapped. */
  faceMatchesReferencePlane(selection: Selection, centroidNanometers: readonly number[], normalMillionths: readonly number[], areaSquareNanometers?: number): boolean {
    if (selection.kind !== "face" || centroidNanometers.length !== 3 || normalMillionths.length !== 3) return false;
    const vertices = this.faceVertices(selection.token);
    if (!vertices.length || !this.faceTokenIsPlanar(selection.token)) return false;
    const origin = new THREE.Vector3(centroidNanometers[0], centroidNanometers[1], centroidNanometers[2]).multiplyScalar(1 / 1_000_000);
    const referenceNormal = new THREE.Vector3(normalMillionths[0], normalMillionths[1], normalMillionths[2]).normalize();
    const faceNormal = vertices[1]?.clone().sub(vertices[0]).cross(vertices[2]?.clone().sub(vertices[0]) ?? new THREE.Vector3()).normalize();
    if (!faceNormal || Math.abs(faceNormal.dot(referenceNormal)) < 0.999_999) return false;
    const tolerance = Math.max(this.modelRadius * 1e-6, 1e-6);
    if (!vertices.every((vertex) => Math.abs(referenceNormal.dot(vertex.clone().sub(origin))) <= tolerance)) return false;
    let area = 0;
    const centroid = new THREE.Vector3();
    for (let index = 0; index + 2 < vertices.length; index += 3) {
      const a = vertices[index]; const b = vertices[index + 1]; const c = vertices[index + 2];
      const triangleArea = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
      if (triangleArea <= 0) continue;
      area += triangleArea;
      centroid.add(a.clone().add(b).add(c).multiplyScalar(triangleArea / 3));
    }
    if (area <= 0) return false;
    centroid.multiplyScalar(1 / area);
    if (centroid.distanceTo(origin) > Math.max(this.modelRadius * 1e-5, 1e-5)) return false;
    const expectedAreaSquareMillimeters = areaSquareNanometers === undefined ? undefined : areaSquareNanometers / 1_000_000_000_000;
    return expectedAreaSquareMillimeters === undefined || Math.abs(area - expectedAreaSquareMillimeters) <= Math.max(expectedAreaSquareMillimeters * 1e-5, 1e-8);
  }

  setProjection(mode: "perspective" | "orthographic"): void {
    const snapshot = this.viewportState.snapshot();
    const current = snapshot.projection;
    if (mode === current.kind) return;
    const near = current.near;
    const far = current.far;
    const position = new THREE.Vector3(...snapshot.cameraPose.position);
    const pivot = new THREE.Vector3(...snapshot.pivot.point);
    const distance = Math.max(position.distanceTo(pivot), near * 2);
    if (mode === "orthographic" && current.kind === "perspective") {
      this.viewportState.setProjection({ kind: "orthographic", viewHeight: 2 * distance * Math.tan(THREE.MathUtils.degToRad(current.verticalFieldOfViewDegrees) / 2), near, far });
      return;
    }
    if (mode === "perspective" && current.kind === "orthographic") {
      const fov = 38;
      const equivalentDistance = current.viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
      const direction = position.sub(pivot).normalize();
      this.viewportState.update({
        cameraPose: this.lookAtPose(pivot.clone().addScaledVector(direction, equivalentDistance), pivot, this.camera.up),
        projection: { kind: "perspective", verticalFieldOfViewDegrees: fov, near, far },
      });
    }
  }
  dispose(): void {
    this.unsubscribeViewportState();
    this.renderScheduler.dispose();
    this.eventController.abort();
    this.resizeObserver.disconnect();
    this.viewCube?.dispose();
    this.viewCube = undefined;
    this.renderer.dispose();
  }

  private installNavigation(): void {
    const signal = this.eventController.signal;
    const navigationSurface = this.canvas.parentElement ?? this.canvas;
    const isViewportTarget = (target: EventTarget | null) => target === this.canvas
      || (target instanceof Element && Boolean(target.closest("#sketch-overlay")));
    const endCameraDrag = (event: PointerEvent) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId || this.drag.action === "select") return;
      event.preventDefault();
      event.stopPropagation();
      this.drag = null;
      const snapshot = this.viewportState.snapshot();
      if (snapshot.navigationMode === "temporary-orbit" && snapshot.workingSketchFrame) this.viewportState.setNavigationMode("sketch");
      if (navigationSurface.hasPointerCapture(event.pointerId)) navigationSurface.releasePointerCapture(event.pointerId);
    };

    navigationSurface.addEventListener("contextmenu", (event) => {
      if (isViewportTarget(event.target)) event.preventDefault();
    }, { capture: true, signal });
    navigationSurface.addEventListener("auxclick", (event) => {
      if (event.button === 1 && isViewportTarget(event.target)) event.preventDefault();
    }, { capture: true, signal });
    navigationSurface.addEventListener("pointerdown", (event) => {
      const action = viewportPointerAction(event.button, event.ctrlKey, event.metaKey);
      if (!isViewportTarget(event.target) || (action !== "orbit" && action !== "pan")) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "orbit") {
        const point = this.navigationPointAt(event.clientX, event.clientY);
        const snapshot = this.viewportState.snapshot();
        this.viewportState.update({
          ...(point ? { pivot: { point: point.toArray() } } : {}),
          navigationMode: snapshot.workingSketchFrame ? "temporary-orbit" : "model",
        });
      }
      this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, action, moved: false };
      navigationSurface.setPointerCapture(event.pointerId);
    }, { capture: true, signal });
    navigationSurface.addEventListener("pointermove", (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId || this.drag.action === "select") return;
      event.preventDefault();
      event.stopPropagation();
      const previousX = this.drag.x;
      const previousY = this.drag.y;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) >= 2) this.drag.moved = true;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      const snapshot = this.viewportState.snapshot();
      const pivot = new THREE.Vector3(...snapshot.pivot.point);
      const position = new THREE.Vector3(...snapshot.cameraPose.position);
      if (this.drag.action === "orbit") {
        const up = snapshot.workingSketchFrame
          ? new THREE.Vector3(...snapshot.workingSketchFrame.yAxis).normalize()
          : new THREE.Vector3(0, 1, 0);
        const offset = position.sub(pivot).applyAxisAngle(up, -dx * 0.008);
        const right = new THREE.Vector3().crossVectors(up, offset).normalize();
        const pitched = offset.clone().applyAxisAngle(right, -dy * 0.008);
        if (Math.abs(pitched.clone().normalize().dot(up)) < 0.997) offset.copy(pitched);
        const nextPosition = pivot.clone().add(offset);
        this.viewportState.setCameraPose(this.lookAtPose(nextPosition, pivot, up));
      } else {
        let translation: THREE.Vector3;
        const plane = this.resolvedWorkingSketchPlane();
        const previousLocal = plane ? this.sketchPointAt(previousX, previousY, plane) : undefined;
        const currentLocal = plane ? this.sketchPointAt(event.clientX, event.clientY, plane) : undefined;
        if (plane && previousLocal && currentLocal) {
          const previousWorld = new THREE.Vector3(...planeLocalToWorldMillimeters(previousLocal, plane));
          const currentWorld = new THREE.Vector3(...planeLocalToWorldMillimeters(currentLocal, plane));
          translation = previousWorld.sub(currentWorld);
        } else {
          const height = Math.max(1, this.canvas.clientHeight);
          const worldPerPixel = snapshot.projection.kind === "orthographic"
            ? snapshot.projection.viewHeight / height
            : 2 * position.distanceTo(pivot) * Math.tan(THREE.MathUtils.degToRad(snapshot.projection.verticalFieldOfViewDegrees) / 2) / height;
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(-dx * worldPerPixel);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(dy * worldPerPixel);
          translation = right.add(up);
        }
        this.viewportState.update({
          cameraPose: { ...snapshot.cameraPose, position: position.add(translation).toArray() },
          pivot: { point: pivot.add(translation).toArray() },
        });
      }
    }, { capture: true, signal });
    navigationSurface.addEventListener("pointerup", endCameraDrag, { capture: true, signal });
    navigationSurface.addEventListener("pointercancel", endCameraDrag, { capture: true, signal });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (viewportPointerAction(event.button, event.ctrlKey, event.metaKey) !== "select") return;
      this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, action: "select", moved: false };
      this.canvas.setPointerCapture(event.pointerId);
    }, { signal });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) {
        if (this.sketchSupportSelection) {
          const pick = this.resolveSketchSupportAt(event.clientX, event.clientY);
          this.highlightSketchSupport(pick?.kind === "origin_plane" ? pick.plane : undefined);
          const selection = pick?.kind === "face" ? pick.selection : null;
          this.showPreselection(selection);
          this.onPreselection(selection);
          return;
        }
        const selection = this.resolveAt(event.clientX, event.clientY);
        this.showPreselection(selection);
        this.onPreselection(selection);
        return;
      }
      if (this.drag.action !== "select") return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) >= SELECTION_DRAG_THRESHOLD_PX) this.drag.moved = true;
    }, { signal });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.drag?.pointerId === event.pointerId && this.drag.action === "select" && !this.drag.moved) {
        const pickX = this.drag.x;
        const pickY = this.drag.y;
        if (this.sketchSupportSelection) {
          const pick = this.resolveSketchSupportAt(pickX, pickY);
          if (pick) this.sketchSupportListener?.(pick);
        } else this.pickAt(pickX, pickY, event.shiftKey || event.ctrlKey || event.metaKey);
      }
      if (this.drag?.pointerId === event.pointerId && this.drag.action === "select") {
        this.drag = null;
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      }
    }, { signal });
    this.canvas.addEventListener("pointercancel", (event) => {
      if (this.drag?.pointerId === event.pointerId && this.drag.action === "select") this.drag = null;
    }, { signal });
    this.canvas.addEventListener("pointerleave", () => {
      this.showPreselection(null);
      this.onPreselection(null);
    }, { signal });
    navigationSurface.addEventListener("wheel", (event) => {
      if (!isViewportTarget(event.target)) return;
      event.preventDefault();
      const scale = wheelZoomScale(event.deltaY, event.deltaMode, this.canvas.clientHeight);
      const snapshot = this.viewportState.snapshot();
      const anchor = this.navigationPointAt(event.clientX, event.clientY) ?? new THREE.Vector3(...snapshot.pivot.point);
      if (snapshot.projection.kind === "orthographic") {
        const nextHeight = THREE.MathUtils.clamp(snapshot.projection.viewHeight * scale, this.modelRadius * 0.002, this.modelRadius * 200);
        this.viewportState.setProjection({ ...snapshot.projection, viewHeight: nextHeight });
        const afterZoomPoint = this.navigationPointAt(event.clientX, event.clientY);
        if (afterZoomPoint) {
          const translation = anchor.clone().sub(afterZoomPoint);
          const zoomed = this.viewportState.snapshot();
          this.viewportState.update({
            cameraPose: { ...zoomed.cameraPose, position: new THREE.Vector3(...zoomed.cameraPose.position).add(translation).toArray() },
            pivot: { point: new THREE.Vector3(...zoomed.pivot.point).add(translation).toArray() },
          });
        }
      } else {
        const offset = new THREE.Vector3(...snapshot.cameraPose.position).sub(anchor);
        const distance = offset.length();
        const defaultDistance = this.modelRadius * 3.6;
        const minDistance = Math.max(this.modelRadius * 1.05, this.camera.near * 4);
        const maxDistance = Math.max(this.modelRadius * 100, defaultDistance);
        if (!Number.isFinite(distance) || distance <= 0) {
          offset.set(1, 0.82, 1.08).normalize().multiplyScalar(defaultDistance);
        } else {
          offset.setLength(THREE.MathUtils.clamp(distance * scale, minDistance, maxDistance));
        }
        this.viewportState.update({
          cameraPose: { ...snapshot.cameraPose, position: anchor.clone().add(offset).toArray() },
          pivot: { point: anchor.toArray() },
        });
      }
    }, { capture: true, passive: false, signal });
  }

  private createOriginPlaneSurfaces(): void {
    const metrics = viewportGridMetrics(this.modelRadius);
    // Datum planes read more like selectable construction objects when they
    // occupy only their positive local quadrant and leave a visible channel
    // around the axes instead of intersecting at the origin.
    const size = metrics.originPlaneSize * 0.48;
    const axisGap = metrics.cellSize * 0.32;
    const positiveCenter = axisGap + size * 0.5;
    const definitions = [
      { plane: "xy", color: 0x4f8cff, rotation: [0, 0, 0], position: [positiveCenter, positiveCenter, 0] },
      { plane: "xz", color: 0x55c878, rotation: [Math.PI / 2, 0, 0], position: [positiveCenter, 0, positiveCenter] },
      { plane: "yz", color: 0xff6b6b, rotation: [0, -Math.PI / 2, 0], position: [0, positiveCenter, positiveCenter] },
    ] as const;
    for (const definition of definitions) {
      const geometry = new THREE.PlaneGeometry(size, size);
      const material = new THREE.MeshBasicMaterial({
        color: definition.color,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.rotation.set(definition.rotation[0], definition.rotation[1], definition.rotation[2]);
      plane.position.set(definition.position[0], definition.position[1], definition.position[2]);
      plane.userData.originPlane = definition.plane;
      plane.renderOrder = 4;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: definition.color, transparent: true, opacity: 0.82, depthTest: false }),
      );
      outline.userData.originPlaneOutline = true;
      outline.renderOrder = 5;
      plane.add(outline);
      this.sketchSupportPlanes.push(plane);
      this.sketchSupportGroup.add(plane);
    }
    const axisNegative = metrics.cellSize * 1.2;
    const axisPositive = axisGap + size + metrics.cellSize * 0.55;
    const axisPositions = new Float32Array([
      -axisNegative, 0, 0, axisPositive, 0, 0,
      0, -axisNegative, 0, 0, axisPositive, 0,
      0, 0, -axisNegative, 0, 0, axisPositive,
    ]);
    const axisColors = new Float32Array([
      1, 0.27, 0.27, 1, 0.27, 0.27,
      0.25, 0.9, 0.48, 0.25, 0.9, 0.48,
      0.3, 0.55, 1, 0.3, 0.55, 1,
    ]);
    const axes = new THREE.LineSegments(
      new THREE.BufferGeometry()
        .setAttribute("position", new THREE.BufferAttribute(axisPositions, 3))
        .setAttribute("color", new THREE.BufferAttribute(axisColors, 3)),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false }),
    );
    axes.name = "Origin plane intersections";
    axes.renderOrder = 6;
    this.sketchSupportGroup.add(axes);
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.018, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    origin.name = "Absolute origin";
    origin.renderOrder = 7;
    this.sketchSupportGroup.add(origin);
    this.sketchSupportGroup.visible = false;
    this.scene.add(this.sketchSupportGroup);
  }

  private highlightSketchSupport(plane: "xy" | "xz" | "yz" | undefined): void {
    for (const surface of this.sketchSupportPlanes) {
      const active = surface.userData.originPlane === plane;
      (surface.material as THREE.MeshBasicMaterial).opacity = active ? 0.25 : 0.09;
      const outline = surface.children[0] as THREE.LineSegments | undefined;
      if (outline) (outline.material as THREE.LineBasicMaterial).opacity = active ? 1 : 0.78;
    }
  }

  private faceTokenIsPlanar(token: number): boolean {
    const vertices = this.faceVertices(token);
    if (vertices.length < 3) return false;
    const origin = vertices[0];
    let normal: THREE.Vector3 | undefined;
    for (let index = 2; index < vertices.length && !normal; index += 1) {
      const candidate = vertices[index - 1].clone().sub(origin).cross(vertices[index].clone().sub(origin));
      if (candidate.lengthSq() > 1e-18) normal = candidate.normalize();
    }
    if (!normal) return false;
    const tolerance = Math.max(this.modelRadius * 1e-6, 1e-6);
    return vertices.every((vertex) => Math.abs(normal!.dot(vertex.clone().sub(origin))) <= tolerance);
  }

  private faceVertices(token: number): THREE.Vector3[] {
    let firstIndex = -1;
    let indexCount = 0;
    for (let offset = 0; offset < this.faceRanges.length; offset += 3) {
      if (this.faceRanges[offset + 2] === token) {
        firstIndex = this.faceRanges[offset];
        indexCount = this.faceRanges[offset + 1];
        break;
      }
    }
    if (firstIndex < 0 || indexCount < 3) return [];
    const geometry = this.faceMesh.geometry;
    const positions = geometry.getAttribute("position");
    const indices = geometry.getIndex();
    const vertices: THREE.Vector3[] = [];
    for (let offset = firstIndex; offset < firstIndex + indexCount; offset += 1) {
      const vertexIndex = indices ? indices.getX(offset) : offset;
      vertices.push(new THREE.Vector3(positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex)));
    }
    return vertices;
  }

  private showPreselection(selection: Selection | null): void {
    const faceMaterial = this.faceMesh.material as THREE.MeshStandardMaterial;
    faceMaterial.color.set(selection?.kind === "body" ? 0x4f78b5 : selection?.kind === "face" ? 0x8bb8ff : this.baseFaceColor);
    for (const edge of this.edges) {
      const highlighted = selection?.kind === "edge" && edge.userData.pickToken === selection.token;
      (edge.material as THREE.LineBasicMaterial).color.setHex(highlighted ? 0xffcf66 : 0xe8f0ff);
    }
    for (const vertex of this.vertices) {
      const highlighted = selection?.kind === "vertex" && vertex.userData.pickToken === selection.token;
      (vertex.material as THREE.PointsMaterial).color.setHex(highlighted ? 0xffcf66 : 0xffffff);
    }
    this.render();
  }

  private applyViewportState(snapshot: ViewportSnapshot): void {
    const wantsPerspective = snapshot.projection.kind === "perspective";
    if ((wantsPerspective && !(this.camera instanceof THREE.PerspectiveCamera))
        || (!wantsPerspective && !(this.camera instanceof THREE.OrthographicCamera))) {
      this.camera = wantsPerspective
        ? new THREE.PerspectiveCamera(snapshot.projection.kind === "perspective" ? snapshot.projection.verticalFieldOfViewDegrees : 38, 1, snapshot.projection.near, snapshot.projection.far)
        : new THREE.OrthographicCamera(-1, 1, 1, -1, snapshot.projection.near, snapshot.projection.far);
    }
    this.camera.position.fromArray(snapshot.cameraPose.position);
    this.camera.quaternion.fromArray(snapshot.cameraPose.orientation);
    this.camera.up.fromArray(snapshot.workingSketchFrame && snapshot.navigationMode !== "model"
      ? snapshot.workingSketchFrame.yAxis
      : [0, 1, 0]);
    this.camera.near = snapshot.projection.near;
    this.camera.far = snapshot.projection.far;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    if (this.camera instanceof THREE.PerspectiveCamera && snapshot.projection.kind === "perspective") {
      this.camera.fov = snapshot.projection.verticalFieldOfViewDegrees;
      this.camera.aspect = aspect;
    } else if (this.camera instanceof THREE.OrthographicCamera && snapshot.projection.kind === "orthographic") {
      const halfHeight = snapshot.projection.viewHeight * 0.5;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.zoom = 1;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const frame = snapshot.workingSketchFrame;
    if (frame) {
      const xAxis = new THREE.Vector3(...frame.xAxis);
      const yAxis = new THREE.Vector3(...frame.yAxis);
      const normal = new THREE.Vector3(...frame.normal);
      // GridHelper is authored in local XZ with +Y as its normal.
      this.grid.position.fromArray(frame.origin);
      this.grid.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, normal, yAxis.negate()));
    } else {
      this.grid.position.copy(this.modelGridPosition);
      this.grid.quaternion.copy(this.modelGridQuaternion);
    }
    if (this.viewCube) {
      this.viewCube.camera = this.camera;
      this.viewCube.target.fromArray(snapshot.pivot.point);
      this.viewCube.update();
    }
    this.render();
    this.viewChanged();
  }

  private lookAtPose(position: THREE.Vector3, pivot: THREE.Vector3, up: THREE.Vector3): ViewportModelView["cameraPose"] {
    const probe = new THREE.PerspectiveCamera();
    probe.position.copy(position);
    probe.up.copy(up).normalize();
    probe.lookAt(pivot);
    return { position: probe.position.toArray(), orientation: probe.quaternion.toArray() };
  }

  private resolvedWorkingSketchPlane(): ResolvedSketchPlane | undefined {
    const frame = this.viewportState.snapshot().workingSketchFrame;
    if (!frame) return undefined;
    const scaled = (value: readonly number[], scale: number) => value.map((component) => Math.round(component * scale)) as [number, number, number];
    return {
      support: { kind: "origin_plane", plane: "xy" },
      source: "construction_plane",
      origin_nanometers: scaled(frame.origin, 1_000_000),
      x_axis_millionths: scaled(frame.xAxis, 1_000_000),
      y_axis_millionths: scaled(frame.yAxis, 1_000_000),
      normal_millionths: scaled(frame.normal, 1_000_000),
    };
  }

  private navigationPointAt(clientX: number, clientY: number): THREE.Vector3 | undefined {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    this.pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = this.resolvedWorkingSketchPlane();
    if (plane) {
      const local = intersectRayWithSketchPlane(
        this.raycaster.ray.origin.toArray(),
        this.raycaster.ray.direction.toArray(),
        plane,
      );
      if (local) return new THREE.Vector3(...planeLocalToWorldMillimeters(local, plane));
    }
    if (this.body.visible) return this.raycaster.intersectObject(this.faceMesh, false)[0]?.point.clone();
    return undefined;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth); const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const projection = this.viewportState.snapshot().projection;
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = aspect;
    else {
      const halfHeight = projection.kind === "orthographic" ? projection.viewHeight * 0.5 : this.modelRadius * 1.35;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
    }
    this.camera.updateProjectionMatrix();
    this.viewCube?.domUpdate();
    this.render();
    this.viewChanged();
  }

  private configureCameraClipping(): void {
    const projection = this.viewportState.snapshot().projection;
    this.viewportState.setProjection({ ...projection, near: Math.max(this.modelRadius / 10_000, 0.000_001), far: Math.max(this.modelRadius * 1_000, 10) });
  }
  private applyBodyVisibility(): void {
    this.faceMesh.visible = this.body.visible && this.displayMode !== "wireframe";
    const displayEdges = this.displayMode !== "shaded" && this.displayMode !== "no-shading";
    for (const edge of this.edges) edge.visible = this.body.visible && displayEdges && edge.userData.appearanceVisible !== false;
    for (const vertex of this.vertices) vertex.visible = this.body.visible;
    this.render();
  }
  private render(): void {
    this.renderScheduler.invalidate();
  }
  private drawFrame(): void {
    this.renderer.render(this.scene, this.camera);
    this.viewCube?.cameraUpdate().render();
  }
}
