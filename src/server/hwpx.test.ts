import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { seed } from "../shared/seed";
import { changedCases } from "../../scripts/export-cases";
import { generateHwpx } from "./hwpx";
import { paragraphText, paragraphs, readTemplate, tableCells } from "./template";
import { child, children, descendants, parseXml, serialize } from "./xml";

const template = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const generate = (data = seed) => generateHwpx(data, template);
const section = (bytes: Uint8Array) => child(parseXml(strFromU8(unzipSync(bytes)["Contents/section0.xml"])), "hs:sec");

describe("weekly plan hwpx", () => {
  test("one-off seed retains all source data, including duplicate department content", () => {
    expect(seed).toEqual(readTemplate(template).data);
  });
  test("the seed changes only the automatically assigned digit in section XML", () => {
    const original = strFromU8(unzipSync(template)["Contents/section0.xml"]);
    const generated = strFromU8(unzipSync(generate())["Contents/section0.xml"]);
    expect(generated).toBe(original.replace("<hp:t> 4</hp:t>", "<hp:t> 3</hp:t>"));
  });
  test("new week periods retain the form's separate heading and date typography", () => {
    const data = {
      ...seed, titlePeriod: "<11.　16.　~　11.　20.>", writtenDate: "2026. 11. 16.",
      lastWeekPeriod: "(11. 9. ~ 11. 13.)", thisWeekPeriod: "(11. 16. ~ 11. 20.)",
    };
    const doc = section(generate(data));
    for (const department of readTemplate(template).departments) {
      const main = descendants(doc, "hp:tbl").find((table) => table.attributes.id === department.main.attributes.id)!;
      for (const [index, heading, period] of [
        [0, "전주 실적", data.lastWeekPeriod], [1, "금주 계획", data.thisWeekPeriod],
      ] as const) {
        const p = paragraphs(tableCells(main)[index])[0];
        const runs = children(p, "hp:run");
        expect(paragraphText(p)).toBe(`${heading}${period}`);
        expect(runs.map((run) => run.attributes.charPrIDRef)).toEqual(["30", "31"]);
        expect(children(runs[0], "hp:t").map((text) => serialize(text))).toEqual([`<hp:t>${heading}</hp:t>`]);
        expect(children(runs[1], "hp:t").map((text) => serialize(text))).toEqual([`<hp:t>${period}</hp:t>`]);
      }
    }
    expect(children(descendants(doc, "hp:p").find((p) => p.attributes.id === "11")!, "hp:run")[0].attributes.charPrIDRef)
      .toBe("22");
    expect(children(descendants(doc, "hp:p").find((p) => p.attributes.id === "26")!, "hp:run")[0].attributes.charPrIDRef)
      .toBe("23");
  });
  test("edited item content becomes XML text, with escaping and multiple lines", () => {
    const data = changedCases()[0];
    data.departments[0].items.lastWeek[0].content.push([{ text: ' ○ <추가 & "본문">' }]);
    const doc = section(generate(data));
    const p = descendants(doc, "hp:p").find((p) => p.attributes.id === "45")!;
    expect(paragraphText(p)).toBe("1. 수정된 업무 제목");
    const text = serialize(doc);
    expect(text).toContain("수정한 본문을 확인합니다.");
    expect(text).toContain("&lt;추가 &amp; &quot;본문&quot;&gt;");
    expect(text).not.toContain("본부‧사업별 추진 실적‧성과‧");
  });
  test("added and removed items rebuild rows and renumber each column independently", () => {
    const data = changedCases()[1];
    const doc = section(generate(data));
    const main = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1178668902")!;
    expect(main.attributes.rowCnt).toBe("10");
    const title = (row: number, col: number) =>
      paragraphText(paragraphs(children(children(main, "hp:tr")[row], "hp:tc")[col])[0]);
    expect(title(8, 0)).toBe("4. 추가한 네 번째 업무");
    expect(title(4, 1)).toBe("2. 내부통제 및 ");
    expect(title(8, 1)).toBe("");
    expect(serialize(main)).not.toContain("2027년 인력운영계획 수립을 위한");
  });
  test("changed nested table covers its grid with merges and exports a connected SUM field", () => {
    const data = changedCases()[2];
    const doc = section(generate(data));
    const outer = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1233225380")!;
    const nested = descendants(outer, "hp:tbl")[0];
    expect([nested.attributes.rowCnt, nested.attributes.colCnt]).toEqual(["4", "5"]);
    expect(child(tableCells(nested)[0], "hp:cellSpan").attributes.colSpan).toBe("2");
    const merged = tableCells(nested).find((c) => child(c, "hp:cellAddr").attributes.rowAddr === "3")!;
    expect(child(merged, "hp:cellSpan").attributes.colSpan).toBe("4");
    const begin = descendants(nested, "hp:fieldBegin")[0];
    expect(begin.attributes.type).toBe("FORMULA");
    expect(descendants(nested, "hp:fieldEnd")[0].attributes.beginIDRef).toBe(begin.attributes.id);
    expect(serialize(begin)).toContain("=SUM(A2:D3)??%g,;;110");
    expect(paragraphText(paragraphs(tableCells(nested).at(-1)!)[0])).toBe("110");
  });
  test("changing numeric source cells updates the formula's displayed cache", () => {
    const data = structuredClone(seed);
    const table = data.departments[1].items.ongoing[2].tables[0];
    table.cells.find((c) => c.row === 2 && c.column === 0)!.paragraphs = [[{ text: "111" }]];
    const xml = serialize(section(generate(data)));
    expect(xml).toContain("=SUM(A3:F3)??%g,;;128");
    expect(xml).toContain("<hp:t>128</hp:t>");
  });
  test("changed items carry original centered slack as margins while Hancom sizes the content", () => {
    const original = readTemplate(template);
    const item = seed.departments[1].items.ongoing[2];
    const outer = original.departments[1].ongoing;
    for (const rowHeight of [800, 2000, 2500]) {
      const data = structuredClone(seed);
      data.departments[1].items.ongoing[2].tables[0].rowHeights.fill(rowHeight);
      const doc = section(generate(data));
      const result = descendants(doc, "hp:tbl").find((t) => t.attributes.id === outer.attributes.id)!;
      const cell = tableCells(result).find((c) => paragraphs(c)[0].attributes.id === "115")!;
      expect(child(cell, "hp:cellSz").attributes.height).toBe("0");
      expect(cell.attributes.hasMargin).toBe("1");
      expect(child(cell, "hp:cellMargin").attributes).toEqual({
        left: "0", right: "0", top: "990", bottom: "991",
      });
      expect(child(cell, "hp:subList").attributes.vertAlign).toBe("TOP");
      expect(result.attributes.pageBreak).toBe("TABLE");
      expect(descendants(cell, "hp:linesegarray")).toHaveLength(0);
      expect(serialize(tableCells(result)[1])).toBe(serialize(tableCells(outer)[1]));
      const following = descendants(doc, "hp:tbl").find((t) =>
        t.attributes.id === original.departments[2].main.attributes.id)!;
      expect(child(following, "hp:pos").attributes.flowWithText).toBe("1");
    }
  });
  test("auto rows and width changes keep side by side tables and content-independent padding", () => {
    for (const indexes of [[0], [1], [0, 1]]) {
      for (const change of ["grow", "add-row", "remove-row", "add-column", "remove-column", "content"] as const) {
        const data = structuredClone(seed);
        const item = data.departments[2].items.ongoing[0];
        for (const index of indexes) {
          const table = item.tables[index];
          if (change === "grow") table.rowHeights = [2800, 0, 2800];
          if (change === "add-row") {
            table.cells.push(...structuredClone(table.cells.filter(c => c.row === 2)).map(c =>
              ({ ...c, row: 3, paragraphs: [[{ text: "1" }]] })));
            table.rows++;
            table.rowHeights.push(0);
          }
          if (change === "remove-row") {
            table.cells = table.cells.filter(c => c.row !== 1).map(c => ({ ...c, row: c.row > 1 ? c.row - 1 : c.row }));
            table.rows--;
            table.rowHeights.splice(1, 1);
          }
          if (change === "add-column" || change === "remove-column") {
            const width = table.columnWidths.reduce((a, b) => a + b, 0);
            table.columns += change === "add-column" ? 1 : -1;
            if (change === "add-column") {
              table.cells[0].colSpan++;
              for (const row of [1, 2]) table.cells.push({
                row, column: 8, rowSpan: 1, colSpan: 1, alignment: "center", paragraphs: [[{ text: "1" }]],
              });
            } else {
              table.cells = table.cells.filter(c => c.column !== 7);
              for (const c of table.cells) if (c.column + c.colSpan > 7) c.colSpan--;
            }
            table.columnWidths = Array(table.columns).fill(Math.floor(width / table.columns));
            table.columnWidths[table.columns - 1] += width - table.columnWidths.reduce((a, b) => a + b, 0);
          }
          if (change === "content") {
            table.rowHeights[1] = 0;
            table.cells.find(c => c.row === 1 && c.column === 0)!.paragraphs.push([{ text: "추가" }]);
          }
        }
        const doc = readTemplate(generate(data));
        const body = doc.items.get(item.id)!.body;
        const nested = descendants(body, "hp:tbl");
        // These are declared minima. Hancom grows even explicit rows when text wraps.
        expect(nested.map(t => Number(child(t, "hp:sz").attributes.height))).toEqual(
          [0, 1].map(i => !indexes.includes(i) ? 4398 :
            item.tables[i].rowHeights.reduce((a, b) => a + b, 0)));
        expect(child(body, "hp:cellSz").attributes.height).toBe("0");
        expect(body.attributes.hasMargin).toBe("1");
        expect(child(body, "hp:cellMargin").attributes).toEqual({
          left: "140", right: "140", top: "337", bottom: "340",
        });
        expect(child(body, "hp:subList").attributes.vertAlign).toBe("TOP");
        expect(descendants(body, "hp:linesegarray")).toHaveLength(0);
        expect(paragraphs(body).filter(p => descendants(p, "hp:tbl").length)).toHaveLength(1);
        if (change === "grow" || change === "add-row") {
          const row = change === "grow" ? 1 : 3;
          for (const index of indexes) expect(tableCells(nested[index]).filter(c =>
            Number(child(c, "hp:cellAddr").attributes.rowAddr) === row).every(c =>
            child(c, "hp:cellSz").attributes.height === "0")).toBe(true);
        }
      }
    }
  });
  test("new and changed text uses template padding independently of line count", () => {
    for (const kind of ["content", "notes"] as const) {
      const data = structuredClone(seed);
      data.departments[1].items.ongoing[2][kind].push(
        ...[1, 2, 3].map((n) => [{ text: `${kind === "notes" ? "   *" : " ○"} 추가 ${n}` }]),
      );
      const doc = section(generate(data));
      const outer = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1233225380")!;
      const body = tableCells(outer).find((c) => paragraphs(c)[0].attributes.id === "115")!;
      expect(child(body, "hp:cellSz").attributes.height).toBe("0");
      expect(child(body, "hp:cellMargin").attributes.top).toBe("990");
      expect(child(body, "hp:cellMargin").attributes.bottom).toBe("991");
      expect(outer.attributes.pageBreak).toBe("TABLE");
    }
    const data = structuredClone(seed);
    const items = data.departments[1].items.ongoing;
    items[0].tables.push({ ...structuredClone(items[2].tables[0]), id: "added-endpoint" });
    items[1].content = [];
    items[1].notes = [];
    const doc = section(generate(data));
    const outer = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1233225380")!;
    const bodies = tableCells(outer).filter((c) => ["108", "111"].includes(paragraphs(c)[0].attributes.id));
    expect(bodies.map((c) => child(c, "hp:cellSz").attributes.height)).toEqual(["0", "0"]);
    expect(bodies.map((c) => child(c, "hp:cellMargin").attributes.top)).toEqual(["1413", "566"]);
    expect(bodies.map((c) => child(c, "hp:cellMargin").attributes.bottom)).toEqual(["1413", "566"]);
    expect(child(descendants(bodies[0], "hp:tbl")[0], "hp:outMargin").attributes.bottom).toBe("0");
    const added = section(generate(changedCases()[1]));
    const main = descendants(added, "hp:tbl").find(t => t.attributes.id === "1178668902")!;
    const newBody = child(children(main, "hp:tr")[8], "hp:tc");
    expect(child(newBody, "hp:cellSz").attributes.height).toBe("0");
    expect(child(newBody, "hp:cellMargin").attributes).toEqual({
      left: "138", right: "138", top: "566", bottom: "3142",
    });
    expect(descendants(newBody, "hp:linesegarray")).toHaveLength(0);
  });
  test("a table can be added to a narrow column and existing tables can be removed", () => {
    const data = structuredClone(seed);
    const source = structuredClone(data.departments[1].items.ongoing[2].tables[0]);
    source.id = "added-table";
    data.departments[0].items.lastWeek[0].tables.push(source);
    data.departments[2].items.ongoing[0].tables = [];
    const doc = section(generate(data));
    const main = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1178668902")!;
    const nested = descendants(main, "hp:tbl")[0];
    expect(Number(child(nested, "hp:sz").attributes.width)).toBeLessThan(25891);
    expect(descendants(nested, "hp:fieldBegin")[0].attributes.type).toBe("FORMULA");
    const ongoing = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1239168024")!;
    expect(descendants(ongoing, "hp:tbl")).toHaveLength(0);
  });
  test("shared row items use the tallest original cell's padding", () => {
    const original = readTemplate(template);
    for (const [department, category, index, top, bottom] of [
      [0, "thisWeek", 0, "566", "3142"],
      [0, "thisWeek", 1, "566", "3023"],
      [1, "lastWeek", 0, "283", "1898"],
    ] as const) {
      const data = structuredClone(seed);
      const item = data.departments[department].items[category][index];
      item.content.push(...Array.from({ length: 6 }, (_, i) => [{ text: ` ○ 추가 내용 ${i + 1}` }]));
      const result = readTemplate(generate(data));
      const body = result.items.get(item.id)!.body;
      expect(child(body, "hp:cellMargin").attributes.top).toBe(top);
      expect(child(body, "hp:cellMargin").attributes.bottom).toBe(bottom);
      expect(child(body, "hp:cellSz").attributes.height).toBe("0");
      expect(child(body, "hp:subList").attributes.vertAlign).toBe("TOP");
      const opposite = original.departments[department].data.items[category === "lastWeek" ? "thisWeek" : "lastWeek"][index];
      expect(serialize(result.items.get(opposite.id)!.body)).toBe(serialize(original.items.get(opposite.id)!.body));
    }
  });
  test("new items in either column inherit row padding without an empty neighbour's minimum height", () => {
    for (const [column, category] of [[0, "lastWeek"], [1, "thisWeek"]] as const) {
      const data = structuredClone(seed);
      const items = data.departments[0].items[category];
      items.push({
        id: "new-shared-item", title: [{ text: "새 업무", bold: true }],
        content: [[{ text: " ○ 새 내용" }]], notes: [], tables: [], assignee: "담당자",
      });
      const doc = section(generate(data));
      const main = descendants(doc, "hp:tbl").find(t => t.attributes.id === "1178668902")!;
      const cells = children(children(main, "hp:tr")[8], "hp:tc");
      expect(child(cells[column], "hp:cellMargin").attributes).toEqual({
        left: "138", right: "138", top: "566", bottom: "3142",
      });
      expect(cells.map(c => child(c, "hp:cellSz").attributes.height)).toEqual(["0", "0"]);
      expect(paragraphs(cells[1 - column]).map(paragraphText)).toEqual([""]);
      expect(descendants(cells[column], "hp:linesegarray")).toHaveLength(0);
    }
  });
  test("new emphasis references generated properties without changing the template properties", () => {
    const entries = unzipSync(generate(changedCases()[3]));
    const header = parseXml(strFromU8(entries["Contents/header.xml"]));
    const doc = parseXml(strFromU8(entries["Contents/section0.xml"]));
    const runs = descendants(doc, "hp:run");
    for (const [text, color, bold] of [["굵은 글자", "#000000", true], [" 파란 글자", "#0000FF", false], [" 빨간 글자", "#FF0000", true]] as const) {
      const run = runs.find((r) => children(r, "hp:t").some((t) => serialize(t).includes(text)))!;
      const prop = descendants(header, "hh:charPr").find((p) => p.attributes.id === run.attributes.charPrIDRef)!;
      expect(prop.attributes.textColor).toBe(color);
      expect(children(prop, "hh:bold").length > 0).toBe(bold);
    }
  });
  test("output XML is well formed and the package retains every original resource", () => {
    for (const data of [seed, ...changedCases()]) {
      const entries = unzipSync(generate(data));
      expect(Object.keys(entries)).toEqual(Object.keys(unzipSync(template)));
      for (const [name, bytes] of Object.entries(entries)) {
        if (name.endsWith(".xml") || name.endsWith(".hpf") || name.endsWith(".rdf"))
          expect(() => parseXml(strFromU8(bytes))).not.toThrow();
        if (name.startsWith("BinData/")) expect(bytes).toEqual(unzipSync(template)[name]);
      }
      const ids = descendants(section(generate(data)), "hp:p").map((p) => p.attributes.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  test("ZIP starts with the uncompressed mimetype local entry", () => {
    const bytes = generate();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    const nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true);
    expect(strFromU8(bytes.subarray(30, 30 + nameLength))).toBe("mimetype");
    expect(strFromU8(bytes.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + 19)))
      .toBe("application/hwp+zip");
  });
  test("invalid merge overlap is rejected before a document can be exported", () => {
    const data = structuredClone(seed);
    data.departments[1].items.ongoing[2].tables[0].cells[0].colSpan = 3;
    expect(() => generate(data)).toThrow("Overlapping");
  });
});
