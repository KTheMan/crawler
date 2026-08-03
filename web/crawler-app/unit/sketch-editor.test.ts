import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSTRAINT_SCHEMA,
  SKETCH_TOOL_SCHEMA,
  SketchEditSession,
  StableSketchIds,
  explicitFaceRebind,
  hydrateSketchFromDocument,
  rectangleCommands,
  resolveAttachment,
  selfIntersectionDiagnostics,
  updateDimensionBinding,
  type Sketch,
  type SketchRuntimeBridge,
} from "../src/sketch-editor.ts";

const empty = (): Sketch => ({ id: "sketch:test", revision: 0, geometry: {}, constraints: {} });

test("schema exposes alpha sketch tools and all ten constraints", () => {
  assert.deepEqual(SKETCH_TOOL_SCHEMA.map((tool) => tool.id), ["line", "circle", "arc", "rectangle", "trim", "construction"]);
  assert.equal(CONSTRAINT_SCHEMA.length, 10);
  assert.deepEqual(CONSTRAINT_SCHEMA, ["coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "equal", "distance", "radius", "angle"]);
});

test("rectangle expands to four stable connected lines with exact dimensions", () => {
  const commands = rectangleCommands(new StableSketchIds("sketch:test"), { x_nm: 5, y_nm: 10 }, { x_nm: 105, y_nm: 60 });
  const geometry = commands.filter((command) => command.kind === "add_geometry");
  const constraints = commands.filter((command) => command.kind === "add_constraint");
  assert.equal(geometry.length, 4);
  assert.equal(new Set(geometry.map((command) => command.kind === "add_geometry" && command.entity.id)).size, 4);
  assert.equal(constraints.filter((command) => command.kind === "add_constraint" && command.constraint.kind === "coincident").length, 4);
  assert.deepEqual(constraints.filter((command) => command.kind === "add_constraint" && command.constraint.kind === "distance").map((command) => command.kind === "add_constraint" && command.constraint.kind === "distance" && command.constraint.distance_nm), [100, 50]);
});

test("missing planar support blocks until an explicit ranked candidate is selected", () => {
  const face = (id: string, x: number) => ({ id, kind: "face" as const, stable_kernel_id: x, stable_token: id, fallback_signature: { kind: "face" as const, centroid_nanometers: [x, 0, 0] as [number, number, number], normal_millionths: [0, 0, 1_000_000] as [number, number, number], area_square_nanometers: 100 } });
  const state = resolveAttachment({ kind: "topology", reference: "face:missing" }, [face("face:far", 20), face("face:near", 2)], face("face:missing", 0));
  assert.equal(state.status, "missing_face");
  if (state.status !== "missing_face") return;
  assert.deepEqual(state.candidates.map((candidate) => candidate.id), ["face:near", "face:far"]);
  assert.throws(() => explicitFaceRebind(state, "face:unknown"));
  assert.deepEqual(explicitFaceRebind(state, "face:near"), { kind: "topology", reference: "face:near" });
});

test("invalid in-context dimension retains the last valid parameter expression", () => {
  const binding = { constraintId: "constraint:width", parameterId: "parameter:width", expression: "40 mm", lastValidExpression: "40 mm" };
  assert.deepEqual(updateDimensionBinding(binding, "width +", false, "unexpected token"), { ...binding, expression: "width +", error: "unexpected token" });
  assert.equal(updateDimensionBinding(binding, "42 mm", true).lastValidExpression, "42 mm");
});

test("crossing profile lines produce self-intersection diagnostics", () => {
  const sketch = empty();
  sketch.geometry.a = { id: "a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 10 } } };
  sketch.geometry.b = { id: "b", geometry: { kind: "line", start: { x_nm: 0, y_nm: 10 }, end: { x_nm: 10, y_nm: 0 } } };
  assert.deepEqual(selfIntersectionDiagnostics(sketch), [{ kind: "self_intersection", geometry: ["a", "b"] }]);
});

test("accepted semantic sketches hydrate geometry, constraints, support, and collision-free IDs", () => {
  const hydrated = hydrateSketchFromDocument({
    revision: 7,
    sketches: {
      "sketch:durable": {
        id: "sketch:durable",
        support: { kind: "topology", reference: "topology:face:42" },
        elements: [
          { kind: "point", id: "point:a", x_nanometers: 10, y_nanometers: 20 },
          { kind: "point", id: "point:b", x_nanometers: 110, y_nanometers: 20 },
          { kind: "line", id: "line:accepted", start_element: "point:a", end_element: "point:b" },
          { kind: "circle", id: "circle:accepted", center_nanometers: [40, 50], radius_nanometers: 12, construction: true },
        ],
        constraints: [
          { kind: "horizontal", id: "constraint:h", line: "line:accepted" },
          { kind: "distance_x", id: "constraint:width", start_point: "point:a", end_point: "point:b", parameter: "parameter:width" },
          { kind: "point_on_origin", id: "constraint:origin", point: "point:a" },
        ],
      },
    },
    parameters: { "parameter:width": { value: { value: 100 } } },
  }, "sketch:durable");
  assert.ok(hydrated);
  assert.deepEqual(hydrated.support, { kind: "topology", reference: "topology:face:42" });
  assert.deepEqual(hydrated.sketch.geometry["line:accepted"].geometry, { kind: "line", start: { x_nm: 10, y_nm: 20 }, end: { x_nm: 110, y_nm: 20 } });
  assert.equal(hydrated.sketch.geometry["circle:accepted"].construction, true);
  assert.deepEqual(hydrated.sketch.constraints["constraint:width"], { kind: "distance", a: { geometry: "line:accepted", anchor: "start" }, b: { geometry: "line:accepted", anchor: "end" }, distance_nm: 100 });
  assert.equal(hydrated.sketch.constraints["constraint:origin"], undefined);
  const ids = new StableSketchIds(hydrated.sketch.id, hydrated.sketch.revision, [...Object.keys(hydrated.sketch.geometry), "sketch:durable:geometry:000z"]);
  assert.equal(ids.next("geometry"), "sketch:durable:geometry:0010");
});

test("Enter commits and Escape restores accepted draft through the runtime bridge", async () => {
  let committed = 0;
  let committedSupport: unknown;
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = command.entity;
      after.revision += 1;
      return { sketch: after, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "same" };
    },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] } }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch(request) { committed += 1; committedSupport = request.support; return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);
  await session.apply({ kind: "add_geometry", entity: { id: "line:1", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } });
  assert.equal(await session.handleKey("Escape"), "cancelled");
  assert.equal(Object.keys(session.draft.geometry).length, 0);
  await session.apply({ kind: "add_geometry", entity: { id: "line:2", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 20, y_nm: 0 } } } });
  assert.equal(await session.handleKey("Enter"), "committed");
  assert.equal(committed, 1);
  assert.deepEqual(committedSupport, { kind: "origin_plane", plane: "xy" });
});
