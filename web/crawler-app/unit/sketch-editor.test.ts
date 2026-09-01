import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSTRAINT_SCHEMA,
  SKETCH_TOOL_SCHEMA,
  SketchEditSession,
  StableSketchIds,
  angleToAxisConstraintCommand,
  constraintCommand,
  explicitFaceRebind,
  filterCenterOnLineTangencies,
  hydrateSketchFromDocument,
  normalizeImpliedOriginMidpointSolve,
  rectangleCommands,
  resolveAttachment,
  selfIntersectionDiagnostics,
  sketchToolFacsimile,
  tangentConflictsWithCenterOnLine,
  toolCommands,
  updateDimensionBinding,
  type Sketch,
  type SketchCommand,
  type SketchRuntimeBridge,
} from "../src/sketch-editor.ts";

const empty = (): Sketch => ({ id: "sketch:test", revision: 0, geometry: {}, constraints: {} });

test("implied origin midpoint compatibility normalization removes false overconstraint reports", () => {
  const sketch = empty();
  sketch.geometry = {
    line: { id: "line", construction: true, geometry: { kind: "line", start: { x_nm: -10, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
    center: { id: "center", construction: true, geometry: { kind: "sketch_point", x_nm: 0, y_nm: 0 } },
  };
  sketch.constraints = {
    midpoint_point: { kind: "midpoint", point: { geometry: "center", anchor: "position" }, line: "line" },
    point_origin: { kind: "point_on_origin", point: { geometry: "center", anchor: "position" } },
    midpoint_origin: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line" },
  };
  const normalized = normalizeImpliedOriginMidpointSolve(sketch, {
    state: "over_constrained",
    degrees_of_freedom: 0,
    active_constraints: ["midpoint_origin", "midpoint_point", "point_origin"],
    redundant_constraints: [],
    conflicts: [{ constraints: ["midpoint_origin", "midpoint_point", "point_origin"], reason: { kind: "excess_independent_constraints" } }],
    solve_components: [{ id: 0, geometry: ["line", "center"], constraints: ["midpoint_origin", "midpoint_point", "point_origin"], variable_count: 6, equation_count: 8, structural_rank: 6, structural_degrees_of_freedom: 0, structurally_redundant_equations: 2 }],
  });
  assert.equal(normalized.state, "fully_constrained");
  assert.deepEqual(normalized.active_constraints, ["midpoint_point", "point_origin"]);
  assert.deepEqual(normalized.redundant_constraints, ["midpoint_origin"]);
  assert.deepEqual(normalized.conflicts, []);
});

test("origin midpoint compatibility handles fixed-zero and coincident-chain implications", () => {
  for (const [caseName, constraints] of [
    ["fixed-zero", {
      midpoint_point: { kind: "midpoint", point: { geometry: "center", anchor: "position" }, line: "line" },
      origin_hold: { kind: "fixed", point: { geometry: "center", anchor: "position" }, x_nm: 0, y_nm: 0 },
      midpoint_origin: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line" },
    }],
    ["coincident-chain", {
      midpoint_point: { kind: "midpoint", point: { geometry: "center", anchor: "position" }, line: "line" },
      coincident_a: { kind: "coincident", a: { geometry: "center", anchor: "position" }, b: { geometry: "bridge-a", anchor: "position" } },
      coincident_b: { kind: "coincident", a: { geometry: "bridge-a", anchor: "position" }, b: { geometry: "bridge-b", anchor: "position" } },
      origin_hold: { kind: "point_on_origin", point: { geometry: "bridge-b", anchor: "position" } },
      midpoint_origin: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line" },
    }],
  ] as const) {
    const sketch = empty();
    sketch.constraints = structuredClone(constraints) as Sketch["constraints"];
    const ids = Object.keys(sketch.constraints);
    const normalized = normalizeImpliedOriginMidpointSolve(sketch, {
      state: "over_constrained",
      degrees_of_freedom: 0,
      active_constraints: ids,
      redundant_constraints: [],
      conflicts: [{ constraints: ids, reason: { kind: "excess_independent_constraints" } }],
      solve_components: [{ id: 0, geometry: ["line", "center"], constraints: ids, variable_count: 6, equation_count: 8, structural_rank: 6, structural_degrees_of_freedom: 0, structurally_redundant_equations: 2 }],
    });
    assert.equal(normalized.state, "fully_constrained", caseName);
    assert.ok(normalized.redundant_constraints.includes("midpoint_origin"), caseName);
    assert.ok(!normalized.active_constraints.includes("midpoint_origin"), caseName);
    assert.deepEqual(normalized.conflicts, [], caseName);
  }
});

test("origin midpoint compatibility ignores suppressed near-misses and preserves real conflicts", () => {
  const suppressed = empty();
  suppressed.suppressed_constraints = ["origin_hold"];
  suppressed.constraints = {
    midpoint_point: { kind: "midpoint", point: { geometry: "center", anchor: "position" }, line: "line" },
    origin_hold: { kind: "point_on_origin", point: { geometry: "center", anchor: "position" } },
    midpoint_origin: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line" },
  };
  const unchangedSolve = {
    state: "fully_constrained" as const,
    degrees_of_freedom: 0,
    active_constraints: ["midpoint_point", "midpoint_origin"],
    redundant_constraints: [],
    conflicts: [],
  };
  assert.strictEqual(normalizeImpliedOriginMidpointSolve(suppressed, unchangedSolve), unchangedSolve);

  const conflicting = structuredClone(suppressed);
  conflicting.suppressed_constraints = [];
  const normalized = normalizeImpliedOriginMidpointSolve(conflicting, {
    state: "conflicting",
    degrees_of_freedom: 0,
    active_constraints: ["midpoint_point", "origin_hold", "midpoint_origin", "horizontal", "vertical"],
    redundant_constraints: [],
    conflicts: [
      { constraints: ["midpoint_origin"], reason: { kind: "excess_independent_constraints" } },
      { constraints: ["horizontal", "vertical"], reason: { kind: "horizontal_and_vertical", geometry: "line" } },
    ],
    solve_components: [{ id: 0, geometry: ["line", "center"], constraints: ["midpoint_point", "origin_hold", "midpoint_origin", "horizontal", "vertical"], variable_count: 6, equation_count: 9, structural_rank: 7, structural_degrees_of_freedom: 0, structurally_redundant_equations: 2 }],
  });
  assert.equal(normalized.state, "conflicting");
  assert.deepEqual(normalized.conflicts, [
    { constraints: ["horizontal", "vertical"], reason: { kind: "horizontal_and_vertical", geometry: "line" } },
  ]);
  assert.ok(normalized.redundant_constraints.includes("midpoint_origin"));
});

test("draftView reuses one deeply immutable snapshot until the draft changes", async () => {
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = structuredClone(command.entity);
      after.revision += 1;
      return {
        sketch: after,
        solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] },
        profile: { closed_profiles: [], diagnostics: [] },
        document_hash: "view-test",
      };
    },
    async applySketchCommands({ sketch }) {
      return {
        sketch: structuredClone(sketch),
        solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] },
        profile: { closed_profiles: [], diagnostics: [] },
        document_hash: "view-test",
      };
    },
    async dragSketch({ sketch, drag }) {
      return {
        drag: { accepted: true, sketch: structuredClone(sketch), resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } },
        profile: { closed_profiles: [], diagnostics: [] },
      };
    },
    async solveSketch() {
      return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } };
    },
  };
  const initial: Sketch = {
    ...empty(),
    geometry: { "line:initial": { id: "line:initial", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } },
  };
  const session = new SketchEditSession(initial, { kind: "origin_plane", plane: "xy" }, runtime);

  const first = session.draftView;
  assert.strictEqual(session.draftView, first);
  assert.equal(first.revision, 0);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.geometry), true);
  assert.equal(Object.isFrozen(first.geometry["line:initial"].geometry), true);

  if (false) {
    // @ts-expect-error draft views expose no mutable top-level fields
    first.revision = 99;
    // @ts-expect-error draft views expose no mutable nested geometry
    first.geometry["line:initial"].geometry = { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 1 };
  }
  assert.throws(() => {
    (first as unknown as Sketch).revision = 99;
  }, TypeError);
  assert.equal(session.draft.revision, 0);

  await session.apply({ kind: "add_geometry", entity: { id: "line:next", geometry: { kind: "line", start: { x_nm: 10, y_nm: 0 }, end: { x_nm: 20, y_nm: 0 } } } });
  const next = session.draftView;
  assert.notStrictEqual(next, first);
  assert.strictEqual(session.draftView, next);
  assert.equal(next.revision, 1);
  assert.ok(next.geometry["line:next"]);
});

