import { expect, test } from "@playwright/test";

test("tour completes the meaningful sketch-to-extrude loop from an empty document", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const tour = page.locator("#onboarding");
  const next = page.locator("#tour-next");

  await expect(tour).toContainText("Choose New Sketch");
  await expect(tour).toContainText("Quick tour 1/6");
  await expect(next).toBeDisabled();
  await expect(page.locator("#edit-sketch")).toHaveAttribute("data-tour-target", "true");

  await page.locator("#edit-sketch").click();
  await expect(tour).toContainText("Action complete");
  await expect(next).toBeEnabled();
  await next.click();

  const xyPlane = page.locator('[data-origin-plane-id="origin-plane:xy"]');
  await expect(tour).toContainText("Choose an origin plane");
  await expect(next).toBeDisabled();
  await expect(xyPlane).toBeFocused();
  await expect(xyPlane).toHaveAttribute("aria-describedby", /tour-instruction/);
  await xyPlane.click();
  await expect(next).toBeEnabled();
  await next.click();

  const rectangle = page.locator('[data-sketch-tool="rectangle"]');
  await expect(tour).toContainText("Create a closed rectangle");
  await expect(next).toBeDisabled();
  await expect(rectangle).toBeFocused();
  await rectangle.click();
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.36, box!.y + box!.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.50, box!.y + box!.height * 0.50, { steps: 4 });
  await page.mouse.up();
  await expect(next).toBeEnabled();
  await next.click();

  const finish = page.locator("#active-tool-finish");
  await expect(tour).toContainText("Finish Sketch");
  await expect(finish).toBeFocused();
  await finish.click();
  await expect(next).toBeEnabled();
  await next.click();

  const extrude = page.locator("#start-pad");
  await expect(tour).toContainText("Start Extrude");
  await expect(extrude).toBeFocused();
  await extrude.click();
  await expect(next).toBeEnabled();
  await next.click();

  const distance = page.locator("#pad-length");
  await expect(tour).toContainText("Commit the Extrude preview");
  await expect(distance).toBeFocused();
  await distance.press("Enter");
  await expect(next).toBeEnabled({ timeout: 60_000 });

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await expect(tour).toContainText("Quick tour 6/6");
  await expect(page.locator("#tour-next")).toBeEnabled();
  await page.locator("#tour-next").click();
  await expect(tour).toBeHidden();
});

test("Exit, restart, and Back keep the executable tour controllable", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp));
  const tour = page.locator("#onboarding");

  await page.locator("#tour-exit").click();
  await expect(tour).toBeHidden();
  await page.locator(".app-menu").filter({ hasText: "Help" }).locator("summary").click();
  await page.getByRole("menuitem", { name: /Quick tour/ }).click();

  await expect(tour).toContainText("Quick tour 1/6");
  await expect(tour).toContainText("Choose New Sketch");
  await expect(page.locator("#tour-next")).toBeDisabled();
  await expect(page.locator("#edit-sketch")).toBeFocused();
  await expect(page.locator("#edit-sketch")).toHaveAttribute("data-tour-target", "true");
  await expect(page.locator("#tour-back")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.onboarding())).toEqual({ step: 0, complete: false });
});

test("production Help can start the quick tour without forcing it at startup", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp));
  const tour = page.locator("#onboarding");

  await expect(tour).toBeHidden();
  await page.locator(".app-menu").filter({ hasText: "Help" }).locator("summary").click();
  await page.getByRole("menuitem", { name: /Quick tour/ }).click();

  await expect(tour).toContainText("Quick tour 1/6");
  await expect(page.locator("#edit-sketch")).toBeFocused();
  expect(await page.evaluate(() => window.__crawlerApp.onboarding())).toEqual({ step: 0, complete: false });
});
