import assert from "node:assert/strict";
import test from "node:test";

import type { GeometryEntity, Sketch } from "../src/sketch-editor.ts";
import { planIntersectionTrim } from "../src/sketch-trim.ts";

const sketch = (...entities: GeometryEntity[]): Sketch => ({
  id: "trim-test",
  revision: 0,
  geometry: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
  constraints: {},
});

const ids = () => {
  let value = 0;
  return () => `replacement:${value++}`;
};

test("line trim removes only the intersection-bounded interval under the cursor", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 4, y_nm: -5 }, end: { x_nm: 4, y_nm: 5 } } },
  ), "source", undefined, { x_nm: 2, y_nm: 0 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 1);
  assert.deepEqual(plan.commands, [
    { kind: "remove_geometry", geometry: "source" },
    { kind: "add_geometry", entity: { id: "replacement:0", construction: undefined, geometry: { kind: "line", start: { x_nm: 4, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } } },
  ]);
});

test("circle trim uses real exact intersections rather than a canned quadrant", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 5 } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 0, y_nm: -10 }, end: { x_nm: 0, y_nm: 10 } } },
  ), "source", undefined, { x_nm: 5, y_nm: 0 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 2);
  assert.equal(plan.replacements.length, 1);
  assert.equal(plan.commands[1].kind, "add_geometry");
  if (plan.commands[1].kind === "add_geometry") {
    assert.deepEqual(plan.commands[1].entity.geometry, {
      kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 0, y_nm: 5 }, end: { x_nm: 0, y_nm: -5 }, clockwise: false,
    });
  }
});

test("arc trim keeps the unclicked side of an actual intersection", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 5, y_nm: 0 }, end: { x_nm: -5, y_nm: 0 }, clockwise: false } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 10 } } },
  ), "source", undefined, { x_nm: 4, y_nm: 2 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 1);
  assert.equal(plan.replacements.length, 1);
  assert.equal(plan.commands[1].kind, "add_geometry");
  if (plan.commands[1].kind === "add_geometry") {
    assert.deepEqual(plan.commands[1].entity.geometry, {
      kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 0, y_nm: 5 }, end: { x_nm: -5, y_nm: 0 }, clockwise: false,
    });
  }
});

test("arc trim accepts exact lattice intersections on a non-integer radius", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 2, y_nm: 1 }, end: { x_nm: -2, y_nm: 1 }, clockwise: false } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 1, y_nm: 0 }, end: { x_nm: 1, y_nm: 4 } } },
  ), "source", undefined, { x_nm: 2, y_nm: 1 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 1);
  assert.equal(plan.commands[1].kind, "add_geometry");
  if (plan.commands[1].kind === "add_geometry") {
    assert.deepEqual(plan.commands[1].entity.geometry, {
      kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 1, y_nm: 2 }, end: { x_nm: -2, y_nm: 1 }, clockwise: false,
    });
  }
});

test("rectangle trim preserves other edges and intersection-bounds the selected edge", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "rectangle", min: { x_nm: 0, y_nm: 0 }, max: { x_nm: 10, y_nm: 10 } } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 4, y_nm: -5 }, end: { x_nm: 4, y_nm: 5 } } },
  ), "source", 0, { x_nm: 2, y_nm: 0 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 1);
  assert.equal(plan.replacements.length, 4);
  assert.deepEqual(plan.commands.at(-1), {
    kind: "add_geometry",
    entity: { id: "replacement:3", construction: undefined, geometry: { kind: "line", start: { x_nm: 4, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
  });
});

test("native conic trim finds tolerance-bounded intersections and preserves editable native pieces", () => {
  const plan = planIntersectionTrim(sketch(
    { id: "source", geometry: { kind: "conic", start: { x_nm: -20, y_nm: 0 }, control: { x_nm: 0, y_nm: 40 }, end: { x_nm: 20, y_nm: 0 }, weight_millionths: 1_000_000 } },
    { id: "boundary", geometry: { kind: "line", start: { x_nm: 0, y_nm: -10 }, end: { x_nm: 0, y_nm: 30 } } },
  ), "source", undefined, { x_nm: -15, y_nm: 5 }, ids());
  assert.ok(plan);
  assert.equal(plan.boundaryCount, 1);
  assert.equal(plan.replacements.length, 1);
  assert.equal(plan.commands[1].kind === "add_geometry" && plan.commands[1].entity.geometry.kind, "fit_point_spline");
});
