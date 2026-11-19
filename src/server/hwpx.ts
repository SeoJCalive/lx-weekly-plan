import { strToU8, zipSync, type Zippable } from "fflate";
import { validateTable } from "../shared/table-validation";
import { formRuns } from "../shared/form-runs";
import { cellOrigin, tableCellStyle } from "../shared/table-style";
import { templateTableStyles } from "./table-style";
import { sumValue, type RichText, type TableCell, type WeeklyPlan, type WorkItem, type WorkTable } from "../shared/weekly-plan";
import { paragraphs, paragraphText, readTemplate, tableCells, type ItemTemplate } from "./template";
import { child, children, clone, descendants, element, escapeXml, serialize, setAttribute, setText, textContent, type XmlNode } from "./xml";

const equal = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b);
const columnName = (column: number): string => {
  let name = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};
const address = (cell: { row: number; column: number }): string => `${columnName(cell.column)}${cell.row + 1}`;

/** The template is read on each call; neither caller data nor template bytes are mutated. */
export function generateHwpx(data: WeeklyPlan, templateBytes: Uint8Array): Uint8Array {
  const t = readTemplate(templateBytes);
  const tableStyles = templateTableStyles(t);
  let nextId = Math.max(...descendants(t.section, "hp:p").map((p) => Number(p.attributes.id)),
    ...descendants(t.section, "hp:tbl").map((p) => Number(p.attributes.id))) + 1;
  const charCache = new Map<string, string>();
  const paraCache = new Map<string, string>();
  function charStyle(baseId: string, span: RichText[number]): string {
    const base = t.charProperties.get(baseId)!;
    const bold = span.bold ?? children(base, "hh:bold").length > 0;
    const color = span.color === "blue" ? "#0000FF" : span.color === "red" ? "#FF0000" : "#000000";
    if (bold === (children(base, "hh:bold").length > 0) && color === base.attributes.textColor.toUpperCase()) return baseId;
    const key = `${baseId}/${bold}/${color}`;
    if (charCache.has(key)) return charCache.get(key)!;
    const property = clone(base);
    const id = String(t.charProperties.size);
    setAttribute(property, "id", id);
    setAttribute(property, "textColor", color);
    property.children = property.children.filter((c) => typeof c === "string" || c.name !== "hh:bold");
    if (bold) property.children.push(element("<hh:bold/>"));
    const list = descendants(t.header, "hh:charProperties")[0];
    list.children.push(property);
    t.charProperties.set(id, property);
    setAttribute(list, "itemCnt", t.charProperties.size);
    charCache.set(key, id);
    return id;
  }
  function aligned(baseId: string, alignment: TableCell["alignment"]): string {
    const base = t.paraProperties.get(baseId)!;
    if (child(base, "hh:align").attributes.horizontal.toLowerCase() === alignment) return baseId;
    const key = `${baseId}/${alignment}`;
    if (paraCache.has(key)) return paraCache.get(key)!;
    const property = clone(base), id = String(t.paraProperties.size);
    setAttribute(property, "id", id);
    setAttribute(child(property, "hh:align"), "horizontal", alignment.toUpperCase());
    const list = descendants(t.header, "hh:paraProperties")[0];
    list.children.push(property);
    t.paraProperties.set(id, property);
    setAttribute(list, "itemCnt", t.paraProperties.size);
    paraCache.set(key, id);
    return id;
  }
  function renderParagraph(source: XmlNode, text: RichText, baseId: string, keepTypography=false): XmlNode {
    const p = clone(source);
    const runs=keepTypography?formRuns(text,children(source,"hp:run").map(r=>({
      text:children(r,"hp:t").map(textContent).join(""),style:r.attributes.charPrIDRef})),baseId):text.map(span=>({span,style:baseId}));
    p.children = runs.map(({span,style}) =>
      element(`<hp:run charPrIDRef="${charStyle(style, span)}"><hp:t>${escapeXml(span.text)}</hp:t></hp:run>`));
    if (!p.children.length) p.children.push(element(`<hp:run charPrIDRef="${baseId}"><hp:t/></hp:run>`));
    return p;
  }
  function replaceText(p: XmlNode, value: string): void {
    if (paragraphText(p) === value) return;
    const texts = children(p, "hp:run").flatMap((r) => children(r, "hp:t"));
    let remaining = value;
    for (const [index, text] of texts.entries()) {
      const previous = textContent(text);
      if (index < texts.length - 1 && remaining.startsWith(previous))
        remaining = remaining.slice(previous.length);
      else {
        setText(text, remaining);
        remaining = "";
      }
    }
    p.children = p.children.filter((c) => typeof c === "string" || c.name !== "hp:linesegarray");
  }
  function freshIds(node: XmlNode): void {
    const fields = new Map<string, string>();
    for (const p of [node, ...descendants(node, "hp:p"), ...descendants(node, "hp:tbl"), ...descendants(node, "hp:fieldBegin")]) {
      if (!p.attributes.id) continue;
      const old = p.attributes.id, id = String(nextId++);
      setAttribute(p, "id", id);
      if (p.name === "hp:fieldBegin") fields.set(old, id);
    }
    for (const end of descendants(node, "hp:fieldEnd")) {
      const id = fields.get(end.attributes.beginIDRef);
      if (id) setAttribute(end, "beginIDRef", id);
    }
  }
  function renderTable(table: WorkTable, source: XmlNode, baseline: WorkTable | undefined, cellWidth: number): XmlNode {
    validateTable(table);
    const margin = child(source, "hp:outMargin").attributes;
    const available = cellWidth - Number(margin.left) - Number(margin.right);
    const width = table.columnWidths.reduce((a, b) => a + b, 0);
    if (width > available) {
      const widths = table.columnWidths.map((w) => Math.floor(w * available / width));
      widths[widths.length - 1] += available - widths.reduce((a, b) => a + b, 0);
      table = { ...table, columnWidths: widths };
    }
    if (equal(table, baseline)) return clone(source);
    const result = clone(source);
    const originals = tableCells(source);
    const sourceCells = new Map(originals.map((c) => {
      const a = child(c, "hp:cellAddr").attributes;
      return [`${a.rowAddr}/${a.colAddr}`, c];
    }));
    const oldCells = new Map(baseline?.cells.map((c) => [`${c.row}/${c.column}`, c]));
    const rows = Array.from({ length: table.rows }, () => element("<hp:tr></hp:tr>"));
    for (const cell of table.cells) {
      const origin = cellOrigin(cell), key = `${origin.row}/${origin.column}`;
      const old = oldCells.get(key);
      const style = tableCellStyle(table, cell, tableStyles);
      const original = baseline ? sourceCells.get(key) ?? originals.find(c =>
        c.attributes.borderFillIDRef === style.borderFillId) ?? originals[0] : originals[0];
      const c = clone(original);
      setAttribute(c, "borderFillIDRef", style.borderFillId);
      setAttribute(child(c, "hp:cellAddr"), "rowAddr", cell.row);
      setAttribute(child(c, "hp:cellAddr"), "colAddr", cell.column);
      setAttribute(child(c, "hp:cellSpan"), "rowSpan", cell.rowSpan);
      setAttribute(child(c, "hp:cellSpan"), "colSpan", cell.colSpan);
      setAttribute(child(c, "hp:cellSz"), "width", table.columnWidths.slice(cell.column, cell.column + cell.colSpan).reduce((a, b) => a + b, 0));
      setAttribute(child(c, "hp:cellSz"), "height", table.rowHeights.slice(cell.row, cell.row + cell.rowSpan).reduce((a, b) => a + b, 0));
      const sourcePs = paragraphs(original);
      const formulaChanged = !equal(table.cells, baseline?.cells);
      const outputPs = cell.paragraphs.map((line, i) => {
        const p = sourcePs[i] ?? sourcePs[0];
        if (equal(line, old?.paragraphs[i]) && equal(cell.formula, old?.formula) &&
          (!cell.formula || !formulaChanged)) return clone(p);
        return renderParagraph(p, line, style.charPrId);
      });
      if (cell.formula) {
        const value = String(sumValue(table, cell.formula));
        const p = outputPs[0] ?? renderParagraph(sourcePs[0], [{ text: value }], style.charPrId);
        if (formulaChanged || !equal(cell.formula, old?.formula)) {
          const charId = children(p, "hp:run")[0].attributes.charPrIDRef;
          const fieldId = nextId++;
          const command = `=SUM(${address(cell.formula.from)}:${address(cell.formula.to)})??%g,;;${value}`;
          p.children = [element(`<hp:run charPrIDRef="${charId}"><hp:ctrl><hp:fieldBegin id="${fieldId}" type="FORMULA" name="" editable="0" dirty="0"><hp:parameters cnt="1" name=""><hp:stringParam name="Command">${escapeXml(command)}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:t>${value}</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="${fieldId}"/></hp:ctrl></hp:run>`)];
        }
        outputPs.splice(0, outputPs.length, p);
      }
      if (!outputPs.length) outputPs.push(renderParagraph(sourcePs[0], [], style.charPrId));
      for (const p of outputPs) setAttribute(p, "paraPrIDRef", aligned(p.attributes.paraPrIDRef, cell.alignment));
      child(c, "hp:subList").children = outputPs;
      rows[cell.row].children.push(c);
    }
    result.children = result.children.filter((c) => typeof c === "string" || c.name !== "hp:tr");
    result.children.push(...rows);
    setAttribute(result, "rowCnt", table.rows);
    setAttribute(result, "colCnt", table.columns);
    setAttribute(child(result, "hp:sz"), "width", table.columnWidths.reduce((a, b) => a + b, 0));
    setAttribute(child(result, "hp:sz"), "height", table.rowHeights.reduce((a, b) => a + b, 0));
    const caption = children(result, "hp:caption")[0];
    if (caption) {
      if (table.caption.length) {
        const ps = descendants(caption, "hp:p");
        child(caption, "hp:subList").children = table.caption.map((line, i) =>
          equal(line, baseline?.caption[i]) ? clone(ps[i]) : renderParagraph(ps[i] ?? ps[0], line, "41"));
      } else result.children = result.children.filter((c) => c !== caption);
    } else if (table.caption.length) {
      const prototype = [...t.tables.values()].find((tbl) => children(tbl, "hp:caption").length)!;
      const cap = clone(child(prototype, "hp:caption"));
      const p = descendants(cap, "hp:p")[0];
      child(cap, "hp:subList").children = table.caption.map((line) => renderParagraph(p, line, "41"));
      result.children.splice(3, 0, cap);
    }
    if (!baseline) freshIds(result);
    return result;
  }
  function renderItem(item: WorkItem, source: ItemTemplate, number: number, isNew: boolean): [XmlNode, XmlNode] {
    const body = clone(source.body), assignee = clone(source.assignee);
    const old = source.data, sourcePs = paragraphs(source.body);
    let title: XmlNode;
    if (equal(item.title, old.title)) {
      title = clone(sourcePs[0]);
      const texts = children(title, "hp:run").flatMap((r) => children(r, "hp:t"));
      const first = texts.find((text) => /\d/.test(serialize(text)))!;
      first.children = first.children.map((c) => typeof c === "string" ? c.replace(/\d+/, String(number)) : c);
    } else {
      const prefix = /^\s*/.exec(paragraphText(sourcePs[0]))![0];
      title = renderParagraph(sourcePs[0], [{ text: `${prefix}${number}. `, bold: true }, ...item.title], "29",!isNew);
    }
    const linePs = sourcePs.slice(1).filter((p) => !descendants(p, "hp:tbl").length);
    const contentPs = linePs.filter((p) => !/^\s*\*/.test(paragraphText(p)));
    const notePs = linePs.filter((p) => /^\s*\*/.test(paragraphText(p)));
    const standardContent = paragraphs(t.items.values().next().value!.body)[1];
    const standardNote = paragraphs(t.items.values().next().value!.body)[2];
    const output: XmlNode[] = [title];
    for (const [lines, previous, templates, standard, charId] of [
      [item.content, old.content, contentPs, standardContent, "36"],
      [item.notes, old.notes, notePs, standardNote, "41"],
    ] as const) {
      lines.forEach((line, i) => output.push(equal(line, previous[i]) && templates[i]
        ? clone(templates[i]) : renderParagraph(templates[i] ?? templates[0] ?? standard, line, charId,!!templates[i] && !isNew)));
    }
    const tablePs = sourcePs.filter((p) => descendants(p, "hp:tbl").length);
    const width=Number(child(body,"hp:cellSz").attributes.width);
    for(let index=0; index<item.tables.length;) {
      // Keep an intact original group in its own paragraph, even when another table was appended.
      const group=tablePs.find(p=>descendants(p,"hp:tbl").every((tbl,j)=>tbl.attributes.id===item.tables[index+j]?.id));
      if(group) {
        const p=clone(group);
        for(const run of children(p,"hp:run"))run.children=run.children.map(c=>{
          if(typeof c==="string" || c.name!=="hp:tbl")return c;
          const model=item.tables[index++];
          return renderTable(model,c,old.tables.find(t=>t.id===model.id),width);
        });
        output.push(p);
      }else{
        const model=item.tables[index++], baseline=old.tables.find(tbl=>tbl.id===model.id);
        const fallback=[...t.items.values()].find(i=>i.data.tables.length)!;
        const prototype=paragraphs(fallback.body).find(p=>descendants(p,"hp:tbl").length)!;
        const p=clone(prototype), sourceTable=baseline?t.tables.get(baseline.id)!:descendants(prototype,"hp:tbl")[0];
        const nested=renderTable(model,sourceTable,baseline,width);
        p.children=[element('<hp:run charPrIDRef="36"></hp:run>')];
        child(p,"hp:run").children=[nested,element("<hp:t/>")];
        output.push(p);
      }
    }
    if (!descendants(sourcePs[sourcePs.length - 1], "hp:tbl").length)
      for (const table of descendants(output[output.length - 1], "hp:tbl"))
        setAttribute(child(table, "hp:outMargin"), "bottom", "0");
    if (isNew || !equal([item.title, item.content, item.notes, item.tables],
      [old.title, old.content, old.notes, old.tables])) {
      // Only the tallest original cell's slack is padding; Hancom recreates row slack.
      const row = children(source.table, "hp:tr").find((r) => children(r, "hp:tc").includes(source.body))!;
      const padding = children(row, "hp:tc").map((cell) => {
        const ps = paragraphs(cell), last = ps[ps.length - 1];
        const lines = children(last, "hp:linesegarray").flatMap((a) => children(a, "hp:lineseg"));
        const paraMargin = descendants(t.paraProperties.get(last.attributes.paraPrIDRef)!, "hh:margin")[0];
        const extent = Math.max(...lines.map((line) => Number(line.attributes.vertpos) + Number(line.attributes.vertsize))) +
          Number(child(paraMargin, "hc:next").attributes.value);
        const effective = cell.attributes.hasMargin === "1" ? child(cell, "hp:cellMargin") : child(source.table, "hp:inMargin");
        const slack = Number(child(cell, "hp:cellSz").attributes.height) - extent -
          Number(effective.attributes.top) - Number(effective.attributes.bottom);
        return { slack, above: child(cell, "hp:subList").attributes.vertAlign === "CENTER" ? Math.floor(slack / 2) : 0 };
      }).reduce((a, b) => a.slack <= b.slack ? a : b);
      const margin = child(body, "hp:cellMargin");
      const effective = body.attributes.hasMargin === "1" ? margin : child(source.table, "hp:inMargin");
      const top = Number(effective.attributes.top), bottom = Number(effective.attributes.bottom);
      for (const side of ["left", "right"]) setAttribute(margin, side, effective.attributes[side]);
      setAttribute(margin, "top", top + padding.above);
      setAttribute(margin, "bottom", bottom + padding.slack - padding.above);
      setAttribute(body, "hasMargin", "1");
      setAttribute(child(body, "hp:subList"), "vertAlign", "TOP");
      setAttribute(child(body, "hp:cellSz"), "height", "0");
      for (const p of output.flatMap((p) => [p, ...descendants(p, "hp:p")]))
        p.children = p.children.filter((c) => typeof c === "string" || c.name !== "hp:linesegarray");
    }
    child(body, "hp:subList").children = output;
    if (item.assignee !== old.assignee) {
      const p = clone(paragraphs(assignee)[0]);
      p.children = [
        element('<hp:run charPrIDRef="36"><hp:t> \uf0d8 </hp:t></hp:run>'),
        element('<hp:run charPrIDRef="34"><hp:t>(업무담당자) </hp:t></hp:run>'),
        element(`<hp:run charPrIDRef="36"><hp:t>${escapeXml(item.assignee)}</hp:t></hp:run>`),
      ];
      child(assignee, "hp:subList").children = [p];
    }
    if (isNew) { freshIds(body); freshIds(assignee); }
    return [body, assignee];
  }
  function renderOuter(source: XmlNode, lists: WorkItem[][], headerRows: number): XmlNode {
    const result = clone(source), sourceRows = children(source, "hp:tr");
    const count = Math.max(0, ...lists.map((items) => items.length));
    const rows = sourceRows.slice(0, headerRows).map(clone);
    for (let index = 0; index < count; index++) {
      const bodyRow = clone(sourceRows[headerRows]), assigneeRow = clone(sourceRows[headerRows + 1]);
      bodyRow.children = []; assigneeRow.children = [];
      for (let col = 0; col < lists.length; col++) {
        const item = lists[col][index];
        const defaultBody = children(sourceRows[headerRows], "hp:tc")[col];
        const defaultAssignee = children(sourceRows[headerRows + 1], "hp:tc")[col];
        let body: XmlNode, assignee: XmlNode;
        if (item) {
          const known = t.items.get(item.templateItemId ?? item.id);
          const prototype = known ?? [...t.items.values()].find((i) => i.body === defaultBody)!;
          [body, assignee] = renderItem(item, prototype, index + 1, !known);
        } else {
          body = clone(defaultBody); assignee = clone(defaultAssignee);
          setAttribute(child(body, "hp:cellSz"), "height", "0");
          for (const c of [body, assignee]) {
            child(c, "hp:subList").children = [renderParagraph(paragraphs(c)[0], [], "36")];
            freshIds(c);
          }
        }
        for (const [cell, row] of [[body, headerRows + index * 2], [assignee, headerRows + index * 2 + 1]] as const) {
          setAttribute(child(cell, "hp:cellAddr"), "rowAddr", row);
          setAttribute(child(cell, "hp:cellAddr"), "colAddr", col);
          setAttribute(child(cell, "hp:cellSz"), "width", child(defaultBody, "hp:cellSz").attributes.width);
        }
        bodyRow.children.push(body); assigneeRow.children.push(assignee);
      }
      rows.push(bodyRow, assigneeRow);
    }
    result.children = result.children.filter((c) => typeof c === "string" || c.name !== "hp:tr");
    result.children.push(...rows);
    setAttribute(result, "rowCnt", rows.length);
    if (rows.length !== sourceRows.length || rows.some((row, i) =>
      children(row, "hp:tc").some((c, col) => child(c, "hp:cellSz").attributes.height !==
        child(children(sourceRows[i], "hp:tc")[col], "hp:cellSz").attributes.height))) {
      setAttribute(child(result, "hp:sz"), "height", rows.reduce((sum, row) =>
        sum + Math.max(...children(row, "hp:tc").map((c) => Number(child(c, "hp:cellSz").attributes.height))), 0));
    }
    return result;
  }
  const cover = t.cover.map(clone);
  for (const [id, value] of [["10", data.title], ["11", data.titlePeriod], ["26", data.writtenDate]]) {
    const p = cover.flatMap((p) => [p, ...descendants(p, "hp:p")]).find((p) => p.attributes.id === id)!;
    replaceText(p, value);
  }
  let layoutChanged = false;
  const body = data.departments.flatMap((department) => {
    const source = t.departments.find((d) => d.data.id === department.id) ?? t.departments[0];
    const nodes = source.nodes.map(clone);
    replaceText(nodes[0], `[${department.parentOffice ? `${department.parentOffice}_` : ""}${department.name}]`);
    const main = renderOuter(source.main, [department.items.lastWeek, department.items.thisWeek], 2);
    const ongoing = renderOuter(source.ongoing, [department.items.ongoing], 1);
    layoutChanged ||= !equal(department.items, source.data.items);
    const mainCells = tableCells(main);
    for (const [index, text] of [
      [0, `전주 실적${data.lastWeekPeriod}`], [1, `금주 계획${data.thisWeekPeriod}`],
      [2, department.labels.lastWeek], [3, department.labels.thisWeek],
    ] as const) replaceText(paragraphs(mainCells[index])[0], text);
    replaceText(paragraphs(tableCells(ongoing)[0])[0], department.labels.ongoing);
    for (const p of nodes) for (const run of children(p, "hp:run")) {
      run.children = run.children.map((c) => typeof c === "string" ? c :
        c.name === "hp:tbl" && c.attributes.id === source.main.attributes.id ? main :
        c.name === "hp:tbl" && c.attributes.id === source.ongoing.attributes.id ? ongoing : c);
    }
    if (layoutChanged) for (const table of [main, ongoing]) {
      setAttribute(child(table, "hp:pos"), "flowWithText", "1");
    }
    return nodes;
  });
  t.section.children = [...cover, ...body];
  // Reusing a paragraph prototype for extra lines/cells must not duplicate its ID.
  for (const name of ["hp:p", "hp:tbl"]) {
    const seen = new Set<string>();
    for (const node of descendants(t.section, name)) {
      if (seen.has(node.attributes.id)) setAttribute(node, "id", nextId++);
      seen.add(node.attributes.id);
    }
  }
  t.entries["Contents/section0.xml"] = strToU8(serialize(t.document));
  t.entries["Contents/header.xml"] = strToU8(serialize(t.header));
  const zip: Zippable = { mimetype: [t.entries.mimetype, { level: 0 }] };
  for (const [name, bytes] of Object.entries(t.entries)) if (name !== "mimetype") zip[name] = [bytes, { level: 6 }];
  return zipSync(zip);
}