test("initializing a hydrated session derives profiles without mutating the draft or history", async () => {
  const initial: Sketch = {
    ...empty(),
    revision: 7,
    geometry: {
      circle: { id: "circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 10 } },
    },
  };
  let initializationRequest: { sketch: Sketch; commands: SketchCommand[] } | undefined;
  const solve = { state: "under_constrained" as const, degrees_of_freedom: 3, active_constraints: [], redundant_constraints: [], conflicts: [] };
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand() { throw new Error("initialization must use the batch evaluation path"); },
    async applySketchCommands(request) {
      initializationRequest = structuredClone(request);
      return {
        sketch: structuredClone(request.sketch),
        solve,
        profile: { closed_profiles: [["circle"]], diagnostics: [] },
        document_hash: "hydrated",
      };
    },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve }, profile: { closed_profiles: [["circle"]], diagnostics: [] } }; },
    async solveSketch() { return { accepted: true, solve }; },
  };
  const session = new SketchEditSession(initial, { kind: "origin_plane", plane: "xy" }, runtime);

  await session.initialize();

  assert.deepEqual(initializationRequest, { sketch: initial, commands: [] });
  assert.deepEqual(session.draft, initial);
  assert.deepEqual(session.solve, solve);
  assert.deepEqual(session.profile?.closed_profiles, [["circle"]]);
  assert.equal(session.undo(), false, "initial derivation must not create an edit history entry");
  session.cancel();
  assert.deepEqual(session.profile?.closed_profiles, [["circle"]], "cancel restores the initialized accepted profile");
});

test("mutable snapshots and runtime payloads cannot mutate session-owned draft state", async () => {
  let runtimeRequest: Sketch | undefined;
  let runtimeResponse: Sketch | undefined;
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      runtimeRequest = sketch;
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = structuredClone(command.entity);
      runtimeResponse = after;
      return {
        sketch: after,
        solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] },
        profile: { closed_profiles: [], diagnostics: [] },
        document_hash: "boundary-test",
      };
    },
    async applySketchCommands({ sketch }) {
      return {
        sketch: structuredClone(sketch),
        solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] },
        profile: { closed_profiles: [], diagnostics: [] },
        document_hash: "boundary-test",
      };
    },
    async dragSketch({ sketch, drag }) {
      return {
        drag: { accepted: true, sketch: structuredClone(sketch), resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } },
        profile: { closed_profiles: [], diagnostics: [] },
      };
    },
    async solveSketch() {
      return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } };
    },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);

  const firstSnapshot = session.draft;
  const secondSnapshot = session.draft;
  assert.notStrictEqual(firstSnapshot, secondSnapshot);
  firstSnapshot.revision = 90;
  firstSnapshot.geometry.injected = { id: "injected", geometry: { kind: "sketch_point", x_nm: 0, y_nm: 0 } };
  assert.equal(session.draft.revision, 0);
  assert.equal(session.draft.geometry.injected, undefined);

  const applied = await session.apply({ kind: "add_geometry", entity: { id: "point:owned", geometry: { kind: "sketch_point", x_nm: 5, y_nm: 7 } } });
  assert.ok(runtimeRequest);
  assert.ok(runtimeResponse);
  runtimeRequest!.revision = 91;
  runtimeResponse!.revision = 92;
  delete runtimeResponse!.geometry["point:owned"];
  applied.revision = 93;
  delete applied.geometry["point:owned"];

  assert.equal(session.draft.revision, 0);
  assert.ok(session.draft.geometry["point:owned"]);
});

