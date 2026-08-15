import type { Geometry, Point2, Sketch, SketchCommand, StableSketchIds } from "./sketch-editor";
import { evaluateGeometryCurve } from "./sketch-spline.ts";

const NM_PER_MM = 1_000_000;

export type SketchInterchangeImport = { commands: SketchCommand[]; imported: number; ignored: number; warnings: string[] };

export function exportSketchSvg(sketch: Sketch): string {
  const entities = Object.values(sketch.geometry); const points = entities.flatMap((entity) => boundsPoints(entity.geometry));
  const minX = Math.min(0, ...points.map((point) => point.x_nm)) / NM_PER_MM; const minY = Math.min(0, ...points.map((point) => -point.y_nm)) / NM_PER_MM;
  const maxX = Math.max(1, ...points.map((point) => point.x_nm)) / NM_PER_MM; const maxY = Math.max(1, ...points.map((point) => -point.y_nm)) / NM_PER_MM;
  const body = entities.map((entity) => svgEntity(entity.id, entity.geometry, Boolean(entity.construction))).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(maxX-minX)} ${fmt(maxY-minY)}" fill="none" stroke="black" stroke-width="0.2" data-crawler-units="mm">\n  ${body}\n</svg>\n`;
}

export function importSketchSvgCommands(ids: StableSketchIds, svg: string): SketchInterchangeImport {
  const documentValue = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (documentValue.querySelector("parsererror")) throw new Error("SVG is not well-formed XML");
  const commands: SketchCommand[] = []; const warnings: string[] = []; let ignored = 0;
  const add = (geometry: Geometry, construction = false) => commands.push({ kind: "add_geometry", entity: { id: ids.next("geometry"), construction, geometry } });
  for (const element of Array.from(documentValue.querySelectorAll("line,circle,ellipse,rect,polyline,polygon,path"))) {
    const construction = element.getAttribute("data-construction") === "true";
    const retained = element.getAttribute("data-crawler-native");
    if (retained) {
      try { add(JSON.parse(retained) as Geometry, construction); continue; } catch { warnings.push("Ignored invalid Crawler native metadata"); }
    }
    try {
      if (element.tagName === "line") add({ kind: "line", start: svgPoint(numberAttr(element,"x1"),numberAttr(element,"y1")), end: svgPoint(numberAttr(element,"x2"),numberAttr(element,"y2")) }, construction);
      else if (element.tagName === "circle") add({ kind: "circle", center: svgPoint(numberAttr(element,"cx"),numberAttr(element,"cy")), radius_nm: mm(numberAttr(element,"r")) }, construction);
      else if (element.tagName === "ellipse") {
        const center=svgPoint(numberAttr(element,"cx"),numberAttr(element,"cy")); add({ kind:"ellipse",center,major:svgPoint(numberAttr(element,"cx")+numberAttr(element,"rx"),numberAttr(element,"cy")),minor:svgPoint(numberAttr(element,"cx"),numberAttr(element,"cy")-numberAttr(element,"ry")) },construction);
      } else if (element.tagName === "rect") {
        const x=numberAttr(element,"x"),y=numberAttr(element,"y"),width=numberAttr(element,"width"),height=numberAttr(element,"height");if(width<=0||height<=0)throw new Error("rectangle width and height must be positive");
        add({kind:"rectangle",min:svgPoint(x,y+height),max:svgPoint(x+width,y)},construction);
      } else if (element.tagName === "polyline" || element.tagName === "polygon") {
        const points=parsePointList(element.getAttribute("points")??""); for(let i=0;i<points.length-(element.tagName==="polygon"?0:1);i+=1)add({kind:"line",start:points[i],end:points[(i+1)%points.length]},construction);
      } else if (element.tagName === "path") {
        const result=parseSvgPath(element.getAttribute("d")??""); result.forEach((geometry)=>add(geometry,construction));
      }
    } catch (error) { ignored += 1; warnings.push(`${element.tagName}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { commands, imported: commands.length, ignored, warnings };
}

function svgEntity(id: string, geometry: Geometry, construction: boolean): string {
  const common=`id="${escapeXml(id)}" data-construction="${construction}"`;
  if(geometry.kind==="line")return `<line ${common} x1="${x(geometry.start)}" y1="${y(geometry.start)}" x2="${x(geometry.end)}" y2="${y(geometry.end)}"/>`;
  if(geometry.kind==="circle")return `<circle ${common} cx="${x(geometry.center)}" cy="${y(geometry.center)}" r="${fmt(geometry.radius_nm/NM_PER_MM)}"/>`;
  if(geometry.kind==="ellipse") { const rx=Math.hypot(geometry.major.x_nm-geometry.center.x_nm,geometry.major.y_nm-geometry.center.y_nm)/NM_PER_MM;const ry=Math.hypot(geometry.minor.x_nm-geometry.center.x_nm,geometry.minor.y_nm-geometry.center.y_nm)/NM_PER_MM;const rotation=-Math.atan2(geometry.major.y_nm-geometry.center.y_nm,geometry.major.x_nm-geometry.center.x_nm)*180/Math.PI;return `<ellipse ${common} cx="${x(geometry.center)}" cy="${y(geometry.center)}" rx="${fmt(rx)}" ry="${fmt(ry)}" transform="rotate(${fmt(rotation)} ${x(geometry.center)} ${y(geometry.center)})" data-crawler-native="${escapeXml(JSON.stringify(geometry))}"/>`;}
  if(geometry.kind==="arc"||geometry.kind==="elliptical_arc")return `<path ${common} d="${arcPath(geometry)}" data-crawler-native="${escapeXml(JSON.stringify(geometry))}"/>`;
  if(geometry.kind==="rectangle")return `<rect ${common} x="${x(geometry.min)}" y="${y({x_nm:geometry.min.x_nm,y_nm:geometry.max.y_nm})}" width="${fmt((geometry.max.x_nm-geometry.min.x_nm)/NM_PER_MM)}" height="${fmt((geometry.max.y_nm-geometry.min.y_nm)/NM_PER_MM)}" data-crawler-native="${escapeXml(JSON.stringify(geometry))}"/>`;
  if(geometry.kind==="sketch_point")return `<circle ${common} cx="${fmt(geometry.x_nm/NM_PER_MM)}" cy="${fmt(-geometry.y_nm/NM_PER_MM)}" r="0.25" data-crawler-native="${escapeXml(JSON.stringify(geometry))}"/>`;
  return `<path ${common} d="${nativeCurvePath(geometry)}" data-crawler-native="${escapeXml(JSON.stringify(geometry))}"/>`;
}

function nativeCurvePath(geometry:Extract<Geometry,{kind:"control_point_spline"|"fit_point_spline"|"conic"}>):string{
  if(geometry.kind==="conic")return`M ${x(geometry.start)} ${y(geometry.start)} Q ${x(geometry.control)} ${y(geometry.control)} ${x(geometry.end)} ${y(geometry.end)}`;
  if(geometry.kind==="control_point_spline"&&geometry.degree===3&&geometry.control_points.length===4){const[p0,p1,p2,p3]=geometry.control_points;return`M ${x(p0)} ${y(p0)} C ${x(p1)} ${y(p1)} ${x(p2)} ${y(p2)} ${x(p3)} ${y(p3)}`;}
  if(geometry.kind==="control_point_spline"&&geometry.degree===2&&geometry.control_points.length===3){const[p0,p1,p2]=geometry.control_points;return`M ${x(p0)} ${y(p0)} Q ${x(p1)} ${y(p1)} ${x(p2)} ${y(p2)}`;}
  const points=geometry.kind==="fit_point_spline"?geometry.fit_points:Array.from({length:17},(_,index)=>evaluateGeometryCurve(geometry,index/16));return cubicPathThroughPoints(points);
}

function cubicPathThroughPoints(points:readonly Point2[]):string{
  if(points.length<2)throw new Error("native SVG curve requires at least two points");let output=`M ${x(points[0])} ${y(points[0])}`;
  for(let index=0;index<points.length-1;index+=1){const before=points[Math.max(0,index-1)],start=points[index],end=points[index+1],after=points[Math.min(points.length-1,index+2)];const c1=point(start.x_nm+(end.x_nm-before.x_nm)/6,start.y_nm+(end.y_nm-before.y_nm)/6);const c2=point(end.x_nm-(after.x_nm-start.x_nm)/6,end.y_nm-(after.y_nm-start.y_nm)/6);output+=` C ${x(c1)} ${y(c1)} ${x(c2)} ${y(c2)} ${x(end)} ${y(end)}`;}return output;
}

function parseSvgPath(value:string):Geometry[]{
  const tokens=value.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)??[];let i=0;let command="";let current=svgPoint(0,0);let start=current;const output:Geometry[]=[];
  const num=()=>{const value=Number(tokens[i++]);if(!Number.isFinite(value))throw new Error("path has an invalid number");return value;};const pointFor=(relative:boolean)=>{const px=num(),py=num();const raw=svgPoint(px,py);return relative?{x_nm:current.x_nm+raw.x_nm,y_nm:current.y_nm+raw.y_nm}:raw;};
  while(i<tokens.length){if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++];if(!command)throw new Error("path is missing a command");const relative=command===command.toLowerCase();const kind=command.toUpperCase();
    if(kind==="M"){current=pointFor(relative);start=current;command=relative?"l":"L";}
    else if(kind==="L"){const next=pointFor(relative);output.push({kind:"line",start:current,end:next});current=next;}
    else if(kind==="H"){const raw=mm(num());const next={x_nm:relative?current.x_nm+raw:raw,y_nm:current.y_nm};output.push({kind:"line",start:current,end:next});current=next;}
    else if(kind==="V"){const raw=-mm(num());const next={x_nm:current.x_nm,y_nm:relative?current.y_nm+raw:raw};output.push({kind:"line",start:current,end:next});current=next;}
    else if(kind==="C"){const c1=pointFor(relative),c2=pointFor(relative),end=pointFor(relative);output.push({kind:"control_point_spline",degree:3,control_points:[current,c1,c2,end],knots_millionths:[0,0,0,0,1_000_000,1_000_000,1_000_000,1_000_000]});current=end;}
    else if(kind==="Q"){const control=pointFor(relative),end=pointFor(relative);output.push({kind:"conic",start:current,control,end,weight_millionths:1_000_000});current=end;}
    else if(kind==="A"){const rx=num(),ry=num(),rotation=num(),large=num()!==0,sweep=num()!==0,end=pointFor(relative);output.push(endpointArc(current,end,rx,ry,rotation,large,sweep));current=end;}
    else if(kind==="Z"){if(current.x_nm!==start.x_nm||current.y_nm!==start.y_nm)output.push({kind:"line",start:current,end:start});current=start;command="";}
    else throw new Error(`unsupported path command ${command}`);
  }return output;
}

function endpointArc(start:Point2,end:Point2,rxMm:number,ryMm:number,rotationDegrees:number,large:boolean,sweep:boolean):Geometry{
  let rx=Math.abs(mm(rxMm)),ry=Math.abs(mm(ryMm));if(!rx||!ry||start.x_nm===end.x_nm&&start.y_nm===end.y_nm)throw new Error("arc radii and endpoints must be distinct");const phi=-rotationDegrees*Math.PI/180;const cos=Math.cos(phi),sin=Math.sin(phi);const dx=(start.x_nm-end.x_nm)/2,dy=(start.y_nm-end.y_nm)/2;const xp=cos*dx-sin*dy,yp=sin*dx+cos*dy;const lambda=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(lambda>1){const scale=Math.sqrt(lambda);rx*=scale;ry*=scale;}const sign=large===sweep?-1:1;const coefficient=sign*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp)));const cxp=coefficient*rx*yp/ry,cyp=-coefficient*ry*xp/rx;const center=point(cos*cxp+sin*cyp+(start.x_nm+end.x_nm)/2,-sin*cxp+cos*cyp+(start.y_nm+end.y_nm)/2);if(Math.abs(rx-ry)<2&&Math.abs(rotationDegrees%180)<1e-9)return{kind:"arc",center,start,end,clockwise:!sweep};const major=point(center.x_nm+cos*rx,center.y_nm-sin*rx);const minor=point(center.x_nm+sin*ry,center.y_nm+cos*ry);return{kind:"elliptical_arc",center,major,minor,start,end,clockwise:!sweep};
}

function arcPath(geometry:Extract<Geometry,{kind:"arc"|"elliptical_arc"}>):string{const center=geometry.center;const rx=geometry.kind==="arc"?Math.hypot(geometry.start.x_nm-center.x_nm,geometry.start.y_nm-center.y_nm):Math.hypot(geometry.major.x_nm-center.x_nm,geometry.major.y_nm-center.y_nm);const ry=geometry.kind==="arc"?rx:Math.hypot(geometry.minor.x_nm-center.x_nm,geometry.minor.y_nm-center.y_nm);const rotation=geometry.kind==="arc"?0:-Math.atan2(geometry.major.y_nm-center.y_nm,geometry.major.x_nm-center.x_nm)*180/Math.PI;return`M ${x(geometry.start)} ${y(geometry.start)} A ${fmt(rx/NM_PER_MM)} ${fmt(ry/NM_PER_MM)} ${fmt(rotation)} 0 ${geometry.clockwise?0:1} ${x(geometry.end)} ${y(geometry.end)}`;}
function boundsPoints(geometry:Geometry):Point2[]{return Array.from({length:geometry.kind==="line"?2:33},(_,index)=>evaluateGeometryCurve(geometry,index/(geometry.kind==="line"?1:32)));}
function parsePointList(value:string):Point2[]{const values=value.trim().split(/[\s,]+/).map(Number);if(values.length<4||values.length%2)throw new Error("point list is incomplete");const output:Point2[]=[];for(let i=0;i<values.length;i+=2)output.push(svgPoint(values[i],values[i+1]));return output;}
function numberAttr(element:Element,name:string):number{const value=Number(element.getAttribute(name)??0);if(!Number.isFinite(value))throw new Error(`${name} is invalid`);return value;}
function svgPoint(xMm:number,yMm:number):Point2{return{x_nm:mm(xMm),y_nm:-mm(yMm)};}function mm(value:number):number{return Math.round(value*NM_PER_MM);}function x(value:Point2):string{return fmt(value.x_nm/NM_PER_MM);}function y(value:Point2):string{return fmt(-value.y_nm/NM_PER_MM);}function point(x_nm:number,y_nm:number):Point2{return{x_nm:Math.round(x_nm),y_nm:Math.round(y_nm)};}function fmt(value:number):string{return Number(value.toFixed(6)).toString();}function escapeXml(value:string):string{return value.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");}
