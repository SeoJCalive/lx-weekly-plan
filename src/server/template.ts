import { unzipSync, strFromU8 } from "fflate";
import type { Department, RichText, TableCell, WeeklyPlan, WorkItem, WorkTable } from "../shared/weekly-plan";
import { plainText } from "../shared/weekly-plan";
import { child, children, descendants, parseXml, textContent, type XmlNode } from "./xml";

export const paragraphs = (cell: XmlNode): XmlNode[] => children(child(cell, "hp:subList"), "hp:p");
export const tableCells = (table: XmlNode): XmlNode[] =>
  children(table, "hp:tr").flatMap((row) => children(row, "hp:tc"));
export const paragraphText = (p: XmlNode): string =>
  children(p, "hp:run").flatMap((run) => children(run, "hp:t")).map(textContent).join("");

export interface ItemTemplate {
  body: XmlNode;
  assignee: XmlNode;
  table: XmlNode;
  data: WorkItem;
}
export interface DepartmentTemplate {
  nodes: XmlNode[];
  main: XmlNode;
  ongoing: XmlNode;
  data: Department;
}
export interface Template {
  entries: Record<string, Uint8Array>;
  document: XmlNode;
  section: XmlNode;
  header: XmlNode;
  cover: XmlNode[];
  departments: DepartmentTemplate[];
  items: Map<string, ItemTemplate>;
  tables: Map<string, XmlNode>;
  charProperties: Map<string, XmlNode>;
  paraProperties: Map<string, XmlNode>;
  data: WeeklyPlan;
}

