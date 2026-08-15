export type ViewportVector3 = readonly [number, number, number];
export type ViewportQuaternion = readonly [number, number, number, number];

export type ViewportCameraPose = Readonly<{
  position: ViewportVector3;
  orientation: ViewportQuaternion;
}>;

export type ViewportProjection =
  | Readonly<{
    kind: "perspective";
    verticalFieldOfViewDegrees: number;
    near: number;
    far: number;
  }>
  | Readonly<{
    kind: "orthographic";
    viewHeight: number;
    near: number;
    far: number;
  }>;

/** Stable application identity for a pivot, independent of its current world position. */
export type ViewportSemanticAnchor = Readonly<{
  kind: string;
  key: string;
}>;

export type ViewportPivot = Readonly<{
  point: ViewportVector3;
  anchor?: ViewportSemanticAnchor;
}>;

export type ViewportWorkingSketchFrame = Readonly<{
  origin: ViewportVector3;
  xAxis: ViewportVector3;
  yAxis: ViewportVector3;
  normal: ViewportVector3;
}>;

export type ViewportNavigationMode = "model" | "sketch" | "temporary-orbit";

export type ViewportModelView = Readonly<{
  cameraPose: ViewportCameraPose;
  projection: ViewportProjection;
  pivot: ViewportPivot;
  workingSketchFrame: ViewportWorkingSketchFrame | null;
  navigationMode: ViewportNavigationMode;
}>;

export type ViewportStatePatch = Readonly<Partial<ViewportModelView>>;

export type ViewportSnapshot = ViewportModelView & Readonly<{
  revision: number;
  savedModelView: ViewportModelView | null;
}>;

export type ViewportStateListener = (snapshot: ViewportSnapshot) => void;

/**
 * Renderer-agnostic source of truth for viewport navigation and sketch framing.
 * Mutations are synchronous and publish one immutable snapshot per revision.
 */
export class ViewportStateController {
  private current: ViewportSnapshot;
  private readonly listeners = new Set<ViewportStateListener>();
  private readonly notificationQueue: ViewportSnapshot[] = [];
  private publishing = false;

  constructor(initial: ViewportModelView) {
    const view = immutableModelView(initial);
    this.current = immutableSnapshot(view, 0, null);
  }

  snapshot(): ViewportSnapshot {
    return this.current;
  }

