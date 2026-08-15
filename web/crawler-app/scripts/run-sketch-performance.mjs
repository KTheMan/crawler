import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpus, hostname, release, totalmem } from "node:os";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
const runId = process.env.SKETCH_PERF_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const defaultOutputRoot = path.resolve(root, "../../docs/qualification/output/sketch-performance");
const outputRoot = path.resolve(root, process.env.SKETCH_PERF_OUTPUT ?? defaultOutputRoot);
const runDirectory = path.join(outputRoot, runId);
const selfTest = process.argv.includes("--self-test");
const skipBuild = process.argv.includes("--skip-build") || selfTest;
const deadlineMs = Number(process.env.SKETCH_PERF_SCENE_TIMEOUT_MS ?? 90_000);

async function hashTree(directory) {
  const hash = createHash("sha256");
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      const file = path.join(current, name); const info = await stat(file);
      if (info.isDirectory()) await visit(file);
      else { hash.update(path.relative(directory, file)); hash.update(await readFile(file)); }
    }
  }
  await visit(directory); return hash.digest("hex");
}

function git(command, fallback = "unknown") {
  try { return execFileSync("git", command, { cwd: gitRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim() || fallback; } catch { return fallback; }
}

async function worktreeHash() {
  const hash = createHash("sha256");
  hash.update(git(["diff", "HEAD", "--binary"], ""));
  let untracked = [];
  try {
    untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: gitRoot })
      .toString("utf8").split("\0").filter(Boolean);
  } catch { /* tracked diff still identifies the source state */ }
  const generatedRoots = [
    path.relative(gitRoot, defaultOutputRoot),
    path.relative(gitRoot, outputRoot),
    path.relative(gitRoot, path.join(root, "output")),
    path.relative(gitRoot, path.join(root, "dist")),
    path.relative(gitRoot, path.join(root, "test-results")),
    path.relative(gitRoot, path.join(root, "playwright-report")),
  ].map((value) => value.replaceAll("\\", "/").replace(/\/$/, ""));
  for (const relative of untracked.map((value) => value.replaceAll("\\", "/")).sort()) {
    if (generatedRoots.some((generated) => relative === generated || relative.startsWith(`${generated}/`))) continue;
    try { hash.update(relative); hash.update(await readFile(path.join(gitRoot, relative))); } catch { hash.update(`missing:${relative}`); }
  }
  return hash.digest("hex");
}

function browserVersion() {
  try {
    if (process.platform === "win32") return execFileSync("powershell.exe", ["-NoProfile", "-Command", "$p=@(\"$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe\",\"$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe\")|Where-Object{Test-Path $_}|Select-Object -First 1;(Get-Item $p).VersionInfo.ProductVersion"], { encoding: "utf8" }).trim();
    return execFileSync("google-chrome", ["--version"], { encoding: "utf8" }).trim();
  } catch { return "unknown"; }
}

function terminateTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
}

