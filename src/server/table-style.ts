import type { TableCellStyle, TableStyles } from "../shared/table-style";
import { paragraphs, tableCells, type Template } from "./template";
import { child, children, descendants, type XmlNode } from "./xml";

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
    tables[table.id] = { rows: table.rows, columns: table.columns, cells };
  }
  const prototype = Object.values(tables)[0];
  return { tables, header: prototype.cells["0/0"], body: prototype.cells[`${prototype.rows - 1}/0`] };
}
