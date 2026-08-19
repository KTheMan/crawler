import { strFromU8, unzipSync } from "fflate";
import { CRAWLER_FREECAD_ICON_ALIASES } from "./freecad-icon-map.ts";

export type ThemeSourceKind = "fctheme" | "legacy-freecad-icons" | "github";

export interface ThemeSource {
  kind: ThemeSourceKind;
  url?: string;
  revision?: string;
  license?: string;
  licenseUrl?: string;
}

export interface ImportedTheme {
  formatVersion: 1;
  name: string;
  mode?: "light" | "dark";
  author?: string;
  description?: string;
  source: ThemeSource;
  colors: Record<string, string>;
  icons: Record<string, { mime: string; bytes: Uint8Array; sourcePath: string }>;
}

type Archive = Record<string, Uint8Array>;

const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 4_000;

const COLOR_VARIABLES = new Set([
  "--bg", "--bg-overlay", "--chrome", "--chrome-raised", "--surface", "--surface-hover",
  "--surface-panel", "--surface-deep", "--surface-overlay", "--surface-control",
  "--surface-control-strong", "--surface-control-hover", "--surface-item", "--surface-item-muted",
  "--surface-popover", "--workspace-divider", "--track", "--border", "--border-strong",
  "--floating-surface", "--floating-border", "--floating-control", "--floating-control-hover",
  "--floating-control-active", "--floating-control-active-border", "--floating-control-active-bg",
  "--timeline-playhead", "--timeline-playhead-handle", "--muted", "--muted-dim", "--muted-faint",
  "--text-secondary", "--text-tertiary", "--text", "--accent", "--accent-strong", "--success",
]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function basename(path: string): string {
  const value = normalizePath(path).split("/").at(-1) ?? path;
  return value.replace(/\.[^.]+$/, "");
}

function relativeTo(manifestPath: string, path: string): string {
  const normalized = normalizePath(path);
  if (/^(?:[a-z]+:|\/)/i.test(path)) return normalized;
  const directory = normalizePath(manifestPath).replace(/[^/]+$/, "");
  return `${directory}${normalized}`;
}

function normalizeIconId(id: string): string {
  return basename(id).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mimeFor(path: string): string | undefined {
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  return undefined;
}

function textFile(archive: Archive, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = normalizePath(path).toLowerCase();
  const entry = Object.entries(archive).find(([name]) => normalizePath(name).toLowerCase() === normalized);
  return entry ? strFromU8(entry[1]) : undefined;
}

function findEntry(archive: Archive, path: string): [string, Uint8Array] | undefined {
  const normalized = normalizePath(path).toLowerCase();
  return Object.entries(archive).find(([name]) => normalizePath(name).toLowerCase() === normalized);
}

function unzipTheme(bytes: Uint8Array): Archive {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Theme archive is larger than 80 MB");
  let entries = 0;
  let expandedBytes = 0;
  return unzipSync(bytes, {
    filter(file) {
      entries += 1;
      expandedBytes += file.originalSize;
      if (entries > MAX_ENTRIES) throw new Error("Theme archive contains too many files");
      if (file.originalSize > MAX_ENTRY_BYTES) throw new Error(`Theme file is too large: ${file.name}`);
      if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error("Expanded theme is larger than 80 MB");
      const path = normalizePath(file.name);
      if (path.includes("../") || /^[a-z]:/i.test(path)) throw new Error(`Unsafe theme path: ${file.name}`);
      return /\.(?:xml|json|yaml|yml|qss|css|txt|theme|svg|png|webp|gif|md|license)$/i.test(path) || /(?:^|\/)license(?:\.[^/]*)?$/i.test(path);
    },
  });
}

function xmlTag(xml: string, tag: string): string | undefined {
  const value = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml)?.[1];
  return value?.replace(/<[^>]+>/g, "").trim();
}

function xmlAttribute(xml: string, tag: string, attribute: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "i").exec(xml);
  return match?.[1]?.trim();
}

