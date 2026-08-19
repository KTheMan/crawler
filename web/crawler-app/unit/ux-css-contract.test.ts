import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("forced-colors preserves focus, state, modal, and sketch boundaries", () => {
  const forcedColors = css.slice(css.indexOf("@media (forced-colors: active)"));
  assert.ok(forcedColors.length > 2_000, "forced-colors contract should be substantive");
  assert.match(forcedColors, /outline:\s*3px solid Highlight/);
  assert.match(forcedColors, /\[aria-disabled="true"\]/);
  assert.match(forcedColors, /border:\s*3px double CanvasText/);
  assert.match(forcedColors, /#modal-scrim/);
  assert.match(forcedColors, /#sketch-overlay \.sketch-entity\.selected/);
  assert.match(forcedColors, /#sketch-overlay \.sketch-box-selection/);
});

test("narrow reflow removes fixed page width and collapses the browser column", () => {
  const reflowStart = css.indexOf("@media (max-width: 640px)");
  const forcedColorsStart = css.indexOf("@media (forced-colors: active)");
  const reflow = css.slice(reflowStart, forcedColorsStart);
  assert.ok(reflowStart >= 0 && forcedColorsStart > reflowStart);
  assert.match(reflow, /body\s*\{\s*min-width:\s*0/);
  assert.match(reflow, /grid-template-columns:\s*32px minmax\(0, 1fr\)/);
  assert.match(reflow, /\.browser-panel\s*\{\s*display:\s*none/);
  assert.match(reflow, /#command-search[\s\S]*?width:\s*auto/);
  assert.match(reflow, /\.dialog-card,[\s\S]*?width:\s*calc\(100vw - 16px\)/);
});

test("active text and compact targets retain explicit floors", () => {
  assert.match(css, /--target-min:\s*24px/);
  assert.match(css, /--target-compact:\s*30px/);
  assert.match(css, /Human-factors type floor:[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.timeline-item,[\s\S]*?min-height:\s*var\(--target-min\)/);
  assert.match(css, /\.menu-popover button,[\s\S]*?min-height:\s*var\(--target-compact\)/);
});

test("technical chrome shares restrained geometry, elevation, and focus tokens", () => {
  const chrome = css.slice(css.indexOf("Cohesive technical chrome"), css.indexOf("@media (forced-colors: active)"));
  assert.match(chrome, /--chrome-radius-control:\s*3px/);
  assert.match(chrome, /--chrome-radius-popover:\s*5px/);
  assert.match(chrome, /--chrome-popover-shadow:/);
  assert.match(chrome, /--chrome-focus-ring:/);
  assert.match(chrome, /\.menu-popover, \.ribbon-group > \.ribbon-flyout, \.context-surface, \.viewport-background-menu/);
  assert.match(chrome, /\.panel-title[\s\S]*?text-transform:\s*none/);
  assert.match(chrome, /\.viewport-tools,[\s\S]*?border-radius:\s*var\(--chrome-radius-popover\)/);
  assert.match(chrome, /Imported CAD command artwork is intentionally left untouched/);
});
