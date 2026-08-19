import type { Selection, TopologyKind } from "./protocol";
import type { AppState } from "./state";

declare global {
  const __CRAWLER_BUNDLE_DEV_THEMES__: boolean;
  interface Window {
    __crawlerApp: {
      state(): AppState;
      readiness(): AppState["readiness"];
      durableChecksum(): string;
      originalDurableChecksum: string;
      transferredBytes(): number;
      dimensions(): { widthNanometers: number; heightNanometers: number; distanceNanometers: number };
      geometryBounds(): number[];
      recompute(): { dirtyRoots: string[]; evaluationOrder: string[] };
      selectFirst(kind: TopologyKind, additive?: boolean): Selection | null;
      cameraPosition(): number[];
      projectionMode(): "perspective" | "orthographic";
      viewportSnapshot(): import("./viewport-state").ViewportSnapshot | undefined;
      viewportProbeAt(clientX: number, clientY: number): { world?: readonly [number, number, number]; local?: import("./sketch-editor").Point2 };
      committedSketchCount(): number;
      committedSketchState(): { id: string; visible: boolean; polylineCount: number; pointCount: number }[];
      sketchPlane(): import("./sketch-plane").ResolvedSketchPlane | undefined;
      sketchSupportSelection(): { active: boolean; surfacesVisible: boolean };
      chooseOriginSketchSupport(plane: "xy" | "xz" | "yz"): void;
      sketchSolverContract(): Promise<import("./sketch-editor").SketchSolverContract> | undefined;
      sketchDecomposition(): Promise<import("./sketch-editor").SketchDecomposition> | undefined;
      sketchDraft(): import("./sketch-editor").Sketch | undefined;
      sketchSolve(): import("./sketch-editor").SolveResult | undefined;
      sketchAutoConstraintAudit(): Array<{
        tool: import("./sketch-editor").SketchTool;
        rawInferenceKinds: string[];
        emittedConstraints: Array<{ id: string; kind: import("./sketch-editor").Constraint["kind"] }>;
        solveState: import("./sketch-editor").SolveState | "idle";
        redundantConstraints: string[];
        conflicts: import("./sketch-editor").SolveResult["conflicts"];
      }>;
      applySketchCommands(commands: readonly import("./sketch-editor").SketchCommand[]): Promise<{
        totalMs: number;
        solverMs: number;
        workerRuntimeMs: number;
        bridgeOverheadMs: number;
        requestParseMs: number;
        applyBatchMs: number;
        ezpzSolveMs: number;
        profileBuildMs: number;
        documentHashMs: number;
        wasmBoundaryAndSerializeMs: number;
        responseParseMs: number;
        diagnosticsMs: number;
        overlayMs: number;
        inspectorMs: number;
        stablePaintMs: number;
        geometryCount: number;
        constraintCount: number;
        profileCount: number;
        solveComponentCount: number;
        solveState: import("./sketch-editor").SolveState | "idle";
      }>;
      sketchDxfRoundTrip(sketchId: string, dxf: string): Promise<{ sketch: import("./sketch-editor").Sketch; decomposition: import("./sketch-editor").SketchDecomposition; normalized: string }>;
      hasExplicitSave(): Promise<boolean>;
      pwaStatus(): { supported: boolean; controlled: boolean; updateAvailable: boolean; cacheVersion: string };
      onboarding(): { step: number; complete: boolean };
      safeMode(): boolean;
      recoveryProvenance(): string;
      recoveryChoices(): readonly import("./storage").RecoveryChoice[];
      parameters(): readonly import("./protocol").NamedParameterView[];
      historyServices(): { services?: import("./protocol").FeatureServicesView; repair?: import("./protocol").RepairInspectionView; message: string };
      inspectRepair(observedTopology: readonly import("./protocol").TopologyReferenceView[]): void;
      commitDocumentChanges(changes: readonly Record<string, unknown>[]): void;
      performanceEvidence(): import("./performance-evidence").PerformanceEvidenceSnapshot;
      sketchRenderIndexCounters(): import("./sketch-render-indexes").SketchRenderIndexCounters;
      sketchPointerRenderCounters(): import("./sketch-pointer-render").SketchPointerRenderCounters & {
        pointerFrames: import("./sketch-pointer-render").LatestFrameCoordinatorCounters;
        dynamicClasses: { patchPasses: number; geometryIdsPatched: number; fullScans: number };
      };
      offsetPerformanceCounters(): readonly {
        stage: "preview" | "commit";
        outcome: "ready" | "rejected" | "accepted" | "refused";
        planMs: number;
        commandConstructionMs?: number;
        bridgeMs?: number;
        diagnosticsMs?: number;
        overlayMs?: number;
        stablePaintMs?: number;
        stableLayerDelta?: number;
        offsetChain?: import("./sketch-operations").OffsetChainInstrumentation;
        reason?: string;
      }[];
      sketchBridgePerformance(): readonly import("./sketch-worker-bridge").SketchBridgePerformanceRecord[];
      themeStatus(): import("./theme-manager").ThemeManagerStatus;
      faultWorker(message?: string): void;
      simulateQuotaFailure(): void;
    };
  }
}

export {};
