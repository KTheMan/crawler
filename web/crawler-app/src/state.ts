import type { Selection, TopologyKind } from "./protocol";

export type Readiness = "idle" | "loading" | "ready" | "error";
export type OperationStatus = "idle" | "preview" | "committed" | "cancelled";

export interface AppState {
  readiness: Record<"ui" | "wasm" | "worker" | "renderer", Readiness>;
  diagnostics: Partial<Record<"wasm" | "worker" | "renderer", string>>;
  selectedFeatureId: string;
  selection: Selection | null;
  selections: Selection[];
  preselection: Selection | null;
  selectionFilters: Record<TopologyKind, boolean>;
  panels: Record<"browser" | "inspector" | "timeline", boolean>;
  operation: { status: OperationStatus; type: "rectangle" | "sketch" | "pad" | "step-import" | "advanced" | "parameter" | null };
}

export function initialState(): AppState {
  return {
    readiness: { ui: "ready", wasm: "idle", worker: "idle", renderer: "idle" },
    diagnostics: {},
    selectedFeatureId: "feature:extrude",
    selection: null,
    selections: [],
    preselection: null,
    selectionFilters: { body: true, face: true, edge: true, vertex: true },
    panels: { browser: true, inspector: true, timeline: true },
    operation: { status: "idle", type: null },
  };
}
