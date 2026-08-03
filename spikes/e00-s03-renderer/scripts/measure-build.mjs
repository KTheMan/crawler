import { brotliCompressSync, gzipSync } from "node:zlib";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.slice(1);
const inputs = [join(root, "dist"), join(root, "src", "generated")];
const rows = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if ([".js", ".wasm", ".css"].includes(extname(entry.name))) {
      const bytes = await readFile(path);
      rows.push({
        file: relative(root, path).replaceAll("\\", "/"),
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
        brotliBytes: brotliCompressSync(bytes).length,
      });
    }
  }
}

for (const directory of inputs) await collect(directory);
await mkdir(join(root, "results"), { recursive: true });
await writeFile(
  join(root, "results", "build-sizes.json"),
  `${JSON.stringify({ measuredAt: new Date().toISOString(), files: rows }, null, 2)}\n`,
);
console.log(JSON.stringify(rows, null, 2));
