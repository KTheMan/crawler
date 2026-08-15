const WHEEL_LINE_HEIGHT_PX = 16;
const MAX_WHEEL_ZOOM_EXPONENT = 0.1;
const VIEWPORT_GRID_RADIUS_SPAN = 10;
const VIEWPORT_GRID_DIVISIONS = 20;
const ORIGIN_PLANE_CELL_SPAN = 8;
const EMPTY_WORKSPACE_RADIUS_MM = 25;

export type ViewportPointerAction = "select" | "orbit" | "pan";

/** Give an empty part a useful millimeter-scale workspace instead of a micron-scale camera. */
export function viewportModelRadius(boundsDiagonalMillimeters: number): number {
  return Number.isFinite(boundsDiagonalMillimeters) && boundsDiagonalMillimeters > 0.000_001
    ? Math.max(boundsDiagonalMillimeters * 0.5, 0.001)
    : EMPTY_WORKSPACE_RADIUS_MM;
}

/**
 * SolidWorks-style pointer ownership: left is never camera navigation, the
 * wheel button orbits, and Ctrl/Cmd + wheel button pans.
 */
export function viewportPointerAction(button: number, ctrlKey = false, metaKey = false): ViewportPointerAction | undefined {
  if (button === 0) return "select";
  if (button === 1) return ctrlKey || metaKey ? "pan" : "orbit";
  return undefined;
}

export type ViewportGridMetrics = {
  size: number;
  divisions: number;
  cellSize: number;
  originPlaneSize: number;
};

/** Keep datum planes aligned to an exact number of cells in the centered viewport grid. */
export function viewportGridMetrics(modelRadius: number): ViewportGridMetrics {
  const size = modelRadius * VIEWPORT_GRID_RADIUS_SPAN;
  const cellSize = size / VIEWPORT_GRID_DIVISIONS;
  return {
    size,
    divisions: VIEWPORT_GRID_DIVISIONS,
    cellSize,
    originPlaneSize: cellSize * ORIGIN_PLANE_CELL_SPAN,
  };
}

/** Convert mouse wheels, trackpads, and page-scroll deltas into one bounded zoom step. */
export function wheelZoomScale(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (!Number.isFinite(deltaY)) return 1;
  const pixelDelta = deltaY * (deltaMode === 1
    ? WHEEL_LINE_HEIGHT_PX
    : deltaMode === 2
      ? Math.max(1, viewportHeight)
      : 1);
  const exponent = Math.tanh(pixelDelta / 120) * MAX_WHEEL_ZOOM_EXPONENT;
  return Math.exp(exponent);
}