test("schema exposes the first-class sketch tools and constraints", () => {
  assert.deepEqual(SKETCH_TOOL_SCHEMA.map((tool) => tool.id), ["line", "circle", "arc", "rectangle", "trim", "construction", "project", "spline", "fit_spline", "polygon", "slot", "ellipse", "elliptical_arc", "conic", "point", "text", "offset", "extend", "sketch_fillet", "sketch_chamfer", "sketch_mirror", "sketch_linear_pattern", "sketch_circular_pattern", "sketch_break", "sketch_scale", "sketch_move_copy", "sketch_blend"]);
  assert.equal(CONSTRAINT_SCHEMA.length, 24);
  assert.deepEqual(CONSTRAINT_SCHEMA, ["coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "equal", "fixed", "midpoint", "concentric", "point_on_object", "collinear", "symmetry", "curvature_continuous", "distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance", "radius", "diameter", "ellipse_radius", "angle"]);
});

test("axis-relative line angles serialize as durable commands and hydrate from storage", () => {
  assert.deepEqual(
    angleToAxisConstraintCommand("constraint:axis", "line:a", "x", 30),
    {
      kind: "add_constraint",
      id: "constraint:axis",
      constraint: { kind: "angle_to_axis", line: "line:a", axis: "x", angle_microdegrees: 30_000_000 },
    },
  );
  const result = hydrateSketchFromDocument({ sketches: { "sketch:axis": {
    elements: [{ kind: "line_segment", id: "line:a", start_nanometers: [0, 0], end_nanometers: [10, 4] }],
    constraints: [{ kind: "angle_to_axis_literal", id: "constraint:axis", line: "line:a", axis: "y", angle_microdegrees: 90_000_000 }],
  } } }, "sketch:axis");
  assert.deepEqual(result?.sketch.constraints["constraint:axis"], {
    kind: "angle_to_axis", line: "line:a", axis: "y", angle_microdegrees: 90_000_000,
  });
});

test("rectangle click input creates four connected lines without pre-dimensioning", () => {
  const commands = rectangleCommands(new StableSketchIds("sketch:test"), { x_nm: 5, y_nm: 10 }, { x_nm: 105, y_nm: 60 });
  const geometry = commands.filter((command) => command.kind === "add_geometry");
  const constraints = commands.filter((command) => command.kind === "add_constraint");
  assert.equal(geometry.length, 4);
  assert.equal(constraints.length, 8);
  assert.deepEqual(geometry[0], { kind: "add_geometry", entity: { id: "sketch:test:geometry:0001", geometry: { kind: "line", start: { x_nm: 5, y_nm: 10 }, end: { x_nm: 105, y_nm: 10 } } } });
  assert.deepEqual(constraints.map((command) => command.kind === "add_constraint" ? command.constraint.kind : ""), [
    "horizontal", "coincident", "vertical", "coincident", "horizontal", "coincident", "vertical", "coincident",
  ]);
  assert.equal(constraints.some((command) => command.kind === "add_constraint" && command.constraint.kind === "distance"), false);
});

test("zero-length direct geometry is rejected before allocating a stable id", () => {
  const ids = new StableSketchIds("sketch:test");
  const point = { x_nm: 25, y_nm: 40 };
  assert.throws(() => toolCommands("line", ids, [point, point]), /positive length/);
  assert.throws(() => toolCommands("circle", ids, [point, point]), /positive radius/);
  assert.equal(ids.next("geometry"), "sketch:test:geometry:0001");
});

test("cursor facsimiles follow fixed sketch points without allocating commands", () => {
  const first = { x_nm: 10, y_nm: 20 };
  const cursor = { x_nm: 60, y_nm: 90 };
  assert.deepEqual(sketchToolFacsimile("line", [first], cursor), { kind: "line", start: first, end: cursor });
  assert.deepEqual(sketchToolFacsimile("rectangle", [first], cursor), { kind: "rectangle", min: first, max: cursor });
  assert.deepEqual(sketchToolFacsimile("circle", [first], { x_nm: 13, y_nm: 24 }), { kind: "circle", center: first, radius_nm: 5 });
  assert.equal(sketchToolFacsimile("trim", [], cursor), undefined);
  assert.deepEqual(sketchToolFacsimile("spline", [first, { x_nm: 30, y_nm: 40 }], cursor), {
    kind: "control_point_spline", degree: 3, control_points: [first, { x_nm: 30, y_nm: 40 }, cursor],
  });
});

test("native spline geometry and control-point references hydrate without polyline expansion", () => {
  const result = hydrateSketchFromDocument({
    revision: 7,
    sketches: {
      "sketch:spline": {
        elements: [{
          kind: "control_point_spline", id: "spline:a", degree: 3,
          control_points_nanometers: [[0, 0], [10, 20], [20, -10], [30, 0]],
        }],
        constraints: [{ kind: "fixed", id: "constraint:cp", point: "spline:a#control:1" }],
      },
    },
  }, "sketch:spline");
  assert.equal(result?.sketch.geometry["spline:a"].geometry.kind, "control_point_spline");
  assert.deepEqual(result?.sketch.constraints["constraint:cp"], {
    kind: "fixed", point: { geometry: "spline:a", anchor: "control:1" }, x_nm: 10, y_nm: 20,
  });
});

test("remaining native entities hydrate with their stable sub-entity anchors", () => {
  const result = hydrateSketchFromDocument({ revision: 8, sketches: { "sketch:native": { elements: [
    { kind: "fit_point_spline", id: "fit:a", fit_points_nanometers: [[0, 0], [10, 20], [20, -10], [30, 0]] },
    { kind: "ellipse", id: "ellipse:a", center_nanometers: [0, 0], major_nanometers: [20, 0], minor_nanometers: [0, 10] },
    { kind: "elliptical_arc", id: "elliptical-arc:a", center_nanometers: [0, 0], major_nanometers: [20, 0], minor_nanometers: [0, 10], start_nanometers: [20, 0], end_nanometers: [0, 10], clockwise: false },
    { kind: "conic", id: "conic:a", start_nanometers: [0, 0], control_nanometers: [15, 20], end_nanometers: [30, 0], weight_millionths: 707107 },
    { kind: "sketch_point", id: "point:a", position_nanometers: [7, 9] },
  ], constraints: [
    { kind: "fixed", id: "c:fit", point: "fit:a#fit:1" }, { kind: "fixed", id: "c:major", point: "ellipse:a#major" }, { kind: "fixed", id: "c:arc-end", point: "elliptical-arc:a#end" },
    { kind: "fixed", id: "c:control", point: "conic:a#control" }, { kind: "fixed", id: "c:point", point: "point:a#position" },
  ] } } }, "sketch:native");
  assert.deepEqual(Object.values(result?.sketch.geometry ?? {}).map((entity) => entity.geometry.kind), ["fit_point_spline", "ellipse", "elliptical_arc", "conic", "sketch_point"]);
  assert.deepEqual(Object.values(result?.sketch.constraints ?? {}).map((constraint) => constraint.kind), ["fixed", "fixed", "fixed", "fixed", "fixed"]);
});

test("three-point arc preserves the arbitrary cursor angle in preview and commit", () => {
  const points = [
    { x_nm: 0, y_nm: 0 },
    { x_nm: 3_000_000, y_nm: 4_000_000 },
    { x_nm: -4_200_000, y_nm: 2_600_000 },
  ];
  const [command] = toolCommands("arc", new StableSketchIds("sketch:arc"), points);
  assert.equal(command.kind, "add_geometry");
  if (command.kind !== "add_geometry" || command.entity.geometry.kind !== "arc") return;
  assert.deepEqual(sketchToolFacsimile("arc", points.slice(0, 2), points[2]), command.entity.geometry);
  const { center, start, end } = command.entity.geometry;
  const radius = (point: typeof start) => Math.hypot(point.x_nm - center.x_nm, point.y_nm - center.y_nm);
  assert.ok(Math.abs(radius(start) - radius(end)) <= 1);
  assert.ok(Math.abs(
    Math.atan2(end.y_nm - center.y_nm, end.x_nm - center.x_nm)
      - Math.atan2(points[2].y_nm - center.y_nm, points[2].x_nm - center.x_nm),
  ) < 1e-6);
  assert.notDeepEqual(end, { x_nm: -4_000_000, y_nm: 3_000_000 });
  assert.notDeepEqual(start, end);
});

test("selection-aware command generation covers every visible constraint", () => {
  const sketch = empty();
  sketch.geometry = {
    "line:a": { id: "line:a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } },
    "line:b": { id: "line:b", geometry: { kind: "line", start: { x_nm: 0, y_nm: 5_000_000 }, end: { x_nm: 10_000_000, y_nm: 5_000_000 } } },
    "circle:a": { id: "circle:a", geometry: { kind: "circle", center: { x_nm: 20_000_000, y_nm: 0 }, radius_nm: 2_000_000 } },
    "circle:b": { id: "circle:b", geometry: { kind: "circle", center: { x_nm: 25_000_000, y_nm: 0 }, radius_nm: 3_000_000 } },
    "arc:a": { id: "arc:a", geometry: { kind: "arc", center: { x_nm: 30_000_000, y_nm: 0 }, start: { x_nm: 32_000_000, y_nm: 0 }, end: { x_nm: 30_000_000, y_nm: 2_000_000 }, clockwise: false } },
    "ellipse:a": { id: "ellipse:a", geometry: { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 8_000_000, y_nm: 0 }, minor: { x_nm: 0, y_nm: 4_000_000 } } },
  };
  const selection = (geometry: string[], points: Array<{ geometry: string; anchor: "start" | "end" }> = []) => ({ geometry, points });
  const cases: Record<string, { geometry: string[]; points: Array<{ geometry: string; anchor: "start" | "end" }> }> = {
    coincident: selection(["line:a", "line:b"], [{ geometry: "line:a", anchor: "end" }, { geometry: "line:b", anchor: "start" }]),
    horizontal: selection(["line:a"]),
    vertical: selection(["line:a"]),
    parallel: selection(["line:a", "line:b"]),
    perpendicular: selection(["line:a", "line:b"]),
    tangent: selection(["line:a", "circle:a"]),
    equal: selection(["circle:a", "circle:b"]),
    fixed: selection(["line:a"], [{ geometry: "line:a", anchor: "start" }]),
    midpoint: selection(["line:a", "line:b"], [{ geometry: "line:b", anchor: "start" }]),
    concentric: selection(["circle:a", "circle:b"]),
    point_on_object: selection(["line:a", "line:b"], [{ geometry: "line:b", anchor: "start" }]),
    collinear: selection(["line:a", "line:b"], [{ geometry: "line:b", anchor: "start" }]),
    symmetry: selection(["line:a", "line:b"], [{ geometry: "line:b", anchor: "start" }, { geometry: "line:b", anchor: "end" }]),
    curvature_continuous: selection(["line:a", "line:b"]),
    distance: selection(["line:a"]),
    distance_x: selection(["line:a", "line:b"], [{ geometry: "line:a", anchor: "start" }, { geometry: "line:b", anchor: "start" }]),
    distance_y: selection(["line:a", "line:b"], [{ geometry: "line:a", anchor: "start" }, { geometry: "line:b", anchor: "start" }]),
    point_line_distance: selection(["line:a", "line:b"], [{ geometry: "line:b", anchor: "start" }]),
    line_distance: selection(["line:a", "line:b"]),
    offset_distance: selection(["line:a", "line:b"]),
    radius: selection(["circle:a"]),
    diameter: selection(["circle:a"]),
    ellipse_radius: selection(["ellipse:a"]),
    angle: selection(["line:a", "line:b"]),
  };
  for (const kind of CONSTRAINT_SCHEMA) {
    const command = constraintCommand(kind, `constraint:${kind}`, sketch, cases[kind], 12.5);
    assert.equal(command?.kind, "add_constraint", `${kind} should generate a command`);
    if (command?.kind === "add_constraint") assert.equal(command.constraint.kind, kind);
    assert.equal(constraintCommand(kind, `constraint:missing:${kind}`, sketch, { geometry: [], points: [] }, 12.5), undefined, `${kind} must not silently fall back to unrelated geometry`);
  }
  const radius = constraintCommand("radius", "constraint:radius-value", sketch, cases.radius, 12.5);
  assert.equal(radius?.kind === "add_constraint" && radius.constraint.kind === "radius" && radius.constraint.radius_nm, 12_500_000);
  const arcRadius = constraintCommand("radius", "constraint:arc-radius", sketch, { geometry: ["arc:a"], points: [] }, 7.25);
  assert.deepEqual(arcRadius, { kind: "add_constraint", id: "constraint:arc-radius", constraint: { kind: "radius", geometry: "arc:a", radius_nm: 7_250_000 } });
  const angle = constraintCommand("angle", "constraint:angle-value", sketch, cases.angle, 37.5);
  assert.equal(angle?.kind === "add_constraint" && angle.constraint.kind === "angle" && angle.constraint.angle_microdegrees, 37_500_000);
  const tangent = constraintCommand("tangent", "constraint:tangent-contact", sketch, cases.tangent, 0);
  assert.ok(tangent?.kind === "add_constraint" && tangent.constraint.kind === "tangent" && Number.isInteger(tangent.constraint.first_parameter_millionths) && Number.isInteger(tangent.constraint.second_parameter_millionths));
  const distance = constraintCommand("distance", "constraint:line-length", sketch, { geometry: ["line:a"], points: [] }, 12.5);
  assert.deepEqual(distance, { kind: "add_constraint", id: "constraint:line-length", constraint: { kind: "distance", a: { geometry: "line:a", anchor: "start" }, b: { geometry: "line:a", anchor: "end" }, distance_nm: 12_500_000 } });
  assert.deepEqual(
    constraintCommand("coincident", "constraint:origin", sketch, { geometry: ["line:a"], points: [{ geometry: "line:a", anchor: "start" }], origin: true }, 0),
    { kind: "add_constraint", id: "constraint:origin", constraint: { kind: "point_on_origin", point: { geometry: "line:a", anchor: "start" } } },
  );
  assert.deepEqual(
    constraintCommand("midpoint", "constraint:origin-midpoint", sketch, { geometry: ["line:a"], points: [], origin: true }, 0),
    { kind: "add_constraint", id: "constraint:origin-midpoint", constraint: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line:a" } },
  );
  assert.deepEqual(
    constraintCommand("distance", "constraint:origin-distance", sketch, { geometry: ["line:a"], points: [{ geometry: "line:a", anchor: "start" }], origin: true }, 5),
    { kind: "add_constraint", id: "constraint:origin-distance", constraint: { kind: "distance", a: { geometry: "reference:origin", anchor: "center" }, b: { geometry: "line:a", anchor: "start" }, distance_nm: 5_000_000 } },
  );
  assert.deepEqual(
    constraintCommand("distance_x", "constraint:origin-distance-x", sketch, { geometry: ["line:a"], points: [{ geometry: "line:a", anchor: "start" }], origin: true }, 5),
    { kind: "add_constraint", id: "constraint:origin-distance-x", constraint: { kind: "distance_x", a: { geometry: "reference:origin", anchor: "center" }, b: { geometry: "line:a", anchor: "start" }, distance_nm: 5_000_000 } },
  );
  assert.deepEqual(
    constraintCommand("point_on_object", "constraint:origin-on-line", sketch, { geometry: ["line:a"], points: [], origin: true }, 0),
    { kind: "add_constraint", id: "constraint:origin-on-line", constraint: { kind: "point_on_object", point: { geometry: "reference:origin", anchor: "center" }, geometry: "line:a" } },
  );
});

test("tangency rejects a centered curve constrained onto the same line", () => {
  const sketch = empty();
  sketch.geometry = {
    "line:a": { id: "line:a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } },
    "circle:a": { id: "circle:a", geometry: { kind: "circle", center: { x_nm: 5_000_000, y_nm: 0 }, radius_nm: 2_000_000 } },
  };
  sketch.constraints["constraint:midpoint"] = { kind: "midpoint", point: { geometry: "circle:a", anchor: "center" }, line: "line:a" };

  assert.equal(
    constraintCommand("tangent", "constraint:tangent", sketch, { geometry: ["line:a", "circle:a"], points: [] }, 0),
    undefined,
  );
  assert.equal(tangentConflictsWithCenterOnLine(sketch, "line:a", "circle:a"), true);
  sketch.suppressed_constraints = ["constraint:midpoint"];
  assert.equal(
    constraintCommand("tangent", "constraint:tangent", sketch, { geometry: ["line:a", "circle:a"], points: [] }, 0)?.kind,
    "add_constraint",
  );
});

test("same-batch center-on-line inference blocks tangency for new geometry", () => {
  const sketch = empty();
  sketch.geometry["line:a"] = { id: "line:a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } };
  const circle = { id: "circle:new", geometry: { kind: "circle" as const, center: { x_nm: 5_000_000, y_nm: 0 }, radius_nm: 2_000_000 } };
  const midpoint = { kind: "midpoint" as const, point: { geometry: "circle:new", anchor: "center" as const }, line: "line:a" };

  const commands: SketchCommand[] = [
    { kind: "add_constraint", id: "constraint:midpoint", constraint: midpoint },
    { kind: "add_constraint", id: "constraint:tangent", constraint: { kind: "tangent", first: "line:a", second: "circle:new" } },
  ];
  assert.deepEqual(filterCenterOnLineTangencies(sketch, commands, { "circle:new": circle }), [commands[0]]);
  assert.equal(tangentConflictsWithCenterOnLine(sketch, "line:a", "circle:new", [midpoint], { "circle:new": circle }), true);
  assert.equal(tangentConflictsWithCenterOnLine(sketch, "line:a", "circle:new", [], { "circle:new": circle }), false);
});

test("missing planar support blocks until an explicit ranked candidate is selected", () => {
  const face = (id: string, x: number) => ({ id, kind: "face" as const, stable_kernel_id: String(18_446_744_073_709_550_000n + BigInt(x)), stable_token: id, fallback_signature: { kind: "face" as const, centroid_nanometers: [x, 0, 0] as [number, number, number], normal_millionths: [0, 0, 1_000_000] as [number, number, number], area_square_nanometers: 100 } });
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

test("profile diagnostics distinguish overlap, touching, and curved crossings", () => {
  const overlap = empty();
  overlap.geometry.a = { id: "a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } };
  overlap.geometry.b = { id: "b", geometry: { kind: "line", start: { x_nm: 4, y_nm: 0 }, end: { x_nm: 14, y_nm: 0 } } };
  assert.equal(selfIntersectionDiagnostics(overlap)[0]?.kind, "overlapping_contours");
  overlap.geometry.b = { id: "b", geometry: { kind: "line", start: { x_nm: 5, y_nm: 0 }, end: { x_nm: 5, y_nm: 5 } } };
  assert.equal(selfIntersectionDiagnostics(overlap)[0]?.kind, "touching_contours");

  const curved = empty();
  curved.geometry.circle = { id: "circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 1_000 } };
  curved.geometry.line = { id: "line", geometry: { kind: "line", start: { x_nm: -2_000, y_nm: 100 }, end: { x_nm: 2_000, y_nm: 100 } } };
  assert.equal(selfIntersectionDiagnostics(curved)[0]?.kind, "self_intersection");
});

test("profile diagnostics coalesce queued generations and publish only the deterministic latest report", async () => {
  const scheduled: Array<() => void> = [];
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = structuredClone(command.entity);
      after.revision += 1;
      return { sketch: after, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "async-diagnostics" };
    },
    async applySketchCommands({ sketch }) { return { sketch, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "async-diagnostics" }; },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch() { return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime, undefined, (task) => scheduled.push(task));
  let publications = 0;
  session.setDiagnosticsChangedListener(() => { publications += 1; });
  await session.apply({ kind: "add_geometry", entity: { id: "a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 10 } } } });
  const supersededReady = session.diagnosticsReady();
  await session.apply({ kind: "add_geometry", entity: { id: "b", geometry: { kind: "line", start: { x_nm: 0, y_nm: 10 }, end: { x_nm: 10, y_nm: 0 } } } });
  await supersededReady;
  assert.equal(session.profile?.diagnostics.length, 0, "command completion is not blocked by local pairwise diagnostics");
  assert.equal(scheduled.length, 1, "rapid mutations share one queued scheduler task");
  assert.deepEqual(session.diagnosticsInstrumentation(), { scheduled: 2, skipped: 1, executed: 0, published: 0 });
  scheduled[0]();
  await session.diagnosticsReady();
  assert.deepEqual(session.profile?.diagnostics, [{ kind: "self_intersection", geometry: ["a", "b"] }]);
  assert.equal(publications, 1);
  assert.deepEqual(session.diagnosticsInstrumentation(), { scheduled: 2, skipped: 1, executed: 1, published: 1 });
});

test("invalidated queued diagnostics neither execute nor publish", async () => {
  const scheduled: Array<() => void> = [];
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = structuredClone(command.entity);
      return { sketch: after, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "invalidated-diagnostics" };
    },
    async applySketchCommands({ sketch }) { return { sketch, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "invalidated-diagnostics" }; },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch() { return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime, undefined, (task) => scheduled.push(task));
  let publications = 0;
  session.setDiagnosticsChangedListener(() => { publications += 1; });
  await session.apply({ kind: "add_geometry", entity: { id: "stale", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 10 } } } });
  const invalidatedReady = session.diagnosticsReady();
  session.cancel();
  await invalidatedReady;
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(publications, 0);
  assert.equal(session.profile, undefined);
  assert.deepEqual(session.diagnosticsInstrumentation(), { scheduled: 1, skipped: 1, executed: 0, published: 0 });
});

test("commit waits for current asynchronous profile diagnostics", async () => {
  const scheduled: Array<() => void> = [];
  let solveCalls = 0;
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch }) { return { sketch, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "commit-diagnostics" }; },
    async applySketchCommands({ sketch }) { return { sketch, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "commit-diagnostics" }; },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch() { solveCalls += 1; return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime, undefined, (task) => scheduled.push(task));
  await session.apply({ kind: "set_auto_constraints", enabled: true });
  const committing = session.commit();
  await Promise.resolve();
  assert.equal(solveCalls, 0);
  scheduled[0]();
  assert.equal(await committing, true);
  assert.equal(solveCalls, 1);
});

test("durable external references, dimension bindings, and suppression hydrate together", () => {
  const hydrated = hydrateSketchFromDocument({
    revision: 3,
    sketches: {
      "sketch:linked": {
        elements: [{ kind: "external_line", id: "external:1", start_nanometers: [0, 0], end_nanometers: [10, 0], body: "body:1", stable_kernel_id: "18446744073709551614" }],
        constraints: [{ kind: "suppressed", id: "constraint:length", constraint: { kind: "distance", id: "constraint:length", first: "external:1#start", second: "external:1#end", parameter: "parameter:length" } }],
      },
    },
    parameters: { "parameter:length": { value: { value: 10 } } },
  }, "sketch:linked");
  assert.ok(hydrated);
  assert.deepEqual(hydrated.sketch.external_references?.["external:1"], { body: "body:1", stable_kernel_id: "18446744073709551614" });
  assert.deepEqual(hydrated.sketch.suppressed_constraints, ["constraint:length"]);
  assert.equal(hydrated.sketch.dimension_parameters?.["constraint:length"], "parameter:length");
  assert.equal(hydrated.sketch.constraints["constraint:length"].kind, "distance");
});

test("P0 native knots and every new dimension binding hydrate without losing intent", () => {
  const parameters = Object.fromEntries([
    ["dx", 8], ["dy", 4], ["point-line", 2], ["line-distance", 3],
    ["offset", 3], ["diameter", 6], ["ellipse-major", 5],
  ].map(([name, value]) => [`parameter:${name}`, { value: { value } }]));
  const hydrated = hydrateSketchFromDocument({
    revision: 9,
    parameters,
    sketches: {
      "sketch:p0": {
        elements: [
          { kind: "sketch_point", id: "point:a", position_nanometers: [0, 2] },
          { kind: "sketch_point", id: "point:b", position_nanometers: [8, 6] },
          { kind: "line_segment", id: "line:a", start_nanometers: [0, 0], end_nanometers: [10, 0] },
          { kind: "line_segment", id: "line:b", start_nanometers: [0, 3], end_nanometers: [10, 3] },
          { kind: "circle", id: "circle:a", center_nanometers: [20, 0], radius_nanometers: 3 },
          { kind: "ellipse", id: "ellipse:a", center_nanometers: [30, 0], major_nanometers: [35, 0], minor_nanometers: [30, 2] },
          { kind: "control_point_spline", id: "spline:a", degree: 3, knots_millionths: [0, 0, 0, 0, 500_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000], control_points_nanometers: [[0, 10], [2, 12], [4, 8], [6, 12], [8, 10]] },
        ],
        constraints: [
          { kind: "distance_x", id: "constraint:dx", start_point: "point:a#position", end_point: "point:b#position", parameter: "parameter:dx" },
          { kind: "distance_y", id: "constraint:dy", start_point: "point:a#position", end_point: "point:b#position", parameter: "parameter:dy" },
          { kind: "point_line_distance", id: "constraint:point-line", point: "point:a#position", line: "line:a", parameter: "parameter:point-line" },
          { kind: "line_distance", id: "constraint:line-distance", first: "line:a", second: "line:b", parameter: "parameter:line-distance" },
          { kind: "offset_distance", id: "constraint:offset", source: "line:a", offset: "line:b", source_start_millionths: 0, source_end_millionths: 1_000_000, parameter: "parameter:offset" },
          { kind: "diameter", id: "constraint:diameter", geometry: "circle:a", parameter: "parameter:diameter" },
          { kind: "ellipse_radius", id: "constraint:ellipse-major", geometry: "ellipse:a", axis: "major", parameter: "parameter:ellipse-major" },
        ],
      },
    },
  }, "sketch:p0");
  assert.ok(hydrated);
  assert.deepEqual(hydrated.sketch.geometry["spline:a"].geometry, {
    kind: "control_point_spline",
    degree: 3,
    knots_millionths: [0, 0, 0, 0, 500_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    control_points: [{ x_nm: 0, y_nm: 10 }, { x_nm: 2, y_nm: 12 }, { x_nm: 4, y_nm: 8 }, { x_nm: 6, y_nm: 12 }, { x_nm: 8, y_nm: 10 }],
  });
  assert.deepEqual(Object.keys(hydrated.sketch.dimension_parameters ?? {}).sort(), [
    "constraint:diameter", "constraint:dx", "constraint:dy", "constraint:ellipse-major",
    "constraint:line-distance", "constraint:offset", "constraint:point-line",
  ]);
  assert.deepEqual(hydrated.sketch.constraints["constraint:offset"], {
    kind: "offset_distance", source: "line:a", offset: "line:b", distance_nm: 3,
    source_start_millionths: 0, source_end_millionths: 1_000_000,
  });
});

test("sketch-local undo and redo restore geometry plus solver diagnostics", async () => {
  let step = 0;
  const preview = (sketch: Sketch) => ({
    sketch,
    solve: { state: "under_constrained" as const, degrees_of_freedom: ++step, active_constraints: [], redundant_constraints: [], conflicts: [] },
    profile: { closed_profiles: [], diagnostics: [{ kind: `step_${step}` }] },
    document_hash: "unchanged",
  });
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = command.entity;
      return preview(after);
    },
    async applySketchCommands({ sketch }) { return preview(structuredClone(sketch)); },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: preview(sketch).solve }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch() { return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 0, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);
  await session.apply({ kind: "add_geometry", entity: { id: "line:history", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } });
  assert.equal(session.solve?.degrees_of_freedom, 1);
  assert.equal(session.undo(), true);
  assert.equal(session.solve, undefined);
  assert.equal(Object.keys(session.draft.geometry).length, 0);
  assert.equal(session.redo(), true);
  assert.equal(session.solve?.degrees_of_freedom, 1);
  assert.ok(session.draft.geometry["line:history"]);
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
        dimension_positions: { "constraint:width": [55, 88] },
      },
    },
    parameters: { "parameter:width": { value: { value: 100 } } },
  }, "sketch:durable");
  assert.ok(hydrated);
  assert.deepEqual(hydrated.support, { kind: "topology", reference: "topology:face:42" });
  assert.deepEqual(hydrated.sketch.geometry["line:accepted"].geometry, { kind: "line", start: { x_nm: 10, y_nm: 20 }, end: { x_nm: 110, y_nm: 20 } });
  assert.equal(hydrated.sketch.geometry["circle:accepted"].construction, true);
  assert.deepEqual(hydrated.sketch.constraints["constraint:width"], { kind: "distance_x", a: { geometry: "line:accepted", anchor: "start" }, b: { geometry: "line:accepted", anchor: "end" }, distance_nm: 100 });
  assert.deepEqual(hydrated.sketch.constraints["constraint:origin"], { kind: "point_on_origin", point: { geometry: "line:accepted", anchor: "start" } });
  assert.deepEqual(hydrated.sketch.dimension_positions?.["constraint:width"], { x_nm: 55, y_nm: 88 });
  const ids = new StableSketchIds(hydrated.sketch.id, hydrated.sketch.revision, [...Object.keys(hydrated.sketch.geometry), "sketch:durable:geometry:000z"]);
  assert.equal(ids.next("geometry"), "sketch:durable:geometry:0010");
});

test("durable composite recipes hydrate with editable parameters and stable members", () => {
  const hydrated = hydrateSketchFromDocument({ sketches: { "sketch:recipe": {
    id: "sketch:recipe",
    elements: [
      { kind: "line_segment", id: "a", start_nanometers: [0, 0], end_nanometers: [10, 0] },
      { kind: "line_segment", id: "b", start_nanometers: [10, 0], end_nanometers: [5, 9] },
      { kind: "line_segment", id: "c", start_nanometers: [5, 9], end_nanometers: [0, 0] },
    ],
    constraints: [],
    recipes: { triangle: { kind: "polygon", center_nanometers: [5, 3], radius_nanometers: 6, sides: 3, orientation_microdegrees: 0, geometry: ["a", "b", "c"] } },
  } } }, "sketch:recipe");
  assert.deepEqual(hydrated?.sketch.recipes?.triangle, { kind: "polygon", center: { x_nm: 5, y_nm: 3 }, radius_nm: 6, sides: 3, orientation_microdegrees: 0, geometry: ["a", "b", "c"] });
});

test("durable midpoint constraints hydrate an implied origin without helper geometry", () => {
  const hydrated = hydrateSketchFromDocument({
    sketches: {
      "sketch:origin-midpoint": {
        id: "sketch:origin-midpoint",
        elements: [{ kind: "line_segment", id: "line:centered", start_nanometers: [-10, 0], end_nanometers: [10, 0] }],
        constraints: [{ kind: "midpoint", id: "constraint:centered", point: "reference:origin#center", line: "line:centered" }],
      },
    },
  }, "sketch:origin-midpoint");
  assert.deepEqual(hydrated?.sketch.constraints["constraint:centered"], { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "line:centered" });
  assert.equal(Object.keys(hydrated?.sketch.geometry ?? {}).length, 1);
});

test("explicit discard restores the accepted draft and commit crosses the runtime bridge", async () => {
  let committed = 0;
  let committedSupport: unknown;
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) {
      const after = structuredClone(sketch);
      if (command.kind === "add_geometry") after.geometry[command.entity.id] = command.entity;
      after.revision += 1;
      return { sketch: after, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "same" };
    },
    async applySketchCommands({ sketch, commands }) {
      let after = structuredClone(sketch);
      for (const command of commands) {
        if (command.kind === "add_geometry") after.geometry[command.entity.id] = command.entity;
        after.revision += 1;
      }
      return { sketch: after, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] }, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "same" };
    },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] } }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch(request) { committed += 1; committedSupport = request.support; return { accepted: true, solve: { state: "under_constrained", degrees_of_freedom: 4, active_constraints: [], redundant_constraints: [], conflicts: [] } }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);
  await session.apply({ kind: "add_geometry", entity: { id: "line:1", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } });
  session.cancel();
  assert.equal(Object.keys(session.draft.geometry).length, 0);
  await session.apply({ kind: "add_geometry", entity: { id: "line:2", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 20, y_nm: 0 } } } });
  assert.equal(await session.commit(), true);
  assert.equal(committed, 1);
  assert.deepEqual(committedSupport, { kind: "origin_plane", plane: "xy" });
});

