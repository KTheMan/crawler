import { expect, test } from "@playwright/test";

test("tour advances only after real model, timeline, and explicit-save actions", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const tour = page.locator("#onboarding");
  const next = page.locator("#tour-next");

  await expect(tour).toContainText("Change Pad length");
  await expect(next).toBeDisabled();
  await page.locator("#pad-length").fill("24.5");
  await expect(next).toBeDisabled();
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  await expect(next).toBeEnabled();
  await expect(tour).toContainText("Action complete");
  await next.click();

  await expect(tour).toContainText("Select a feature in the timeline");
  await expect(next).toBeDisabled();
  await page.locator("[data-timeline-id]").first().click();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(tour).toContainText("Save the part");
  await expect(next).toBeDisabled();
  await page.locator("#save-part").click();
  await expect(page.locator("#storage-status")).toHaveText("saved");
  await expect(next).toBeEnabled();

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp));
  await expect(tour).toContainText("Quick tour 3/3");
  await expect(page.locator("#tour-next")).toBeEnabled();
  await page.locator("#tour-next").click();
  await expect(tour).toBeHidden();

  await page.locator("#restart-tour").click();
  await expect(tour).toContainText("Quick tour 1/3");
  await expect(page.locator("#tour-next")).toBeDisabled();
  await expect(page.locator("#pad-length")).toBeFocused();
});
