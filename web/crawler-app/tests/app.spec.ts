import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe.configure({ timeout: 120_000 });

async function tabTo(page: import("@playwright/test").Page, selector: string, attempts = 40): Promise<void> {
  const target = page.locator(selector);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`keyboard focus did not reach ${selector}`);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("reports explicit UI, WASM, worker, and renderer readiness", async ({ page }) => {
  await expect(page.locator('[data-stage="ui"]')).toHaveAttribute("data-status", "ready");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready");
  await expect(page.locator('[data-stage="worker"]')).toHaveAttribute("data-status", "ready");
  await expect(page.locator('[data-stage="renderer"]')).toHaveAttribute("data-status", "ready");
  expect(await page.evaluate(() => window.__crawlerApp.transferredBytes())).toBeGreaterThan(0);
});

test("desktop layout gives the viewport the largest workspace region", async ({ page }) => {
  const boxes = await Promise.all([
    page.getByTestId("viewport-region").boundingBox(),
    page.getByTestId("browser-region").boundingBox(),
    page.getByTestId("inspector-region").boundingBox(),
    page.getByTestId("timeline-region").boundingBox(),
  ]);
  const areas = boxes.map((box) => (box?.width ?? 0) * (box?.height ?? 0));
  expect(areas[0]).toBeGreaterThan(Math.max(...areas.slice(1)));
});

test("browser, timeline, and schema-driven inspector stay synchronized", async ({ page }) => {
  const sketch = page.locator("[data-feature-id]").filter({ hasText: /sketch/i }).first();
  const sketchId = await sketch.getAttribute("data-feature-id");
  expect(sketchId).toBeTruthy();
  await sketch.click();
  await expect(page.locator("#inspector h2")).toContainText(/sketch/i);
  await expect(page.locator(`[data-timeline-id="${sketchId}"]`)).toHaveClass(/selected/);
  await expect(page.locator("#inspector")).toContainText("Constraints");
  const solidFeature = page.locator("[data-timeline-id]").filter({ hasText: /pad|extrude/i }).first();
  const solidFeatureId = await solidFeature.getAttribute("data-timeline-id");
  expect(solidFeatureId).toBeTruthy();
  await solidFeature.click();
  await expect(page.locator(`[data-feature-id="${solidFeatureId}"]`)).toHaveClass(/selected/);
  await expect(page.locator("#inspector")).toContainText(/Length|Distance/i);
});

test("hierarchical browser owns body identity, visibility, and pick eligibility", async ({ page }) => {
  const tree = page.getByRole("tree");
  await expect(tree.locator('[data-entity-kind="component"]')).toContainText("Bracket");
  await expect(tree.locator('[data-tree-group="origin-planes"]')).toContainText("XY plane");
  await expect(tree.locator('[data-tree-group="bodies"]')).toContainText("Part Body");
  await expect(tree.locator('[data-tree-group="sketches"]')).toContainText("Rectangle");
  await expect(tree.locator('[data-tree-group="features"]')).toContainText("Extrude");

  const initial = await page.evaluate(() => window.__crawlerApp.selectFirst("face"));
  expect(initial?.bodyId).toBe("body:part");
  const visibility = page.locator('[data-body-visibility="body:part"]');
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("body"))).toBeNull();
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("face"))).toBeNull();
  await expect(page.locator("#selection-readout")).toHaveText("Selection: none");

  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  expect((await page.evaluate(() => window.__crawlerApp.selectFirst("vertex")))?.bodyId).toBe("body:part");

  await page.locator('[data-feature-id="feature:extrude"]').click();
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator('[data-body-id="body:part"]')).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("edge"))).toBeNull();
  await page.locator("#undo").click();
  await expect(page.locator('[data-body-id="body:part"]')).not.toHaveAttribute("aria-disabled", "true");
  expect((await page.evaluate(() => window.__crawlerApp.selectFirst("body")))?.stableId).toBe("body:part");
});

