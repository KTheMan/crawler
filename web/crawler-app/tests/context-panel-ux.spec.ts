import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1280, height: 720 } });

async function openReady(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

test("context tabs are readable, keyboard navigable, and separated from the layout action", async ({ page }) => {
  await openReady(page);

  const panel = page.getByRole("complementary", { name: "Context panel" });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.width).toBe(352);
  await expect(panel).toHaveCSS("position", "relative");
  await expect(panel.getByRole("button", { name: "Float properties panel" })).toBeVisible();
  await expect(panel.getByRole("tablist", { name: "Context views" })).toBeVisible();

  const tabs = panel.getByRole("tab");
  const metrics = await tabs.evaluateAll((items) => items.map((item) => ({
    height: item.getBoundingClientRect().height,
    clientWidth: item.clientWidth,
    scrollWidth: item.scrollWidth,
  })));
  expect(metrics.every((metric) => metric.height >= 32 && metric.scrollWidth <= metric.clientWidth)).toBe(true);
  await expect(panel.getByRole("button", { name: "Float properties panel" })).toBeVisible();

  const properties = panel.getByRole("tab", { name: "Properties" });
  await properties.focus();
  await properties.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "Constraints" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "inspector-constraints-tab");
});

test("floating is an explicit persisted layout choice and drag stays inside the workspace", async ({ page }) => {
  await openReady(page);
  const panel = page.getByRole("complementary", { name: "Context panel" });
  await page.getByRole("button", { name: "Float properties panel" }).click();
  await expect(panel).toHaveCSS("position", "absolute");
  await expect(page.getByRole("button", { name: "Dock properties panel" })).toBeVisible();

  const handle = panel.locator(".inspector-drag-handle");
  const handleBox = await handle.boundingBox();
  const workspace = page.locator(".workspace");
  const workspaceBox = await workspace.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(workspaceBox!.x - 500, workspaceBox!.y - 500);
  await page.mouse.up();
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(workspaceBox!.x + 8);
  expect(panelBox!.y).toBeGreaterThanOrEqual(workspaceBox!.y + 8);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await expect(page.getByRole("button", { name: "Dock properties panel" })).toBeVisible();
});

test("active sketch tools prioritize current instructions and keep completion actions reachable", async ({ page }) => {
  await openReady(page);
  await page.getByRole("button", { name: "New Sketch", exact: true }).click();
  await page.getByRole("button", { name: "◇ XY plane construction", exact: true }).click();

  const panel = page.getByRole("complementary", { name: "Context panel" });
  await expect(panel.getByRole("tab", { name: "Select" })).toHaveAttribute("aria-selected", "true");
  const tabMetrics = await panel.getByRole("tab").evaluateAll((items) => items.map((item) => ({ clientWidth: item.clientWidth, scrollWidth: item.scrollWidth })));
  expect(tabMetrics.every((metric) => metric.scrollWidth <= metric.clientWidth)).toBe(true);
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "inspector-tool-tab");
  await expect(panel).not.toContainText("No active tool");
  await expect(panel.locator("#active-tool-operation-value")).toHaveCount(0);
  await expect(panel.getByText("Ready to select", { exact: true })).toBeVisible();

  const reachability = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const finish = element.querySelector("#active-tool-finish")!.getBoundingClientRect();
    return { finishBottom: finish.bottom, panelBottom: bounds.bottom, finishHeight: finish.height };
  });
  expect(reachability.finishHeight).toBeGreaterThanOrEqual(38);
  expect(reachability.finishBottom).toBeLessThanOrEqual(reachability.panelBottom);

  const sketchSupport = panel.locator(".sketch-context-support");
  await expect(sketchSupport).not.toHaveAttribute("open", "");
  const changeSupport = panel.locator("#active-tool-choose-plane");
  await expect(changeSupport).toBeHidden();
  await sketchSupport.locator(":scope > summary").click();
  await expect(sketchSupport).toHaveAttribute("open", "");
  await expect(changeSupport).toBeVisible();
  await sketchSupport.locator(":scope > summary").click();
  await expect(sketchSupport).not.toHaveAttribute("open", "");
  await expect(changeSupport).toBeHidden();
});