test("canonical previews accept atomically with one worker call and reject stale or reused tokens", async () => {
  let batchCalls = 0;
  const result = (sketch: Sketch) => ({
    sketch,
    solve: { state: "under_constrained" as const, degrees_of_freedom: 1, active_constraints: [], redundant_constraints: [], conflicts: [] },
    profile: { closed_profiles: [], diagnostics: [] },
    document_hash: "same-document",
  });
  const applyCommand = (sketch: Sketch, command: Parameters<SketchRuntimeBridge["applySketchCommand"]>[0]["command"]) => {
    const after = structuredClone(sketch);
    if (command.kind === "add_geometry") after.geometry[command.entity.id] = structuredClone(command.entity);
    after.revision += 1;
    return after;
  };
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch, command }) { return result(applyCommand(sketch, command)); },
    async applySketchCommands({ sketch, commands }) {
      batchCalls += 1;
      return result(commands.reduce((after, command) => applyCommand(after, command), sketch));
    },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve: result(sketch).solve }, profile: result(sketch).profile }; },
    async solveSketch() { return { accepted: true, solve: result(empty()).solve }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);
  const firstCommand = { kind: "add_geometry", entity: { id: "preview:first", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } } satisfies SketchCommand;
  const prepared = await session.previewAll([firstCommand]);
  assert.equal(batchCalls, 1);
  assert.equal(session.draft.geometry["preview:first"], undefined);
  assert.ok(prepared.preview.sketch.geometry["preview:first"]);
  assert.equal(session.acceptPreview(prepared), true);
  assert.equal(batchCalls, 1, "accepting must not issue a second worker request");
  assert.ok(session.draft.geometry["preview:first"]);
  assert.equal(session.acceptPreview(prepared), false, "prepared results are single-use");
  assert.equal(session.undo(), true, "acceptance records exactly one undo entry");
  assert.equal(session.draft.geometry["preview:first"], undefined);

  const stale = await session.previewAll([firstCommand]);
  await session.apply({ kind: "add_geometry", entity: { id: "newer", geometry: { kind: "sketch_point", x_nm: 2, y_nm: 3 } } });
  assert.equal(session.acceptPreview(stale), false);
  assert.ok(session.draft.geometry.newer);
  assert.equal(session.draft.geometry["preview:first"], undefined);
});