test("body, face, edge, and vertex filters resolve stable IDs with deterministic multi-select", async ({ page }) => {
  for (const kind of ["body", "face", "edge", "vertex"] as const) {
    const selection = await page.evaluate((value) => window.__crawlerApp.selectFirst(value), kind);
    expect(selection?.kind).toBe(kind);
    expect(selection?.bodyId).toBe("body:part");
    if (kind === "body") expect(selection?.stableId).toBe("body:part");
    else expect(BigInt(selection?.stableId ?? "0")).toBeGreaterThan(0n);
    await expect(page.locator("#timeline-status")).toContainText(selection?.stableId ?? "missing");
  }
  await page.evaluate(() => {
    window.__crawlerApp.selectFirst("face");
    window.__crawlerApp.selectFirst("edge", true);
  });
  expect((await page.evaluate(() => window.__crawlerApp.state())).selections.map((item) => item.kind)).toEqual(["face", "edge"]);
  await expect(page.locator("#selection-readout")).toContainText("Selection (2)");
  await page.locator('[data-filter="edge"]').uncheck();
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("edge"))).toBeNull();
  await page.locator('[data-filter="edge"]').check();
  expect((await page.evaluate(() => window.__crawlerApp.selectFirst("edge")))?.kind).toBe("edge");
});

test("standard views and fit update transient camera state", async ({ page }) => {
  expect(await page.evaluate(() => window.__crawlerApp.projectionMode())).toBe("perspective");
  await page.locator("#projection-mode").click();
  expect(await page.evaluate(() => window.__crawlerApp.projectionMode())).toBe("orthographic");
  await expect(page.locator("#projection-mode")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#projection-mode").click();
  expect(await page.evaluate(() => window.__crawlerApp.projectionMode())).toBe("perspective");
  await page.locator('[data-view="front"]').click();
  const front = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(front[0]).toBeCloseTo(20);
  expect(front[1]).toBeCloseTo(14);
  expect(front[2]).toBeGreaterThan(12);
  await page.locator('[data-view="top"]').click();
  const top = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(top[0]).toBeCloseTo(20);
  expect(top[1]).toBeGreaterThan(28);
  expect(top[2]).toBeCloseTo(6);
  await page.locator("#fit-view").click();
  const fitted = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(fitted[0]).toBeGreaterThan(40);
  expect(fitted[1]).toBeGreaterThan(28);
  expect(fitted[2]).toBeGreaterThan(12);

  const canvas = page.locator("#viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#preselection-readout")).not.toHaveText("Hover: none");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 35);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__crawlerApp.cameraPosition())).not.toEqual(fitted);
  const beforeZoom = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  await page.mouse.wheel(0, 220);
  expect(await page.evaluate(() => window.__crawlerApp.cameraPosition())).not.toEqual(beforeZoom);
});

test("Enter commits and Escape cancels operation lifecycle without cancel mutation", async ({ page }) => {
  const original = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#start-pad").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
  await page.keyboard.press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(original);

  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
});

test("Extrude viewport manipulator previews worker geometry and restores accepted state", async ({ page }) => {
  const acceptedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const acceptedDistance = await page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers);
  await page.locator("#pad-length").fill("24");
  await page.locator("#start-pad").click();

  const handle = page.locator("#extrude-manipulator");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("role", "slider");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()[5])).toBeCloseTo(24, 5);
  expect(await page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(acceptedDistance);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedHash);

  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#pad-length")).toHaveValue("25");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()[5])).toBeCloseTo(25, 5);
  expect((await page.evaluate(() => window.__crawlerApp.performanceEvidence())).timingsMs.preview).toBeGreaterThanOrEqual(0);

  await page.keyboard.press("Escape");
  await expect(handle).toBeHidden();
  await expect(page.locator("#pad-length")).toHaveValue(String(acceptedDistance / 1_000_000));
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()[5])).toBeCloseTo(acceptedDistance / 1_000_000, 5);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedHash);
});

test("runtime can retry without moving durable state into UI state", async ({ page }) => {
  const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#retry-runtime").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.readiness().renderer), { timeout: 60_000 }).toBe("ready");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);
});

test("panel visibility is transient and does not mutate the document", async ({ page }) => {
  const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator('[data-panel-toggle="browser"]').click();
  expect((await page.evaluate(() => window.__crawlerApp.state())).panels.browser).toBe(false);
  await expect(page.getByTestId("browser-region")).toBeHidden();
  await page.locator('[data-panel-toggle="browser"]').click();
  await expect(page.getByTestId("browser-region")).toBeVisible();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);
});

test("explicit save uses the shared storage protocol", async ({ page }) => {
  await page.locator("#save-part").click();
  await expect(page.locator("#storage-status")).toHaveText("saved");
  expect(await page.evaluate(() => window.__crawlerApp.hasExplicitSave())).toBe(true);
});

