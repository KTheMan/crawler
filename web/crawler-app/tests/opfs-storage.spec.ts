import { expect, test } from "@playwright/test";

test("accepted recovery state uses OPFS and survives an application reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  const initialSnapshot = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("crawler-part-design-alpha.v1.json");
    const file = await handle.getFile();
    return { size: file.size, snapshot: JSON.parse(await file.text()) };
  });
  expect(initialSnapshot.size).toBeGreaterThan(0);
  expect(initialSnapshot.snapshot.snapshot_version).toBe(1);
  expect(initialSnapshot.snapshot.stores.metadata.length).toBeGreaterThan(0);

  await page.locator("#pad-length").fill("26.5");
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  const acceptedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await expect(page.locator("#storage-status")).toHaveText("recovered");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedHash);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(26_500_000);
});
