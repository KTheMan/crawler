export type SketchSvgFragment = { key: string; markup: string };

export type SketchSvgReconcileStats = {
  inserted: number;
  updated: number;
  removed: number;
  retained: number;
};

const wrapperMarkup = new WeakMap<SVGGElement, string>();

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Incrementally reconciles keyed SVG fragments without replacing siblings. */
export function reconcileSketchSvgFragments(layer: SVGGElement, fragments: readonly SketchSvgFragment[]): SketchSvgReconcileStats {
  if (layer.childElementCount === 0 && fragments.length > 0) {
    layer.innerHTML = fragments.map(({ key, markup }) => `<g data-sketch-render-key="${escapeAttribute(key)}">${markup}</g>`).join("");
    Array.from(layer.children).forEach((child, index) => {
      if (child instanceof SVGGElement) wrapperMarkup.set(child, fragments[index].markup);
    });
    return { inserted: fragments.length, updated: 0, removed: 0, retained: 0 };
  }
  const existing = new Map<string, SVGGElement>();
  for (const child of Array.from(layer.children)) {
    if (child instanceof SVGGElement && child.dataset.sketchRenderKey) existing.set(child.dataset.sketchRenderKey, child);
  }
  const stats: SketchSvgReconcileStats = { inserted: 0, updated: 0, removed: 0, retained: 0 };
  let cursor: ChildNode | null = layer.firstChild;
  for (const fragment of fragments) {
    let wrapper = existing.get(fragment.key);
    if (!wrapper) {
      wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
      wrapper.dataset.sketchRenderKey = fragment.key;
      wrapperMarkup.set(wrapper, fragment.markup);
      wrapper.innerHTML = fragment.markup;
      stats.inserted += 1;
    } else {
      existing.delete(fragment.key);
      if ((wrapperMarkup.get(wrapper) ?? wrapper.innerHTML) !== fragment.markup) {
        wrapperMarkup.set(wrapper, fragment.markup);
        wrapper.innerHTML = fragment.markup;
        stats.updated += 1;
      } else stats.retained += 1;
    }
    if (wrapper !== cursor) layer.insertBefore(wrapper, cursor);
    cursor = wrapper.nextSibling;
  }
  for (const stale of existing.values()) {
    stale.remove();
    stats.removed += 1;
  }
  return stats;
}

/** Builds deterministic keys for existing render markup without parsing SVG. */
export function keyedSketchSvgMarkup(markup: readonly string[], attribute: string, prefix: string): SketchSvgFragment[] {
  const occurrences = new Map<string, number>();
  const expression = new RegExp(`${attribute}="([^"]+)"`);
  return markup.map((value, index) => {
    const match = expression.exec(value)?.[1];
    const base = match ? `${prefix}:${match}` : `${prefix}:anonymous:${index}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { key: `${base}:${occurrence}`, markup: value };
  });
}
