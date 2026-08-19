/**
 * Compatibility boundary between FreeCAD command names and Crawler's public
 * tool vocabulary. Imported artwork stays in the user's theme store; this
 * table contains identifiers only.
 */
export interface FreeCadCrawlerIconMapping {
  crawlerToolId: string;
  crawlerLabel: string;
  freeCadCommandIds: readonly string[];
}

export const FREECAD_CRAWLER_ICON_MAP: readonly FreeCadCrawlerIconMapping[] = [
  { crawlerToolId: "select", crawlerLabel: "Select", freeCadCommandIds: ["Std_Select", "mouse_pointer"] },
  { crawlerToolId: "sketch-select", crawlerLabel: "Select", freeCadCommandIds: ["Std_Select", "mouse_pointer"] },
  { crawlerToolId: "box-select", crawlerLabel: "Box Select", freeCadCommandIds: ["Std_BoxSelection", "edit-select-box", "sel-bbox"] },
  { crawlerToolId: "new-sketch", crawlerLabel: "New Sketch", freeCadCommandIds: ["Sketcher_NewSketch", "Sketcher_new_sketch", "Sketcher_Sketch"] },
  { crawlerToolId: "rectangle", crawlerLabel: "Rectangle", freeCadCommandIds: ["Sketcher_CreateRectangle"] },
  { crawlerToolId: "rect", crawlerLabel: "Rectangle", freeCadCommandIds: ["Sketcher_CreateRectangle"] },
  { crawlerToolId: "line", crawlerLabel: "Line", freeCadCommandIds: ["Sketcher_CreatePolyline", "Sketcher_CreateLine"] },
  { crawlerToolId: "arc", crawlerLabel: "Arc", freeCadCommandIds: ["Sketcher_CreateArc", "Sketcher_Create3PointArc"] },
  { crawlerToolId: "circle", crawlerLabel: "Circle", freeCadCommandIds: ["Sketcher_CreateCircle", "Sketcher_Create3PointCircle"] },
  { crawlerToolId: "point", crawlerLabel: "Point", freeCadCommandIds: ["Sketcher_CreatePoint", "Std_Point"] },
  { crawlerToolId: "text", crawlerLabel: "Text", freeCadCommandIds: ["Sketcher_CreateText", "Draft_ShapeString"] },
  { crawlerToolId: "spline", crawlerLabel: "Spline", freeCadCommandIds: ["Sketcher_CreateBSpline"] },
  { crawlerToolId: "fit-spline", crawlerLabel: "Fit Spline", freeCadCommandIds: ["Sketcher_CreateBSpline"] },
  { crawlerToolId: "conic", crawlerLabel: "Conic", freeCadCommandIds: ["Sketcher_CreateConic"] },
  { crawlerToolId: "polygon", crawlerLabel: "Polygon", freeCadCommandIds: ["Sketcher_CreateRegularPolygon"] },
  { crawlerToolId: "slot", crawlerLabel: "Slot", freeCadCommandIds: ["Sketcher_CreateSlot"] },
  { crawlerToolId: "ellipse", crawlerLabel: "Ellipse", freeCadCommandIds: ["Sketcher_CreateEllipse"] },
  { crawlerToolId: "elliptical-arc", crawlerLabel: "Elliptical Arc", freeCadCommandIds: ["Sketcher_CreateElliptical_Arc", "Sketcher_CreateArcOfEllipse"] },
  { crawlerToolId: "trim", crawlerLabel: "Trim", freeCadCommandIds: ["Sketcher_Trimming"] },
  { crawlerToolId: "project", crawlerLabel: "Project", freeCadCommandIds: ["Sketcher_External"] },
  { crawlerToolId: "construction", crawlerLabel: "Normal / Construction", freeCadCommandIds: ["Sketcher_ToggleConstruction"] },
  { crawlerToolId: "offset", crawlerLabel: "Offset", freeCadCommandIds: ["Sketcher_CreateOffset"] },
  { crawlerToolId: "extend", crawlerLabel: "Extend", freeCadCommandIds: ["Sketcher_Extend"] },
  { crawlerToolId: "sketch-fillet", crawlerLabel: "Sketch Fillet", freeCadCommandIds: ["Sketcher_CreateFillet"] },
  { crawlerToolId: "sketch-chamfer", crawlerLabel: "Sketch Chamfer", freeCadCommandIds: ["Sketcher_CreateChamfer"] },
  { crawlerToolId: "sketch-mirror", crawlerLabel: "Sketch Mirror", freeCadCommandIds: ["Sketcher_MirrorSketch"] },
  { crawlerToolId: "sketch-rectangular-pattern", crawlerLabel: "Rectangular Pattern", freeCadCommandIds: ["Sketcher_RectangularArray"] },
  { crawlerToolId: "sketch-circular-pattern", crawlerLabel: "Circular Pattern", freeCadCommandIds: ["Sketcher_CreateArray", "Sketcher_CircularArray"] },
  { crawlerToolId: "sketch-break", crawlerLabel: "Break", freeCadCommandIds: ["Sketcher_Split"] },
  { crawlerToolId: "sketch-scale", crawlerLabel: "Scale", freeCadCommandIds: ["Sketcher_Scale"] },
  { crawlerToolId: "sketch-move-copy", crawlerLabel: "Move / Copy", freeCadCommandIds: ["Sketcher_Move", "Sketcher_Copy"] },
  { crawlerToolId: "sketch-blend", crawlerLabel: "Blend", freeCadCommandIds: ["Sketcher_CreateFillet"] },

  { crawlerToolId: "extrude", crawlerLabel: "Extrude", freeCadCommandIds: ["PartDesign_Pad", "Part_Extrude"] },
  { crawlerToolId: "extrude-cut", crawlerLabel: "Extrude Cut", freeCadCommandIds: ["PartDesign_Pocket"] },
  { crawlerToolId: "revolve", crawlerLabel: "Revolve", freeCadCommandIds: ["PartDesign_Revolution", "Part_Revolve"] },
  { crawlerToolId: "revolve-cut", crawlerLabel: "Revolve Cut", freeCadCommandIds: ["PartDesign_Groove"] },
  { crawlerToolId: "loft", crawlerLabel: "Loft", freeCadCommandIds: ["PartDesign_AdditiveLoft", "Part_Loft"] },
  { crawlerToolId: "sweep", crawlerLabel: "Sweep", freeCadCommandIds: ["PartDesign_AdditivePipe", "Part_Sweep"] },
  { crawlerToolId: "fillet", crawlerLabel: "Fillet", freeCadCommandIds: ["PartDesign_Fillet", "Part_Fillet"] },
  { crawlerToolId: "chamfer", crawlerLabel: "Chamfer", freeCadCommandIds: ["PartDesign_Chamfer", "Part_Chamfer"] },
  { crawlerToolId: "draft", crawlerLabel: "Draft", freeCadCommandIds: ["PartDesign_Draft"] },
  { crawlerToolId: "shell", crawlerLabel: "Shell", freeCadCommandIds: ["PartDesign_Thickness"] },
  { crawlerToolId: "linear-pattern", crawlerLabel: "Linear Pattern", freeCadCommandIds: ["PartDesign_LinearPattern"] },
  { crawlerToolId: "circular-pattern", crawlerLabel: "Circular Pattern", freeCadCommandIds: ["PartDesign_PolarPattern"] },
  { crawlerToolId: "mirror", crawlerLabel: "Mirror", freeCadCommandIds: ["PartDesign_Mirrored"] },
  { crawlerToolId: "combine", crawlerLabel: "Combine", freeCadCommandIds: ["PartDesign_Boolean", "Part_Fuse"] },
  { crawlerToolId: "subtract", crawlerLabel: "Subtract", freeCadCommandIds: ["Part_Cut"] },
  { crawlerToolId: "intersect", crawlerLabel: "Intersect", freeCadCommandIds: ["Part_Common"] },
  { crawlerToolId: "measure", crawlerLabel: "Measure", freeCadCommandIds: ["Part_Measure_Linear"] },
  { crawlerToolId: "measure-angle", crawlerLabel: "Measure Angle", freeCadCommandIds: ["Part_Measure_Angular"] },

  { crawlerToolId: "coincident", crawlerLabel: "Coincident", freeCadCommandIds: ["Constraint_PointOnPoint"] },
  { crawlerToolId: "horizontal", crawlerLabel: "Horizontal", freeCadCommandIds: ["Constraint_Horizontal"] },
  { crawlerToolId: "vertical", crawlerLabel: "Vertical", freeCadCommandIds: ["Constraint_Vertical"] },
  { crawlerToolId: "parallel", crawlerLabel: "Parallel", freeCadCommandIds: ["Constraint_Parallel"] },
  { crawlerToolId: "perpendicular", crawlerLabel: "Perpendicular", freeCadCommandIds: ["Constraint_Perpendicular"] },
  { crawlerToolId: "tangent", crawlerLabel: "Tangent", freeCadCommandIds: ["Constraint_Tangent"] },
  { crawlerToolId: "equal", crawlerLabel: "Equal", freeCadCommandIds: ["Constraint_EqualLength"] },
  { crawlerToolId: "fixed", crawlerLabel: "Fix / Unfix", freeCadCommandIds: ["Constraint_Lock", "Constraint_Block"] },
  { crawlerToolId: "midpoint", crawlerLabel: "Midpoint", freeCadCommandIds: ["Constraint_InternalAlignment"] },
  { crawlerToolId: "concentric", crawlerLabel: "Concentric", freeCadCommandIds: ["Constraint_Concentric"] },
  { crawlerToolId: "point-on-object", crawlerLabel: "Point On Object", freeCadCommandIds: ["Constraint_PointOnObject"] },
  { crawlerToolId: "smart-sketch-dimension", crawlerLabel: "Smart Dimension", freeCadCommandIds: ["Sketcher_ConstrainDistance"] },
  { crawlerToolId: "distance", crawlerLabel: "Linear Dimension", freeCadCommandIds: ["Constraint_Length", "Constraint_HorizontalDistance", "Constraint_VerticalDistance"] },
  { crawlerToolId: "radius", crawlerLabel: "Radius Dimension", freeCadCommandIds: ["Constraint_Radius", "Constraint_Radiam"] },
  { crawlerToolId: "sketch-angle", crawlerLabel: "Angular Dimension", freeCadCommandIds: ["Constraint_InternalAngle"] },

  { crawlerToolId: "insert-part", crawlerLabel: "Insert Component", freeCadCommandIds: ["Assembly_InsertLink", "Assembly_AssemblyLink"] },
  { crawlerToolId: "new-body", crawlerLabel: "New Body", freeCadCommandIds: ["PartDesign_Body"] },
  { crawlerToolId: "new-component", crawlerLabel: "New Component", freeCadCommandIds: ["Assembly_CreateAssembly"] },
  { crawlerToolId: "rigid", crawlerLabel: "Rigid Joint", freeCadCommandIds: ["Assembly_CreateJointFixed"] },
  { crawlerToolId: "revolute-joint", crawlerLabel: "Revolute Joint", freeCadCommandIds: ["Assembly_CreateJointRevolute"] },
  { crawlerToolId: "slider", crawlerLabel: "Slider Joint", freeCadCommandIds: ["Assembly_CreateJointSlider"] },
  { crawlerToolId: "cylindrical", crawlerLabel: "Cylindrical Joint", freeCadCommandIds: ["Assembly_CreateJointCylindrical"] },
  { crawlerToolId: "ball", crawlerLabel: "Ball Joint", freeCadCommandIds: ["Assembly_CreateJointBall"] },
  { crawlerToolId: "ground", crawlerLabel: "Ground", freeCadCommandIds: ["Assembly_ToggleGrounded"] },
  { crawlerToolId: "assembly-mirror", crawlerLabel: "Mirror Components", freeCadCommandIds: ["PartDesign_Mirrored"] },
  { crawlerToolId: "assembly-linear", crawlerLabel: "Linear Component Pattern", freeCadCommandIds: ["PartDesign_LinearPattern"] },
  { crawlerToolId: "explode", crawlerLabel: "Exploded View", freeCadCommandIds: ["Assembly_ExplodedView"] },
  { crawlerToolId: "assembly-distance", crawlerLabel: "Measure", freeCadCommandIds: ["Assembly_CreateJointDistance", "Part_Measure_Linear"] },
  { crawlerToolId: "interference", crawlerLabel: "Interference", freeCadCommandIds: ["Assembly_InterferenceCheck"] },

  { crawlerToolId: "standard-view", crawlerLabel: "Base View", freeCadCommandIds: ["TechDraw_View"] },
  { crawlerToolId: "section-view", crawlerLabel: "Section View", freeCadCommandIds: ["TechDraw_SectionView"] },
  { crawlerToolId: "detail-view", crawlerLabel: "Detail View", freeCadCommandIds: ["TechDraw_DetailView"] },
  { crawlerToolId: "aux-view", crawlerLabel: "Auxiliary View", freeCadCommandIds: ["TechDraw_AuxiliaryView"] },
  { crawlerToolId: "smart-dimension", crawlerLabel: "Smart Dimension", freeCadCommandIds: ["TechDraw_Dimension"] },
  { crawlerToolId: "linear-dimension", crawlerLabel: "Linear Dimension", freeCadCommandIds: ["TechDraw_LengthDimension"] },
  { crawlerToolId: "angular-dimension", crawlerLabel: "Angular Dimension", freeCadCommandIds: ["TechDraw_AngleDimension"] },
  { crawlerToolId: "radius-dimension", crawlerLabel: "Radius Dimension", freeCadCommandIds: ["TechDraw_RadiusDimension"] },
  { crawlerToolId: "note", crawlerLabel: "Note", freeCadCommandIds: ["TechDraw_RichTextAnnotation"] },
  { crawlerToolId: "centerline", crawlerLabel: "Centerline", freeCadCommandIds: ["TechDraw_2LineCenterline", "TechDraw_2PointCenterline", "TechDraw_FaceCenterLine"] },
  { crawlerToolId: "center-mark", crawlerLabel: "Center Mark", freeCadCommandIds: ["TechDraw_FaceCenterLine"] },
  { crawlerToolId: "table", crawlerLabel: "Table", freeCadCommandIds: ["TechDraw_SpreadsheetView"] },
  { crawlerToolId: "bom", crawlerLabel: "Bill of Materials", freeCadCommandIds: ["Assembly_BillOfMaterials"] },
] as const;

export const CRAWLER_FREECAD_ICON_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(FREECAD_CRAWLER_ICON_MAP.map((mapping) => [mapping.crawlerToolId, mapping.freeCadCommandIds])),
);

export function crawlerToolIdForFreeCadCommand(commandId: string): string | undefined {
  const normalized = commandId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return FREECAD_CRAWLER_ICON_MAP.find((mapping) =>
    mapping.freeCadCommandIds.some((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized),
  )?.crawlerToolId;
}
