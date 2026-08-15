import assert from "node:assert/strict";
import test from "node:test";
import { StableSketchIds, selfIntersectionDiagnostics, type Sketch } from "../src/sketch-editor.ts";
import { arcVariantCommands, circleVariantCommands, creationVariantPointCount, polygonVariantCommands, rectangleVariantCommands, slotVariantCommands } from "../src/sketch-creation.ts";
import { explodeSketchTextCommand, sketchTextCommands, updatedSketchTextRecipe } from "../src/sketch-text.ts";
import { exportSketchSvg } from "../src/sketch-interchange.ts";

const point = (x_nm:number,y_nm:number)=>({x_nm,y_nm});
const base:Sketch={id:"p2",revision:0,geometry:{axis:{id:"axis",geometry:{kind:"line",start:point(-20,0),end:point(20,0)}},path:{id:"path",geometry:{kind:"arc",center:point(0,0),start:point(50,0),end:point(0,50),clockwise:false}},b:{id:"b",geometry:{kind:"line",start:point(0,-20),end:point(0,20)}},c:{id:"c",geometry:{kind:"circle",center:point(30,30),radius_nm:10}}},constraints:{}};
const geometryCount=(commands:ReturnType<typeof rectangleVariantCommands>)=>commands.filter((command)=>command.kind==="add_geometry").length;

test("P2 rectangle, circle, and arc creation methods produce distinct native constructions",()=>{
  assert.deepEqual(["two_point","three_point","center"].map((mode)=>geometryCount(rectangleVariantCommands(new StableSketchIds(`r:${mode}`),mode as never,mode==="three_point"?[point(0,0),point(20,10),point(5,20)]:[point(0,0),point(20,10)]))),[4,4,6]);
  assert.deepEqual(["center_diameter","two_point","three_point","two_tangent","three_tangent"].map((mode)=>geometryCount(circleVariantCommands(new StableSketchIds(`c:${mode}`),mode as never,mode==="center_diameter"||mode==="two_point"?[point(0,0),point(20,0)]:mode==="three_point"?[point(0,0),point(20,0),point(10,10)]:[point(5,5)],["axis","b","c"],base))),[1,1,1,1,1]);
  assert.equal(circleVariantCommands(new StableSketchIds("c:tangent"),"three_tangent",[point(5,5)],["axis","b","c"],base).filter((command)=>command.kind==="add_constraint"&&command.constraint.kind==="tangent").length,3);
  const arcs=[arcVariantCommands(new StableSketchIds("a:center"),"center_point",[point(0,0),point(20,0),point(0,20)]),arcVariantCommands(new StableSketchIds("a:three"),"three_point",[point(20,0),point(14,14),point(0,20)]),arcVariantCommands(new StableSketchIds("a:tangent"),"tangent",[point(0,0),point(10,10)],base,"axis")];
  assert.ok(arcs.every((commands)=>commands[0].kind==="add_geometry"&&commands[0].entity.geometry.kind==="arc"));
  assert.equal(creationVariantPointCount("slot","three_point_arc"),4);
});

test("P2 polygon and slot variants retain method-specific recipe intent",()=>{
  const polygons=["inscribed","circumscribed","edge"].map((mode)=>polygonVariantCommands(new StableSketchIds(`p:${mode}`),mode as never,point(0,0),point(20,0),6));
  assert.deepEqual(polygons.map((commands)=>commands.find((command)=>command.kind==="add_recipe")?.recipe.kind),["polygon","polygon","polygon"]);
  assert.deepEqual(polygons.map((commands)=>commands.find((command)=>command.kind==="add_recipe")?.recipe.kind==="polygon"&&commands.find((command)=>command.kind==="add_recipe")?.recipe.mode),["inscribed","circumscribed","edge"]);
  const slots=[
    slotVariantCommands(new StableSketchIds("s:center"),"center_to_center",[point(0,0),point(40,0),point(0,8)]),
    slotVariantCommands(new StableSketchIds("s:overall"),"overall",[point(0,0),point(40,0),point(0,8)]),
    slotVariantCommands(new StableSketchIds("s:centerpoint"),"center_point",[point(0,0),point(20,0),point(0,8)]),
    slotVariantCommands(new StableSketchIds("s:arc"),"three_point_arc",[point(30,0),point(21,21),point(0,30),point(25,25)]),
  ];
  assert.deepEqual(slots.map(geometryCount),[4,4,4,4]);
  assert.deepEqual(slots.map((commands)=>commands.find((command)=>command.kind==="add_recipe")?.recipe.kind==="slot"&&commands.find((command)=>command.kind==="add_recipe")?.recipe.mode),["center_to_center","overall","center_point","three_point_arc"]);
});

test("retained sketch text supports straight/path layouts, edit topology, and explode",()=>{
  const straight=sketchTextCommands(new StableSketchIds("text:straight"),base,{text:"CAD 360",origin:point(0,0),heightNm:10});
  const path=sketchTextCommands(new StableSketchIds("text:path"),base,{text:"ARC",origin:point(0,0),heightNm:5,path:"path",reversed:true});
  const straightRecipe=straight.find((command)=>command.kind==="add_recipe");const pathRecipe=path.find((command)=>command.kind==="add_recipe");
  assert.ok(straightRecipe?.kind==="add_recipe"&&straightRecipe.recipe.kind==="text"&&straightRecipe.recipe.geometry.length>10);
  assert.ok(pathRecipe?.kind==="add_recipe"&&pathRecipe.recipe.kind==="text"&&pathRecipe.recipe.path==="path"&&pathRecipe.recipe.reversed);
  const pathSketch:Sketch={...structuredClone(base),geometry:{...structuredClone(base.geometry),...Object.fromEntries(path.flatMap((command)=>command.kind==="add_geometry"?[[command.entity.id,command.entity]]:[]))}};
  assert.doesNotThrow(()=>selfIntersectionDiagnostics(pathSketch));
  if(straightRecipe?.kind!=="add_recipe"||straightRecipe.recipe.kind!=="text")return;
  const edited=updatedSketchTextRecipe(base,straightRecipe.recipe,{text:"P2",heightNm:20},new StableSketchIds("text:edit",100));
  assert.equal(edited.recipe.text,"P2");assert.equal(edited.recipe.height_nm,20);assert.equal(edited.recipe.geometry.length,edited.geometry.length);assert.deepEqual(explodeSketchTextCommand("recipe:text"),{kind:"remove_recipe",id:"recipe:text"});
});

test("SVG export preserves native curve metadata while using standard SVG shapes",()=>{
  const svg=exportSketchSvg(base);assert.match(svg,/<line/);assert.match(svg,/<path/);assert.match(svg,/data-crawler-native/);assert.match(svg,/data-crawler-units="mm"/);
});