async function runChild(scenario) {
  const scenarioDirectory = path.join(runDirectory, "scenarios", scenario.id);
  await mkdir(scenarioDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const metadataFile = path.join(scenarioDirectory, "parent-metadata.json");
  const scenarioDeadlineMs = scenario.deadlineMs ?? deadlineMs;
  await writeFile(metadataFile, JSON.stringify({ runId, id: scenario.id, status: "running", startedAt, deadlineMs: scenarioDeadlineMs }, null, 2));
  const playwrightArgs = ["exec", "playwright", "test", scenario.file, "--config", "playwright.performance.config.ts", "--workers=1"];
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `call pnpm ${playwrightArgs.map((value) => /\s/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)).join(" ")}`]
    : playwrightArgs;
  const child = spawn(command, commandArgs, {
    cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...scenario.env, SKETCH_PERF_TEST_GREP: scenario.grep ?? "", SKETCH_PERF_PORT: String(scenario.port), SKETCH_PERF_RUN_ID: runId, SKETCH_PERF_ARTIFACT_DIR: scenarioDirectory, SKETCH_PERF_REPETITIONS: "1", SKETCH_PERF_WARMUPS: "0" },
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => { terminateTree(child); resolve({ status: "timed_out", exitCode: null }); }, scenarioDeadlineMs);
    child.once("exit", (exitCode) => { clearTimeout(timer); resolve({ status: exitCode === 0 ? "passed" : "failed", exitCode }); });
  });
  let evidence;
  for (const name of await readdir(scenarioDirectory)) {
    if (!name.endsWith(".json") || name === "parent-metadata.json") continue;
    try { evidence = JSON.parse(await readFile(path.join(scenarioDirectory, name), "utf8")); break; } catch { /* malformed child evidence is preserved by its logs */ }
  }
  const result = { runId, id: scenario.id, target: scenario.target ?? scenario.id, repetition: scenario.repetition ?? 1, warmup: scenario.warmup ?? false, startedAt, finishedAt: new Date().toISOString(), deadlineMs: scenarioDeadlineMs, ...outcome, evidence };
  await Promise.all([writeFile(path.join(scenarioDirectory, "stdout.log"), stdout), writeFile(path.join(scenarioDirectory, "stderr.log"), stderr), writeFile(metadataFile, JSON.stringify(result, null, 2))]);
  return result;
}

