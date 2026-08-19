const svg = (body: string): string => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">${body}</svg>`;

const icons: Record<string, string> = {
  origin: svg(`<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 3v6m0 6v6M3 12h6m6 0h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity=".65"/>`),
  eye: svg(`<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>`),
  "eye-off": svg(`<path d="m4 4 16 16M10.5 6.2A10.4 10.4 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M7.2 7.3C4.2 9 2.5 12 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  "box-select": svg(`<rect x="4" y="4" width="16" height="16" rx=".5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/><path d="M4 4l3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`),
  "new-sketch": svg(`<path d="M3 15l4-3h10v5H7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity=".08"/><path d="M3 15l3-4m0 0h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="2 1"/><path d="m13 5 4 4-5 5-4 1 1-4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor" fill-opacity=".18"/><path d="m15 5 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  line: svg(`<circle cx="5" cy="19" r="2" fill="currentColor" fill-opacity=".9"/><circle cx="19" cy="5" r="2" fill="currentColor" fill-opacity=".9"/><line x1="6.4" y1="17.6" x2="17.6" y2="6.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  arc: svg(`<path d="M4 18A10 10 0 0 1 20 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="18" r="2" fill="currentColor"/><circle cx="20" cy="6" r="2" fill="currentColor"/><circle cx="11" cy="7" r="1.5" fill="currentColor" fill-opacity=".5"/><line x1="11" y1="7" x2="11" y2="12.5" stroke="currentColor" stroke-dasharray="1.5 1.5"/>`),
  circle: svg(`<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><line x1="12" y1="12" x2="19.4" y2="7.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`),
  rect: svg(`<rect x="4" y="7" width="16" height="10" rx=".5" stroke="currentColor" stroke-width="1.8"/><circle cx="4" cy="7" r="1.5" fill="currentColor" fill-opacity=".7"/><circle cx="20" cy="17" r="1.5" fill="currentColor" fill-opacity=".7"/>`),
  pad: svg(`<path d="m3 16 5-3h10v5H8z" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity=".15" stroke-linejoin="round"/><path d="m3 11 5-3h10v5H8l-5 3z" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity=".25" stroke-linejoin="round"/><path d="M3 11v5l5 2v-5z" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity=".1"/><line x1="12" y1="6" x2="12" y2="1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 4 12 1.5 14.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  revolve: svg(`<line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" stroke-dasharray="3 2"/><path d="M12 6h6v12h-6" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity=".18"/><path d="M18 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 1.5"/><path d="m15.5 16.5 2.5 1.5v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  pocket: svg(`<path d="m3 11 5-3h12v10H8l-5-3z" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity=".15" stroke-linejoin="round"/><path d="M8 8v5h12V8m-9 0v5h5V8" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity=".35"/><line x1="13.5" y1="2" x2="13.5" y2="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m11 5 2.5 2.5L16 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  fillet: svg(`<path d="M4 20V6h14" stroke="currentColor" stroke-width="1.8"/><path d="M4 12q0-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="12" x2="7" y2="9" stroke="currentColor" stroke-dasharray="1.5 1.5"/><text x="8.5" y="13" font-size="5" fill="currentColor" font-family="monospace" opacity=".7">R</text>`),
  chamfer: svg(`<path d="M4 20V10l10-4" stroke="currentColor" stroke-width="1.8"/><line x1="4" y1="10" x2="10" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 6h6M4 10V6" stroke="currentColor" opacity=".25"/><text x="5" y="13" font-size="5" fill="currentColor" font-family="monospace" opacity=".7">45°</text>`),
  linear: svg(`${[3, 8, 13, 18].map((x, index) => `<rect x="${x}" y="8" width="4" height="8" stroke="currentColor" stroke-width="1.3" fill="currentColor" fill-opacity="${index ? ".15" : ".45"}"/>`).join("")}<line x1="3" y1="4.5" x2="21" y2="4.5" stroke="currentColor" stroke-width="1.2"/><path d="m18.5 3 2.5 1.5L18.5 6" stroke="currentColor" stroke-width="1.2"/>`),
  circular: svg(`<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><rect x="10" y="3" width="4" height="4" stroke="currentColor" fill="currentColor" fill-opacity=".45"/><rect x="17" y="10" width="4" height="4" stroke="currentColor"/><rect x="10" y="17" width="4" height="4" stroke="currentColor"/><rect x="3" y="10" width="4" height="4" stroke="currentColor"/>`),
  mirror: svg(`<line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M4 7h6v10H4z" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity=".4"/><path d="M14 7h6v10h-6z" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity=".15"/>`),
  union: svg(`<rect x="4" y="7" width="11" height="11" rx="1" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity=".3"/><rect x="9" y="4" width="11" height="11" rx="1" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity=".15"/><path d="M4 7v11h11v-3h5V4H9v3z" stroke="currentColor" stroke-width="1.5"/>`),
  cut: svg(`<rect x="3" y="7" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity=".25"/><rect x="9" y="3" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 1.5"/><line x1="11.5" y1="9.5" x2="18" y2="9.5" stroke="currentColor" stroke-width="1.8"/>`),
  intersect: svg(`<rect x="3" y="7" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 1.5"/><rect x="9" y="3" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 1.5"/><rect x="9" y="7" width="6" height="8" rx=".5" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity=".45"/>`),
  distance: svg(`<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/><path d="M7 12h10M7 10v4m10-4v4" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="8" width="6" height="4" rx=".5" fill="currentColor" fill-opacity=".12"/><text x="12" y="11.5" font-size="4.5" fill="currentColor" font-family="monospace" text-anchor="middle">mm</text>`),
};

// Old theme records used FreeCAD-flavored UI keys. Keep accepting them while
// emitting stable Crawler tool IDs for all newly rendered ribbon icons.
const LEGACY_CAD_ICON_IDS: Readonly<Record<string, string>> = {
  pad: "extrude",
  pocket: "extrude-cut",
  groove: "revolve-cut",
  linear: "linear-pattern",
  circular: "circular-pattern",
  union: "combine",
  cut: "subtract",
  "sketch-linear-pattern": "sketch-rectangular-pattern",
};

icons.extrude = icons.pad;
icons["extrude-cut"] = icons.pocket;
icons["revolve-cut"] = icons.revolve;
icons["linear-pattern"] = icons.linear;
icons["circular-pattern"] = icons.circular;
icons.combine = icons.union;
icons.subtract = icons.cut;
icons.measure = icons.distance;
icons["measure-angle"] = icons.distance;

function canonicalCadIconId(name: string): string {
  return LEGACY_CAD_ICON_IDS[name] ?? name;
}

const activeThemeIconUrls = new Map<string, string>();
const builtInIconMarkup = new Map<string, string>();

function externalIcon(name: string, url: string): string {
  return `<img class="cad-theme-icon" data-cad-icon="${name}" src="${url}" alt="" aria-hidden="true" />`;
}

function builtInIcon(name: string, fallback: string): string {
  const builtIn = icons[name];
  return builtIn
    ? builtIn.replace("<svg ", `<svg data-cad-icon="${name}" `)
    : `<i data-cad-icon="${name}" data-lucide="${fallback}"></i>`;
}

export function cadIcon(name: string, fallback: string): string {
  const canonicalName = canonicalCadIconId(name);
  const fallbackMarkup = builtInIcon(canonicalName, fallback);
  // Remember the fallback even when this element is initially rendered while
  // an external theme is already active. This covers lazily rendered ribbon
  // flyouts, browser rows, and timeline entries.
  if (!builtInIconMarkup.has(canonicalName)) builtInIconMarkup.set(canonicalName, fallbackMarkup);
  const themed = activeThemeIconUrls.get(canonicalName);
  if (themed) return externalIcon(canonicalName, themed);
  return fallbackMarkup;
}

export function setCadThemeIcons(icons: Record<string, { mime: string; bytes: Uint8Array }>): void {
  const previousUrls = [...activeThemeIconUrls.values()];
  activeThemeIconUrls.clear();
  for (const [name, icon] of Object.entries(icons)) {
    const canonicalName = canonicalCadIconId(name);
    const bytes = icon.bytes.slice().buffer as ArrayBuffer;
    const previousUrl = activeThemeIconUrls.get(canonicalName);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    activeThemeIconUrls.set(canonicalName, URL.createObjectURL(new Blob([bytes], { type: icon.mime })));
  }
  document.querySelectorAll<HTMLElement>("[data-cad-icon]").forEach((element) => {
    const name = element.dataset.cadIcon;
    const url = name && activeThemeIconUrls.get(name);
    if (!name) return;
    if (url) {
      if (element.tagName === "IMG") {
        // External-to-external switching must replace the blob URL in place.
        // Previously these elements retained the revoked URL from the old pack.
        element.setAttribute("src", url);
      } else {
        if (!builtInIconMarkup.has(name)) builtInIconMarkup.set(name, element.outerHTML);
        element.replaceWith(document.createRange().createContextualFragment(externalIcon(name, url)));
      }
      return;
    }
    if (!url && element.tagName === "IMG") {
      const fallback = builtInIconMarkup.get(name);
      if (fallback) element.replaceWith(document.createRange().createContextualFragment(fallback));
    }
  });
  // Revoke only after every live image has moved to its replacement URL or
  // built-in fallback, avoiding a broken-image frame during theme switches.
  for (const url of previousUrls) URL.revokeObjectURL(url);
}
