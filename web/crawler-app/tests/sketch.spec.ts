import { expect, test } from "@playwright/test";

test.setTimeout(300_000);

test("edits and atomically commits an origin-plane sketch", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.getByRole("button", { name: "Edit Sketch" }).click();
  const toolbar = page.getByRole("region", { name: "Sketch tools" });
  await expect(toolbar).toBeVisible();
  await expect(page.locator("[data-sketch-tool]")).toHaveCount(6);
  await expect(page.locator("[data-sketch-constraint]")).toHaveCount(10);
  await expect(page.getByLabel("Sketch plane")).toHaveValue("xy");

  const canvas = page.getByLabel("3D viewport");
  const acceptedEntityCount = await page.getByLabel("Editable sketch geometry").locator(".sketch-entity").count();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drawingY = Math.max(320, Math.round(box!.height * 0.62));
  const drawingX = Math.max(650, Math.round(box!.width * 0.58));
  await canvas.click({ position: { x: drawingX, y: drawingY } });
  await canvas.click({ position: { x: Math.min(box!.width - 80, drawingX + 110), y: drawingY } });
  await expect(page.locator("#sketch-solver-state")).toContainText("under constrained", { timeout: 60_000 });
  await expect(page.locator("#sketch-profile-state")).toContainText("open endpoint", { timeout: 60_000 });

  await page.getByRole("button", { name: "Finish sketch (Enter)" }).click();
  await expect(toolbar).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.state().operation.status)).toBe("committed");
  await expect(page.locator("#storage-status")).toHaveText(/autosaved|saved/, { timeout: 60_000 });
  await page.reload();
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.getByRole("button", { name: "Edit Sketch" }).click();
  await expect(page.getByLabel("Sketch plane")).toHaveValue("xy");
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);
});

test("Escape cancels a sketch draft without committing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.getByRole("button", { name: "Edit Sketch" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Sketch tools" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.state().operation.status)).toBe("cancelled");
});

test("viewport handles run constrained drag preview without mutating the accepted document", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.getByRole("button", { name: "Edit Sketch" }).click();
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const acceptedEntityCount = await overlay.locator(".sketch-entity").count();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: Math.round(box!.width * 0.55), y: Math.round(box!.height * 0.64) };
  const end = { x: start.x + 90, y: start.y };
  await canvas.click({ position: start });
  await canvas.click({ position: end });

  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);
  const endHandle = overlay.locator('[data-anchor="end"]').last();
  const beforeX = Number(await endHandle.getAttribute("cx"));
  const handleBox = await endHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 45, handleBox!.y + handleBox!.height / 2 - 20, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator("#sketch-solver-state")).toHaveAttribute("data-last-drag", "accepted", { timeout: 60_000 });
  await expect.poll(async () => Number(await overlay.locator('[data-anchor="end"]').last().getAttribute("cx"))).toBeGreaterThan(beforeX + 30);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  await page.getByRole("button", { name: "Finish sketch (Enter)" }).click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(accepted);
});
