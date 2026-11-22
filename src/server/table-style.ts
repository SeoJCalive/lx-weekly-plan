import type { TableCellStyle, TableStyles } from "../shared/table-style";
import { paragraphs, tableCells, type ItemTemplate, type Template } from "./template";
import { child, children, clone, descendants, element, setAttribute, type XmlNode } from "./xml";

export function bodyContentWidth(source: Pick<ItemTemplate, "body" | "table">,margin:Record<string,string|number>=bodyMargins(source)): number {
  return Number(child(source.body, "hp:cellSz").attributes.width) - Number(margin.left) - Number(margin.right);
}
export const bodyMargins = (source: Pick<ItemTemplate, "body" | "table">) =>
  child(source.body.attributes.hasMargin === "1" ? source.body : source.table,
    source.body.attributes.hasMargin === "1" ? "hp:cellMargin" : "hp:inMargin").attributes;

export const inlineParagraph = (template: Template): XmlNode =>
  [...template.items.values()].flatMap(item => paragraphs(item.body)).find(p => descendants(p, "hp:tbl").length > 1)!;

/** Read the form once for both the exporter and the preview's build-time layout. */
export function templateTableStyles(template: Template): TableStyles {
  const fills = new Map(descendants(template.header, "hh:borderFill").map(p => [p.attributes.id, p]));
  const fonts = children(descendants(template.header,"hh:fontface").find(face=>face.attributes.lang==="HANGUL")!,"hh:font");
  function style(cell: XmlNode, table: XmlNode): TableCellStyle {
    const charPrId = children(paragraphs(cell)[0], "hp:run")[0].attributes.charPrIDRef;
    const property = template.charProperties.get(charPrId)!;
    const borderFillId = cell.attributes.borderFillIDRef;
    const fill = fills.get(borderFillId)!;
    const color = descendants(fill, "hc:winBrush")[0]?.attributes.faceColor;
    const border = (side:string) => {
      const a=child(fill,`hh:${side}Border`).attributes;
      const types:Record<string,string>={NONE:"none",SOLID:"solid",DOUBLE_SLIM:"double",DASH:"dashed"};
      return `${a.width.replace(" ","")} ${types[a.type]} ${a.color}`;
    };
    const padding = child(cell.attributes.hasMargin==="1"?cell:table,cell.attributes.hasMargin==="1"?"hp:cellMargin":"hp:inMargin").attributes;
    const para = template.paraProperties.get(paragraphs(cell)[0].attributes.paraPrIDRef)!;
    return { background: color && color !== "none" ? color : "#FFFFFF",
      fontSize: Number(property.attributes.height) / 100,
      bold: children(property, "hh:bold").length > 0, charPrId, borderFillId,
      fontFamily:fonts.find(font=>font.attributes.id===child(property,"hh:fontRef").attributes.hangul)!.attributes.face,
      lineHeight:Number(descendants(para,"hh:lineSpacing")[0].attributes.value)/100,
      letterSpacing:Number(child(property,"hh:spacing").attributes.hangul)/100,
      padding:{left:Number(padding.left),right:Number(padding.right),top:Number(padding.top),bottom:Number(padding.bottom)},
      borders:{left:border("left"),right:border("right"),top:border("top"),bottom:border("bottom")} };
  }
  const tables: TableStyles["tables"] = {};
  for (const item of template.items.values()) for (const table of item.data.tables) {
    const cells: Record<string, TableCellStyle> = {};
    for (const cell of tableCells(template.tables.get(table.id)!)) {
      const a = child(cell, "hp:cellAddr").attributes, span = child(cell, "hp:cellSpan").attributes;
      for (let r = Number(a.rowAddr); r < Number(a.rowAddr) + Number(span.rowSpan); r++)
        for (let c = Number(a.colAddr); c < Number(a.colAddr) + Number(span.colSpan); c++)
          cells[`${r}/${c}`] = style(cell, template.tables.get(table.id)!);
    }
    const margin = child(template.tables.get(table.id)!, "hp:outMargin").attributes;
    const paragraph=paragraphs(item.body).find(p=>descendants(p,"hp:tbl").some(t=>t.attributes.id===table.id))!;
    tables[table.id] = { rows: table.rows, columns: table.columns, cells, beside: table.beside ?? false,
      inline:descendants(paragraph,"hp:tbl").length>1,
      margin: { left: Number(margin.left), right: Number(margin.right) } };
  }
  const paragraph=inlineParagraph(template),inlineTables=descendants(paragraph,"hp:tbl");
  const runs = children(paragraph, "hp:run");
  const prototype = tables[inlineTables[0].attributes.id];
  const owner=[...template.items.values()].find(item=>paragraphs(item.body).includes(paragraph))!;
  const bodyMargin=bodyMargins(owner);
  const extent=Math.max(...paragraphs(owner.body).flatMap(p=>children(p,"hp:linesegarray").flatMap(a=>children(a,"hp:lineseg")))
    .map(line=>Number(line.attributes.vertpos)+Number(line.attributes.vertsize)));
  const slack=Number(child(owner.body,"hp:cellSz").attributes.height)-extent-Number(bodyMargin.top)-Number(bodyMargin.bottom);
  const grid = Object.values(prototype.cells).find(cell => ["left","right","top","bottom"].every(side =>
    child(fills.get(cell.borderFillId)!,`hh:${side}Border`).attributes.type==="SOLID"))!;
  const spaceWidth = (run: XmlNode) => Number(template.charProperties.get(run.attributes.charPrIDRef)!.attributes.height) / 2;
  const leading=spaceWidth(runs[0]),gap=spaceWidth(runs[1]);
  const property=template.paraProperties.get(paragraph.attributes.paraPrIDRef)!;
  const lineSpacing=Number(descendants(property,"hh:lineSpacing")[0].attributes.value);
  const paraMargin=descendants(property,"hh:margin")[0];
  const spacing=(rowRuns:XmlNode[])=>Math.round(Math.max(...rowRuns.map(run=>
    Number(template.charProperties.get(run.attributes.charPrIDRef)!.attributes.height)))*(lineSpacing-100)/100)+
    Number(child(paraMargin,"hc:prev").attributes.value)+Number(child(paraMargin,"hc:next").attributes.value);
  const width=inlineTables.reduce((width,table)=>width+Number(child(table,"hp:sz").attributes.width)+
    Number(child(table,"hp:outMargin").attributes.left)+Number(child(table,"hp:outMargin").attributes.right),
    leading+gap*(inlineTables.length-1));
  return { tables,
    header: {...prototype.cells["0/0"],borderFillId:grid.borderFillId,borders:{...grid.borders,top:prototype.cells["0/0"].borders.top}},
    body: {...prototype.cells[`${prototype.rows - 1}/0`],borderFillId:grid.borderFillId,borders:grid.borders},
    margin: prototype.margin, inline: {leading,gap,trailing:bodyContentWidth(owner)-width,beforeSpacing:408,
      rowSpacing:spacing([runs[0],runs[3]]),groupSpacing:spacing(runs),slack,
      bodyMargin:{left:Number(bodyMargin.left),right:Number(bodyMargin.right),top:Number(bodyMargin.top),bottom:Number(bodyMargin.bottom)}} };
}

