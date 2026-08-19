import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { colorsFromFreeCadParameters, importThemeArchive, themeImporterInternals } from "../src/theme-importer.ts";
import { crawlerToolIdForFreeCadCommand } from "../src/freecad-icon-map.ts";

test("imports a legacy FreeCAD iconset manifest without bundling its assets", () => {
  const archive = zipSync({
    "MM_Gray_blue_yellow.txt": strToU8([
      "PartDesign_Pad, iconset:MM/PartDesign/PartDesign_Pad.png",
      "PartDesign_Pocket, iconset:MM/PartDesign/PartDesign_Pocket.png",
      "PartDesign_Groove, iconset:MM/PartDesign/PartDesign_Groove.png",
      "Sketcher_CreateRectangle, iconset:MM/Sketcher/Sketcher_CreateRectangle.png",
    ].join("\n")),
    "MM/PartDesign/PartDesign_Pad.png": new Uint8Array([137, 80, 78, 71]),
    "MM/PartDesign/PartDesign_Pocket.png": new Uint8Array([137, 80, 78, 71, 2]),
    "MM/PartDesign/PartDesign_Groove.png": new Uint8Array([137, 80, 78, 71, 3]),
    "MM/Sketcher/Sketcher_CreateRectangle.png": new Uint8Array([137, 80, 78, 71, 1]),
  });

  const theme = importThemeArchive(archive, "MM_Gray_blue_yellow.zip");

  assert.equal(theme.source.kind, "legacy-freecad-icons");
  assert.deepEqual(Object.keys(theme.icons).sort(), ["extrude", "extrude-cut", "rect", "rectangle", "revolve-cut"]);
  assert.equal(theme.icons.extrude.mime, "image/png");
  assert.equal(theme.icons.extrude.sourcePath, "MM/PartDesign/PartDesign_Pad.png");
  assert.equal(theme.icons["extrude-cut"].sourcePath, "MM/PartDesign/PartDesign_Pocket.png");
  assert.equal(theme.icons["revolve-cut"].sourcePath, "MM/PartDesign/PartDesign_Groove.png");
  assert.deepEqual(theme.colors, {});
});

test("imports proposed FCTheme metadata, QSS colors, and explicit icons", () => {
  const archive = zipSync({
    "theme.xml": strToU8(`
      <theme themefileversion="1.0">
        <name>Workbench Blue</name><author>Example</author><type>light</type>
        <stylesheet>theme.qss</stylesheet>
        <icons><icon name="PartDesign_Pad" path="icons/pad.svg" /></icons>
      </theme>`),
    "theme.qss": strToU8(`
      * { color: #202630; }
      QMainWindow, QDialog, QDockWidget { background-color: #e8edf4; }
      QMenu::item:selected { background-color: #3578c8; }
      QLineEdit { background-color: #ffffff; }
    `),
    "icons/pad.svg": strToU8(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
  });

  const theme = importThemeArchive(archive, "workbench.fctheme");

  assert.equal(theme.source.kind, "fctheme");
  assert.equal(theme.name, "Workbench Blue");
  assert.equal(theme.author, "Example");
  assert.equal(theme.mode, "light");
  assert.equal(theme.colors["--bg"], "#e8edf4");
  assert.equal(theme.colors["--text"], "#202630");
  assert.equal(theme.colors["--accent"], "#3578c8");
  assert.equal(theme.icons.extrude.mime, "image/svg+xml");
});

test("maps FreeCAD feature names to Crawler's CAD-neutral vocabulary", () => {
  assert.equal(crawlerToolIdForFreeCadCommand("PartDesign_Pad"), "extrude");
  assert.equal(crawlerToolIdForFreeCadCommand("PartDesign_Pocket"), "extrude-cut");
  assert.equal(crawlerToolIdForFreeCadCommand("PartDesign_Groove"), "revolve-cut");
  assert.equal(crawlerToolIdForFreeCadCommand("Part_Fuse"), "combine");
});

test("resolves FreeCAD parameter aliases and color functions into web tokens", () => {
  const result = colorsFromFreeCadParameters(`
    PrimaryColor: "#191919"
    GeneralBackgroundColor: "@PrimaryColor"
    DialogBackgroundColor: "lighten(@PrimaryColor, 5)"
    ThemeAccentColor1: "#5B9EEB"
    AccentColor: "@ThemeAccentColor1"
    TextForegroundColor: "#f0f0f0"
  `);

  assert.equal(result.mode, "dark");
  assert.equal(result.colors["--bg"], "#191919");
  assert.equal(result.colors["--chrome"], "#252525");
  assert.equal(result.colors["--accent"], "#5B9EEB");
});

test("accepts a GitHub repository tree URL and rejects non-GitHub sources", () => {
  assert.deepEqual(themeImporterInternals.parseGitHubUrl("https://github.com/FreeCAD-Nut/FreeCAD/tree/main"), {
    owner: "FreeCAD-Nut", repo: "FreeCAD", ref: "main",
  });
  assert.throws(() => themeImporterInternals.parseGitHubUrl("https://example.com/theme"), /Only github\.com/);
});