test("startup diagnostics expose the failing stage and retry recovers", async ({ page }) => {
  await page.goto("/?failWorker=1");
  await expect(page.locator('[data-stage="worker"]')).toHaveAttribute("data-status", "error");
  await expect(page.locator("#diagnostics")).toContainText("diagnostic worker startup failure");
  await page.locator("#retry-runtime").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.readiness().renderer), { timeout: 60_000 }).toBe("ready");
  await expect(page.locator("#diagnostics")).not.toHaveAttribute("data-visible", "");
});

test("dimension edit recomputes geometry, undo/redo survives recovery, and export is read-only", async ({ page }) => {
  await page.locator("#pad-length").fill("26.5");
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(26_500_000);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds()[5])).toBeCloseTo(26.5, 5);
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({
    dirtyRoots: ["feature:extrude"],
    evaluationOrder: ["feature:extrude"],
  });
  expect((await page.evaluate(() => window.__crawlerApp.performanceEvidence())).timingsMs.recompute).toBeGreaterThanOrEqual(0);
  const committedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(12_000_000);
  await page.locator("#redo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(26_500_000);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(committedHash);
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"), undefined, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers), { timeout: 60_000 }).toBe(26_500_000);
  await expect(page.locator("#storage-status")).toHaveText("recovered");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(committedHash);

  const pending = page.waitForEvent("download");
  await page.locator('[data-export="obj"]').click();
  await pending;
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(committedHash);
});

test("rectangle dimensions commit atomically and drive authoritative model bounds", async ({ page }) => {
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#part-width").fill("52.25");
  await page.locator("#part-height").fill("31.75");
  await page.locator("#start-rectangle").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers)).toBe(52_250_000);
  expect(await page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers)).toBe(31_750_000);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds().slice(3, 5))).toEqual([52.25, 31.75]);
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({
    dirtyRoots: ["feature:rectangle-sketch"],
    evaluationOrder: ["feature:rectangle-sketch", "feature:extrude"],
  });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers)).toBe(40_000_000);
  await page.locator("#redo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers)).toBe(31_750_000);
});

test("manifest, controlling service worker, and cached runtime support an offline reload", async ({ page, context }) => {
  expect((await page.request.get("/manifest.webmanifest")).ok()).toBe(true);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await page.waitForFunction(() => Object.values(window.__crawlerApp.readiness()).every((value) => value === "ready"));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => Object.values(window.__crawlerApp.readiness()).every((value) => value === "ready"));
  expect((await page.evaluate(() => window.__crawlerApp.pwaStatus())).cacheVersion).toBe("crawler-alpha-v1");
  await context.setOffline(false);
});

test("offline mode preserves the core new, open, model, undo, save, and recovery workflow", async ({ page, context }) => {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await page.waitForFunction(() => Object.values(window.__crawlerApp.readiness()).every((value) => value === "ready"));

  const originalHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const originalDistance = await page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers);
  const packageDownload = page.waitForEvent("download");
  await page.locator("#save-as-part").click();
  const packagePath = await (await packageDownload).path();
  const portablePackage = await readFile(packagePath!);

  await context.setOffline(true);
  try {
    await page.keyboard.press("Control+n");
    await expect(page.locator("#storage-status")).toHaveText("new part");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(originalHash);

    await page.locator("#open-part-file").setInputFiles({
      name: "offline-roundtrip.crawlerpart",
      mimeType: "application/vnd.crawler.part+zip",
      buffer: portablePackage,
    });
    await expect(page.locator("#storage-status")).toHaveText("opened");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(originalHash);

    await page.locator("#pad-length").fill("31.25");
    await page.locator("#start-pad").click();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(31_250_000);
    await expect(page.locator("#storage-status")).toHaveText("autosaved");

    await page.locator("#undo").click();
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(originalDistance);
    await expect(page.locator("#storage-status")).toHaveText("autosaved");
    await page.locator("#redo").click();
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(31_250_000);
    const acceptedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

    await page.keyboard.press("Control+s");
    await expect(page.locator("#storage-status")).toHaveText("saved");
    expect(await page.evaluate(() => window.__crawlerApp.hasExplicitSave())).toBe(true);
    const offlineSaveAs = page.waitForEvent("download");
    await page.keyboard.press("Control+Shift+s");
    expect((await offlineSaveAs).suggestedFilename()).toBe("bracket.crawlerpart");

    await page.reload();
    await page.waitForFunction(() => Object.values(window.__crawlerApp.readiness()).every((value) => value === "ready"));
    await expect(page.locator("#storage-status")).toHaveText("recovered");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedHash);
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(31_250_000);
    expect(await page.evaluate(() => window.__crawlerApp.recoveryProvenance())).toMatch(/accepted state \(redo, sequence \d+\)/);
    expect(await page.evaluate(() => window.__crawlerApp.recoveryChoices())).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "restore_accepted", semanticHash: acceptedHash }),
      expect.objectContaining({ kind: "open_explicit_save", available: true }),
    ]));
  } finally {
    await context.setOffline(false);
  }
});

