import assert from "node:assert/strict";
import test from "node:test";
import type { Constraint, Sketch } from "../src/sketch-editor.ts";
import { constraintPointKey, constraintVisualOperands, layoutConstraintGlyphs, positionedConstraintVisualOperands, selectedConstraintIds, sketchConstraintCoverage, sketchConstraintIcon, sketchConstraintVisualState, sketchPointMobility } from "../src/sketch-constraint-visuals.ts";

const sketch = (): Sketch => ({
  id: "sketch:constraint-visuals",
  revision: 0,
  geometry: {
    arc: {
      id: "arc",
      geometry: {
        kind: "arc",
        center: { x_nm: 0, y_nm: 0 },
        start: { x_nm: 10_000_000, y_nm: 0 },
        end: { x_nm: 0, y_nm: 10_000_000 },
        clockwise: false,
      },
    },
    line: {
      id: "line",
      geometry: {
        kind: "line",
        start: { x_nm: 0, y_nm: 10_000_000 },
        end: { x_nm: 20_000_000, y_nm: 10_000_000 },
      },
    },
  },
  constraints: {
    diameter: { kind: "diameter", geometry: "arc", diameter_nm: 20_000_000 },
    join: {
      kind: "coincident",
      a: { geometry: "arc", anchor: "end" },
      b: { geometry: "line", anchor: "start" },
    },
  },
});

test("diameter constrains the arc body without claiming its free endpoints", () => {
  const coverage = sketchConstraintCoverage(sketch());
  assert.equal(coverage.geometry.has("arc"), true);
  assert.equal(coverage.points.has(constraintPointKey({ geometry: "arc", anchor: "start" })), false);
  assert.equal(coverage.points.has(constraintPointKey({ geometry: "arc", anchor: "end" })), true);
  assert.equal(coverage.points.has(constraintPointKey({ geometry: "arc", anchor: "center" })), false);
});

test("suppressed constraints do not blacken their targets", () => {
  const value = sketch();
  value.suppressed_constraints = ["diameter", "join"];
  const coverage = sketchConstraintCoverage(value);
  assert.equal(coverage.geometry.has("arc"), false);
  assert.equal(coverage.points.size, 0);
});

test("viewport relations are scoped to a whole curve or its specifically selected point", () => {
  const value = sketch();
  assert.deepEqual([...selectedConstraintIds(value, [], [])], []);
  assert.deepEqual([...selectedConstraintIds(value, ["arc"], [])], ["diameter", "join"]);
  assert.deepEqual(
    [...selectedConstraintIds(value, ["arc"], [{ geometry: "arc", anchor: "start" }])],
    [],
  );
  assert.deepEqual(
    [...selectedConstraintIds(value, ["arc"], [{ geometry: "arc", anchor: "end" }])],
    ["join"],
  );
  assert.deepEqual([...selectedConstraintIds(value, [], [], "diameter")], ["diameter"]);
});

test("constraint symbols are real vector glyphs rather than letter placeholders", () => {
  const representativeKinds: Constraint["kind"][] = ["horizontal", "vertical", "coincident", "midpoint", "tangent", "diameter"];
  for (const kind of representativeKinds) {
    const markup = sketchConstraintIcon(kind);
    assert.match(markup, /^<svg/);
    assert.doesNotMatch(markup, /<text|>H<|>V<|>●</);
    assert.match(markup, /(?:path|circle|rect|ellipse)/);
  }
});

test("relation visualization exposes semantic point and curve operands in stable order", () => {
  const value = sketch();
  assert.deepEqual(constraintVisualOperands(value.constraints.join), [
    { geometry: "arc", anchor: "end", role: "point" },
    { geometry: "line", anchor: "start", role: "point" },
  ]);
  assert.deepEqual(constraintVisualOperands(value.constraints.diameter), [
    { geometry: "arc", role: "curve" },
  ]);
  assert.deepEqual(positionedConstraintVisualOperands(value, value.constraints.join).map(({ point, ...operand }) => ({ ...operand, point })), [
    { geometry: "arc", anchor: "end", role: "point", point: { x_nm: 0, y_nm: 10_000_000 } },
    { geometry: "line", anchor: "start", role: "point", point: { x_nm: 0, y_nm: 10_000_000 } },
  ]);
});

test("mobility distinguishes locked relations from the remaining arc and line directions", () => {
  const value = sketch();
  assert.equal(sketchPointMobility(value, { geometry: "arc", anchor: "start" }), "angular");
  assert.equal(sketchPointMobility(value, { geometry: "arc", anchor: "end" }), "none");
  assert.equal(sketchPointMobility(value, { geometry: "arc", anchor: "center" }), "xy");
  assert.equal(sketchPointMobility(value, { geometry: "line", anchor: "start" }), "none");
  assert.equal(sketchPointMobility(value, { geometry: "line", anchor: "end" }), "xy");
  value.constraints.horizontal = { kind: "horizontal", line: "line" };
  assert.equal(sketchPointMobility(value, { geometry: "line", anchor: "end" }), "x");
  value.suppressed_constraints = ["diameter"];
  assert.equal(sketchPointMobility(value, { geometry: "arc", anchor: "start" }), "xy");
});

test("glyph layout is deterministic, viewport-bounded, and avoids dimensions and peer glyphs", () => {
  const inputs = [
    { id: "dimension:a", x: 40, y: 40, width: 70, height: 22, fixed: true },
    { id: "a", x: 42, y: 40 },
    { id: "b", x: 42, y: 40 },
    { id: "c", x: 42, y: 40 },
  ] as const;
  const first = layoutConstraintGlyphs(inputs, { width: 140, height: 100 });
  const second = layoutConstraintGlyphs(inputs, { width: 140, height: 100 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((placement) => placement.id), ["a", "b", "c"]);
  assert.equal(new Set(first.map((placement) => `${placement.x}:${placement.y}`)).size, 3);
  assert.ok(first.every((placement) => placement.x >= 2 && placement.x <= 110 && placement.y >= 2 && placement.y <= 70));
  assert.ok(first.every((placement) => placement.displaced));
  assert.deepEqual(first.map((placement) => placement.clusterIndex), [0, 1, 2]);
  assert.ok(first.every((placement) => placement.clusterSize === 3));
});

test("constraint visual states distinguish driving, reference, redundant, conflict, and dangling relations", () => {
  const value = sketch();
  assert.equal(sketchConstraintVisualState(value, "diameter"), "driving");
  value.suppressed_constraints = ["diameter", "join"];
  assert.equal(sketchConstraintVisualState(value, "diameter"), "reference");
  assert.equal(sketchConstraintVisualState(value, "join"), "suppressed");
  value.suppressed_constraints = [];
  assert.equal(sketchConstraintVisualState(value, "join", { redundant: new Set(["join"]) }), "redundant");
  assert.equal(sketchConstraintVisualState(value, "join", { conflicting: new Set(["join"]) }), "conflicting");
  assert.equal(sketchConstraintVisualState(value, "diameter", { solveState: "over_constrained" }), "unsolvable");
  delete value.geometry.line;
  assert.equal(sketchConstraintVisualState(value, "join"), "dangling");
});
