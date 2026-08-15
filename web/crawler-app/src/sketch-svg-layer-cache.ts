export const SKETCH_SVG_LAYER_NAMES = [
  "profiles",
  "hit-geometry",
  "geometry",
  "transient",
  "references",
  "handles",
  "annotations",
  "selection",
] as const;

export type SketchSvgLayerName = typeof SKETCH_SVG_LAYER_NAMES[number];

/**
 * Tracks the last markup assigned to each stable sketch SVG layer. Keeping the
 * cache independent from the DOM makes invalidation deterministic and lets the
 * renderer avoid detaching focusable geometry when only cursor feedback moves.
 */
export class SketchSvgLayerCache {
  private readonly markup = new Map<SketchSvgLayerName, string>();

  update(name: SketchSvgLayerName, nextMarkup: string): boolean {
    if (this.markup.get(name) === nextMarkup) return false;
    this.markup.set(name, nextMarkup);
    return true;
  }

  invalidate(name?: SketchSvgLayerName): void {
    if (name) this.markup.delete(name);
    else this.markup.clear();
  }
}
