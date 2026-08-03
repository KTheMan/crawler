import { readFile } from "node:fs/promises";

for (const name of ["build-sizes.json", "browser-metrics.json"]) {
  try {
    process.stdout.write(await readFile(new URL(`../results/${name}`, import.meta.url), "utf8"));
  } catch {
    console.error(`missing results/${name}`);
    process.exitCode = 1;
  }
}
