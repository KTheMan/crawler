import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output = resolve(root, "web/worker-spike/measurement-browser.json");
let chromeProcess;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" || pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const file = resolve(root, `.${decodeURIComponent(relative)}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error("outside workspace");
    const bytes = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream" });
    response.end(bytes);
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("measurement server address unavailable");
const serverOrigin = `http://127.0.0.1:${address.port}`;
try {
  const child = (chromeProcess = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9229",
    `--user-data-dir=${resolve(root, "target/chrome-worker-measurement")}`,
    "about:blank",
  ]));
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (value) => (stderr += value));

  let page;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pages = await fetch("http://127.0.0.1:9229/json/list").then((response) => response.json());
      page = pages.find((candidate) => candidate.type === "page");
      if (page) break;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!page) throw new Error(`Chrome DevTools page was unavailable: ${stderr}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params.exceptionDetails.text);
    }
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}) =>
    new Promise((resolveMessage) => {
      const id = ++messageId;
      pending.set(id, (message) => {
        pending.delete(id);
        resolveMessage(message);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.navigate", {
    url: `${serverOrigin}/web/worker-spike/?samples=10`,
  });
  let complete = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await send("Runtime.evaluate", {
      expression: 'document.documentElement.dataset.complete === "true"',
      returnByValue: true,
    });
    complete = result.result?.result?.value === true;
    if (complete) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (!complete) {
    const state = await send("Runtime.evaluate", {
      expression: '({ready: document.readyState, phase: document.documentElement.dataset.phase, evidence: document.querySelector("#evidence")?.textContent, resources: performance.getEntriesByType("resource").map(({name}) => name)})',
      returnByValue: true,
    });
    throw new Error(
      `browser measurement timed out: ${JSON.stringify(state.result?.result?.value)}; runtime=${runtimeErrors.join(" | ")}; ${stderr}`,
    );
  }
  const result = await send("Runtime.evaluate", {
    expression: 'document.querySelector("#evidence").textContent',
    returnByValue: true,
  });
  const json = result.result?.result?.value;
  if (typeof json !== "string") throw new Error("browser evidence element was unavailable");
  const evidence = JSON.parse(json);
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  socket.close();
  child.kill();
} finally {
  chromeProcess?.kill();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
