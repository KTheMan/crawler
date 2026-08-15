import assert from "node:assert/strict";
import test from "node:test";
import { keyedSketchSvgMarkup } from "../src/sketch-svg-reconciler.ts";

test("keyed SVG markup gives stable entity and segment occurrence keys", () => {
  const fragments = keyedSketchSvgMarkup([
    '<line data-sketch-geometry="box" data-sketch-segment="0"/>',
    '<line data-sketch-geometry="box" data-sketch-segment="1"/>',
    '<line data-sketch-geometry="line"/>',
  ], "data-sketch-geometry", "geometry");
  assert.deepEqual(fragments.map(({ key }) => key), ["geometry:box:0", "geometry:box:1", "geometry:line:0"]);
});

test("anonymous markup remains deterministically keyed by position", () => {
  assert.deepEqual(keyedSketchSvgMarkup(["<path/>", "<circle/>"], "data-id", "overlay").map(({ key }) => key), ["overlay:anonymous:0:0", "overlay:anonymous:1:0"]);
});
