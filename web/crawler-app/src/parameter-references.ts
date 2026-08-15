export interface ParameterReferenceDocument {
  revision: number;
  sketches?: Record<string, {
    id?: string;
    display_name?: string;
    constraints?: Array<{ id?: string; parameter?: string; implicit_name?: string }>;
  }>;
  parameters?: Record<string, { display_name?: string }>;
}

/** Opaque, deterministic reference identity derived from the immutable durable sketch ID. */
export function sketchReferenceId(sketchId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sketchId.length; index += 1) {
    hash ^= sketchId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `s${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function resolveSketchReferences(source: string, document: ParameterReferenceDocument): string {
  return source.replace(/\{\{sketch\.(?:(?:alias\."((?:[^"\\]|\\.)*)")|([A-Za-z0-9_-]+))\.([A-Za-z0-9_-]+)\}\}/g, (reference, encodedAlias: string | undefined, stableSketchId: string | undefined, dimensionId: string) => {
    const alias = encodedAlias === undefined ? undefined : JSON.parse(`"${encodedAlias}"`) as string;
    const sketchEntry = Object.entries(document.sketches ?? {}).find(([key, sketch]) => {
      if (alias !== undefined) return sketch.display_name === alias;
      return sketchReferenceId(sketch.id ?? key) === stableSketchId;
    });
    const dimensionalConstraints = sketchEntry?.[1].constraints?.filter((candidate) => candidate.parameter) ?? [];
    const numberedIndex = /^d(\d+)$/i.exec(dimensionId);
    const constraint = dimensionalConstraints.find((candidate) => candidate.implicit_name === dimensionId)
      ?? (numberedIndex ? dimensionalConstraints[Number(numberedIndex[1]) - 1] : undefined);
    const parameterName = constraint?.parameter ? document.parameters?.[constraint.parameter]?.display_name : undefined;
    return parameterName ?? reference;
  });
}
