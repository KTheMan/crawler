import { bundledDevelopmentThemes } from "./development-themes";

interface DevelopmentThemeUiOptions {
  dialog: HTMLElement;
  importArchive(bytes: Uint8Array, filename: string): Promise<unknown>;
  setStatus(message: string, error?: boolean): void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

export function installDevelopmentThemeUi(options: DevelopmentThemeUiOptions): void {
  const section = document.createElement("section");
  section.dataset.developmentThemes = "";
  section.setAttribute("aria-labelledby", "development-themes-heading");
  section.innerHTML = `
    <h3 id="development-themes-heading">Bundled development themes</h3>
    <p>Local compatibility fixtures included only in development builds.</p>
    <div class="development-theme-list" data-development-theme-list>
      ${bundledDevelopmentThemes.map((theme) => `<button type="button" data-development-theme="${escapeHtml(theme.id)}">${escapeHtml(theme.name)}${theme.default ? " (default)" : ""}</button>`).join("")}
    </div>`;
  options.dialog.querySelector("[aria-labelledby='theme-source-heading']")?.before(section);

  section.querySelectorAll<HTMLButtonElement>("[data-development-theme]").forEach((button) => button.addEventListener("click", async () => {
    const theme = bundledDevelopmentThemes.find((candidate) => candidate.id === button.dataset.developmentTheme);
    if (!theme) return;
    button.disabled = true;
    options.setStatus(`Loading ${theme.name}…`);
    try {
      const response = await fetch(theme.url);
      if (!response.ok) throw new Error(`Development theme could not be loaded (${response.status})`);
      await options.importArchive(new Uint8Array(await response.arrayBuffer()), theme.filename);
    } catch (error) {
      options.setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      button.disabled = false;
    }
  }));
}
