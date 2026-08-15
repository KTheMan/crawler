import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const runId = process.env.SKETCH_SCALE_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const outputRoot = path.resolve(root, process.env.SKETCH_SCALE_OUTPUT ?? "../../docs/qualification/output/sketch-workspace-scale");
const runDirectory = path.join(outputRoot, runId);
const deadlineMs = Number(process.env.SKETCH_SCALE_TIMEOUT_MS ?? 180_000);
const customCells = Number.parseInt(process.env.SKETCH_SCALE_CELLS ?? "", 10);
const requestedTiers = (process.env.SKETCH_SCALE_TIERS ?? "multiple-100,large-500,huge-1000").split(",").map((value) => value.trim()).filter(Boolean);
const scenarios = Number.isInteger(customCells) && customCells > 0
  ? [{ id: `custom-${customCells}`, env: { SKETCH_SCALE_CELLS: String(customCells) } }]
  : requestedTiers.map((id) => ({ id, env: { SKETCH_SCALE_TIER: id } }));

if (!scenarios.length) throw new Error("No sketch scale tiers were selected");

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function terminateTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* already stopped */ } }
}

async function runScenario(scenario, index) {
  const directory = path.join(runDirectory, scenario.id);
  await mkdir(directory, { recursive: true });
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
  const playwright = ["exec", "playwright", "test", "tests/sketch-workspace-scale.spec.ts", "--config", "playwright.performance.config.ts", "--workers=1"];
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `call pnpm ${playwright.join(" ")}`]
    : playwright;
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, {
    cwd: root,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...scenario.env,
      SKETCH_PERF_PORT: String(4400 + index),
      SKETCH_PERF_RUN_ID: runId,
      SKETCH_PERF_ARTIFACT_DIR: directory,
    },
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { const value = chunk.toString(); stdout += value; process.stdout.write(value); });
  child.stderr.on("data", (chunk) => { const value = chunk.toString(); stderr += value; process.stderr.write(value); });
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => { terminateTree(child); resolve({ status: "timed_out", exitCode: null }); }, deadlineMs);
    child.once("exit", (exitCode) => { clearTimeout(timer); resolve({ status: exitCode === 0 ? "passed" : "failed", exitCode }); });
  });
  await Promise.all([
    writeFile(path.join(directory, "stdout.log"), stdout),
    writeFile(path.join(directory, "stderr.log"), stderr),
  ]);
  let result;
  try {
    result = JSON.parse(await readFile(path.join(directory, `sketch-workspace-scale-${scenario.id}.json`), "utf8")).result;
  } catch { /* timeout/failure metadata is still useful without child evidence */ }
  const metadata = { id: scenario.id, runId, startedAt, finishedAt: new Date().toISOString(), deadlineMs, ...outcome, result };
  await writeFile(path.join(directory, "metadata.json"), JSON.stringify(metadata, null, 2));
  return metadata;
}

await mkdir(runDirectory, { recursive: true });
if (!process.argv.includes("--skip-build")) {
  if (process.platform === "win32") run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "call pnpm run build"]);
  else run("pnpm", ["run", "build"]);
}

const results = [];
for (const [index, scenario] of scenarios.entries()) results.push(await runScenario(scenario, index));
const artifact = { schemaVersion: 1, runId, deadlineMs, results, finalizedAt: new Date().toISOString() };
await writeFile(path.join(runDirectory, "results.json"), JSON.stringify(artifact, null, 2));
await writeFile(path.join(outputRoot, "latest.json"), JSON.stringify({ runId, artifact: `${runId}/results.json` }, null, 2));
console.log(`Sketch workspace scale artifact: ${path.join(runDirectory, "results.json")}`);
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
