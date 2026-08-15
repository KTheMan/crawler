import assert from "node:assert/strict";
import test from "node:test";
import { deriveInlineCreationFields, solveInlineCreation } from "../src/sketch-inline-creation.ts";

const p = (x_nm: number, y_nm: number) => ({ x_nm, y_nm });
const value = (result: ReturnType<typeof solveInlineCreation>, key: string) => result.fields.find((field) => field.key === key)?.value;

test("line locks length and axis-relative angle while freeform creates no intent", () => {
  const free = solveInlineCreation({ tool: "line", points: [p(10, 20), p(13, 24)] });
  assert.deepEqual(free.points, [p(10, 20), p(13, 24)]);
  assert.equal(value(free, "length"), 5);
  assert.equal(free.dimensionIntents.length, 0);

  const locked = solveInlineCreation({ tool: "line", points: [p(10, 20), p(13, 24)], lockedFields: { length: 10, angle: 90_000_000 } });
  assert.deepEqual(locked.points, [p(10, 20), p(10, 30)]);
  assert.deepEqual(locked.dimensionIntents.map((intent) => [intent.field, intent.preferredConstraintKind]), [["length", "distance"], ["angle", "angle_to_axis"]]);
});

test("rectangle width and height respect corner, center, and oriented variants", () => {
  const corner = solveInlineCreation({ tool: "rectangle", variant: "two_point", points: [p(0, 0), p(-3, 4)], lockedFields: { width: 20, height: 10 } });
  assert.deepEqual(corner.points[1], p(-20, 10));
  const center = solveInlineCreation({ tool: "rectangle", variant: "center", points: [p(0, 0), p(3, -4)], lockedFields: { width: 20, height: 10 } });
  assert.deepEqual(center.points[1], p(10, -5));
  const oriented = solveInlineCreation({ tool: "rectangle", variant: "three_point", points: [p(0, 0), p(3, 4), p(-4, 3)], lockedFields: { width: 10, height: 8 } });
  assert.deepEqual(oriented.points, [p(0, 0), p(6, 8), p(-6, 5)]);
  assert.deepEqual(oriented.dimensionIntents.map((intent) => intent.pointIndices), [[0, 1], [0, 1, 2]]);
});

test("circle variants expose diameter or radius and solve explicitly locked values", () => {
  const center = solveInlineCreation({ tool: "circle", variant: "center_diameter", points: [p(0, 0), p(5, 0)], lockedFields: { diameter: 20 } });
  assert.deepEqual(center.points[1], p(10, 0));
  assert.equal(value(center, "diameter"), 20);
  const endpoints = solveInlineCreation({ tool: "circle", variant: "two_point", points: [p(0, 0), p(2, 0)], lockedFields: { diameter: 8 } });
  assert.deepEqual(endpoints.points[1], p(8, 0));
  const three = solveInlineCreation({ tool: "circle", variant: "three_point", points: [p(-5, 0), p(5, 0), p(0, 3)], lockedFields: { radius: 5 } });
  assert.equal(three.valid, true);
  assert.equal(value(three, "radius"), 5);
  assert.equal(three.dimensionIntents[0]?.preferredConstraintKind, "radius");
});

test("arc center-point fields lock radius and sweep; three-point arcs retain radius metadata", () => {
  const center = solveInlineCreation({ tool: "arc", variant: "center_point", points: [p(0, 0), p(5, 0), p(0, 7)], lockedFields: { radius: 10, angle: 90_000_000 } });
  assert.deepEqual(center.points, [p(0, 0), p(10, 0), p(0, 10)]);
  assert.deepEqual(center.dimensionIntents.map((intent) => intent.semantic), ["radius", "sweep_angle"]);
  const threeFields = deriveInlineCreationFields({ tool: "arc", variant: "three_point", points: [p(10, 0), p(0, 10), p(-10, 0)] });
  assert.deepEqual(threeFields.map((field) => field.key), ["radius", "angle"]);
  assert.equal(threeFields[0].value, 10);
  assert.equal(threeFields[1].value, 180_000_000);
});

