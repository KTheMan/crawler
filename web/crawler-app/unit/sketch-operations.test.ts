import assert from "node:assert/strict";
import test from "node:test";
import { StableSketchIds, type Sketch } from "../src/sketch-editor.ts";
import { blendCommands, breakCommands, canonicalOffsetCommands, chamferCommands, circularPatternCommands, conicCommands, ellipseCommands, ellipticalArcCommands, extendCommands, filletCommands, fitSplineCommands, linearPatternCommands, mirrorCommands, moveCopyCommands, pointCommands, polygonCommands, scaleCommands, slotCommands, splineCommands } from "../src/sketch-operations.ts";

const sketch = (): Sketch => ({
  id: "sketch:ops", revision: 0,
  geometry: {
    a: { id: "a", geometry: { kind: "line", start: { x_nm: -10, y_nm: 0 }, end: { x_nm: 0, y_nm: 0 } } },
    b: { id: "b", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 10 } } },
    c: { id: "c", geometry: { kind: "circle", center: { x_nm: 20, y_nm: 0 }, radius_nm: 5 } },
  }, constraints: {},
});

test("advanced profile generators emit stable connected solver geometry", () => {
  const shapes = [
    splineCommands(new StableSketchIds("s:spline"), [{ x_nm: 0, y_nm: 0 }, { x_nm: 10, y_nm: 20 }, { x_nm: 20, y_nm: -10 }, { x_nm: 30, y_nm: 0 }]),
    polygonCommands(new StableSketchIds("s:polygon"), { x_nm: 0, y_nm: 0 }, { x_nm: 10, y_nm: 0 }),
    slotCommands(new StableSketchIds("s:slot"), { x_nm: 0, y_nm: 0 }, { x_nm: 20, y_nm: 0 }, { x_nm: 0, y_nm: 5 }),
    ellipseCommands(new StableSketchIds("s:ellipse"), { x_nm: 0, y_nm: 0 }, { x_nm: 20, y_nm: 0 }, { x_nm: 0, y_nm: 10 }),
    ellipticalArcCommands(new StableSketchIds("s:elliptical-arc"), { x_nm: 0, y_nm: 0 }, { x_nm: 20, y_nm: 0 }, { x_nm: 0, y_nm: 10 }, { x_nm: 19, y_nm: 1 }, { x_nm: 1, y_nm: 9 }),
    fitSplineCommands(new StableSketchIds("s:fit"), [{ x_nm: 0, y_nm: 0 }, { x_nm: 10, y_nm: 20 }, { x_nm: 20, y_nm: -10 }, { x_nm: 30, y_nm: 0 }]),
    conicCommands(new StableSketchIds("s:conic"), { x_nm: 0, y_nm: 0 }, { x_nm: 10, y_nm: 20 }, { x_nm: 30, y_nm: 0 }),
    pointCommands(new StableSketchIds("s:point"), { x_nm: 5, y_nm: 6 }),
  ];
  assert.deepEqual(shapes.map((commands) => commands.filter((command) => command.kind === "add_geometry").length), [1, 6, 4, 1, 1, 1, 1, 1]);
  assert.equal(shapes[1].filter((command) => command.kind === "add_constraint" && command.constraint.kind === "angle").length, 6);
  assert.equal(shapes[1].at(-1)?.kind, "add_recipe");
  assert.equal(shapes[1].at(-1)?.kind === "add_recipe" && shapes[1].at(-1)?.recipe.kind, "polygon");
  assert.equal(shapes[2].at(-1)?.kind === "add_recipe" && shapes[2].at(-1)?.recipe.kind, "slot");
  assert.deepEqual(new Set(shapes[2].filter((command) => command.kind === "add_constraint").map((command) => command.constraint.kind)), new Set(["coincident", "parallel", "equal", "tangent", "distance", "line_distance", "radius"]));
  const slotTangencies = shapes[2].filter((command) => command.kind === "add_constraint" && command.constraint.kind === "tangent");
  assert.equal(slotTangencies.length, 4);
  assert.equal(shapes[2].filter((command) => command.kind === "set_constraint_suppressed" && command.suppressed).length, 5);
  const spline = shapes[0][0];
  assert.equal(spline.kind, "add_geometry");
  assert.equal(spline.kind === "add_geometry" && spline.entity.geometry.kind, "control_point_spline");
  assert.deepEqual(spline.kind === "add_geometry" && spline.entity.geometry.kind === "control_point_spline" && spline.entity.geometry.knots_millionths, [0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  assert.equal(shapes[3][0].kind === "add_geometry" && shapes[3][0].entity.geometry.kind, "ellipse");
  assert.equal(shapes[4][0].kind === "add_geometry" && shapes[4][0].entity.geometry.kind, "elliptical_arc");
  assert.deepEqual(shapes.slice(5).map((commands) => commands[0].kind === "add_geometry" && commands[0].entity.geometry.kind), ["fit_point_spline", "conic", "sketch_point"]);
});

test("ellipse creation stores perpendicular principal axes even from a skew cursor", () => {
  const command = ellipseCommands(new StableSketchIds("s:principal"), { x_nm: 2, y_nm: 3 }, { x_nm: 12, y_nm: 8 }, { x_nm: 5, y_nm: 16 })[0];
  assert.equal(command.kind, "add_geometry");
  if (command.kind !== "add_geometry" || command.entity.geometry.kind !== "ellipse") return;
  const { center, major, minor } = command.entity.geometry;
  const majorVector = { x: major.x_nm - center.x_nm, y: major.y_nm - center.y_nm };
  const minorVector = { x: minor.x_nm - center.x_nm, y: minor.y_nm - center.y_nm };
  assert.ok(Math.abs(majorVector.x * minorVector.x + majorVector.y * minorVector.y) <= 10);
  assert.ok(Math.hypot(majorVector.x, majorVector.y) >= Math.hypot(minorVector.x, minorVector.y));
  const reversed = ellipseCommands(new StableSketchIds("s:reversed"), { x_nm: 0, y_nm: 0 }, { x_nm: 5, y_nm: 0 }, { x_nm: 0, y_nm: 12 })[0];
  assert.ok(reversed.kind === "add_geometry" && reversed.entity.geometry.kind === "ellipse" && Math.hypot(reversed.entity.geometry.major.x_nm, reversed.entity.geometry.major.y_nm) === 12);
});

test("editing operations generate atomic commands over selected stable geometry", () => {
  const value = sketch();
  const offset = canonicalOffsetCommands(value, ["a"], new StableSketchIds("s:offset"), 2);
  assert.equal(offset.length, 1);
  assert.equal(offset[0]?.kind, "add_operation");
  assert.equal(extendCommands(value, ["a"], 5).length, 1);
  assert.equal(mirrorCommands(value, ["a"], new StableSketchIds("s:mirror")).length, 2);
  assert.equal(linearPatternCommands(value, ["a"], new StableSketchIds("s:linear"), 10, 3).length, 3);
  assert.equal(circularPatternCommands(value, ["a"], new StableSketchIds("s:circular"), 4).length, 4);
  assert.equal(chamferCommands(value, ["a", "b"], new StableSketchIds("s:chamfer"), 2).length, 4);
  const fillet = filletCommands(value, ["a", "b"], new StableSketchIds("s:fillet"), 2);
  assert.equal(fillet.length, 4);
  assert.equal(fillet.at(-1)?.kind, "add_operation");
});

test("P1 edit generators retain editable associative operations and topology", () => {
  const value = sketch();
  const operation = (commands: ReturnType<typeof canonicalOffsetCommands>) => commands.find((command) => command.kind === "add_operation");
  const offset = operation(canonicalOffsetCommands(value, ["a"], new StableSketchIds("p1:offset"), 3, { twoSided: true }));
  assert.ok(offset?.kind === "add_operation" && offset.operation.kind === "offset");
  if (offset?.kind === "add_operation" && offset.operation.kind === "offset") {
    assert.equal(offset.operation.result_chains.length, 4);
    assert.equal(offset.operation.linked, true);
  }
  const mirror = operation(mirrorCommands(value, ["a", "b"], new StableSketchIds("p1:mirror")));
  assert.ok(mirror?.kind === "add_operation" && mirror.operation.kind === "mirror" && mirror.operation.axis === "b");
  const linear = operation(linearPatternCommands(value, ["a"], new StableSketchIds("p1:linear"), 12, 4, { direction: { x_nm: 8, y_nm: 12 }, extent: true }));
  assert.ok(linear?.kind === "add_operation" && linear.operation.kind === "linear_pattern" && linear.operation.instances.length === 3 && linear.operation.extent);
  const circular = operation(circularPatternCommands(value, ["a"], new StableSketchIds("p1:circular"), 5, { center: { x_nm: 2, y_nm: 4 }, angleMicrodegrees: 180_000_000 }));
  assert.ok(circular?.kind === "add_operation" && circular.operation.kind === "circular_pattern" && circular.operation.angle_microdegrees === 180_000_000);

  for (const commands of [
    breakCommands(value, ["a"], new StableSketchIds("p1:break"), [0.25, 0.75]),
    scaleCommands(value, ["a"], new StableSketchIds("p1:scale"), 1.5),
    moveCopyCommands(value, ["a"], new StableSketchIds("p1:move"), { x_nm: 7, y_nm: 9 }),
    blendCommands(value, ["a", "b"], new StableSketchIds("p1:blend"), 5, "g2"),
  ]) assert.equal(commands.at(-1)?.kind, "add_operation");
});

test("canonical offset commands leave all result generation to one durable operation", () => {
  const value = sketch();
  value.geometry.spline = { id: "spline", geometry: { kind: "control_point_spline", degree: 3, control_points: [{ x_nm: 0, y_nm: 100 }, { x_nm: 10, y_nm: 120 }, { x_nm: 20, y_nm: 90 }, { x_nm: 30, y_nm: 100 }] } };
  const commands = canonicalOffsetCommands(value, ["spline"], new StableSketchIds("s:canonical-offset"), 3);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].kind, "add_operation");
  if (commands[0].kind !== "add_operation" || commands[0].operation.kind !== "offset") return;
  assert.equal(commands[0].operation.sources[0], "spline");
  assert.equal(commands[0].operation.result_chains.length, commands[0].operation.sources.length);
  assert.ok(commands[0].operation.result_chains.every((chain) => chain.length === 1));
  assert.deepEqual(commands[0].operation.result_spans, [[]]);
  assert.equal(commands[0].operation.model_tolerance_nm, 1_000);
  assert.equal(commands.some((command) => command.kind === "add_geometry" || command.kind === "add_constraint"), false);
});
