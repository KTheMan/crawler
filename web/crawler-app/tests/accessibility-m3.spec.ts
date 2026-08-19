import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function waitForApp(page: Page): Promise<void> {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

test("visible controls have accessible names and valid state relationships", async ({ page }) => {
  await waitForApp(page);
  const audit = await page.evaluate(() => {
    const visible = (element: HTMLElement) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0;
    const name = (element: HTMLElement) => {
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
      const explicit = element.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim() : "";
      return element.getAttribute("aria-label")?.trim() || labelledBy || explicit || element.closest("label")?.textContent?.trim() || element.textContent?.trim() || element.getAttribute("title")?.trim() || "";
    };
    const controls = Array.from(document.querySelectorAll<HTMLElement>("button, input, select, canvas"));
    const unnamed = controls.filter((element) => visible(element) && !(element instanceof HTMLInputElement && element.type === "hidden") && !name(element)).map((element) => element.id || element.outerHTML.slice(0, 100));
    const brokenDescriptions = controls.flatMap((element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => `${element.id || element.tagName}->${id}`));
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[id]")).map((element) => element.id);
    return {
      unnamed,
      brokenDescriptions,
      duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
      statusNames: Array.from(document.querySelectorAll<HTMLElement>('[role="status"]')).filter(visible).map((element) => element.textContent?.trim() ?? ""),
    };
  });
  expect(audit.unnamed).toEqual([]);
  expect(audit.brokenDescriptions).toEqual([]);
  expect(audit.duplicateIds).toEqual([]);
  expect(audit.statusNames.every(Boolean)).toBe(true);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "feature browser" })).toBeVisible();
  await expect(page.getByLabel("3D viewport")).toBeVisible();
  await expect(page.getByRole("button", { name: "Parameters", exact: true })).toBeVisible();
  await expect(page.locator("#diagnostics")).toHaveAttribute("aria-live", "polite");
});

test("keyboard reference flow exposes focus, operation, timeline, save, and recovery state", async ({ page }) => {
  await waitForApp(page);
  await page.locator('[data-ribbon-flyout="sketch"]').click();
  await page.locator('[data-ribbon-run="rectangle"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#part-width")).toBeFocused();
  await page.locator("#part-width").fill("41");
  await page.locator("#part-height").fill("29");
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect(page.locator("#operation-state")).toContainText("committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers)).toBe(41_000_000);

  await page.locator("[data-timeline-id]").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-timeline-id]").nth(1)).toBeFocused();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#storage-status")).toHaveText("saved");

  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate(() => window.__crawlerApp.faultWorker("accessibility recovery probe"));
  await expect(page.getByRole("alert")).toContainText("Editing couldn’t continue");
  await expect(page.getByRole("alert")).toContainText("last completed model state is safe");
  await page.locator("#recover-runtime").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.safeMode()), { timeout: 60_000 }).toBe(false);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
});

test("operation, visibility, and field-error states do not rely on color alone", async ({ page }) => {
  await waitForApp(page);
  await page.locator("#start-pad").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
  await expect(page.locator("#operation-state")).toContainText("Enter commits, Escape cancels");
  await page.keyboard.press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  await expect(page.locator("#operation-state")).toHaveText("Operation: cancelled");

  const visibility = page.locator('[data-body-visibility="body:part"]');
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  await expect(visibility).toHaveAttribute("aria-label", "Hide Part Body");
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await expect(visibility).toHaveAttribute("aria-label", "Show Part Body");

  await page.locator('[data-feature-id="feature:rectangle-sketch"]:visible').first().click();
  const dimension = page.locator('[data-sketch-dimension="d1"]');
  await dimension.getByRole("button", { name: "Define parameter" }).click();
  await dimension.locator("input").fill("Overall Width");
  await dimension.getByRole("button", { name: "Define", exact: true }).click();
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 90_000 });
  await page.locator("[data-open-parameters]:visible").first().click();
  const width = page.locator('[data-dialog-expression="parameter:width"]');
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await width.fill("45 deg");
  await width.press("Enter");
  await expect(width).toHaveAttribute("aria-invalid", "true", { timeout: 60_000 });
  await expect(page.locator('[data-dialog-parameter="parameter:width"] .parameter-description')).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);
});

test("reduced-motion preference suppresses CSS motion while camera commands remain operable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForApp(page);
  const motion = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>("#timeline")!;
    const style = getComputedStyle(target);
    const durationSeconds = (duration: string) => duration.endsWith("ms") ? Number.parseFloat(duration) / 1000 : Number.parseFloat(duration);
    return {
      preference: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationDurationSeconds: durationSeconds(style.animationDuration),
      transitionDurationSeconds: durationSeconds(style.transitionDuration),
      scrollBehavior: style.scrollBehavior,
    };
  });
  expect(motion.preference).toBe(true);
  expect(motion.animationDurationSeconds).toBeLessThanOrEqual(0.001);
  expect(motion.transitionDurationSeconds).toBeLessThanOrEqual(0.001);
  expect(motion.scrollBehavior).toBe("auto");
  const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const before = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  await page.locator('[data-view="front"]').focus();
  await page.keyboard.press("Enter");
  const after = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(after).not.toEqual(before);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);
});

test("onboarding teaches safe sketch entry and supports resume, skip, and restart", async ({ page }) => {
  await waitForApp(page);
  const tour = page.locator("#onboarding");
  await expect(tour).toContainText("Choose New Sketch");
  await expect(page.locator("#tour-next")).toBeDisabled();
  await page.locator("#edit-sketch").click();
  await expect(page.locator("#tour-next")).toBeEnabled();
  await page.locator("#tour-next").click();
  await expect(tour).toContainText("Choose an origin plane");
  await expect(page.locator('[data-origin-plane-id="origin-plane:xy"]')).toBeFocused();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await expect(tour).toContainText("Quick tour 2/3");
  await expect(page.locator("#tour-next")).toBeDisabled();
  await page.locator("#edit-sketch").click();
  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await expect(page.locator("#tour-next")).toBeEnabled();
  await page.locator("#tour-next").click();
  await expect(tour).toContainText("Discard this empty practice sketch");
  await page.locator("#active-tool-cancel").click();
  await expect(page.locator("#tour-next")).toBeEnabled();
  await page.locator("#tour-exit").click();
  await expect(tour).toBeHidden();
  await page.locator(".app-menu").filter({ hasText: "Help" }).locator("summary").click();
  await page.getByRole("menuitem", { name: /Quick tour/ }).click();
  await expect(tour).toContainText("Quick tour 1/3");
  await expect(page.locator("#tour-next")).toBeDisabled();
  await expect(page.locator("#edit-sketch")).toBeFocused();
});
