import { setCadThemeIcons } from "./cad-icons";
import { importThemeArchive, importThemeFromGitHub, type ImportedTheme } from "./theme-importer";

const DATABASE_NAME = "crawler-theme-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "themes";
const ACTIVE_THEME_KEY = "active";
const FREECAD_NUT_REPOSITORY = "https://github.com/FreeCAD-Nut/FreeCAD";

export interface ThemeManagerStatus {
  active: boolean;
  name?: string;
  mode?: "light" | "dark";
  iconCount: number;
  colorCount: number;
  source?: ImportedTheme["source"];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Theme storage could not be opened"));
  });
}

async function readStoredTheme(): Promise<ImportedTheme | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(ACTIVE_THEME_KEY);
      request.onsuccess = () => resolve(request.result as ImportedTheme | undefined);
      request.onerror = () => reject(request.error ?? new Error("Theme could not be read"));
    });
  } finally {
    database.close();
  }
}

async function storeTheme(theme: ImportedTheme): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(theme, ACTIVE_THEME_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Theme could not be saved"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Theme save was cancelled"));
    });
  } finally {
    database.close();
  }
}

async function deleteStoredTheme(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(ACTIVE_THEME_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Theme could not be removed"));
    });
  } finally {
    database.close();
  }
}

function stylesheetFor(theme: ImportedTheme): string {
  const declarations = Object.entries(theme.colors)
    .filter(([name, value]) => /^--[a-z0-9-]+$/i.test(name) && /^(?:#[0-9a-f]{3,8}|rgba?\([^;{}]+\))$/i.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  return declarations ? `:root[data-external-theme="active"]{${declarations}}` : "";
}

function applyImportedTheme(theme: ImportedTheme | undefined, applyBaseMode: (mode: "light" | "dark") => void): void {
  const style = document.querySelector<HTMLStyleElement>("#crawler-imported-theme") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "crawler-imported-theme" }));
  style.textContent = theme ? stylesheetFor(theme) : "";
  document.documentElement.dataset.externalTheme = theme ? "active" : "none";
  document.documentElement.dataset.externalThemeSource = theme?.source.kind ?? "none";
  if (theme?.mode) applyBaseMode(theme.mode);
  setCadThemeIcons(theme?.icons ?? {});
}

