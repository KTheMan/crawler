import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const forbiddenMarkers = [
  "MM_Gray_blue_yellow.zip",
  "mm-gray-blue-yellow",
  "FreeCAD_Nut_Icons.fctheme",
  "freecad-nut-icons",
  "Bundled development themes",
  "data-development-theme=",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".webmanifest"]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }))).flat();
}

const files = await filesUnder(dist);
const violations = [];
for (const file of files) {
  const extension = extname(file).toLowerCase();
  if (extension === ".zip" || extension === ".fctheme") violations.push(relative(dist, file));
  if (!textExtensions.has(extension)) continue;
  const text = await readFile(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (text.includes(marker)) violations.push(`${relative(dist, file)} contains ${marker}`);
  }
}

if (violations.length) {
  throw new Error(`Production build contains development theme assets:\n${violations.join("\n")}`);
}

console.log("Production theme boundary verified: no bundled theme archives.");
