import "./style.css";

import { PACKET_VERSION, type TransferableRenderPacket, type WorkerEvidence } from "./protocol";
import { PacketRenderer } from "./renderer";

const canvasElement = document.querySelector<HTMLCanvasElement>("#viewport");
const statusElement = document.querySelector<HTMLOutputElement>("#status");
if (!canvasElement || !statusElement) throw new Error("spike host elements are missing");
const canvas: HTMLCanvasElement = canvasElement;
const status: HTMLOutputElement = statusElement;

const worker = new Worker(new URL("./packet.worker.ts", import.meta.url), { type: "module" });
let senderDetached = false;
let pending:
  | {
      packet: TransferableRenderPacket;
      evidence: Omit<WorkerEvidence, "senderDetached">;
    }
  | undefined;

function startIfComplete(): void {
  if (!pending || !senderDetached) return;
  if (pending.packet.version !== PACKET_VERSION) {
    throw new Error(`unsupported packet version ${pending.packet.version}`);
  }
  const packet = pending.packet;
  const renderer = new PacketRenderer(canvas, packet);
  const workerEvidence = { ...pending.evidence, senderDetached };
  const packetSummary = {
    version: packet.version,
    faces: packet.faceRanges.length / 3,
    edges: packet.edgeRanges.length / 3,
    vertices: packet.vertexPickTokens.length,
    transferredBytes: workerEvidence.transferredBytes,
    senderDetached,
  };
  window.__crawlerSpike = {
    ready: true,
    backend: renderer.backend,
    packetSummary,
    pickAt: (x, y) => renderer.pickAt(x, y),
    scanForKinds: () => renderer.scanForKinds(),
    sampleFrames: (count) => renderer.sampleFrames(count),
    workerEvidence,
  };
  status.textContent = [
    `backend: ${renderer.backend}`,
    `faces/edges/vertices: ${packetSummary.faces}/${packetSummary.edges}/${packetSummary.vertices}`,
    `transferred: ${packetSummary.transferredBytes} bytes`,
    `worker sender detached: ${packetSummary.senderDetached}`,
  ].join("\n");
  canvas.addEventListener("pointermove", (event) => renderer.pickAt(event.clientX, event.clientY));
}

worker.addEventListener("message", (event) => {
  if ("packet" in event.data) pending = event.data;
  if ("senderDetached" in event.data) senderDetached = event.data.senderDetached;
  startIfComplete();
});
worker.postMessage({ command: "reference_cube" });