function statusFor(theme: ImportedTheme | undefined): ThemeManagerStatus {
  return {
    active: Boolean(theme),
    name: theme?.name,
    mode: theme?.mode,
    iconCount: Object.keys(theme?.icons ?? {}).length,
    colorCount: Object.keys(theme?.colors ?? {}).length,
    source: theme?.source ? { ...theme.source } : undefined,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function renderActiveTheme(host: HTMLElement, theme: ImportedTheme | undefined): void {
  if (!theme) {
    host.innerHTML = `<strong>Built-in appearance</strong><span>No imported theme is active.</span>`;
    return;
  }
  const sourceLabel = theme.source.kind === "github" ? "GitHub" : theme.source.kind === "legacy-freecad-icons" ? "Legacy icon pack" : ".fctheme";
  const revision = theme.source.revision ? ` · ${escapeHtml(theme.source.revision.slice(0, 12))}` : "";
  const licenseLabel = theme.source.license ? escapeHtml(theme.source.license) : "";
  const licenseUrl = safeExternalUrl(theme.source.licenseUrl);
  const license = licenseLabel
    ? ` · ${licenseUrl ? `<a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noreferrer">${licenseLabel}</a>` : licenseLabel}`
    : "";
  const sourceUrl = safeExternalUrl(theme.source.url);
  const source = sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${sourceLabel}</a>`
    : sourceLabel;
  host.innerHTML = `<strong>${escapeHtml(theme.name)}</strong><span>${source}${revision}${license}</span><small>${Object.keys(theme.icons).length} mapped icons · ${Object.keys(theme.colors).length} color tokens${theme.mode ? ` · ${theme.mode}` : ""}</small>`;
}

export function installThemeManager(options: { applyBaseMode: (mode: "light" | "dark") => void }): {
  ready: Promise<void>;
  status(): ThemeManagerStatus;
  importArchive(bytes: Uint8Array, filename: string): Promise<ThemeManagerStatus>;
  importGitHub(url?: string): Promise<ThemeManagerStatus>;
  remove(): Promise<void>;
} {
  const dialog = document.createElement("div");
  dialog.id = "theme-preferences-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "theme-preferences-title");
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="theme-preferences-card">
      <header><h2 id="theme-preferences-title">Appearance themes</h2><button type="button" data-close-theme-preferences aria-label="Close">×</button></header>
      <div class="theme-preferences-content">
        <section aria-labelledby="active-theme-heading">
          <h3 id="active-theme-heading">Active theme</h3>
          <div class="active-imported-theme" data-active-imported-theme></div>
          <button type="button" data-remove-imported-theme>Use built-in appearance</button>
        </section>
        <section aria-labelledby="theme-file-heading">
          <h3 id="theme-file-heading">Import FreeCAD theme or icon pack</h3>
          <p>Choose a proposed <code>.fctheme</code> archive or a legacy FreeCAD icon-pack ZIP.</p>
          <label class="theme-file-picker">Choose .fctheme or ZIP<input type="file" data-theme-file accept=".fctheme,.zip,application/zip,application/x-zip-compressed" /></label>
        </section>
        <section aria-labelledby="theme-source-heading">
          <h3 id="theme-source-heading">Install from GitHub</h3>
          <p>Assets are fetched at runtime and stored only in this browser.</p>
          <div class="theme-source-row"><input type="url" data-theme-source-url value="${FREECAD_NUT_REPOSITORY}" aria-label="GitHub theme repository" /><button type="button" data-import-theme-source>Install</button></div>
        </section>
        <output class="theme-import-status" data-theme-import-status aria-live="polite"></output>
      </div>
      <footer><button type="button" data-close-theme-preferences>Done</button></footer>
    </div>`;
  document.body.append(dialog);

  let activeTheme: ImportedTheme | undefined;
  const activeHost = dialog.querySelector<HTMLElement>("[data-active-imported-theme]")!;
  const status = dialog.querySelector<HTMLOutputElement>("[data-theme-import-status]")!;
  const removeButton = dialog.querySelector<HTMLButtonElement>("[data-remove-imported-theme]")!;
  let returnFocus: HTMLElement | null = null;
  const closeDialog = () => {
    if (dialog.hidden) return;
    dialog.hidden = true;
    const shell = document.querySelector<HTMLElement>(".shell");
    if (shell) shell.inert = false;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };
  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const refresh = () => {
    renderActiveTheme(activeHost, activeTheme);
    removeButton.disabled = !activeTheme;
  };
  const activate = async (theme: ImportedTheme): Promise<ThemeManagerStatus> => {
    await storeTheme(theme);
    activeTheme = theme;
    applyImportedTheme(theme, options.applyBaseMode);
    refresh();
    setStatus(`${theme.name} installed.`);
    return statusFor(theme);
  };
  const importArchive = async (bytes: Uint8Array, filename: string): Promise<ThemeManagerStatus> => activate(importThemeArchive(bytes, filename));
  const importGitHub = async (url = FREECAD_NUT_REPOSITORY): Promise<ThemeManagerStatus> => activate(await importThemeFromGitHub(url));
  const remove = async (): Promise<void> => {
    await deleteStoredTheme();
    activeTheme = undefined;
    applyImportedTheme(undefined, options.applyBaseMode);
    refresh();
    setStatus("Built-in appearance restored.");
  };

  document.querySelector<HTMLButtonElement>("#preferences-command")?.addEventListener("click", () => {
    returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLDetailsElement>(".app-menu")?.querySelector<HTMLElement>("summary") ?? document.activeElement
      : null;
    dialog.hidden = false;
    document.querySelectorAll<HTMLDetailsElement>(".app-menu[open]").forEach((menu) => { menu.open = false; });
    const shell = document.querySelector<HTMLElement>(".shell");
    if (shell) shell.inert = true;
    dialog.querySelector<HTMLInputElement>("[data-theme-source-url]")?.focus();
  });
  dialog.querySelectorAll<HTMLButtonElement>("[data-close-theme-preferences]").forEach((button) => button.addEventListener("click", closeDialog));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDialog(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.querySelector<HTMLInputElement>("[data-theme-file]")!.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setStatus(`Reading ${file.name}…`);
    try { await importArchive(new Uint8Array(await file.arrayBuffer()), file.name); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
    finally { input.value = ""; }
  });
  if (__CRAWLER_BUNDLE_DEV_THEMES__) {
    void import("./development-theme-ui").then(({ installDevelopmentThemeUi }) => {
      installDevelopmentThemeUi({ dialog, importArchive, setStatus });
    }).catch((error) => setStatus(`Development themes unavailable: ${error instanceof Error ? error.message : String(error)}`, true));
  }
  dialog.querySelector<HTMLButtonElement>("[data-import-theme-source]")!.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const input = dialog.querySelector<HTMLInputElement>("[data-theme-source-url]")!;
    button.disabled = true;
    setStatus("Fetching theme metadata and assets…");
    try { await importGitHub(input.value.trim()); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
    finally { button.disabled = false; }
  });
  removeButton.addEventListener("click", () => { void remove().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true)); });

  refresh();
  const ready = readStoredTheme().then(async (storedTheme) => {
    let theme = storedTheme;
    if (!theme && __CRAWLER_BUNDLE_DEV_THEMES__) {
      const { defaultDevelopmentTheme } = await import("./development-themes");
      const response = await fetch(defaultDevelopmentTheme.url);
      if (!response.ok) throw new Error(`Default development theme could not be loaded (${response.status})`);
      theme = importThemeArchive(new Uint8Array(await response.arrayBuffer()), defaultDevelopmentTheme.filename);
    }
    activeTheme = theme;
    applyImportedTheme(theme, options.applyBaseMode);
    refresh();
  }).catch((error) => setStatus(`Saved theme unavailable: ${error instanceof Error ? error.message : String(error)}`, true));
  return { ready, status: () => statusFor(activeTheme), importArchive, importGitHub, remove };
}
