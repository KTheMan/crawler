import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp));
});

test("uses CAD-neutral feature names and canonical icon IDs throughout the ToolRibbon", async ({ page }) => {
  const expected: Record<string, string> = {
    extrude: "Extrude",
    "extrude-cut": "Extrude Cut",
    "revolve-cut": "Revolve Cut",
    "linear-pattern": "Linear Pattern",
    "circular-pattern": "Circular Pattern",
    combine: "Combine",
    subtract: "Subtract",
  };

  for (const [toolId, label] of Object.entries(expected)) {
    const tool = page.locator(`[data-workbench-ribbon="Part Design"] [data-ribbon-tool="${toolId}"]`).first();
    await expect(tool).toContainText(label);
    await expect(tool.locator("[data-cad-icon]")).toHaveAttribute("data-cad-icon", toolId);
  }

  for (const workbench of ["Part Design", "Sketcher"]) {
    const ribbon = page.locator(`[data-workbench-ribbon="${workbench}"]`);
    const tools = ribbon.locator(".ribbon-tool");
    for (let index = 0; index < await tools.count(); index += 1) {
      const tool = tools.nth(index);
      const toolId = await tool.getAttribute("data-ribbon-tool");
      expect(await tool.locator("[data-cad-icon]").getAttribute("data-cad-icon")).toBe(toolId);
    }
  }
});

test("uses familiar full names in shipped workbenches and hides future-only workbenches", async ({ page }) => {
  const labels: Record<string, string> = {
    "sketch-rectangular-pattern": "Rectangular Pattern",
    perpendicular: "Perpendicular",
    "smart-sketch-dimension": "Smart Dimension",
  };
  for (const [toolId, label] of Object.entries(labels)) {
    await expect(page.locator(`[data-ribbon-tool="${toolId}"]`).first()).toContainText(label);
  }
  await expect(page.locator('[data-workbench="Assembly"], [data-workbench="Drawing"], [data-workbench="Mesh"]')).toHaveCount(0);
});
