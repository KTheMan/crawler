import assert from "node:assert/strict";
import test from "node:test";
import { StableSketchIds, type GeometryEntity, type Sketch } from "../src/sketch-editor.ts";
import { canonicalOffsetCommands, planConnectedOffsetChain, type OffsetChainInstrumentation } from "../src/sketch-operations.ts";

function makeSketch(entities: readonly GeometryEntity[]): Sketch {
  return {
    id: "sketch:offset-chain",
    revision: 0,
    geometry: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    constraints: {},
  };
}

test("endpoint adjacency emits a deterministic geometric chain independent of insertion and seed order", () => {
  const entities: GeometryEntity[] = [
    { id: "middle", geometry: { kind: "line", start: { x_nm: 10, y_nm: 0 }, end: { x_nm: 20, y_nm: 0 } } },
    { id: "last", geometry: { kind: "line", start: { x_nm: 20, y_nm: 0 }, end: { x_nm: 30, y_nm: 0 } } },
    { id: "first", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
  ];
  assert.deepEqual(planConnectedOffsetChain(makeSketch(entities), ["last"]).sources, ["first", "middle", "last"]);
  assert.deepEqual(planConnectedOffsetChain(makeSketch([...entities].reverse()), ["middle", "first"]).sources, ["first", "middle", "last"]);
});

test("endpoint adjacency typed-rejects branching and disconnected selected components", () => {
  const branched = makeSketch([
    { id: "left", geometry: { kind: "line", start: { x_nm: -1, y_nm: 0 }, end: { x_nm: 0, y_nm: 0 } } },
    { id: "right", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 1, y_nm: 0 } } },
    { id: "up", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 1 } } },
  ]);
  assert.equal(planConnectedOffsetChain(branched, ["right"]).rejection?.reason, "branched_endpoint");

  const disconnected = makeSketch([
    { id: "a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 1, y_nm: 0 } } },
    { id: "b", geometry: { kind: "line", start: { x_nm: 10, y_nm: 0 }, end: { x_nm: 11, y_nm: 0 } } },
  ]);
  assert.equal(planConnectedOffsetChain(disconnected, ["a", "b"]).rejection?.reason, "disconnected_endpoint_component");
});

test("explicit construction and external seeds retain legacy traversal semantics", () => {
  const value = makeSketch([
    { id: "normal-from-construction", geometry: { kind: "line", start: { x_nm: 2, y_nm: 0 }, end: { x_nm: 4, y_nm: 0 } } },
    { id: "normal-from-both", geometry: { kind: "line", start: { x_nm: 1, y_nm: 0 }, end: { x_nm: 3, y_nm: 0 } } },
    { id: "construction", construction: true, geometry: { kind: "line", start: { x_nm: 1, y_nm: 0 }, end: { x_nm: 2, y_nm: 0 } } },
    { id: "external:seed", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 1, y_nm: 0 } } },
  ]);
  assert.deepEqual(planConnectedOffsetChain(value, ["external:seed"]).sources, ["external:seed", "normal-from-both"]);
  assert.equal(planConnectedOffsetChain(value, ["construction", "external:seed"]).rejection?.reason, "branched_endpoint");
});