// Capture source identity before this run creates evidence or rebuilds dist.
const sourceWorktreeHash = await worktreeHash();
await mkdir(runDirectory, { recursive: true });
if (!skipBuild) {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "call pnpm run build"], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
  }
}
const buildHash = await hashTree(path.join(root, "dist"));
const shapeNames = ["line", "native point", "control-point spline", "fit-point spline", "ellipse", "elliptical arc", "conic", "sketch text", "rectangle / two point", "rectangle / three point", "rectangle / center", "circle / center diameter", "circle / two point", "circle / three point", "circle / two tangent", "circle / three tangent", "arc / center point", "arc / three point", "arc / tangent", "polygon / inscribed", "polygon / circumscribed", "polygon / edge", "slot / center to center", "slot / overall", "slot / center point", "slot / three point arc"];
const mixedNames = ["mild rectangle + construction diagonal + circle", "mild scene + center-point arc", "mild scene + ellipse", "mild scene + control-point spline", "mild scene + arc + polygon-6 + arc slot"];
const constraintNames = ["circle center + diagonal midpoint", "two line Smart Dimension angle preview and commit", "line + circle tangent", "circle + circle equal", "circle + arc concentric", "native point + spline point-on-object", "control spline + retained offset", "fit spline + retained offset", "ellipse + retained offset", "elliptical arc + retained offset", "conic + retained offset"];
const allScenarios = selfTest ? [
  { id: "fixture-block", deadlineMs: 4_000, file: "tests/sketch-performance-watchdog-fixture.spec.ts", grep: "deliberately blocks", env: { SKETCH_PERF_WATCHDOG_FIXTURE: "block" } },
  { id: "fixture-continue", deadlineMs: 20_000, file: "tests/sketch-performance-watchdog-fixture.spec.ts", grep: "later child", env: { SKETCH_PERF_WATCHDOG_FIXTURE: "continue" } },
] : [
  { id: "auto-constraint-audit", file: "tests/sketch-performance-matrix.spec.ts", grep: "every auto-inferred constraint batch" },
  ...shapeNames.map((name, index) => ({ id: `shape-${String(index + 1).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, file: "tests/sketch-performance-matrix.spec.ts", grep: "all sketch creation types", env: { SKETCH_PERF_FILTER: name } })),
  ...mixedNames.map((name, index) => ({ id: `mixed-${index + 1}`, file: "tests/sketch-performance-matrix.spec.ts", grep: "mixed sketch combinations", env: { SKETCH_PERF_SCENARIO: name } })),
  ...constraintNames.map((name, index) => ({ id: `action-${index + 1}`, file: "tests/sketch-performance-matrix.spec.ts", grep: "constraint, Smart Dimension", env: { SKETCH_PERF_SCENARIO: name } })),
];
const runnerFilter = process.env.SKETCH_PERF_RUNNER_FILTER;
const scenarios = runnerFilter && !selfTest ? allScenarios.filter((scenario) => scenario.id === runnerFilter) : allScenarios;
if (!scenarios.length) throw new Error(`SKETCH_PERF_RUNNER_FILTER=${runnerFilter} matched no scenario`);
const results = [];
if (selfTest) {
  for (const [index, scenario] of scenarios.entries()) results.push(await runChild({ ...scenario, port: 4300 + index }));
} else {
  const warmups = Number(process.env.SKETCH_PERF_WARMUPS ?? 1);
  const repetitions = Number(process.env.SKETCH_PERF_REPETITIONS ?? 5);
  let childIndex = 0;
  for (const scenario of scenarios) for (let index = 0; index < warmups + repetitions; index += 1) {
    const warmup = index < warmups; const repetition = warmup ? index + 1 : index - warmups + 1;
    results.push(await runChild({ ...scenario, target: scenario.id, id: `${scenario.id}-${warmup ? "warmup" : "sample"}-${String(repetition).padStart(2, "0")}`, repetition, warmup, port: 4300 + childIndex++ }));
  }
}
const percentile = (values, fraction) => values.length ? values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const aggregates = selfTest ? [] : scenarios.map((scenario) => {
  const rows = results.filter((result) => result.target === scenario.id && !result.warmup);
  const probes = rows.flatMap((result) => result.evidence?.payload?.results?.flatMap((row) => row.probeRecords ?? []) ?? []);
  const stable = probes.map((probe) => probe.stablePaintMs); const semantic = probes.map((probe) => probe.semanticMs);
  return { target: scenario.id, measuredRuns: rows.length, passedRuns: rows.filter((row) => row.status === "passed").length, semanticSampleCount: semantic.length, stablePaintSampleCount: stable.length, semanticSamples: semantic, stablePaintSamples: stable, semanticP95Ms: percentile(semantic, .95), stablePaintP95Ms: percentile(stable, .95), actionLongTasks: probes.flatMap((probe) => probe.actionLongTasks ?? []) };
});
const environment = {
  runId, commit: git(["rev-parse", "HEAD"]), dirtyPatchHash: sourceWorktreeHash, buildHash,
  mode: "production", headed: process.env.SKETCH_PERF_HEADED === "1", node: process.version, platform: `${process.platform} ${process.arch}`, osRelease: release(), hostname: hostname(),
  cpu: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  browser: `Chrome ${browserVersion()}`,
  configuredWarmups: Number(process.env.SKETCH_PERF_WARMUPS ?? 1), configuredSamples: Number(process.env.SKETCH_PERF_REPETITIONS ?? 5), releaseSampleCommand: "SKETCH_PERF_REPETITIONS=20 pnpm run test:sketch-perf:qualified",
};
const artifact = { schemaVersion: 1, environment, aggregates, results, finalizedAt: new Date().toISOString() };
const body = JSON.stringify(artifact, null, 2); const checksum = createHash("sha256").update(body).digest("hex");
await writeFile(path.join(runDirectory, "results.json"), body); await writeFile(path.join(runDirectory, "results.json.sha256"), `${checksum}  results.json\n`);
await writeFile(path.join(outputRoot, "latest.json"), JSON.stringify({ runId, artifact: `${runId}/results.json`, checksum }, null, 2));
console.log(`Sketch performance artifact: ${path.join(runDirectory, "results.json")}`);
if (selfTest && !(results[0]?.status === "timed_out" && results[1]?.status === "passed")) process.exitCode = 1;
else if (!selfTest && results.some((result) => result.status !== "passed")) process.exitCode = 1;