function rich(p: XmlNode, properties: Map<string, XmlNode>): RichText {
  return children(p, "hp:run").flatMap((run) => {
    const property = properties.get(run.attributes.charPrIDRef)!;
    const text = children(run, "hp:t").map(textContent).join("");
    if (!text) return [];
    const color = property.attributes.textColor.toUpperCase();
    return [{
      text,
      bold: children(property, "hh:bold").length > 0,
      ...(color === "#0000FF" ? { color: "blue" as const } : color === "#FF0000" ? { color: "red" as const } : {}),
    }];
  });
}
function withoutNumber(text: RichText): RichText {
  let remove = /^\s*\d+\.\s*/.exec(plainText(text))![0].length;
  return text.flatMap((span) => {
    const cut = Math.min(remove, span.text.length);
    remove -= cut;
    return cut === span.text.length ? [] : [{ ...span, text: span.text.slice(cut) }];
  });
}
function columnIndex(value: string): number {
  return [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

export function readTemplate(bytes: Uint8Array): Template {
  const entries = unzipSync(bytes);
  const document = parseXml(strFromU8(entries["Contents/section0.xml"]));
  const section = child(document, "hs:sec");
  const header = parseXml(strFromU8(entries["Contents/header.xml"]));
  const charProperties = new Map(descendants(header, "hh:charPr").map((p) => [p.attributes.id, p]));
  const paraProperties = new Map(descendants(header, "hh:paraPr").map((p) => [p.attributes.id, p]));
  const tables = new Map(descendants(section, "hp:tbl").map((t) => [t.attributes.id, t]));
  const items = new Map<string, ItemTemplate>();
  function tableData(table: XmlNode): WorkTable {
    const rows = Number(table.attributes.rowCnt);
    const columns = Number(table.attributes.colCnt);
    const columnWidths = Array<number>(columns).fill(0);
    const rowHeights = Array<number>(rows).fill(0);
    const cells: TableCell[] = tableCells(table).map((cell) => {
      const address = child(cell, "hp:cellAddr").attributes;
      const span = child(cell, "hp:cellSpan").attributes;
      const size = child(cell, "hp:cellSz").attributes;
      const row = Number(address.rowAddr), column = Number(address.colAddr);
      const rowSpan = Number(span.rowSpan), colSpan = Number(span.colSpan);
      if (colSpan === 1) columnWidths[column] = Number(size.width);
      if (rowSpan === 1) rowHeights[row] = Math.max(rowHeights[row], Number(size.height));
      const para = paragraphs(cell);
      const align = child(paraProperties.get(para[0].attributes.paraPrIDRef)!, "hh:align").attributes.horizontal;
      const formula = descendants(cell, "hp:fieldBegin")[0];
      const command = formula && textContent(child(child(formula, "hp:parameters"), "hp:stringParam"));
      const range = command && /=SUM\(([A-Z]+)(\d+|\?):([A-Z]+)(\d+|\?)\)/.exec(command);
      return {
        row, column, rowSpan, colSpan,
        alignment: align.toLowerCase() as TableCell["alignment"],
        paragraphs: para.map((p) => rich(p, charProperties)),
        ...(range ? {
          formula: {
            type: "SUM" as const,
            from: { row: range[2] === "?" ? row : Number(range[2]) - 1, column: columnIndex(range[1]) },
            to: { row: range[4] === "?" ? row : Number(range[4]) - 1, column: columnIndex(range[3]) },
          },
        } : {}),
      };
    });
    const caption = children(table, "hp:caption")[0];
    return {
      id: table.attributes.id, rows, columns, columnWidths, rowHeights,
      caption: caption ? descendants(caption, "hp:p").map((p) => rich(p, charProperties)) : [],
      cells,
    };
  }
  function itemData(body: XmlNode, assignee: XmlNode, table: XmlNode): WorkItem {
    const ps = paragraphs(body);
    const lines = ps.slice(1).filter((p) => !descendants(p, "hp:tbl").length);
    const data: WorkItem = {
      id: `item-${ps[0].attributes.id}`,
      title: withoutNumber(rich(ps[0], charProperties)),
      content: lines.filter((p) => !/^\s*\*/.test(paragraphText(p))).map((p) => rich(p, charProperties)),
      notes: lines.filter((p) => /^\s*\*/.test(paragraphText(p))).map((p) => rich(p, charProperties)),
      tables: descendants(body, "hp:tbl").map(tableData),
      assignee: paragraphs(assignee).map(paragraphText).join("\n").replace(/^.*?\(업무담당자\)\s*/, ""),
    };
    items.set(data.id, { body, assignee, table, data });
    return data;
  }
  const ps = children(section, "hp:p");
  const starts = ps.flatMap((p, i) => /^\[.*처\]/.test(paragraphText(p)) ? [i] : []);
  const departments: DepartmentTemplate[] = starts.map((start, index) => {
    const nodes = ps.slice(start, starts[index + 1] ?? ps.length);
    const outer = nodes.flatMap((p) => children(p, "hp:run").flatMap((r) => children(r, "hp:tbl")));
    const [main, ongoing] = outer;
    const rows = children(main, "hp:tr");
    const heading = paragraphText(nodes[0]).slice(1, -1).split("_");
    const data: Department = {
      id: `department-${main.attributes.id}`,
      name: heading[heading.length - 1],
      ...(heading.length > 1 ? { parentOffice: heading[0] } : {}),
      labels: {
        lastWeek: paragraphText(paragraphs(tableCells(main)[2])[0]),
        thisWeek: paragraphText(paragraphs(tableCells(main)[3])[0]),
        ongoing: paragraphText(paragraphs(tableCells(ongoing)[0])[0]),
      },
      items: { lastWeek: [], thisWeek: [], ongoing: [] },
    };
    for (let row = 2; row < rows.length; row += 2) {
      for (let col = 0; col < 2; col++) {
        data.items[col === 0 ? "lastWeek" : "thisWeek"].push(
          itemData(children(rows[row], "hp:tc")[col], children(rows[row + 1], "hp:tc")[col], main),
        );
      }
    }
    const ongoingRows = children(ongoing, "hp:tr");
    for (let row = 1; row < ongoingRows.length; row += 2) {
      data.items.ongoing.push(itemData(child(ongoingRows[row], "hp:tc"), child(ongoingRows[row + 1], "hp:tc"), ongoing));
    }
    return { nodes, main, ongoing, data };
  });
  const all = descendants(section, "hp:p");
  const cover = ps.slice(0, starts[0]);
  const coverPs = cover.flatMap((p) => [p, ...descendants(p, "hp:p")]);
  const mainCells = tableCells(departments[0].main);
  const data: WeeklyPlan = {
    title: paragraphText(coverPs.find((p) => p.attributes.id === "10")!),
    titlePeriod: paragraphText(coverPs.find((p) => p.attributes.id === "11")!),
    writtenDate: paragraphText(all.find((p) => p.attributes.id === "26")!),
    lastWeekPeriod: plainText(rich(paragraphs(mainCells[0])[0], charProperties)).replace(/^전주 실적/, ""),
    thisWeekPeriod: plainText(rich(paragraphs(mainCells[1])[0], charProperties)).replace(/^금주 계획/, ""),
    departments: departments.map((d) => d.data),
  };
  return { entries, document, section, header, cover, departments, items, tables, charProperties, paraProperties, data };
}
