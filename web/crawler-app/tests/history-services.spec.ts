import { expect, test } from "@playwright/test";

type WorkerTraffic = { direction: "to-worker" | "from-worker"; data: Record<string, unknown> };

async function observeModelWorker(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const traffic: { direction: "to-worker" | "from-worker"; data: Record<string, unknown> }[] = [];
    const record = (direction: "to-worker" | "from-worker", data: unknown) => {
      if (!data || typeof data !== "object") return;
      const message = data as Record<string, unknown>;
      if (!["document", "feature-services", "repair-committed", "explicit-rebind"].includes(String(message.type))) return;
      traffic.push({ direction, data: structuredClone(message) });
    };
    Object.defineProperty(window, "__crawlerWorkerTraffic", { value: traffic, configurable: false });

    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const instance = Reflect.construct(Target, args) as Worker;
        instance.addEventListener("message", (event) => record("from-worker", event.data));
        const postMessage = instance.postMessage.bind(instance);
        instance.postMessage = ((message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
          record("to-worker", message);
          postMessage(message, transfer as Transferable[]);
        }) as Worker["postMessage"];
        return instance;
      },
    });
  });
}

async function workerTraffic(page: import("@playwright/test").Page): Promise<WorkerTraffic[]> {
  return page.evaluate(() => structuredClone((window as unknown as { __crawlerWorkerTraffic: WorkerTraffic[] }).__crawlerWorkerTraffic));
}

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator('[data-stage="renderer"]')).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
}

const detailFeature = {
  kind: "create_feature",
  feature: {
    id: "feature:topology-detail",
    display_name: "Topology detail",
    component: "component:root",
    operation: { schema_id: "crawler.operation.detail", schema_version: 1 },
    dependencies: ["feature:extrude"],
    inputs: { target: { kind: "topology", id: "topology:extrude-top" } },
    parameters: {},
    suppressed: false,
  },
  before: null,
};

test("worker-ranked topology churn requires an explicit durable rebind and remains undoable", async ({ page }) => {
  await observeModelWorker(page);
  await ready(page);
  await page.evaluate((change) => window.__crawlerApp.commitDocumentChanges([change]), detailFeature);
  await expect(page.locator('[data-feature-id="feature:topology-detail"]')).toBeVisible();
  await page.locator('[data-feature-id="feature:topology-detail"]').click();

  const observedTopology = await page.evaluate(() => {
    const traffic = (window as unknown as { __crawlerWorkerTraffic: WorkerTraffic[] }).__crawlerWorkerTraffic;
    const documentMessage = traffic.findLast((message) => message.direction === "from-worker" && message.data.type === "document");
    if (typeof documentMessage?.data.documentJson !== "string") throw new Error("worker document snapshot was not observed");
    const document = JSON.parse(documentMessage.data.documentJson) as {
      topology_references: Record<string, {
        id: string;
        body: string;
        producer: string;
        kind: "face";
        stable_kernel_id: number;
        stable_token: string;
        fallback_signature: Record<string, unknown>;
      }>;
    };
    const expected = document.topology_references["topology:extrude-top"];
    if (!expected) throw new Error("runtime did not publish the extrude top-face reference");
    const replacement = {
      ...expected,
      id: "topology:repair-candidate",
      stable_kernel_id: expected.stable_kernel_id + 10_000,
      stable_token: `${expected.stable_token}:regenerated`,
    };
    return [
      ...Object.values(document.topology_references).filter((reference) => reference.id !== expected.id),
      replacement,
    ];
  });

  const beforeRepair = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate((observed) => window.__crawlerApp.inspectRepair(observed), observedTopology);
  await expect(page.locator(".repair-preview")).toContainText("Evaluation stopped");
  await expect(page.locator('[data-repair-candidate="topology:repair-candidate"]')).toBeVisible();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeRepair);

  const previewTraffic = await workerTraffic(page);
  const previewResponse = previewTraffic.findLast((message) => message.direction === "from-worker" && message.data.type === "feature-services");
  expect(previewResponse?.data.repair).toMatchObject({
    status: "evaluation_blocked",
    preview: {
      explicit_rebind_required: true,
      unresolved: { feature: "feature:topology-detail", input_name: "target", reference: "topology:extrude-top" },
      candidates: [{ rank: 1, candidate: { id: "topology:repair-candidate" } }],
    },
  });

  await page.locator('[data-repair-candidate="topology:repair-candidate"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Rebound explicitly");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(beforeRepair);
  await expect.poll(async () => {
    const traffic = await workerTraffic(page);
    const documentMessage = traffic.findLast((message) => message.direction === "from-worker" && message.data.type === "document");
    if (typeof documentMessage?.data.documentJson !== "string") return undefined;
    const document = JSON.parse(documentMessage.data.documentJson) as {
      features: Record<string, { inputs: Record<string, unknown> }>;
      transactions: { changes: Record<string, unknown>[] }[];
    };
    return {
      input: document.features["feature:topology-detail"]?.inputs.target,
      change: document.transactions.at(-1)?.changes.at(-1),
    };
  }).toMatchObject({
    input: { kind: "topology", id: "topology:repair-candidate" },
    change: {
      kind: "rebind_topology",
      feature: "feature:topology-detail",
      input_name: "target",
      from_reference: "topology:extrude-top",
      replacement: { id: "topology:repair-candidate" },
    },
  });
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeRepair);
});

test("dependency cues, group, blocked reorder, rollback-aware recompute, and timing share one timeline", async ({ page }) => {
  await ready(page);
  await page.evaluate((change) => window.__crawlerApp.commitDocumentChanges([change]), detailFeature);
  await page.locator('[data-feature-id="feature:extrude"]').click();
  await expect(page.locator('[data-timeline-id="feature:topology-detail"]')).toHaveClass(/dependency-consumer/);
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#history-action-status")).toContainText("Recomputed");
  await expect(page.locator("[data-feature-timing]")).not.toContainText("available after");

  await page.locator('[data-history-action="group"]').click();
  await expect(page.locator('[data-timeline-id="feature:extrude"] em')).toContainText("group:");
  await page.locator('[data-history-action="reorder"]').click();
  await expect(page.locator("#history-action-status")).toContainText(/reorder feature blocked/i);

  await page.locator('[data-feature-action="rollback"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Rollback after feature:extrude");
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#history-action-status")).toContainText("feature:extrude");
  await expect(page.locator('[data-timeline-id="feature:topology-detail"]')).toHaveAttribute("data-after-rollback", "true");
});
