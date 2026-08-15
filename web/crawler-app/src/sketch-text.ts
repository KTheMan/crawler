import type { Geometry, Point2, Sketch, SketchCommand, SketchRecipe, StableId, StableSketchIds } from "./sketch-editor";
import { evaluateCurveFrame } from "./sketch-spline.ts";

export type SketchTextOptions = {
  text: string;
  origin: Point2;
  heightNm?: number;
  rotationMicrodegrees?: number;
  trackingMillionths?: number;
  horizontalAlignment?: "left" | "center" | "right";
  path?: StableId;
  pathStartMillionths?: number;
  reversed?: boolean;
};

export function sketchTextCommands(ids: StableSketchIds, sketch: Sketch, options: SketchTextOptions): SketchCommand[] {
  const recipe = textRecipeGeometry(sketch, options);
  const geometry = recipe.geometry.map(() => ids.next("geometry"));
  const commands: SketchCommand[] = recipe.geometry.map((value, index) => ({ kind: "add_geometry", entity: { id: geometry[index], geometry: value } }));
  commands.push({ kind: "add_recipe", id: ids.next("recipe"), recipe: { ...recipe.recipe, geometry } });
  return commands;
}

export function updatedSketchTextRecipe(sketch: Sketch, recipe: Extract<SketchRecipe, { kind: "text" }>, updates: Partial<Omit<SketchTextOptions, "origin">> & { origin?: Point2 }, ids: StableSketchIds): { recipe: Extract<SketchRecipe, { kind: "text" }>; geometry: Geometry[] } {
  const options: SketchTextOptions = {
    text: updates.text ?? recipe.text, origin: updates.origin ?? recipe.origin, heightNm: updates.heightNm ?? recipe.height_nm,
    rotationMicrodegrees: updates.rotationMicrodegrees ?? recipe.rotation_microdegrees, trackingMillionths: updates.trackingMillionths ?? recipe.tracking_millionths,
    horizontalAlignment: updates.horizontalAlignment ?? recipe.horizontal_alignment, path: updates.path === undefined ? recipe.path : updates.path,
    pathStartMillionths: updates.pathStartMillionths ?? recipe.path_start_millionths, reversed: updates.reversed ?? recipe.reversed,
  };
  const generated = textRecipeGeometry(sketch, options); const geometry = recipe.geometry.slice(0, generated.geometry.length);
  while (geometry.length < generated.geometry.length) geometry.push(ids.next("geometry"));
  return { geometry: generated.geometry, recipe: { ...generated.recipe, geometry } };
}

export function explodeSketchTextCommand(recipeId: StableId): SketchCommand { return { kind: "remove_recipe", id: recipeId }; }