test("polygon radius and side locks are separated into dimension and property intents", () => {
  const polygon = solveInlineCreation({ tool: "polygon", variant: "edge", points: [p(0, 0), p(1, 0)], sides: 6, lockedFields: { radius: 10, sides: 4 } });
  assert.equal(polygon.valid, true);
  assert.equal(polygon.sides, 4);
  assert.equal(value(polygon, "radius"), 10);
  assert.deepEqual(polygon.points[1], p(14, 0));
  assert.deepEqual(polygon.dimensionIntents.map((intent) => intent.semantic), ["polygon_radius"]);
  assert.deepEqual(polygon.propertyIntents, [{ field: "sides", value: 4, unit: "count", semantic: "polygon_sides" }]);
  const circumscribed = deriveInlineCreationFields({ tool: "polygon", variant: "circumscribed", points: [p(0, 0), p(8, 0)], sides: 6 });
  assert.equal(circumscribed.find((field) => field.key === "radius")?.semantic, "polygon_apothem");
});

test("straight slot length and full width respect center and overall semantics", () => {
  const centered = solveInlineCreation({ tool: "slot", variant: "center_point", points: [p(0, 0), p(4, 0), p(0, 2)], lockedFields: { length: 20, width: 6 } });
  assert.deepEqual(centered.points, [p(0, 0), p(10, 0), p(0, 3)]);
  assert.equal(value(centered, "length"), 20);
  assert.equal(value(centered, "width"), 6);
  const overallInvalid = solveInlineCreation({ tool: "slot", variant: "overall", points: [p(0, 0), p(10, 0), p(0, 3)], lockedFields: { width: 12 } });
  assert.equal(overallInvalid.valid, false);
  assert.deepEqual(overallInvalid.points, [p(0, 0), p(10, 0), p(0, 3)]);
  assert.equal(overallInvalid.dimensionIntents.length, 0);
});

test("arc slot supports centerline length and width", () => {
  const result = solveInlineCreation({ tool: "slot", variant: "three_point_arc", points: [p(10, 0), p(0, 10), p(-10, 0), p(0, 12)], lockedFields: { length: 31, width: 4 } });
  assert.equal(result.valid, true);
  assert.equal(value(result, "width"), 4);
  assert.ok(Math.abs((value(result, "length") ?? 0) - 31) <= 1);
  assert.deepEqual(result.dimensionIntents.map((intent) => intent.pointIndices), [[0, 1, 2], [1, 3]]);
});

test("ellipse axes solve independently and reject a locked minor larger than major", () => {
  const result = solveInlineCreation({ tool: "ellipse", points: [p(0, 0), p(4, 0), p(1, -2)], lockedFields: { major_radius: 10, minor_radius: 3 } });
  assert.deepEqual(result.points, [p(0, 0), p(10, 0), p(0, -3)]);
  assert.deepEqual(result.dimensionIntents.map((intent) => [intent.field, intent.preferredConstraintKind]), [["major_radius", "ellipse_radius"], ["minor_radius", "ellipse_radius"]]);
  const invalid = solveInlineCreation({ tool: "ellipse", points: [p(0, 0), p(4, 0), p(0, 2)], lockedFields: { minor_radius: 5 } });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.points, [p(0, 0), p(4, 0), p(0, 2)]);
});

test("invalid numeric input is safe, transactional, and produces no durable intent", () => {
  const points = [p(0, 0), p(2, 0)];
  const nonFinite = solveInlineCreation({ tool: "line", points, lockedFields: { length: Number.NaN } });
  assert.equal(nonFinite.valid, false);
  assert.deepEqual(nonFinite.points, points);
  assert.equal(nonFinite.dimensionIntents.length, 0);
  const degenerateRadius = solveInlineCreation({ tool: "circle", variant: "three_point", points: [p(-10, 0), p(10, 0), p(0, 5)], lockedFields: { radius: 2 } });
  assert.equal(degenerateRadius.valid, false);
  assert.match(degenerateRadius.errors[0], /too small/i);
});
