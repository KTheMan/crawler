import * as THREE from "three";

import { PickKind, type PickResult, type TransferableRenderPacket } from "./protocol";

interface PickRecord {
  token: number;
  kind: 1 | 2 | 3;
  stableId: string;
}

export class PacketRenderer {
  readonly backend = "webgl2" as const;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly faceMesh: THREE.Mesh;
  private readonly edgeObjects: THREE.LineSegments[] = [];
  private readonly vertexObjects: THREE.Points[] = [];
  private readonly faceRanges: Uint32Array;
  private readonly pickTable = new Map<number, PickRecord>();
  private readonly defaultFaceMaterial = new THREE.MeshStandardMaterial({
    color: 0x5f89c8,
    metalness: 0.05,
    roughness: 0.62,
    side: THREE.DoubleSide,
  });
  private readonly selectedFaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb447,
    metalness: 0,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  private previousFaceGroup: number | undefined;
  private previousEdge: THREE.LineSegments | undefined;
  private previousVertex: THREE.Points | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    packet: TransferableRenderPacket,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a101a, 1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x203050, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 5, 6);
    this.scene.add(key);

    packet.pickTable.forEach((_, index) => {
      if (index % 4 !== 0) return;
      const token = packet.pickTable[index];
      const low = packet.pickTable[index + 2];
      const high = packet.pickTable[index + 3];
      this.pickTable.set(token, {
        token,
        kind: packet.pickTable[index + 1] as 1 | 2 | 3,
        stableId: ((BigInt(high) << 32n) | BigInt(low)).toString(),
      });
    });

    this.faceRanges = packet.faceRanges;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(packet.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(packet.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(packet.triangleIndices, 1));
    for (let offset = 0; offset < packet.faceRanges.length; offset += 3) {
      geometry.addGroup(packet.faceRanges[offset], packet.faceRanges[offset + 1], 0);
    }
    this.faceMesh = new THREE.Mesh(geometry, [this.defaultFaceMaterial, this.selectedFaceMaterial]);
    this.faceMesh.name = "faces";
    this.scene.add(this.faceMesh);

    for (let offset = 0; offset < packet.edgeRanges.length; offset += 3) {
      const first = packet.edgeRanges[offset];
      const count = packet.edgeRanges[offset + 1];
      const token = packet.edgeRanges[offset + 2];
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(packet.edgePositions.subarray(first * 3, (first + count) * 3), 3),
      );
      const edge = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: 0xe5efff }),
      );
      edge.userData.pickToken = token;
      this.edgeObjects.push(edge);
      this.scene.add(edge);
    }

    for (let index = 0; index < packet.vertexPickTokens.length; index += 1) {
      const vertexGeometry = new THREE.BufferGeometry();
      vertexGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(packet.vertexPositions.subarray(index * 3, index * 3 + 3), 3),
      );
      const vertex = new THREE.Points(
        vertexGeometry,
        new THREE.PointsMaterial({ color: 0xf5fbff, size: 0.055, sizeAttenuation: true }),
      );
      vertex.userData.pickToken = packet.vertexPickTokens[index];
      this.vertexObjects.push(vertex);
      this.scene.add(vertex);
    }

    this.raycaster.params.Line = { threshold: 0.035 };
    this.raycaster.params.Points = { threshold: 0.055 };
    this.camera.position.set(2.7, 2.4, 2.9);
    this.camera.lookAt(0.5, 0.5, 0.5);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.render();
  }

  pickAt(x: number, y: number): PickResult | null {
    const start = performance.now();
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((x - bounds.left) / bounds.width) * 2 - 1,
      -((y - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const vertexHit = this.raycaster.intersectObjects(this.vertexObjects, false)[0];
    const edgeHit = this.raycaster.intersectObjects(this.edgeObjects, false)[0];
    const faceHit = this.raycaster.intersectObject(this.faceMesh, false)[0];
    let token = 0;
    if (
      vertexHit &&
      (!edgeHit || vertexHit.distance <= edgeHit.distance + 0.025) &&
      (!faceHit || vertexHit.distance <= faceHit.distance + 0.04)
    ) {
      token = vertexHit.object.userData.pickToken as number;
      this.highlightVertex(vertexHit.object as THREE.Points);
    } else if (edgeHit && (!faceHit || edgeHit.distance <= faceHit.distance + 0.04)) {
      token = edgeHit.object.userData.pickToken as number;
      this.highlightEdge(edgeHit.object as THREE.LineSegments);
    } else if (faceHit?.faceIndex != null) {
      const indexOffset = faceHit.faceIndex * 3;
      for (let offset = 0; offset < this.faceRanges.length; offset += 3) {
        const first = this.faceRanges[offset];
        const count = this.faceRanges[offset + 1];
        if (indexOffset >= first && indexOffset < first + count) {
          token = this.faceRanges[offset + 2];
          this.highlightFace(offset / 3);
          break;
        }
      }
    }
    this.render();
    const record = this.pickTable.get(token);
    return record
      ? { ...record, latencyMs: performance.now() - start }
      : null;
  }

  scanForKinds(): {
    face: PickResult | null;
    edge: PickResult | null;
    vertex: PickResult | null;
  } {
    const bounds = this.canvas.getBoundingClientRect();
    let face: PickResult | null = null;
    let edge: PickResult | null = null;
    let vertex: PickResult | null = null;
    for (let row = 1; row < 40 && (!face || !edge || !vertex); row += 1) {
      for (let column = 1; column < 40 && (!face || !edge || !vertex); column += 1) {
        const result = this.pickAt(
          bounds.left + (bounds.width * column) / 40,
          bounds.top + (bounds.height * row) / 40,
        );
        if (result?.kind === PickKind.Face) face = result;
        if (result?.kind === PickKind.Edge) edge = result;
        if (result?.kind === PickKind.Vertex) vertex = result;
      }
    }
    return { face, edge, vertex };
  }

  sampleFrames(count: number): Promise<number[]> {
    return new Promise((resolve) => {
      const samples: number[] = [];
      let previous = performance.now();
      const frame = (now: number) => {
        samples.push(now - previous);
        previous = now;
        this.faceMesh.rotation.y += 0.004;
        this.edgeObjects.forEach((edge) => {
          edge.rotation.y = this.faceMesh.rotation.y;
        });
        this.vertexObjects.forEach((vertex) => {
          vertex.rotation.y = this.faceMesh.rotation.y;
        });
        this.render();
        if (samples.length >= count) resolve(samples);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  private highlightFace(group: number): void {
    if (this.previousFaceGroup !== undefined) {
      this.faceMesh.geometry.groups[this.previousFaceGroup].materialIndex = 0;
    }
    this.faceMesh.geometry.groups[group].materialIndex = 1;
    this.previousFaceGroup = group;
    this.resetEdgeHighlight();
    this.resetVertexHighlight();
  }

  private highlightEdge(edge: THREE.LineSegments): void {
    this.resetEdgeHighlight();
    (edge.material as THREE.LineBasicMaterial).color.setHex(0xffb447);
    this.previousEdge = edge;
    this.resetVertexHighlight();
  }

  private highlightVertex(vertex: THREE.Points): void {
    this.resetVertexHighlight();
    (vertex.material as THREE.PointsMaterial).color.setHex(0xffb447);
    (vertex.material as THREE.PointsMaterial).size = 0.085;
    this.previousVertex = vertex;
    this.resetEdgeHighlight();
  }

  private resetEdgeHighlight(): void {
    if (this.previousEdge) {
      (this.previousEdge.material as THREE.LineBasicMaterial).color.setHex(0xe5efff);
      this.previousEdge = undefined;
    }
  }

  private resetVertexHighlight(): void {
    if (this.previousVertex) {
      (this.previousVertex.material as THREE.PointsMaterial).color.setHex(0xf5fbff);
      (this.previousVertex.material as THREE.PointsMaterial).size = 0.055;
      this.previousVertex = undefined;
    }
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
