import * as THREE from "three";

import type { RenderPacket, Selection, TopologyKind } from "./protocol";

const kindByCode: Record<number, TopologyKind> = { 1: "face", 2: "edge", 3: "vertex" };

export interface RenderBodyContext {
  readonly id: string;
  readonly visible: boolean;
  readonly selectable: boolean;
}

export class WorkspaceRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(38, 1, 0.001, 10_000);
  private cameraProjection: "perspective" | "orthographic" = "perspective";
  private readonly target = new THREE.Vector3();
  private modelRadius = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly faceMesh: THREE.Mesh;
  private readonly edges: THREE.LineSegments[] = [];
  private readonly vertices: THREE.Points[] = [];
  private readonly faceRanges: Uint32Array;
  private readonly records = new Map<number, Omit<Selection, "bodyId">>();
  private body: RenderBodyContext;
  private filters: Record<TopologyKind, boolean> = { body: true, face: true, edge: true, vertex: true };
  private drag: { x: number; y: number; button: number; moved: boolean } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    packet: RenderPacket,
    body: RenderBodyContext,
    private readonly onSelection: (selection: Selection | null, additive: boolean) => void,
    private readonly onPreselection: (selection: Selection | null) => void,
  ) {
    this.body = body;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0c111b, 1);
    const boundsMin = new THREE.Vector3(packet.bounds[0], packet.bounds[1], packet.bounds[2]);
    const boundsMax = new THREE.Vector3(packet.bounds[3], packet.bounds[4], packet.bounds[5]);
    this.target.copy(boundsMin).add(boundsMax).multiplyScalar(0.5);
    this.modelRadius = Math.max(boundsMin.distanceTo(boundsMax) * 0.5, 0.001);
    this.configureCameraClipping();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x22324a, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.6);
    light.position.set(4, 5, 6);
    this.scene.add(light);

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
    this.faceMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x6c93cf, roughness: 0.62, side: THREE.DoubleSide }));
    this.scene.add(this.faceMesh);

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
    this.installNavigation();
    this.standardView("isometric");
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.applyBodyVisibility();
  }

  setFilters(filters: Record<TopologyKind, boolean>): void { this.filters = { ...filters }; }

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

  pickAt(clientX: number, clientY: number, additive = false): Selection | null {
    const selection = this.resolveAt(clientX, clientY);
    this.onSelection(selection, additive);
    return selection;
  }

  standardView(view: "front" | "top" | "right" | "isometric"): void {
    const directions = {
      front: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      isometric: new THREE.Vector3(1, 0.82, 1.08).normalize(),
    } as const;
    this.camera.position.copy(this.target).addScaledVector(directions[view], this.modelRadius * 3.6);
    this.camera.lookAt(this.target);
    if (this.camera instanceof THREE.OrthographicCamera) this.camera.zoom = 1;
    this.render();
  }

  fit(): void { this.standardView("isometric"); }
  cameraPosition(): number[] { return this.camera.position.toArray(); }
  bodyId(): string { return this.body.id; }
  projectionMode(): "perspective" | "orthographic" { return this.cameraProjection; }

  setProjection(mode: "perspective" | "orthographic"): void {
    if (mode === this.cameraProjection) return;
    const next = mode === "perspective"
      ? new THREE.PerspectiveCamera(38, 1, 0.001, 10_000)
      : new THREE.OrthographicCamera(-2, 2, 2, -2, 0.001, 10_000);
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    next.up.copy(this.camera.up);
    this.camera = next;
    this.cameraProjection = mode;
    this.configureCameraClipping();
    this.resize();
  }
  dispose(): void { this.renderer.dispose(); }

  private installNavigation(): void {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => { this.drag = { x: event.clientX, y: event.clientY, button: event.button, moved: false }; this.canvas.setPointerCapture(event.pointerId); });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) {
        const selection = this.resolveAt(event.clientX, event.clientY);
        this.showPreselection(selection);
        this.onPreselection(selection);
        return;
      }
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) >= 2) this.drag.moved = true;
      this.drag.x = event.clientX; this.drag.y = event.clientY;
      if (this.drag.button === 0) {
        const offset = this.camera.position.clone().sub(this.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta -= dx * 0.008;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * 0.008, 0.08, Math.PI - 0.08);
        this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(spherical));
      } else {
        const scale = this.camera.position.distanceTo(this.target) * 0.0015;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0).multiplyScalar(-dx * scale);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1).multiplyScalar(dy * scale);
        this.camera.position.add(right).add(up); this.target.add(right).add(up);
      }
      this.camera.lookAt(this.target); this.render();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.drag && !this.drag.moved) this.pickAt(event.clientX, event.clientY, event.shiftKey || event.ctrlKey || event.metaKey);
      this.drag = null;
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.showPreselection(null);
      this.onPreselection(null);
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const scale = Math.exp(event.deltaY * 0.001);
      if (this.camera instanceof THREE.OrthographicCamera) {
        this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom / scale, 0.05, 100);
        this.camera.updateProjectionMatrix();
      } else {
        this.camera.position.copy(this.target).add(this.camera.position.clone().sub(this.target).multiplyScalar(scale));
      }
      this.render();
    }, { passive: false });
  }

  private showPreselection(selection: Selection | null): void {
    const faceMaterial = this.faceMesh.material as THREE.MeshStandardMaterial;
    faceMaterial.color.setHex(selection?.kind === "body" ? 0x4f78b5 : selection?.kind === "face" ? 0x8bb8ff : 0x6c93cf);
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

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth); const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = aspect;
    else {
      const halfHeight = this.modelRadius * 1.35;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
    }
    this.camera.updateProjectionMatrix(); this.render();
  }

  private configureCameraClipping(): void {
    this.camera.near = Math.max(this.modelRadius / 10_000, 0.000_001);
    this.camera.far = Math.max(this.modelRadius * 1_000, 10);
    this.camera.updateProjectionMatrix();
  }
  private applyBodyVisibility(): void {
    this.faceMesh.visible = this.body.visible;
    for (const edge of this.edges) edge.visible = this.body.visible;
    for (const vertex of this.vertices) vertex.visible = this.body.visible;
    this.render();
  }
  private render(): void { this.renderer.render(this.scene, this.camera); }
}