/** Repeated base/color/border combinations share a fill derived from the form. */
export function coloredFills(header: XmlNode) {
  const list = descendants(header, "hh:borderFills")[0];
  const fills = new Map(children(list, "hh:borderFill").map(fill => [fill.attributes.id, fill]));
  const cache = new Map<string, string>();
  let nextId = Math.max(...[...fills.keys()].map(Number)) + 1;
  return (baseId: string, color: string,borders?:TableCellStyle["borders"]): string => {
    const base=fills.get(baseId)!;
    const baseColor=descendants(base,"hc:winBrush")[0]?.attributes.faceColor;
    const edges=borders&&Object.fromEntries(Object.entries(borders).map(([side,value])=>{
      const [width,type,color]=value.split(" ");
      return [side,{width:width.replace("mm"," mm"),type:type.toUpperCase(),color}];
    }));
    if ((baseColor && baseColor!=="none" ? baseColor : "#FFFFFF")===color &&
      (!edges||Object.entries(edges).every(([side,attributes])=>Object.entries(attributes).every(([key,value])=>
        child(base,`hh:${side}Border`).attributes[key]===value))))return baseId;
    const key = JSON.stringify([baseId,color,borders]), cached = cache.get(key);
    if (cached) return cached;
    const fill = clone(base);
    const id = String(nextId++);
    setAttribute(fill, "id", id);
    for(const [side,attributes] of Object.entries(edges??{}))
      for(const [key,value] of Object.entries(attributes))setAttribute(child(fill,`hh:${side}Border`),key,value);
    let brush = children(fill, "hc:fillBrush")[0];
    if (!brush) {
      brush = element("<hc:fillBrush></hc:fillBrush>");
      fill.children.push(brush);
    }
    let winBrush = children(brush, "hc:winBrush")[0];
    if (!winBrush) {
      if (brush.open.endsWith("/>")) {
        brush.open = brush.open.replace(/\/>$/, ">");
        brush.close = "</hc:fillBrush>";
      }
      winBrush = element('<hc:winBrush faceColor="none" hatchColor="#000000" alpha="0"/>');
      brush.children.push(winBrush);
    }
    setAttribute(winBrush, "faceColor", color);
    list.children.push(fill);
    setAttribute(list, "itemCnt", children(list, "hh:borderFill").length);
    cache.set(key, id);
    return id;
  };
}