  subscribe(listener: ViewportStateListener, emitCurrent = false): () => void {
    this.listeners.add(listener);
    if (emitCurrent) listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  replaceState(next: ViewportModelView): ViewportSnapshot {
    return this.commit(immutableModelView(next));
  }

  update(patch: ViewportStatePatch): ViewportSnapshot {
    return this.commit(immutableModelView({
      cameraPose: patch.cameraPose ?? this.current.cameraPose,
      projection: patch.projection ?? this.current.projection,
      pivot: patch.pivot ?? this.current.pivot,
      workingSketchFrame: patch.workingSketchFrame === undefined
        ? this.current.workingSketchFrame
        : patch.workingSketchFrame,
      navigationMode: patch.navigationMode ?? this.current.navigationMode,
    }));
  }

  setCameraPose(cameraPose: ViewportCameraPose): ViewportSnapshot {
    return this.update({ cameraPose });
  }

  setProjection(projection: ViewportProjection): ViewportSnapshot {
    return this.update({ projection });
  }

  setPivot(pivot: ViewportPivot): ViewportSnapshot {
    return this.update({ pivot });
  }

  setWorkingSketchFrame(workingSketchFrame: ViewportWorkingSketchFrame | null): ViewportSnapshot {
    return this.update({ workingSketchFrame });
  }

  setNavigationMode(navigationMode: ViewportNavigationMode): ViewportSnapshot {
    return this.update({ navigationMode });
  }

  /** Save the complete current view in one revision for a later model-view restore. */
  saveModelView(): ViewportSnapshot {
    const savedModelView = immutableModelView(this.current);
    if (sameModelView(this.current.savedModelView, savedModelView)) return this.current;
    return this.publish(immutableSnapshot(this.current, this.nextRevision(), savedModelView));
  }

  /** Restore and consume the saved model view in one atomic revision. */
  restoreModelView(): ViewportSnapshot {
    const saved = this.current.savedModelView;
    if (!saved) return this.current;
    return this.publish(immutableSnapshot(saved, this.nextRevision(), null));
  }

  clearSavedModelView(): ViewportSnapshot {
    if (!this.current.savedModelView) return this.current;
    return this.publish(immutableSnapshot(this.current, this.nextRevision(), null));
  }

  private commit(next: ViewportModelView): ViewportSnapshot {
    if (sameModelView(this.current, next)) return this.current;
    return this.publish(immutableSnapshot(next, this.nextRevision(), this.current.savedModelView));
  }

  private nextRevision(): number {
    if (this.current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Viewport revision exhausted");
    return this.current.revision + 1;
  }

  private publish(next: ViewportSnapshot): ViewportSnapshot {
    this.current = next;
    this.notificationQueue.push(next);
    if (this.publishing) return next;

    this.publishing = true;
    try {
      while (this.notificationQueue.length > 0) {
        const snapshot = this.notificationQueue.shift()!;
        for (const listener of [...this.listeners]) listener(snapshot);
      }
    } catch (error) {
      this.notificationQueue.length = 0;
      throw error;
    } finally {
      this.publishing = false;
    }
    return next;
  }
}

function immutableSnapshot(view: ViewportModelView, revision: number, savedModelView: ViewportModelView | null): ViewportSnapshot {
  return Object.freeze({
    cameraPose: view.cameraPose,
    projection: view.projection,
    pivot: view.pivot,
    workingSketchFrame: view.workingSketchFrame,
    navigationMode: view.navigationMode,
    revision,
    savedModelView,
  });
}

function immutableModelView(view: ViewportModelView): ViewportModelView {
  return Object.freeze({
    cameraPose: immutableCameraPose(view.cameraPose),
    projection: immutableProjection(view.projection),
    pivot: immutablePivot(view.pivot),
    workingSketchFrame: view.workingSketchFrame === null
      ? null
      : immutableWorkingSketchFrame(view.workingSketchFrame),
    navigationMode: immutableNavigationMode(view.navigationMode),
  });
}

function immutableCameraPose(pose: ViewportCameraPose): ViewportCameraPose {
  const orientation = quaternion(pose.orientation, "camera orientation");
  return Object.freeze({
    position: vector3(pose.position, "camera position"),
    orientation,
  });
}

function immutableProjection(projection: ViewportProjection): ViewportProjection {
  const near = positiveFinite(projection.near, "projection near");
  const far = positiveFinite(projection.far, "projection far");
  if (far <= near) throw new RangeError("projection far must be greater than near");
  if (projection.kind === "perspective") {
    const verticalFieldOfViewDegrees = finite(projection.verticalFieldOfViewDegrees, "perspective field of view");
    if (verticalFieldOfViewDegrees <= 0 || verticalFieldOfViewDegrees >= 180) {
      throw new RangeError("perspective field of view must be between 0 and 180 degrees");
    }
    return Object.freeze({ kind: projection.kind, verticalFieldOfViewDegrees, near, far });
  }
  if (projection.kind === "orthographic") {
    return Object.freeze({
      kind: projection.kind,
      viewHeight: positiveFinite(projection.viewHeight, "orthographic view height"),
      near,
      far,
    });
  }
  throw new TypeError("unsupported viewport projection");
}

function immutablePivot(pivot: ViewportPivot): ViewportPivot {
  const point = vector3(pivot.point, "pivot point");
  if (!pivot.anchor) return Object.freeze({ point });
  const kind = nonEmpty(pivot.anchor.kind, "pivot anchor kind");
  const key = nonEmpty(pivot.anchor.key, "pivot anchor key");
  return Object.freeze({ point, anchor: Object.freeze({ kind, key }) });
}

function immutableWorkingSketchFrame(frame: ViewportWorkingSketchFrame): ViewportWorkingSketchFrame {
  const xAxis = direction(frame.xAxis, "sketch x axis");
  const yAxis = direction(frame.yAxis, "sketch y axis");
  const normal = direction(frame.normal, "sketch normal");
  if (Math.abs(dot(xAxis, yAxis)) > 1e-6
      || Math.abs(dot(xAxis, normal)) > 1e-6
      || Math.abs(dot(yAxis, normal)) > 1e-6) {
    throw new RangeError("working sketch frame axes must be orthogonal");
  }
  if (dot(cross(xAxis, yAxis), normal) < 1 - 1e-6) {
    throw new RangeError("working sketch frame must be right-handed");
  }
  return Object.freeze({
    origin: vector3(frame.origin, "sketch origin"),
    xAxis,
    yAxis,
    normal,
  });
}

function immutableNavigationMode(mode: ViewportNavigationMode): ViewportNavigationMode {
  if (mode !== "model" && mode !== "sketch" && mode !== "temporary-orbit") {
    throw new TypeError("unsupported viewport navigation mode");
  }
  return mode;
}

function vector3(value: ViewportVector3, label: string): ViewportVector3 {
  return Object.freeze([
    finite(value[0], label),
    finite(value[1], label),
    finite(value[2], label),
  ] as [number, number, number]);
}

function direction(value: ViewportVector3, label: string): ViewportVector3 {
  const result = vector3(value, label);
  const length = Math.hypot(...result);
  if (length <= Number.EPSILON) throw new RangeError(`${label} must be non-zero`);
  return Object.freeze(result.map((component) => component / length) as [number, number, number]);
}

function quaternion(value: ViewportQuaternion, label: string): ViewportQuaternion {
  const result = Object.freeze([
    finite(value[0], label),
    finite(value[1], label),
    finite(value[2], label),
    finite(value[3], label),
  ] as [number, number, number, number]);
  const length = Math.hypot(...result);
  if (length <= Number.EPSILON) throw new RangeError(`${label} must be non-zero`);
  return Object.freeze(result.map((component) => component / length) as [number, number, number, number]);
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must contain finite numbers`);
  return value;
}

function positiveFinite(value: number, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new RangeError(`${label} must be positive`);
  return result;
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be non-empty`);
  return value;
}

function sameModelView(left: ViewportModelView | null, right: ViewportModelView | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return sameCameraPose(left.cameraPose, right.cameraPose)
    && sameProjection(left.projection, right.projection)
    && samePivot(left.pivot, right.pivot)
    && sameWorkingSketchFrame(left.workingSketchFrame, right.workingSketchFrame)
    && left.navigationMode === right.navigationMode;
}

function sameCameraPose(left: ViewportCameraPose, right: ViewportCameraPose): boolean {
  return sameTuple(left.position, right.position) && sameTuple(left.orientation, right.orientation);
}

function sameProjection(left: ViewportProjection, right: ViewportProjection): boolean {
  if (left.kind !== right.kind || left.near !== right.near || left.far !== right.far) return false;
  return left.kind === "perspective" && right.kind === "perspective"
    ? left.verticalFieldOfViewDegrees === right.verticalFieldOfViewDegrees
    : left.kind === "orthographic" && right.kind === "orthographic" && left.viewHeight === right.viewHeight;
}

function samePivot(left: ViewportPivot, right: ViewportPivot): boolean {
  return sameTuple(left.point, right.point)
    && left.anchor?.kind === right.anchor?.kind
    && left.anchor?.key === right.anchor?.key;
}

function sameWorkingSketchFrame(left: ViewportWorkingSketchFrame | null, right: ViewportWorkingSketchFrame | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return sameTuple(left.origin, right.origin)
    && sameTuple(left.xAxis, right.xAxis)
    && sameTuple(left.yAxis, right.yAxis)
    && sameTuple(left.normal, right.normal);
}

function sameTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function dot(left: ViewportVector3, right: ViewportVector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: ViewportVector3, right: ViewportVector3): ViewportVector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}
