export type DurableFeatureType =
  | "origin"
  | "sketch"
  | "pad"
  | "revolve"
  | "boolean"
  | "boolean_union"
  | "boolean_cut"
  | "boolean_intersect"
  | "fillet"
  | "chamfer"
  | "shell"
  | "mirror"
  | "pattern"
  | "pattern_linear"
  | "pattern_circular"
  | "feature";

export type DurableFeatureStatus = "complete" | "suppressed" | "dirty" | "stale" | "failed";

export interface DurableFeature {
  readonly id: string;
  readonly type: DurableFeatureType;
  readonly name: string;
  readonly status: DurableFeatureStatus;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export type DurableBodyVisibility = "visible" | "hidden";

export interface DurableBody {
  readonly id: string;
  readonly name: string;
  readonly generatedBy: string;
  readonly visibility: DurableBodyVisibility;
  readonly status: DurableFeatureStatus;
}

export interface DurableSketch {
  readonly id: string;
  readonly name: string;
  readonly support: string;
  readonly featureId?: string;
}

export interface DurableOriginPlane {
  readonly id: string;
  readonly name: string;
}

export interface DurableComponent {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly childComponentIds: readonly string[];
  readonly bodies: readonly DurableBody[];
  readonly sketches: readonly DurableSketch[];
  readonly featureIds: readonly string[];
  readonly originPlanes: readonly DurableOriginPlane[];
}

export interface DurableDocumentSnapshot {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly name: string;
  readonly features: readonly DurableFeature[];
  readonly components: readonly DurableComponent[];
}

/** Port implemented by the generated crawler-part-runtime worker wrapper. */
export interface PartRuntimePort {
  documentJson(): string;
  semanticHash(): string;
}

const fixture: DurableDocumentSnapshot = Object.freeze({
  schemaVersion: 1,
  documentId: "document:part-alpha-001",
  name: "Bracket",
  features: Object.freeze([
    Object.freeze({ id: "origin", type: "origin", name: "Origin", status: "complete", parameters: Object.freeze({ planes: "XY, XZ, YZ" }) }),
    Object.freeze({ id: "feature:rectangle-sketch", type: "sketch", name: "Constrained Rectangle", status: "complete", parameters: Object.freeze({ profile: "4 elements", constraints: 5 }) }),
    Object.freeze({ id: "feature:extrude", type: "pad", name: "Extrude", status: "complete", parameters: Object.freeze({ distance: 12, width: 40, height: 28 }) }),
  ]),
  components: Object.freeze([
    Object.freeze({
      id: "component:root",
      name: "Bracket",
      childComponentIds: Object.freeze([]),
      bodies: Object.freeze([Object.freeze({ id: "body:part", name: "Part Body", generatedBy: "feature:extrude", visibility: "visible", status: "complete" })]),
      sketches: Object.freeze([Object.freeze({ id: "sketch:rectangle", name: "Rectangle", support: "XY", featureId: "feature:rectangle-sketch" })]),
      featureIds: Object.freeze(["feature:rectangle-sketch", "feature:extrude"]),
      originPlanes: Object.freeze([
        Object.freeze({ id: "origin-plane:xy", name: "XY plane" }),
        Object.freeze({ id: "origin-plane:xz", name: "XZ plane" }),
        Object.freeze({ id: "origin-plane:yz", name: "YZ plane" }),
      ]),
    }),
  ]),
});

interface SemanticParameter {
  display_name?: string;
  value?: { kind?: string; value?: number | string | boolean };
  expression?: { source?: string };
}

interface SemanticFeature {
  id?: string;
  display_name?: string;
  operation?: { schema_id?: string };
  parameters?: Record<string, string>;
  suppressed?: boolean;
  component?: string;
}

interface SemanticSketch {
  id?: string;
  display_name?: string;
  component?: string;
  elements?: unknown[];
  constraints?: unknown[];
  support?: { kind?: string; plane?: string };
}

interface SemanticComponent {
  id?: string;
  display_name?: string;
  parent?: string | null;
  child_components?: string[];
  body_order?: string[];
  sketch_order?: string[];
  feature_order?: string[];
}

interface SemanticBody {
  id?: string;
  display_name?: string;
  component?: string;
  generated_by?: string;
  visibility?: DurableBodyVisibility;
}

interface SemanticOriginPlane {
  id?: string;
  component?: string;
  plane?: string;
}

interface SemanticDocument {
  schema_version?: number;
  id: string;
  display_name?: string;
  root_component?: string;
  origin_planes?: Record<string, SemanticOriginPlane>;
  components?: Record<string, SemanticComponent>;
  bodies?: Record<string, SemanticBody>;
  sketches?: Record<string, SemanticSketch>;
  features?: Record<string, SemanticFeature>;
  parameters?: Record<string, SemanticParameter>;
  recompute?: { features?: Record<string, { status?: string } | string> };
}

function operationType(schemaId = ""): DurableFeatureType {
  if (schemaId.includes(".boolean.")) return `boolean_${schemaId.split(".").at(-1)}` as DurableFeatureType;
  if (schemaId.includes(".pattern.")) return `pattern_${schemaId.split(".").at(-1)}` as DurableFeatureType;
  const operation = schemaId.split(".").at(-1)?.replaceAll("-", "_") ?? "feature";
  if (operation === "extrude" || operation === "pad") return "pad";
  if (operation === "constrained_rectangle" || operation === "sketch") return "sketch";
  if (["revolve", "boolean", "fillet", "chamfer", "shell", "mirror", "pattern"].includes(operation)) return operation as DurableFeatureType;
  return "feature";
}

function parameterValue(parameter: SemanticParameter | undefined): string | number | boolean {
  if (!parameter) return "missing";
  if (parameter.expression?.source) return parameter.expression.source;
  const value = parameter.value?.value;
  if (typeof value === "number" && parameter.value?.kind === "length_nanometers") return value / 1_000_000;
  return value ?? "unset";
}

function featureStatus(document: SemanticDocument, featureId: string, feature: SemanticFeature): DurableFeatureStatus {
  if (feature.suppressed) return "suppressed";
  const recompute = document.recompute?.features?.[featureId];
  const status = typeof recompute === "string" ? recompute : recompute?.status;
  if (status === "dirty" || status === "stale" || status === "failed") return status;
  return "complete";
}

function orderedFeatureIds(document: SemanticDocument): string[] {
  const component = document.components?.[document.root_component ?? ""];
  const ordered = component?.feature_order ?? [];
  const remainder = Object.keys(document.features ?? {}).filter((id) => !ordered.includes(id)).sort();
  return [...ordered, ...remainder];
}

export class DocumentAdapter {
  constructor(private readonly snapshot: DurableDocumentSnapshot = fixture, private readonly semanticHash = JSON.stringify(snapshot), private readonly semanticDocument: unknown = snapshot) {}
  getSnapshot(): DurableDocumentSnapshot { return this.snapshot; }
  findFeature(id: string): DurableFeature | undefined { return this.snapshot.features.find((feature) => feature.id === id); }
  findBody(id: string): DurableBody | undefined { return this.snapshot.components.flatMap((component) => component.bodies).find((body) => body.id === id); }
  activeBody(): DurableBody | undefined {
    const bodies = this.snapshot.components.flatMap((component) => component.bodies);
    return [...bodies].reverse().find((body) => body.status !== "suppressed") ?? bodies.at(-1);
  }
  selectionAllowed(bodyId: string): boolean {
    const body = this.findBody(bodyId);
    return Boolean(body && body.visibility === "visible" && body.status === "complete" && this.activeBody()?.id === body.id);
  }
  checksum(): string { return this.semanticHash; }
  durableDocument(): unknown { return structuredClone(this.semanticDocument); }
}

export function adapterFromRuntime(runtime: PartRuntimePort): DocumentAdapter {
  return adapterFromWorkerSnapshot(runtime.documentJson(), runtime.semanticHash(), "{}");
}

export function adapterFromWorkerSnapshot(documentJson: string, semanticHash: string, _dimensionsJson: string): DocumentAdapter {
  const document = JSON.parse(documentJson) as SemanticDocument;
  const component = document.components?.[document.root_component ?? ""];
  const sketches = document.sketches ?? {};
  let sketchIndex = 0;
  const features: DurableFeature[] = [{
    id: "origin",
    type: "origin",
    name: "Origin",
    status: "complete",
    parameters: {
      planes: Object.values(document.origin_planes ?? {}).map((plane) => plane.plane?.toUpperCase()).filter(Boolean).join(", ") || "XY, XZ, YZ",
    },
  }];

  for (const featureId of orderedFeatureIds(document)) {
    const feature = document.features?.[featureId];
    if (!feature) continue;
    const type = operationType(feature.operation?.schema_id);
    const parameters: Record<string, string | number | boolean> = {};
    for (const [name, parameterId] of Object.entries(feature.parameters ?? {})) {
      parameters[name] = parameterValue(document.parameters?.[parameterId]);
    }
    if (type === "sketch") {
      const sketchId = component?.sketch_order?.[sketchIndex++] ?? Object.keys(sketches).sort()[sketchIndex - 1];
      const sketch = sketches[sketchId];
      parameters.profile = `${sketch?.elements?.length ?? 0} elements`;
      parameters.constraints = sketch?.constraints?.length ?? 0;
      parameters.support = sketch?.support?.plane?.toUpperCase() ?? sketch?.support?.kind ?? "unbound";
    }
    features.push({
      id: featureId,
      type,
      name: feature.display_name ?? featureId,
      status: featureStatus(document, featureId, feature),
      parameters,
    });
  }

  const selected = Object.freeze(features.map((feature) => Object.freeze({ ...feature, parameters: Object.freeze(feature.parameters) })));
  const featureById = new Map(selected.map((feature) => [feature.id, feature]));
  const componentRecords = document.components ?? {};
  const components = Object.entries(componentRecords).map(([componentId, component]) => {
    const orderedBodyIds = [...(component.body_order ?? []), ...Object.keys(document.bodies ?? {}).filter((id) => document.bodies?.[id]?.component === componentId && !(component.body_order ?? []).includes(id)).sort()];
    const orderedSketchIds = [...(component.sketch_order ?? []), ...Object.keys(sketches).filter((id) => sketches[id]?.component === componentId && !(component.sketch_order ?? []).includes(id)).sort()];
    const featureIds = [...(component.feature_order ?? []), ...Object.keys(document.features ?? {}).filter((id) => document.features?.[id]?.component === componentId && !(component.feature_order ?? []).includes(id)).sort()];
    const sketchFeatureIds = featureIds.filter((id) => featureById.get(id)?.type === "sketch");
    const bodies = orderedBodyIds.flatMap((bodyId) => {
      const body = document.bodies?.[bodyId];
      if (!body) return [];
      const producer = body.generated_by ?? "";
      return [{
        id: body.id ?? bodyId,
        name: body.display_name ?? bodyId,
        generatedBy: producer,
        visibility: body.visibility === "hidden" ? "hidden" as const : "visible" as const,
        status: producer ? (featureById.get(producer)?.status ?? "stale") : "stale" as const,
      }];
    });
    const componentSketches = orderedSketchIds.flatMap((sketchId, index) => {
      const sketch = sketches[sketchId];
      if (!sketch) return [];
      const support = sketch.support?.plane;
      const supportName = support ? document.origin_planes?.[support]?.plane?.toUpperCase() ?? support : sketch.support?.kind ?? "unbound";
      return [{ id: sketch.id ?? sketchId, name: sketch.display_name ?? sketchId, support: supportName, featureId: sketchFeatureIds[index] }];
    });
    const originPlanes = Object.entries(document.origin_planes ?? {}).filter(([, plane]) => plane.component === componentId).map(([planeId, plane]) => ({
      id: plane.id ?? planeId,
      name: `${plane.plane?.toUpperCase() ?? planeId} plane`,
    }));
    return Object.freeze({
      id: component.id ?? componentId,
      name: component.display_name ?? componentId,
      parentId: component.parent ?? undefined,
      childComponentIds: Object.freeze([...(component.child_components ?? [])]),
      bodies: Object.freeze(bodies.map((body) => Object.freeze(body))),
      sketches: Object.freeze(componentSketches.map((sketch) => Object.freeze(sketch))),
      featureIds: Object.freeze(featureIds),
      originPlanes: Object.freeze(originPlanes.map((plane) => Object.freeze(plane))),
    });
  });
  const view: DurableDocumentSnapshot = Object.freeze({
    schemaVersion: 1,
    documentId: document.id,
    name: document.display_name ?? "Part",
    features: selected,
    components: Object.freeze(components),
  });
  return new DocumentAdapter(view, semanticHash, document);
}

export async function loadDocumentAdapter(): Promise<DocumentAdapter> {
  await Promise.resolve();
  return new DocumentAdapter();
}
