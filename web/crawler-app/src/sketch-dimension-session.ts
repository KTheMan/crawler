/**
 * Pure interaction state for creation-time and Smart Dimension canvas input.
 *
 * The session deliberately does not create sketch commands. Consumers may only
 * turn it into a durable command after `isSketchDimensionSessionReady` returns
 * true, which keeps expression acceptance, annotation placement, and solver
 * validation independent and order-agnostic.
 */

export type SketchDimensionSource = "creation" | "smart_dimension" | "edit";

export type SketchDimensionType =
  | "distance"
  | "distance_x"
  | "distance_y"
  | "point_line_distance"
  | "line_distance"
  | "offset_distance"
  | "radius"
  | "diameter"
  | "ellipse_radius"
  | "angle";

export type SketchDimensionOperand =
  | { kind: "geometry"; id: string }
  | { kind: "point"; geometryId: string; anchor: string }
  | { kind: "origin" }
  | { kind: "axis"; axis: "x" | "y" }
  | { kind: "dimension"; constraintId: string };

export type SketchDimensionIntent = "driving" | "driven";

export type SketchDimensionPlacementOrientation =
  | "horizontal"
  | "vertical"
  | "aligned"
  | "parallel"
  | "angular"
  | "radial";

export type SketchDimensionPlacement = {
  /** Canvas coordinates, rather than sketch/model coordinates. */
  x: number;
  y: number;
  orientation?: SketchDimensionPlacementOrientation;
};

export type SketchDimensionFieldUnit = "length" | "angle" | "count" | "scalar";

export type SketchDimensionField = {
  id: string;
  label: string;
  unit: SketchDimensionFieldUnit;
  displayUnit?: string;
  required: boolean;
  rawExpression: string;
  evaluatedValue: number | null;
  active: boolean;
  locked: boolean;
};

export type SketchDimensionFieldDefinition = Omit<SketchDimensionField, "active" | "locked"> & {
  active?: boolean;
  locked?: boolean;
};

export type SketchDimensionSolverPreview =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid" }
  | { status: "over_constrained"; conflicts: readonly string[] }
  | { status: "error"; message: string };

export type SketchDimensionSession = {
  source: SketchDimensionSource;
  operands: readonly SketchDimensionOperand[];
  candidateTypes: readonly SketchDimensionType[];
  activeType: SketchDimensionType;
  fields: readonly SketchDimensionField[];
  intent: SketchDimensionIntent;
  placement: SketchDimensionPlacement | null;
  /** Set only by an explicit value-accept action. */
  valueAccepted: boolean;
  /** Set only by an explicit placement-accept action. */
  placementAccepted: boolean;
  solverPreview: SketchDimensionSolverPreview;
  status: "active" | "cancelled";
};

export type CreateSketchDimensionSession = {
  source: SketchDimensionSource;
  operands: readonly SketchDimensionOperand[];
  candidateTypes: readonly SketchDimensionType[];
  activeType?: SketchDimensionType;
  fields: readonly SketchDimensionFieldDefinition[];
  intent?: SketchDimensionIntent;
  placement?: SketchDimensionPlacement | null;
};

export type SketchDimensionSessionAction =
  | { type: "activate_field"; fieldId: string }
  | { type: "input"; fieldId?: string; rawExpression: string; evaluatedValue: number | null }
  | { type: "lock_cycle"; direction: "forward" | "backward" }
  | { type: "accept_value" }
  | { type: "update_placement"; placement: SketchDimensionPlacement }
  | { type: "accept_placement"; placement?: SketchDimensionPlacement }
  | { type: "set_intent"; intent: SketchDimensionIntent }
  | { type: "set_type"; dimensionType: SketchDimensionType }
  | { type: "set_solver_preview"; preview: SketchDimensionSolverPreview }
  | { type: "cancel" };

function isFiniteValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function isSketchDimensionFieldValid(field: SketchDimensionField): boolean {
  return field.rawExpression.trim().length > 0 && isFiniteValue(field.evaluatedValue);
}

/** Required fields need values; optional fields may be blank but never invalid. */
export function isSketchDimensionFieldAcceptable(field: SketchDimensionField): boolean {
  const blank = field.rawExpression.trim().length === 0;
  return field.required ? !blank && isFiniteValue(field.evaluatedValue) : blank || isFiniteValue(field.evaluatedValue);
}

function isFinitePlacement(placement: SketchDimensionPlacement | null): placement is SketchDimensionPlacement {
  return placement !== null && Number.isFinite(placement.x) && Number.isFinite(placement.y);
}

