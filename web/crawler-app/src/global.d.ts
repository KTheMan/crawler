import type { Selection, TopologyKind } from "./protocol";
import type { AppState } from "./state";

declare global {
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
      faultWorker(message?: string): void;
      simulateQuotaFailure(): void;
    };
  }
}

export {};
