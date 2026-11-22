import type { TableCellStyle, TableStyles } from "../shared/table-style";
import { paragraphs, tableCells, type ItemTemplate, type Template } from "./template";
import { child, children, clone, descendants, element, setAttribute, type XmlNode } from "./xml";

export function bodyContentWidth(source: Pick<ItemTemplate, "body" | "table">): number {
  const margin = bodyMargins(source);
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
  function style(cell: XmlNode): TableCellStyle {
    const charPrId = children(paragraphs(cell)[0], "hp:run")[0].attributes.charPrIDRef;
    const property = template.charProperties.get(charPrId)!;
    const borderFillId = cell.attributes.borderFillIDRef;
    const color = descendants(fills.get(borderFillId)!, "hc:winBrush")[0]?.attributes.faceColor;
    return { background: color && color !== "none" ? color : "#FFFFFF",
      fontSize: Number(property.attributes.height) / 100,
      bold: children(property, "hh:bold").length > 0, charPrId, borderFillId };
  }
  const tables: TableStyles["tables"] = {};
  for (const item of template.items.values()) for (const table of item.data.tables) {
    const cells: Record<string, TableCellStyle> = {};
    for (const cell of tableCells(template.tables.get(table.id)!)) {
      const a = child(cell, "hp:cellAddr").attributes, span = child(cell, "hp:cellSpan").attributes;
      for (let r = Number(a.rowAddr); r < Number(a.rowAddr) + Number(span.rowSpan); r++)
        for (let c = Number(a.colAddr); c < Number(a.colAddr) + Number(span.colSpan); c++)
          cells[`${r}/${c}`] = style(cell);
    }
    const margin = child(template.tables.get(table.id)!, "hp:outMargin").attributes;
    tables[table.id] = { rows: table.rows, columns: table.columns, cells, beside: table.beside ?? false,
      margin: { left: Number(margin.left), right: Number(margin.right) } };
  }
  const prototype = Object.values(tables)[0];
  const runs = children(inlineParagraph(template), "hp:run");
  const spaceWidth = (run: XmlNode) => Number(template.charProperties.get(run.attributes.charPrIDRef)!.attributes.height) / 2;
  return { tables, header: prototype.cells["0/0"], body: prototype.cells[`${prototype.rows - 1}/0`],
    margin: prototype.margin, inline: { leading: spaceWidth(runs[0]), gap: spaceWidth(runs[1]) } };
}

/** A new fill shares the original borders; repeated base/color pairs share its ID. */
export function coloredFills(header: XmlNode) {
  const list = descendants(header, "hh:borderFills")[0];
  const fills = new Map(children(list, "hh:borderFill").map(fill => [fill.attributes.id, fill]));
  const cache = new Map<string, string>();
  let nextId = Math.max(...[...fills.keys()].map(Number)) + 1;
  return (baseId: string, color: string): string => {
    const key = `${baseId}/${color}`, cached = cache.get(key);
    if (cached) return cached;
    const fill = clone(fills.get(baseId)!);
    const id = String(nextId++);
    setAttribute(fill, "id", id);
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