test("planning rejects malformed selected endpoints and isolates malformed non-seeds", () => {
  const malformed = makeSketch([
    { id: "a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 1, y_nm: 0 } } },
    { id: "bad", geometry: { kind: "line", start: { x_nm: Number.NaN, y_nm: 0 }, end: { x_nm: 1, y_nm: 0 } } },
    { id: "b", geometry: { kind: "line", start: { x_nm: 1, y_nm: 0 }, end: { x_nm: 2, y_nm: 0 } } },
    { id: "short-spline", geometry: { kind: "control_point_spline", degree: 1, control_points: [{ x_nm: 2, y_nm: 0 }] } },
  ]);
  const validPlan = planConnectedOffsetChain(malformed, ["a"]);
  assert.deepEqual(validPlan.sources, ["a", "b"]);
  assert.equal(validPlan.instrumentation.invalidEndpointGeometryCount, 2);
  const rejected = planConnectedOffsetChain(malformed, ["bad"]);
  assert.deepEqual(rejected.rejection, { geometry: "bad", reason: "nonfinite_endpoint" });
  const counters = {} as OffsetChainInstrumentation;
  assert.deepEqual(canonicalOffsetCommands(malformed, ["bad"], new StableSketchIds("bad-offset"), 10, { chainInstrumentation: counters }), []);
  assert.equal(counters.rejectedSeedGeometryCount, 1);

  const degenerate = makeSketch([{ id: "zero", geometry: { kind: "line", start: { x_nm: 4, y_nm: 4 }, end: { x_nm: 4, y_nm: 4 } } }]);
  assert.equal(planConnectedOffsetChain(degenerate, ["zero"]).rejection?.reason, "degenerate_endpoint");
});

test("reversed long chains have bounded linear planning work", () => {
  const count = 5_000;
  const entities: GeometryEntity[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    entities.push({
      id: `line:${index}`,
      geometry: { kind: "line", start: { x_nm: index, y_nm: 0 }, end: { x_nm: index + 1, y_nm: 0 } },
    });
  }
  const plan = planConnectedOffsetChain(makeSketch(entities), ["line:0"]);
  assert.equal(plan.sources.length, count);
  assert.deepEqual(plan.sources.slice(0, 4), ["line:0", "line:1", "line:2", "line:3"]);
  assert.equal(plan.sources.at(-1), `line:${count - 1}`);
  assert.equal(plan.instrumentation.sceneGeometryVisits, count);
  assert.equal(plan.instrumentation.orderingGeometryVisits, count);
  assert.equal(plan.instrumentation.bfsDequeues, count);
  assert.equal(plan.instrumentation.bfsLevels, count - 1);
  assert.ok(plan.instrumentation.endpointIncidenceCount <= count * 2);
  assert.ok(plan.instrumentation.adjacencyVisits <= count * 4);
});

test("shared-endpoint hubs consume each incidence bucket once", () => {
  const count = 3_000;
  const hub = { x_nm: 0, y_nm: 0 };
  const entities: GeometryEntity[] = Array.from({ length: count }, (_, index) => ({
    id: `ray:${index}`,
    geometry: {
      kind: "line" as const,
      start: hub,
      end: { x_nm: index + 1, y_nm: index + 1 },
    },
  }));
  const plan = planConnectedOffsetChain(makeSketch(entities), ["ray:0"]);
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.rejection?.reason, "branched_endpoint");
  assert.equal(plan.instrumentation.endpointIncidenceCount, count * 2);
  assert.equal(plan.instrumentation.bfsDequeues, count);
  assert.equal(plan.instrumentation.bfsLevels, 1);
  assert.ok(
    plan.instrumentation.adjacencyVisits <= plan.instrumentation.endpointIncidenceCount,
    `${plan.instrumentation.adjacencyVisits} adjacency visits exceeded ${plan.instrumentation.endpointIncidenceCount} incidences`,
  );
});

test("command construction reuses the caller-owned chain plan without replanning", () => {
  const value = makeSketch([
    { id: "planned", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
    { id: "selected-but-not-planned", geometry: { kind: "line", start: { x_nm: 100, y_nm: 0 }, end: { x_nm: 110, y_nm: 0 } } },
  ]);
  const plan = planConnectedOffsetChain(value, ["planned"]);
  const commands = canonicalOffsetCommands(value, ["selected-but-not-planned"], new StableSketchIds("preplanned"), 2, { chainPlan: plan });
  const operation = commands.find((command) => command.kind === "add_operation");
  assert.equal(operation?.kind, "add_operation");
  assert.equal(operation?.operation.kind, "offset");
  if (operation?.operation.kind !== "offset") throw new Error("missing offset operation");
  assert.deepEqual(operation.operation.sources, ["planned"]);
});