test("keyboard command search and modeling controls restore intentional focus", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await expect(page.locator("#command-search")).toBeVisible();
  await expect(page.locator("#command-query")).toBeFocused();
  await page.locator("#command-query").fill("timeline");
  await page.keyboard.press("Enter");
  await expect(page.locator("#timeline")).toBeFocused();
  await page.locator("#start-pad").click();
  await expect(page.locator("#pad-length")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#start-pad")).toBeFocused();
  await page.locator("[data-timeline-id]").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-timeline-id]").nth(1)).toBeFocused();
});

test("camera and projection commands are operable from the keyboard alone", async ({ page }) => {
  const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await tabTo(page, "#projection-mode");
  await page.keyboard.press("Enter");
  await expect(page.locator("#projection-mode")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__crawlerApp.projectionMode())).toBe("orthographic");

  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#fit-view")).toBeFocused();
  await page.keyboard.press("Space");
  const fitted = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(fitted[0]).toBeGreaterThan(40);
  expect(fitted[1]).toBeGreaterThan(28);
  expect(fitted[2]).toBeGreaterThan(12);

  for (let index = 0; index < 4; index += 1) await page.keyboard.press("Shift+Tab");
  await expect(page.locator('[data-view="front"]')).toBeFocused();
  await page.keyboard.press("Enter");
  const front = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(front[0]).toBeCloseTo(20);
  expect(front[1]).toBeCloseTo(14);
  expect(front[2]).toBeGreaterThan(12);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);
});

test("keyboard shortcuts remain distinct and do not fall through to browser defaults", async ({ page, context }) => {
  test.setTimeout(240_000);
  const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  let downloads = 0;
  page.on("download", () => { downloads += 1; });

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command search" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);

  await page.keyboard.press("Control+s");
  await expect(page.locator("#storage-status")).toHaveText("saved");
  expect(downloads).toBe(0);

  const saveAs = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+s");
  await saveAs;
  expect(downloads).toBe(1);

  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles([]);
  expect(context.pages()).toHaveLength(1);

  await page.keyboard.press("Control+n");
  await expect(page.locator("#storage-status")).toHaveText("new part");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(checksum);
  expect(context.pages()).toHaveLength(1);
});

test("semantic accessibility smoke checks cover names, landmarks, states, and dialog focus", async ({ page }) => {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "feature browser" })).toBeVisible();
  await expect(page.getByLabel("3D viewport")).toBeVisible();
  await expect(page.locator('[role="status"]').first()).toBeVisible();

  const audit = await page.evaluate(() => {
    const visible = (element: HTMLElement) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0;
    const controls = Array.from(document.querySelectorAll<HTMLElement>("button, input, canvas"));
    const unnamed = controls.filter((element) => {
      if (!visible(element) || (element instanceof HTMLInputElement && element.type === "hidden")) return false;
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
      const labelText = element.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim() : "";
      const wrappedLabel = element.closest("label")?.textContent?.trim();
      return !(element.getAttribute("aria-label")?.trim() || labelledText || labelText || wrappedLabel || element.textContent?.trim() || element.getAttribute("title")?.trim());
    }).map((element) => element.id || element.outerHTML.slice(0, 80));
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[id]")).map((element) => element.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    return { unnamed, duplicateIds };
  });
  expect(audit.unnamed).toEqual([]);
  expect(audit.duplicateIds).toEqual([]);
  await expect(page.locator("#projection-mode")).toHaveAttribute("aria-pressed", /^(true|false)$/);
  await expect(page.locator("#diagnostics")).toHaveAttribute("aria-live", "polite");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command search" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#command-query")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("quick tour can be skipped and restart resets its executable workflow", async ({ page }) => {
  await expect(page.locator("#onboarding")).toBeVisible();
  await expect(page.locator("#tour-next")).toBeDisabled();
  await page.locator("#tour-skip").click();
  await expect(page.locator("#onboarding")).toBeHidden();
  await page.locator("#restart-tour").click();
  await expect(page.locator("#onboarding")).toContainText("1/3");
  await expect(page.locator("#tour-next")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.onboarding())).toEqual({ step: 0, complete: false });
  await expect(page.locator("#pad-length")).toBeFocused();
});