function parseMetadata(archive: Archive, fallbackName: string): {
  name: string; author?: string; description?: string; mode?: "light" | "dark"; license?: string; licenseUrl?: string; stylesheetPaths: string[]; iconMap: Record<string, string>; colors: Record<string, string>;
} {
  const names = Object.keys(archive);
  const jsonPath = names.find((name) => /(?:^|\/)(?:theme|manifest)\.json$/i.test(name));
  if (jsonPath) {
    try {
      const raw = JSON.parse(strFromU8(archive[jsonPath])) as Record<string, unknown>;
      const stylesheets = [raw.stylesheet, ...(Array.isArray(raw.stylesheets) ? raw.stylesheets : [])].filter((value): value is string => typeof value === "string").map((path) => relativeTo(jsonPath, path));
      const rawIcons = raw.icons && typeof raw.icons === "object" ? raw.icons as Record<string, unknown> : {};
      const rawColors = raw.colors && typeof raw.colors === "object" ? raw.colors as Record<string, unknown> : {};
      return {
        name: typeof raw.name === "string" ? raw.name : fallbackName,
        author: typeof raw.author === "string" ? raw.author : undefined,
        description: typeof raw.description === "string" ? raw.description : undefined,
        license: typeof raw.license === "string" ? raw.license : undefined,
        licenseUrl: typeof raw.licenseUrl === "string" ? raw.licenseUrl : undefined,
        mode: raw.type === "light" || raw.type === "dark" ? raw.type : undefined,
        stylesheetPaths: stylesheets,
        iconMap: Object.fromEntries(Object.entries(rawIcons).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([id, path]) => [id, relativeTo(jsonPath, path)])),
        colors: Object.fromEntries(Object.entries(rawColors).filter((entry): entry is [string, string] => COLOR_VARIABLES.has(entry[0]) && typeof entry[1] === "string")),
      };
    } catch (error) {
      throw new Error(`Theme manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const xmlPath = names.find((name) => /(?:^|\/)(?:theme|manifest)\.xml$/i.test(name));
  if (xmlPath) {
    const xml = strFromU8(archive[xmlPath]);
    const styleTags = [...xml.matchAll(/<stylesheet(?:\s[^>]*)?>([^<]+)<\/stylesheet>/gi)].map((match) => relativeTo(xmlPath, match[1].trim()));
    const iconMap: Record<string, string> = {};
    for (const match of xml.matchAll(/<icon\b([^>]*)\/?\s*>/gi)) {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']+)["']/g)].map((attribute) => [attribute[1].toLowerCase(), attribute[2]]));
      const id = attributes.name ?? attributes.id;
      const path = attributes.path ?? attributes.file;
      if (id && path) iconMap[id] = relativeTo(xmlPath, path);
    }
    const type = xmlTag(xml, "type")?.toLowerCase();
    return {
      name: xmlTag(xml, "name") ?? fallbackName,
      author: xmlTag(xml, "author"),
      description: xmlTag(xml, "description"),
      license: xmlTag(xml, "license"),
      licenseUrl: xmlTag(xml, "licenseurl") ?? xmlTag(xml, "license_url"),
      mode: type === "light" || type === "dark" ? type : undefined,
      stylesheetPaths: styleTags.length ? styleTags : [xmlAttribute(xml, "theme", "stylesheet")].filter((value): value is string => Boolean(value)).map((path) => relativeTo(xmlPath, path)),
      iconMap,
      colors: {},
    };
  }

  return { name: fallbackName, stylesheetPaths: [], iconMap: {}, colors: {} };
}

function parseLegacyManifest(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*([^,#][^,]*?)\s*,\s*iconset\s*:\s*(.+?)\s*$/i.exec(line);
    if (match) result[match[1].trim()] = normalizePath(match[2].trim());
  }
  return result;
}

function detectLicense(text: string): string | undefined {
  if (/creativecommons\.org\/licenses\/by-sa\/4\.0|CC[- ]BY[- ]SA[- ]4\.0/i.test(text)) return "CC-BY-SA-4.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,80}(?:Version\s*)?2\.1/i.test(text)) return "LGPL-2.1";
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,80}(?:Version\s*)?3/i.test(text)) return "LGPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,80}(?:Version\s*)?3/i.test(text)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,80}(?:Version\s*)?2/i.test(text)) return "GPL-2.0";
  return undefined;
}

function colorFromValue(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgb) return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
  if (/^\d+$/.test(trimmed)) {
    const value32 = Number(trimmed) >>> 0;
    const hex = value32.toString(16).padStart(8, "0");
    return `#${hex.slice(0, 6)}`;
  }
  const named: Record<string, string> = { black: "#000000", white: "#ffffff", transparent: "#00000000" };
  return named[trimmed.toLowerCase()];
}

function mix(left: string, right: string, ratio: number): string {
  const channels = (color: string) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const a = channels(left.slice(0, 7));
  const b = channels(right.slice(0, 7));
  const t = Math.max(0, Math.min(1, ratio));
  return `#${a.map((value, index) => Math.round(value * (1 - t) + b[index] * t).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

export function colorsFromFreeCadParameters(text: string): { colors: Record<string, string>; mode?: "light" | "dark" } {
  const expressions = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (match && !match[1].startsWith("#")) expressions.set(match[1], match[2].replace(/^['"]|['"]$/g, ""));
  }
  const resolved = new Map<string, string>();
  const resolve = (name: string, stack = new Set<string>()): string | undefined => {
    if (resolved.has(name)) return resolved.get(name);
    if (stack.has(name)) return undefined;
    stack.add(name);
    const expression = expressions.get(name);
    if (!expression) return undefined;
    let color = colorFromValue(expression);
    if (!color && /^@[A-Za-z0-9_]+$/.test(expression)) color = resolve(expression.slice(1), stack);
    const operation = /^(lighten|darken|blend)\(\s*@([A-Za-z0-9_]+)\s*(?:,\s*@([A-Za-z0-9_]+))?\s*,\s*([\d.]+)\s*\)$/.exec(expression);
    if (!color && operation) {
      const first = resolve(operation[2], stack);
      const second = operation[1] === "blend" ? resolve(operation[3], stack) : operation[1] === "lighten" ? "#ffffff" : "#000000";
      if (first && second) color = mix(first, second, Number(operation[4]) / 100);
    }
    stack.delete(name);
    if (color) resolved.set(name, color);
    return color;
  };
  for (const name of expressions.keys()) resolve(name);
  return paletteFromSemanticColors(Object.fromEntries(resolved));
}

function paletteFromSemanticColors(values: Record<string, string>): { colors: Record<string, string>; mode?: "light" | "dark" } {
  const background = values.GeneralBackgroundColor ?? values.DialogBackgroundColor ?? values.PrimaryColor ?? values.background ?? "#171a20";
  const text = values.TextForegroundColor ?? values.foreground ?? (luminance(background) > 0.55 ? "#1c2030" : "#cdd1dc");
  const accent = values.AccentColor ?? values.ThemeAccentColor1 ?? values.selection ?? "#0ea5e9";
  const dark = luminance(background) < 0.5;
  const toward = dark ? "#ffffff" : "#000000";
  const away = dark ? "#000000" : "#ffffff";
  const surface = values.DialogBackgroundColor ?? mix(background, toward, dark ? 0.05 : 0.03);
  const border = values.GeneralBorderColor ?? mix(background, toward, dark ? 0.18 : 0.15);
  return {
    mode: dark ? "dark" : "light",
    colors: {
      "--bg": background, "--chrome": surface, "--chrome-raised": mix(surface, toward, 0.04),
      "--surface": surface, "--surface-hover": values.GeneralBackgroundHoverColor ?? mix(surface, toward, 0.08),
      "--surface-panel": mix(surface, away, 0.02), "--surface-deep": mix(surface, away, 0.08),
      "--surface-overlay": mix(surface, toward, 0.04), "--surface-control": values.TextEditFieldBackgroundColor ?? mix(surface, toward, 0.03),
      "--surface-control-strong": values.ButtonTopBackgroundColor ?? mix(surface, toward, 0.06),
      "--surface-control-hover": values.ButtonBackgroundHooverColor ?? mix(surface, toward, 0.1),
      "--surface-item": mix(surface, toward, 0.04), "--surface-item-muted": mix(surface, away, 0.04),
      "--surface-popover": mix(surface, toward, 0.05), "--workspace-divider": border, "--track": mix(surface, toward, 0.12),
      "--border": border, "--border-strong": values.GeneralBorderHoverColor ?? mix(border, toward, 0.2),
      "--floating-surface": mix(surface, toward, 0.04), "--floating-border": border,
      "--floating-control": mix(text, background, 0.36), "--floating-control-hover": mix(surface, toward, 0.1),
      "--floating-control-active": accent, "--floating-control-active-border": mix(accent, background, 0.28),
      "--floating-control-active-bg": mix(surface, accent, 0.17), "--timeline-playhead": accent,
      "--timeline-playhead-handle": mix(accent, away, 0.16), "--muted": mix(text, background, 0.28),
      "--muted-dim": mix(text, background, 0.43), "--muted-faint": mix(text, background, 0.55),
      "--text-secondary": mix(text, background, 0.1), "--text-tertiary": mix(text, background, 0.25),
      "--text": text, "--accent": accent, "--accent-strong": mix(accent, away, 0.15),
    },
  };
}

export function colorsFromQss(text: string): { colors: Record<string, string>; mode?: "light" | "dark" } {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map((match) => ({ selector: match[1], body: match[2] }));
  const declaration = (selectors: RegExp, property: RegExp): string | undefined => {
    for (const rule of rules) {
      if (!selectors.test(rule.selector)) continue;
      const match = new RegExp(`(?:^|;)\\s*${property.source}\\s*:\\s*([^;]+)`, "i").exec(rule.body);
      const color = match && colorFromValue(match[1]);
      if (color) return color;
    }
    return undefined;
  };
  const semantic: Record<string, string> = {};
  semantic.GeneralBackgroundColor = declaration(/QMainWindow|QDialog|QDockWidget/i, /background(?:-color)?/) ?? declaration(/^\s*\*/i, /background(?:-color)?/) ?? "";
  semantic.DialogBackgroundColor = declaration(/QDialog|QDockWidget/i, /background(?:-color)?/) ?? semantic.GeneralBackgroundColor;
  semantic.TextForegroundColor = declaration(/^\s*\*/i, /color/) ?? declaration(/QLabel|QMenu/i, /color/) ?? "";
  semantic.AccentColor = declaration(/selected|pressed|checked/i, /background(?:-color)?/) ?? "";
  semantic.TextEditFieldBackgroundColor = declaration(/QLineEdit|QTextEdit|QPlainTextEdit/i, /background(?:-color)?/) ?? "";
  return paletteFromSemanticColors(Object.fromEntries(Object.entries(semantic).filter(([, value]) => Boolean(value))));
}

function colorsFromPreferenceXml(archive: Archive): { colors: Record<string, string>; mode?: "light" | "dark" } | undefined {
  const semantic: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(archive)) {
    if (!/\.xml$/i.test(name) || /(?:theme|manifest)\.xml$/i.test(name)) continue;
    const xml = strFromU8(bytes);
    for (const match of xml.matchAll(/<FC(?:UInt|String|Int|Float)\b[^>]*\bName=["']([^"']*(?:color|background|foreground)[^"']*)["'][^>]*\bValue=["']([^"']+)["'][^>]*\/?\s*>/gi)) {
      const color = colorFromValue(match[2]);
      if (color) semantic[match[1]] = color;
    }
  }
  return Object.keys(semantic).length ? paletteFromSemanticColors(semantic) : undefined;
}

function mapIcons(archive: Archive, explicit: Record<string, string>, legacy: Record<string, string>): ImportedTheme["icons"] {
  const images = Object.entries(archive).filter(([path]) => Boolean(mimeFor(path)));
  const byId = new Map<string, [string, Uint8Array]>();
  for (const image of images) byId.set(normalizeIconId(image[0]), image);
  for (const [id, path] of Object.entries(legacy)) {
    const entry = findEntry(archive, path);
    if (entry) byId.set(normalizeIconId(id), entry);
  }
  for (const [id, path] of Object.entries(explicit)) {
    const entry = findEntry(archive, path);
    if (entry) byId.set(normalizeIconId(id), entry);
  }
  const icons: ImportedTheme["icons"] = {};
  for (const [appId, aliases] of Object.entries(CRAWLER_FREECAD_ICON_ALIASES)) {
    const entry = byId.get(normalizeIconId(appId)) ?? aliases.map((alias) => byId.get(normalizeIconId(alias))).find(Boolean);
    if (!entry) continue;
    const mime = mimeFor(entry[0]);
    if (mime) icons[appId] = { mime, bytes: entry[1], sourcePath: entry[0] };
  }
  return icons;
}

export function importThemeArchive(bytes: Uint8Array, filename: string, source: Partial<ThemeSource> = {}): ImportedTheme {
  const archive = unzipTheme(bytes);
  const names = Object.keys(archive);
  const fallbackName = filename.replace(/\.(?:fctheme|zip)$/i, "") || "Imported FreeCAD theme";
  const metadata = parseMetadata(archive, fallbackName);
  const legacyManifestPath = names.find((name) => /(?:^|\/)[^/]+\.txt$/i.test(name) && /iconset\s*:/i.test(strFromU8(archive[name])));
  const legacy = legacyManifestPath ? parseLegacyManifest(strFromU8(archive[legacyManifestPath])) : {};
  const parameterPath = names.find((name) => /(?:parameters?|colors?).*\.ya?ml$/i.test(name)) ?? names.find((name) => /\.ya?ml$/i.test(name));
  const stylesheetPaths = metadata.stylesheetPaths.length ? metadata.stylesheetPaths : names.filter((name) => /\.qss$/i.test(name));
  const parameterPalette = parameterPath ? colorsFromFreeCadParameters(strFromU8(archive[parameterPath])) : undefined;
  const preferencePalette = colorsFromPreferenceXml(archive);
  const qss = stylesheetPaths.map((path) => textFile(archive, path)).find(Boolean);
  const qssPalette = qss ? colorsFromQss(qss) : undefined;
  const palette = parameterPalette ?? preferencePalette ?? qssPalette ?? { colors: {}, mode: metadata.mode };
  const isLegacy = Boolean(legacyManifestPath) && !names.some((name) => /(?:theme|manifest)\.(?:xml|json)$/i.test(name));
  const licenseEntry = names.find((name) => /(?:^|\/)license(?:\.[^/]*)?$/i.test(name));
  const detectedLicense = licenseEntry ? detectLicense(strFromU8(archive[licenseEntry])) : qss ? detectLicense(qss) : undefined;
  return {
    formatVersion: 1,
    name: metadata.name,
    mode: metadata.mode ?? palette.mode,
    author: metadata.author,
    description: metadata.description,
    source: {
      kind: source.kind ?? (isLegacy ? "legacy-freecad-icons" : "fctheme"),
      url: source.url,
      revision: source.revision,
      license: source.license ?? metadata.license ?? detectedLicense,
      licenseUrl: source.licenseUrl ?? metadata.licenseUrl,
    },
    colors: { ...palette.colors, ...metadata.colors },
    icons: mapIcons(archive, metadata.iconMap, legacy),
  };
}

interface GitTreeEntry { path: string; type: "blob" | "tree"; size?: number }

function parseGitHubUrl(input: string): { owner: string; repo: string; ref?: string } {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid GitHub repository URL"); }
  if (url.hostname.toLowerCase() !== "github.com") throw new Error("Only github.com repository URLs are supported");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) throw new Error("GitHub URL must identify an owner and repository");
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, ""), ref: parts[2] === "tree" ? parts.slice(3).join("/") : undefined };
}

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return await response.json() as T;
}

function rawUrl(owner: string, repo: string, revision: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(revision)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function importThemeFromGitHub(input: string, fetcher: typeof fetch = fetch): Promise<ImportedTheme> {
  const { owner, repo, ref } = parseGitHubUrl(input);
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await fetchJson<{ default_branch: string; license?: { spdx_id?: string } }>(fetcher, api);
  const commit = await fetchJson<{ sha: string }>(fetcher, `${api}/commits/${encodeURIComponent(ref ?? repository.default_branch)}`);
  const pinnedSourceUrl = `https://github.com/${owner}/${repo}/tree/${commit.sha}`;
  const tree = await fetchJson<{ truncated: boolean; tree: GitTreeEntry[] }>(fetcher, `${api}/git/trees/${commit.sha}?recursive=1`);
  if (tree.truncated) throw new Error("GitHub repository tree is too large to import safely");

  const archiveTheme = tree.tree.find((entry) => entry.type === "blob" && /\.fctheme$/i.test(entry.path));
  if (archiveTheme) {
    const response = await fetcher(rawUrl(owner, repo, commit.sha, archiveTheme.path));
    if (!response.ok) throw new Error(`Could not download ${archiveTheme.path}`);
    return importThemeArchive(new Uint8Array(await response.arrayBuffer()), basename(archiveTheme.path), {
      kind: "github", url: pinnedSourceUrl, revision: commit.sha, license: repository.license?.spdx_id, licenseUrl: `https://github.com/${owner}/${repo}/blob/${commit.sha}/LICENSE`,
    });
  }

  const qssEntry = tree.tree.find((entry) => /FreeCAD Nut.*\.qss$/i.test(entry.path))
    ?? tree.tree.find((entry) => entry.type === "blob" && /(?:^|\/)Stylesheets\/[^/]+\.qss$/i.test(entry.path) && !/defaults|overlay/i.test(entry.path));
  const yamlEntry = tree.tree.find((entry) => /Stylesheets\/parameters\/FreeCAD Light\.ya?ml$/i.test(entry.path))
    ?? tree.tree.find((entry) => /Stylesheets\/parameters\/[^/]+\.ya?ml$/i.test(entry.path));
  if (!qssEntry && !yamlEntry) throw new Error("No FreeCAD stylesheet or theme parameters were found in this repository");

  const selectedImages = new Map<string, GitTreeEntry>();
  for (const aliases of Object.values(CRAWLER_FREECAD_ICON_ALIASES)) {
    for (const alias of aliases) {
      const normalized = normalizeIconId(alias);
      const candidates = tree.tree.filter((entry) => entry.type === "blob" && mimeFor(entry.path) && normalizeIconId(entry.path) === normalized);
      const entry = candidates.find((candidate) => /Resources\/icons/i.test(candidate.path) && /\.svg$/i.test(candidate.path)) ?? candidates.find((candidate) => /\.svg$/i.test(candidate.path)) ?? candidates[0];
      if (entry) selectedImages.set(entry.path, entry);
    }
  }
  const requested = [qssEntry, yamlEntry, ...selectedImages.values()].filter((entry): entry is GitTreeEntry => Boolean(entry));
  const files: Archive = {};
  await Promise.all(requested.map(async (entry) => {
    if ((entry.size ?? 0) > MAX_ENTRY_BYTES) throw new Error(`Theme file is too large: ${entry.path}`);
    const response = await fetcher(rawUrl(owner, repo, commit.sha, entry.path));
    if (!response.ok) throw new Error(`Could not download ${entry.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ENTRY_BYTES) throw new Error(`Theme file is too large: ${entry.path}`);
    files[entry.path] = bytes;
  }));
  const parameterPalette = yamlEntry ? colorsFromFreeCadParameters(strFromU8(files[yamlEntry.path])) : undefined;
  const qssText = qssEntry ? strFromU8(files[qssEntry.path]) : undefined;
  const qssPalette = qssText ? colorsFromQss(qssText) : undefined;
  const stylesheetLicense = qssText && /creativecommons\.org\/licenses\/by-sa\/4\.0/i.test(qssText) ? "CC-BY-SA-4.0" : undefined;
  const licenses = [...new Set([repository.license?.spdx_id, stylesheetLicense].filter((value): value is string => Boolean(value)))];
  const palette = qssPalette && Object.keys(qssPalette.colors).length ? qssPalette : parameterPalette ?? { colors: {} };
  return {
    formatVersion: 1,
    name: qssEntry ? basename(qssEntry.path) : `${owner}/${repo}`,
    mode: palette.mode,
    source: {
      kind: "github", url: pinnedSourceUrl, revision: commit.sha, license: licenses.join(" + ") || undefined,
      licenseUrl: licenses.length === 1 ? `https://github.com/${owner}/${repo}/blob/${commit.sha}/LICENSE` : undefined,
    },
    colors: palette.colors,
    icons: mapIcons(files, {}, {}),
  };
}

export const themeImporterInternals = { CRAWLER_FREECAD_ICON_ALIASES, parseLegacyManifest, parseGitHubUrl };