export function createSketchDimensionSession(options: CreateSketchDimensionSession): SketchDimensionSession {
  if (options.candidateTypes.length === 0) throw new Error("A dimension session requires at least one candidate type");
  if (new Set(options.candidateTypes).size !== options.candidateTypes.length) throw new Error("Dimension candidate types must be unique");
  if (new Set(options.fields.map((field) => field.id)).size !== options.fields.length) throw new Error("Dimension field ids must be unique");

  const activeType = options.activeType ?? options.candidateTypes[0];
  if (!options.candidateTypes.includes(activeType)) throw new Error(`Active dimension type '${activeType}' is not a candidate`);

  const requestedActive = options.fields.findIndex((field) => field.active);
  const activeIndex = requestedActive >= 0 ? requestedActive : options.fields.length > 0 ? 0 : -1;
  const fields = options.fields.map((field, index): SketchDimensionField => ({
    ...field,
    active: index === activeIndex,
    locked: field.locked ?? false,
  }));

  return {
    source: options.source,
    operands: [...options.operands],
    candidateTypes: [...options.candidateTypes],
    activeType,
    fields,
    intent: options.intent ?? "driving",
    placement: options.placement ?? null,
    valueAccepted: false,
    placementAccepted: false,
    solverPreview: { status: "idle" },
    status: "active",
  };
}

function withInvalidatedValue(
  session: SketchDimensionSession,
  fields: readonly SketchDimensionField[],
): SketchDimensionSession {
  return {
    ...session,
    fields,
    valueAccepted: false,
    solverPreview: { status: "idle" },
  };
}

function activeFieldIndex(session: SketchDimensionSession): number {
  return session.fields.findIndex((field) => field.active);
}

function cycleField(session: SketchDimensionSession, direction: "forward" | "backward"): SketchDimensionSession {
  if (session.fields.length === 0) return session;
  const current = activeFieldIndex(session);
  const from = current >= 0 ? current : 0;
  const step = direction === "forward" ? 1 : -1;
  const next = (from + step + session.fields.length) % session.fields.length;
  const fields = session.fields.map((field, index) => ({
    ...field,
    active: index === next,
    locked: index === from && isSketchDimensionFieldValid(field) ? true : field.locked,
  }));
  return withInvalidatedValue(session, fields);
}

export function reduceSketchDimensionSession(
  session: SketchDimensionSession,
  action: SketchDimensionSessionAction,
): SketchDimensionSession {
  if (session.status === "cancelled") return session;

  switch (action.type) {
    case "activate_field": {
      if (!session.fields.some((field) => field.id === action.fieldId)) return session;
      return {
        ...session,
        fields: session.fields.map((field) => ({ ...field, active: field.id === action.fieldId })),
      };
    }
    case "input": {
      const targetId = action.fieldId ?? session.fields.find((field) => field.active)?.id;
      if (!targetId || !session.fields.some((field) => field.id === targetId)) return session;
      const fields = session.fields.map((field) => field.id === targetId ? {
        ...field,
        rawExpression: action.rawExpression,
        evaluatedValue: isFiniteValue(action.evaluatedValue) ? action.evaluatedValue : null,
        locked: false,
      } : field);
      return withInvalidatedValue(session, fields);
    }
    case "lock_cycle":
      return cycleField(session, action.direction);
    case "accept_value": {
      const fieldsValid = session.fields.every(isSketchDimensionFieldAcceptable);
      if (!fieldsValid) return { ...session, valueAccepted: false, solverPreview: { status: "idle" } };
      return {
        ...session,
        valueAccepted: true,
        fields: session.fields.map((field) => field.required && isSketchDimensionFieldValid(field)
          ? { ...field, locked: true }
          : field),
        solverPreview: { status: "idle" },
      };
    }
    case "update_placement":
      return {
        ...session,
        placement: isFinitePlacement(action.placement) ? action.placement : null,
        placementAccepted: false,
        solverPreview: { status: "idle" },
      };
    case "accept_placement": {
      const placement = action.placement ?? session.placement;
      if (!isFinitePlacement(placement)) {
        return { ...session, placement: null, placementAccepted: false, solverPreview: { status: "idle" } };
      }
      return { ...session, placement, placementAccepted: true, solverPreview: { status: "idle" } };
    }
    case "set_intent":
      return action.intent === session.intent
        ? session
        : { ...session, intent: action.intent, solverPreview: { status: "idle" } };
    case "set_type":
      return !session.candidateTypes.includes(action.dimensionType) || action.dimensionType === session.activeType
        ? session
        : { ...session, activeType: action.dimensionType, valueAccepted: false, solverPreview: { status: "idle" } };
    case "set_solver_preview":
      // Solver responses are meaningful only for the exact accepted value and
      // placement that were previewed. Ignore early/stale responses.
      return canPreviewSketchDimensionSolver(session)
        ? { ...session, solverPreview: action.preview }
        : session;
    case "cancel":
      return {
        ...session,
        status: "cancelled",
        valueAccepted: false,
        placementAccepted: false,
        solverPreview: { status: "idle" },
      };
  }
}

/** True once the session has enough accepted input to run a solver preview. */
export function canPreviewSketchDimensionSolver(session: SketchDimensionSession): boolean {
  return session.status === "active"
    && session.valueAccepted
    && session.placementAccepted
    && isFinitePlacement(session.placement)
    && session.fields.every(isSketchDimensionFieldAcceptable);
}

/**
 * The sole durable-commit gate. A solver result is deliberately required in
 * addition to both acceptance latches so an over-constraining edit cannot leak
 * into accepted sketch history.
 */
export function isSketchDimensionSessionReady(session: SketchDimensionSession): boolean {
  return canPreviewSketchDimensionSolver(session) && session.solverPreview.status === "valid";
}