test.describe("performance qualification", () => {
  test.describe.configure({ retries: 1 });

test("quota guidance, non-color states, and repeatable performance evidence are actionable", async ({ page }) => {
  await page.evaluate(() => window.__crawlerApp.simulateQuotaFailure());
  await expect(page.locator("#storage-status")).toContainText("export a copy");
  await page.locator("#start-pad").click();
  await expect(page.locator("#operation-state")).toContainText("Enter commits");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.keyboard.press("Escape");
  for (const millimeters of [18, 19, 20]) {
    await page.locator("#pad-length").fill(String(millimeters));
    await page.locator("#start-pad").click();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(millimeters * 1_000_000);
  }
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.performanceEvidence().summariesMs.recompute?.count ?? 0)).toBe(3);
  const evidence = await page.evaluate(() => window.__crawlerApp.performanceEvidence());
  expect(evidence.schemaVersion).toBe(1);
  expect(evidence.timingsMs.ui).toBeGreaterThanOrEqual(0);
  expect(evidence.timingsMs.load).toBeGreaterThanOrEqual(0);
  expect(evidence.timingsMs.input).toBeGreaterThanOrEqual(0);
  expect(evidence.timingsMs.preview).toBeGreaterThanOrEqual(0);
  expect(evidence.resources.workerTransferBytes).toBeGreaterThan(0);
  expect(typeof evidence.resources.memorySupported).toBe("boolean");
  expect(typeof evidence.reducedMotion).toBe("boolean");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.performanceEvidence().timingsMs.frameMedian ?? 0)).toBeGreaterThan(0);
  const gated = await page.evaluate(() => window.__crawlerApp.performanceEvidence());
  expect(gated.timingsMs.input).toBeLessThanOrEqual(50);
  expect(gated.timingsMs.preview).toBeLessThanOrEqual(100);
  expect(gated.timingsMs.load).toBeLessThanOrEqual(5_000);
  expect(gated.summariesMs.recompute.count).toBe(3);
  expect(gated.summariesMs.recompute.p50).toBeLessThanOrEqual(gated.budgets.thresholdsMs.recomputeP50);
  expect(gated.summariesMs.recompute.p95).toBeLessThanOrEqual(gated.budgets.thresholdsMs.recomputeP95);
  expect(gated.summariesMs.frameInterval.p50).toBeLessThanOrEqual(gated.budgets.thresholdsMs.frameP50);
  expect(gated.timingsMs.longTaskMax).toBeLessThanOrEqual(100);
  expect(gated.budgets.violations).toEqual([]);
  expect(gated.budgets.passed).toBe(true);
});

});

