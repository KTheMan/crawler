import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

function percentile(samples: number[], ratio: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

test("records repeatable packet, picking, and frame evidence", async ({ page, browserName }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__crawlerSpike?.ready === true);
  const evidence = await page.evaluate(async () => {
    const api = window.__crawlerSpike!;
    const pickSamples = Array.from({ length: 100 }, () => api.scanForKinds())
      .flatMap(({ face, edge, vertex }) => [
        face?.latencyMs,
        edge?.latencyMs,
        vertex?.latencyMs,
      ])
      .filter((sample): sample is number => sample !== undefined);
    return {
      packetSummary: api.packetSummary,
      worker: api.workerEvidence,
      pickSamples,
      frameSamples: await api.sampleFrames(600),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
  const result = {
    measuredAt: new Date().toISOString(),
    browserName,
    userAgent: evidence.userAgent,
    hardwareConcurrency: evidence.hardwareConcurrency,
    sampleCounts: { picks: evidence.pickSamples.length, frames: evidence.frameSamples.length },
    packet: evidence.packetSummary,
    worker: evidence.worker,
    pickingMs: {
      p50: percentile(evidence.pickSamples, 0.5),
      p95: percentile(evidence.pickSamples, 0.95),
      max: Math.max(...evidence.pickSamples),
    },
    frameMs: {
      p50: percentile(evidence.frameSamples, 0.5),
      p95: percentile(evidence.frameSamples, 0.95),
      max: Math.max(...evidence.frameSamples),
      framesAtOrBelow16_67Ms: evidence.frameSamples.filter((sample) => sample <= 16.67).length,
    },
  };
  const results = resolve("results");
  await mkdir(results, { recursive: true });
  await writeFile(resolve(results, "browser-metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
  expect(evidence.packetSummary.senderDetached).toBe(true);
  expect(evidence.pickSamples).toHaveLength(300);
});
