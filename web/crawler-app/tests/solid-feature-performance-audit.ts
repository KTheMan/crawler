export type SolidFeaturePerformancePhase = "preview" | "recompute" | "cancel";
export type SolidFeaturePerformanceWorkload =
  | "extrude-origin-blind-rectangle"
  | "extrude-origin-annulus"
  | "extrude-offset-plane-rectangle"
  | "extrude-planar-face-rectangle"
  | "planar-face-support-repair"
  | "cut-single-target-rectangle"
  | "cut-single-target-annulus"
  | "cut-single-target-failure-recovery";

export interface SolidFeatureActionInterval {
  id: number;
  phase: SolidFeaturePerformancePhase;
  startTime: number;
  endTime: number;
  workload_id?: SolidFeaturePerformanceWorkload;
}

export interface SolidFeatureLongTaskEntry {
  startTime: number;
  duration: number;
}

export interface AttributedSolidFeatureLongTask extends SolidFeatureLongTaskEntry {
  phase: SolidFeaturePerformancePhase | "unattributed";
  action_interval_id?: number;
  workload_id?: SolidFeaturePerformanceWorkload;
}

/**
 * PerformanceObserver callbacks may run after the action that caused an entry,
 * so callback-time state is not a reliable attribution source. Attribute an
 * entry only when its own startTime falls inside a recorded action interval.
 */
export function attributeSolidFeatureLongTasks(
  entries: readonly SolidFeatureLongTaskEntry[],
  intervals: readonly SolidFeatureActionInterval[],
): AttributedSolidFeatureLongTask[] {
  return entries.map((entry) => {
    const interval = intervals.find((candidate) => (
      entry.startTime >= candidate.startTime && entry.startTime <= candidate.endTime
    ));
    return interval
      ? { ...entry, phase: interval.phase, action_interval_id: interval.id, ...(interval.workload_id ? { workload_id: interval.workload_id } : {}) }
      : { ...entry, phase: "unattributed" };
  });
}