test("aborting an in-flight canonical preview invalidates its eventual worker result", async () => {
  let resolveBatch!: (value: Awaited<ReturnType<SketchRuntimeBridge["applySketchCommands"]>>) => void;
  let batchCalls = 0;
  const solve = { state: "under_constrained" as const, degrees_of_freedom: 0, active_constraints: [], redundant_constraints: [], conflicts: [] };
  const runtime: SketchRuntimeBridge = {
    async applySketchCommand({ sketch }) { return { sketch, solve, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "same" }; },
    applySketchCommands() { batchCalls += 1; return new Promise((resolve) => { resolveBatch = resolve; }); },
    async dragSketch({ sketch, drag }) { return { drag: { accepted: true, sketch, resolved: drag.target, solve }, profile: { closed_profiles: [], diagnostics: [] } }; },
    async solveSketch() { return { accepted: true, solve }; },
  };
  const session = new SketchEditSession(empty(), { kind: "origin_plane", plane: "xy" }, runtime);
  const controller = new AbortController();
  const pending = session.previewAll([{ kind: "set_construction", geometry: "missing", construction: true }], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(batchCalls, 1);
  resolveBatch({ sketch: empty(), solve, profile: { closed_profiles: [], diagnostics: [] }, document_hash: "same" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(session.draft, empty());
});