function textRecipeGeometry(sketch: Sketch, options: SketchTextOptions): { recipe: Omit<Extract<SketchRecipe, { kind: "text" }>, "geometry">; geometry: Geometry[] } {
  const text = options.text.trimEnd(); if (!text) throw new Error("Sketch text cannot be empty");
  const height = Math.max(1, Math.round(options.heightNm ?? 5_000_000)); const tracking = Math.max(1, Math.round(options.trackingMillionths ?? 1_000_000));
  const alignment = options.horizontalAlignment ?? "left"; const rotation = Math.round(options.rotationMicrodegrees ?? 0); const reversed = options.reversed ?? false;
  const advance = height * 0.8 * tracking / 1_000_000; const width = advance * Math.max(0, [...text].length - 1) + height * 0.8;
  const alignmentOffset = alignment === "center" ? -width / 2 : alignment === "right" ? -width : 0;
  const pathGeometry = options.path ? sketch.geometry[options.path]?.geometry : undefined;
  if (options.path && !pathGeometry) throw new Error("Text path no longer exists");
  const pathLength = pathGeometry ? curveLength(pathGeometry) : 1; const pathStart = Math.max(0, Math.min(1_000_000, Math.round(options.pathStartMillionths ?? 0)));
  const radians = rotation / 1_000_000 * Math.PI / 180;
  const transform = (x: number, y: number): Point2 => {
    if (pathGeometry) {
      const travel = alignmentOffset + x; const parameter = clamp(pathStart / 1_000_000 + (reversed ? -travel : travel) / pathLength, 0, 1);
      const frame = evaluateCurveFrame(pathGeometry, parameter); const normal = reversed ? { x: frame.tangent.y, y: -frame.tangent.x } : { x: -frame.tangent.y, y: frame.tangent.x };
      const baselineClearance = height * 0.12;
      return point(frame.point.x_nm + normal.x * (y + baselineClearance), frame.point.y_nm + normal.y * (y + baselineClearance));
    }
    x += alignmentOffset; return point(options.origin.x_nm + x * Math.cos(radians) - y * Math.sin(radians), options.origin.y_nm + x * Math.sin(radians) + y * Math.cos(radians));
  };
  const geometry: Geometry[] = [];
  [...text].forEach((character, index) => glyphSegments(character).forEach(([x1, y1, x2, y2]) => geometry.push({ kind: "line", start: transform(index * advance + x1 * height, y1 * height), end: transform(index * advance + x2 * height, y2 * height) })));
  return { geometry, recipe: { kind: "text", text, origin: { ...options.origin }, height_nm: height, rotation_microdegrees: rotation, tracking_millionths: tracking, horizontal_alignment: alignment, ...(options.path ? { path: options.path } : {}), path_start_millionths: pathStart, reversed } };
}

const SEGMENTS: readonly [number, number, number, number][] = [[0,1,.8,1],[0,.5,.8,.5],[0,0,.8,0],[0,1,0,.5],[0,.5,0,0],[.8,1,.8,.5],[.8,.5,.8,0],[0,1,.4,.5],[.8,1,.4,.5],[.4,.5,0,0],[.4,.5,.8,0],[.4,1,.4,.5],[.4,.5,.4,0],[0,.25,.8,.25]];
const GLYPHS: Record<string, readonly number[]> = {
  A:[0,1,3,4,5,6],B:[0,1,2,3,4,5,6],C:[0,2,3,4],D:[0,2,3,4,5,6],E:[0,1,2,3,4],F:[0,1,3,4],G:[0,1,2,3,4,6],H:[1,3,4,5,6],I:[0,2,11,12],J:[2,4,5,6],K:[3,4,8,10],L:[2,3,4],M:[3,4,5,6,7,8],N:[3,4,5,6,7,10],O:[0,2,3,4,5,6],P:[0,1,3,4,5],Q:[0,2,3,4,5,6,10],R:[0,1,3,4,5,10],S:[0,1,2,3,6],T:[0,11,12],U:[2,3,4,5,6],V:[3,5,9,10],W:[3,4,5,6,9,10],X:[7,8,9,10],Y:[7,8,12],Z:[0,2,8,9],
  "0":[0,2,3,4,5,6],"1":[5,6],"2":[0,1,2,4,5],"3":[0,1,2,5,6],"4":[1,3,5,6],"5":[0,1,2,3,6],"6":[0,1,2,3,4,6],"7":[0,5,6],"8":[0,1,2,3,4,5,6],"9":[0,1,2,3,5,6],"-":[1],"_":[2],"+":[1,11,12],"=":[1,13],"/":[8,9],"\\":[7,10]," ":[],
};
function glyphSegments(character: string): readonly [number, number, number, number][] { return (GLYPHS[character.toUpperCase()] ?? [0,2,3,4,5,6,7,10]).map((index) => SEGMENTS[index]); }
function curveLength(geometry: Geometry): number { let previous = evaluateCurveFrame(geometry, 0).point; let length = 0; for (let i=1;i<=96;i+=1) { const next=evaluateCurveFrame(geometry,i/96).point; length += Math.hypot(next.x_nm-previous.x_nm,next.y_nm-previous.y_nm); previous=next; } return Math.max(1,length); }
function point(x_nm: number, y_nm: number): Point2 { return { x_nm: Math.round(x_nm), y_nm: Math.round(y_nm) }; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
