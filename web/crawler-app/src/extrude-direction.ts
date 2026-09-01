export type ExtrudeDirection = "positive" | "negative" | "symmetric";

export interface NormalizedExtrudeDistance {
  /** Exact value shown in the operation field, expressed in nanometers. */
  visibleNanometers: number;
  /** Exact durable one-sided distance sent to the modeling runtime. */
  durableNanometers: number;
  normalized: boolean;
}

/**
 * Symmetric Extrude stores the half length but exposes the total length. An
 * odd-nanometer total cannot be split exactly, so it is rounded up to the next
 * even nanometer and the caller writes that canonical value back to the UI.
 */
export function normalizeExtrudeDistance(
  visibleNanometers: number,
  direction: ExtrudeDirection,
): NormalizedExtrudeDistance | undefined {
  if (!Number.isSafeInteger(visibleNanometers) || visibleNanometers <= 0) return undefined;
  const canonicalVisible = direction === "symmetric" && visibleNanometers % 2 !== 0
    ? visibleNanometers + 1
    : visibleNanometers;
  const durableNanometers = direction === "symmetric" ? canonicalVisible / 2 : canonicalVisible;
  if (!Number.isSafeInteger(durableNanometers) || durableNanometers < 1_000) return undefined;
  return {
    visibleNanometers: canonicalVisible,
    durableNanometers,
    normalized: canonicalVisible !== visibleNanometers,
  };
}

export function visibleExtrudeDistance(durableNanometers: number, direction: ExtrudeDirection): number {
  return direction === "symmetric" ? durableNanometers * 2 : durableNanometers;
}
