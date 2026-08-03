import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__crawlerSpike?.ready === true);
});

test("worker transfers a complete provenance-rich cube packet", async ({ page }) => {
  const summary = await page.evaluate(() => window.__crawlerSpike?.packetSummary);
  expect(summary).toEqual({
    version: 1,
    faces: 6,
    edges: 12,
    vertices: 8,
    transferredBytes: expect.any(Number),
    senderDetached: true,
  });
  expect(summary?.transferredBytes).toBeGreaterThan(0);
});

test("same viewport picks stable face, edge, and vertex provenance", async ({ page }) => {
  const picked = await page.evaluate(() => window.__crawlerSpike?.scanForKinds());
  expect(picked?.face?.kind).toBe(1);
  expect(BigInt(picked?.face?.stableId ?? "0")).toBeGreaterThan(0n);
  expect(picked?.edge?.kind).toBe(2);
  expect(BigInt(picked?.edge?.stableId ?? "0")).toBeGreaterThan(0n);
  expect(picked?.vertex?.kind).toBe(3);
  expect(BigInt(picked?.vertex?.stableId ?? "0")).toBeGreaterThan(0n);
});

test("fallback arm obtains WebGL2", async ({ page }) => {
  expect(await page.evaluate(() => window.__crawlerSpike?.backend)).toBe("webgl2");
  expect(
    await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl2")),
    ),
  ).toBe(true);
});