test("worker faults preserve the accepted source and require an explicit safe recovery choice", async ({ page }) => {
  await page.locator("#pad-length").fill("24"); await page.locator("#start-pad").click(); await page.keyboard.press("Enter");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate(() => window.__crawlerApp.faultWorker("fault one"));
  await expect(page.locator("#safe-mode")).toBeVisible();
  await expect(page.locator("#start-pad")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  await page.locator("#recover-runtime").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
  await expect(page.locator("#storage-status")).toHaveText("recovered");
  await page.evaluate(() => window.__crawlerApp.faultWorker("fault two"));
  await expect(page.locator("#safe-mode")).toBeVisible();
  await page.locator("#stay-safe").click();
  expect(await page.evaluate(() => window.__crawlerApp.recoveryProvenance())).toContain("accepted runtime snapshot");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
});

test("New, Open, and Save As preserve a portable canonical part through UI and keyboard flows", async ({ page }) => {
  const originalHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const saveDownload = page.waitForEvent("download");
  await page.locator("#save-as-part").click();
  const saved = await saveDownload;
  expect(saved.suggestedFilename()).toBe("bracket.crawlerpart");
  const savedPath = await saved.path();
  const canonical = await readFile(savedPath!);
  expect(Array.from(canonical.subarray(0, 2))).toEqual([0x50, 0x4b]);

  await page.keyboard.press("Control+n");
  await expect(page.locator("#storage-status")).toHaveText("new part");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(originalHash);

  await page.locator("#open-part-file").setInputFiles({ name: "bracket.crawlerpart", mimeType: "application/vnd.crawler.part+zip", buffer: canonical });
  await expect(page.locator("#storage-status")).toHaveText("opened");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(originalHash);

  const keyboardDownload = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+s");
  expect((await keyboardDownload).suggestedFilename()).toBe("bracket.crawlerpart");
});

test("native file pickers open, Save As, and Save the associated portable part", async ({ page }) => {
  await page.evaluate(() => {
    const state: { bytes?: Uint8Array; writes: number } = { writes: 0 };
    const handle = {
      name: "native-picker.crawlerpart",
      async getFile() { return new File([state.bytes ?? new Uint8Array()], this.name, { type: "application/vnd.crawler.part+zip" }); },
      async createWritable() {
        return {
          async write(data: BlobPart) { state.bytes = new Uint8Array(await new Blob([data]).arrayBuffer()); state.writes += 1; },
          async close() {},
        };
      },
    };
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => handle });
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [handle] });
    (window as unknown as { __nativePickerState: typeof state }).__nativePickerState = state;
  });
  const originalHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.locator("#save-as-part").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativePickerState: { writes: number } }).__nativePickerState.writes)).toBe(1);
  await expect(page.locator("#storage-status")).toHaveText("saved");

  await page.locator("#new-part").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(originalHash);
  await page.locator("#open-part").click();
  await expect(page.locator("#storage-status")).toHaveText("opened");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(originalHash);

  await page.locator("#pad-length").fill("21");
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await page.locator("#save-part").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativePickerState: { writes: number } }).__nativePickerState.writes)).toBe(2);
  await expect(page.locator("#storage-status")).toHaveText("saved");
});

test("STEP import creates a durable body with authoritative selectable topology", async ({ page }) => {
  const step = await readFile("../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step");
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#import-step-file").setInputFiles({ name: "qualified-cube.step", mimeType: "model/step", buffer: step });
  await expect(page.locator("#import-status")).toContainText("STEP: 6 faces", { timeout: 30_000 });
  await expect(page.locator("#operation-state")).toHaveText("Operation: STEP import committed");
  await expect(page.locator("#feature-browser")).toContainText("qualified-cube");
  const importedBodyId = await page.locator("[data-body-id]").last().getAttribute("data-body-id");
  expect(importedBodyId).toMatch(/^body:import:/);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 10, 10, 10]);
  for (const kind of ["face", "edge", "vertex"] as const) {
    const selection = await page.evaluate((value) => window.__crawlerApp.selectFirst(value), kind);
    expect(selection?.kind).toBe(kind);
    expect(selection?.bodyId).toBe(importedBodyId);
  }
  const importedFeature = page.locator("[data-feature-id]").filter({ hasText: "qualified-cube" });
  await importedFeature.click();
  await page.locator("#feature-name").fill("Imported Reference Cube");
  await page.locator('[data-feature-action="rename"]').click();
  await expect(page.locator("#feature-browser")).toContainText("Imported Reference Cube");
  const renamed = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator('[data-feature-action="rollback"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Rollback after");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(renamed);
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator("#inspector")).toContainText("suppressed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).toEqual([0, 0, 0, 40, 28, 12]);
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()[3])).toBe(10);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(renamed);
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  const imported = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect(imported).not.toBe(before);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(imported);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 10, 10, 10]);
});

for (const [format, extension, marker] of [["step", ".step", "CLOSED_SHELL"], ["stl", ".stl", "solid CrawlerPart"], ["obj", ".obj", "# Crawler accepted part result"]] as const) {
  test(`${format.toUpperCase()} export downloads deterministic geometry without semantic mutation`, async ({ page }) => {
    const checksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const pending = page.waitForEvent("download");
    await page.locator(`[data-export="${format}"]`).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`bracket${extension}`);
    const path = await download.path();
    expect(path).not.toBeNull();
    expect(await readFile(path!, "utf8")).toContain(marker);
    expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(checksum);
  });
}
