import type { Selection, TopologyKind } from "./protocol";
import type { AppState } from "./state";

declare global {
  const __CRAWLER_BUNDLE_DEV_THEMES__: boolean;
  interface Window {
    __crawlerApp: {
      state(): AppState;
      readiness(): AppState["readiness"];
      durableChecksum(): string;
      durableDocument(): unknown;
      hydrateDocument(document: unknown): void;
      originalDurableChecksum: string;
      transferredBytes(): number;
      dimensions(): { widthNanometers: number; heightNanometers: number; distanceNanometers: number };
      geometryBounds(): number[];
      recompute(): { dirtyRoots: string[]; evaluationOrder: string[] };
      recomputeOutcome(): Extract<import("./protocol").WorkerResponse, { type: "recompute-from-here" }> | undefined;
      selectFirst(kind: TopologyKind, additive?: boolean): Selection | null;
      selectTopology(kind: TopologyKind, stableId: string): Selection | null;
      cameraPosition(): number[];
      projectionMode(): "perspective" | "orthographic";
      viewportSnapshot(): import("./viewport-state").ViewportSnapshot | undefined;
      rendererPacketResources(): import("./renderer").WorkspacePacketResourceState | undefined;
      rendererTopologyFingerprint(): string;
      cutRemovalPreviewState(): import("./renderer").CutRemovalPreviewState | undefined;
      constructionPlaneRendererState(): readonly { id: string; visible: boolean; preview: boolean }[];
      constructionPlanes(): readonly import("./document-adapter").DurableConstructionPlane[];
      constructionPlaneEditState(): { mode: "create" | "edit"; planeId: string; componentId: string; offsetParameterId: string; basePlane: "xy" | "xz" | "yz"; offsetMillimeters: string; suppressed: boolean; transactionId: string; baseRevision: number; requestId: number; previewReady: boolean; previewFrame?: import("./protocol").OffsetConstructionPlaneFrame | null; error?: string } | undefined;
      viewportProbeAt(clientX: number, clientY: number): { world?: readonly [number, number, number]; local?: import("./sketch-editor").Point2 };
      committedSketchCount(): number;
      committedSketchState(): { id: string; visible: boolean; polylineCount: number; pointCount: number }[];
      sketchPlane(): import("./sketch-plane").ResolvedSketchPlane | undefined;
      sketchSupportSelection(): { active: boolean; surfacesVisible: boolean };
      selectedSketchSupport(): import("./sketch-editor").SketchSupport | undefined;
      extrudeSelectionContext(): { selectedFeatureId: string; selectedSketchId?: string; selectedProfile?: { sketchId: string; profileId: string; geometryIds: string[] } };
      chooseOriginSketchSupport(plane: "xy" | "xz" | "yz"): void;
      chooseConstructionSketchSupport(plane: string): void;
      choosePlanarFaceSketchSupport(selection?: Selection): void;
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
      observedTopology(): readonly import("./protocol").TopologyReferenceView[];
      topologyRebindPreview(): { requestId: string; selected: string; phase: "loading" | "ready"; baseDocumentHash?: string; baseRevision?: number; candidateFrame?: import("./protocol").OffsetConstructionPlaneFrame } | undefined;
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
