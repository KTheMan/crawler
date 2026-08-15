import assert from "node:assert/strict";
import test from "node:test";
import { SKETCH_SVG_LAYER_NAMES, SketchSvgLayerCache } from "../src/sketch-svg-layer-cache.ts";

test("sketch SVG layer cache only invalidates changed layers", () => {
  const cache = new SketchSvgLayerCache();
  assert.equal(cache.update("geometry", "<line/>"), true);
  assert.equal(cache.update("geometry", "<line/>"), false);
  assert.equal(cache.update("transient", "<circle/>"), true);
  assert.equal(cache.update("geometry", "<path/>"), true);
  assert.equal(cache.update("transient", "<circle/>"), false);
});

test("individual and full invalidation force the next layer update", () => {
  const cache = new SketchSvgLayerCache();
  for (const name of SKETCH_SVG_LAYER_NAMES) cache.update(name, name);
  cache.invalidate("geometry");
  assert.equal(cache.update("geometry", "geometry"), true);
  assert.equal(cache.update("handles", "handles"), false);
  cache.invalidate();
  for (const name of SKETCH_SVG_LAYER_NAMES) assert.equal(cache.update(name, name), true);
});
