import { describe, expect, test } from "bun:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { seed } from "../shared/seed";
import { newTable } from "../ui/table";
import { changedCases } from "../../scripts/export-cases";
import { generateHwpx } from "./hwpx";
import { bodyContentWidth, templateTableStyles } from "./table-style";
import { paragraphText, paragraphs, readTemplate, tableCells } from "./template";
import { child, children, clone, descendants, element, parseXml, serialize, setAttribute } from "./xml";

const template = new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
const generate = (data = seed) => generateHwpx(data, template);
const section = (bytes: Uint8Array) => child(parseXml(strFromU8(unzipSync(bytes)["Contents/section0.xml"])), "hs:sec");
const nameMapping = [...(await Bun.file("docs/프로젝트_정의서.md").text()).matchAll(/([가-힣]{3})→([가-힣]{3})/g)];
const fictionalNames = (text: string) =>
  nameMapping.reduce((result, [, original, fictional]) => result.replaceAll(original, fictional), text);

describe("weekly plan hwpx", () => {
  test("one-off seed retains all source data, including duplicate department content", () => {
    expect(seed).toEqual(JSON.parse(fictionalNames(JSON.stringify(readTemplate(template).data))));
  });
  test("the seed retains section XML apart from fictional assignees and the automatically assigned digit", () => {
    const expected = strFromU8(unzipSync(template)["Contents/section0.xml"]);
    const generated = strFromU8(unzipSync(generate())["Contents/section0.xml"]);
    expect(generated).toBe(fictionalNames(expected).replace("<hp:t> 4</hp:t>", "<hp:t> 3</hp:t>"));
  });
  test("same-length assignees retain every template run while different lengths rebuild three runs", () => {
    const data = structuredClone(seed);
    const item = data.departments[0].items.thisWeek[0];
    const originalTemplate = readTemplate(template), sameLengthTemplate = readTemplate(generate(data));
    const original = paragraphs(originalTemplate.items.get(item.id)!.assignee)[0];
    const sameLength = paragraphs(sameLengthTemplate.items.get(item.id)!.assignee)[0];
    const flows = (t: typeof originalTemplate) => t.departments.flatMap(department =>
      [department.main, department.ongoing].map(table => child(table, "hp:pos").attributes.flowWithText));
    const styles = (p: typeof original) => children(p, "hp:run").map(run => run.attributes.charPrIDRef);
    expect(children(sameLength, "hp:run")).toHaveLength(children(original, "hp:run").length);
    expect(styles(sameLength)).toEqual(styles(original));
    expect(serialize(sameLength)).toBe(fictionalNames(serialize(original)));
    expect(flows(sameLengthTemplate)).toEqual(flows(originalTemplate));
    item.assignee = "새 담당자";
    const differentLengthTemplate = readTemplate(generate(data));
    const differentLength = paragraphs(differentLengthTemplate.items.get(item.id)!.assignee)[0];
    expect(children(differentLength, "hp:run")).toHaveLength(3);
    expect(styles(differentLength)).toEqual(["36", "34", "36"]);
    expect(paragraphText(differentLength)).toBe(" \uf0d8 (업무담당자) 새 담당자");
    expect(flows(differentLengthTemplate)).toEqual(Array(flows(originalTemplate).length).fill("1"));
    const spacedData = structuredClone(seed), spacedItem = spacedData.departments[0].items.thisWeek[1];
    const spacedOriginal = paragraphs(originalTemplate.items.get(spacedItem.id)!.assignee)[0];
    const mapped = readTemplate(generate(spacedData)).items.get(spacedItem.id)!;
    const mappedParagraph = paragraphs(mapped.assignee)[0];
    expect(styles(mappedParagraph)).toEqual(styles(spacedOriginal));
    expect(children(mappedParagraph, "hp:run")).toHaveLength(children(spacedOriginal, "hp:run").length);
    expect(descendants(mappedParagraph, "hp:fwSpace")).toHaveLength(2);
    expect(serialize(mappedParagraph)).toBe(fictionalNames(serialize(spacedOriginal)));
    expect(mapped.data.assignee).toBe(spacedItem.assignee);
    spacedItem.assignee = "민경석 / 하정민 팀장, 고영진 과장";
    expect(spacedItem.assignee.length).toBe(mapped.data.assignee.length);
    const rebuilt = readTemplate(generate(spacedData)).items.get(spacedItem.id)!;
    const rebuiltParagraph = paragraphs(rebuilt.assignee)[0];
    expect(rebuilt.data.assignee).toBe(spacedItem.assignee);
    expect(styles(rebuiltParagraph)).toEqual(["36", "34", "36"]);
    expect(children(rebuiltParagraph, "hp:run")).toHaveLength(3);
    expect(descendants(rebuiltParagraph, "hp:fwSpace")).toHaveLength(0);
  });
  test("an assignee matching its label changes only the paragraph suffix", () => {
    const fixture = readTemplate(template);
    const id = seed.departments[0].items.lastWeek[0].id;
    const p = paragraphs(fixture.items.get(id)!.assignee)[0];
    p.children = [element('<hp:run charPrIDRef="36"><hp:t> \uf0d8 (업무담당자) 업무담당자</hp:t></hp:run>')];
    fixture.entries["Contents/section0.xml"] = strToU8(serialize(fixture.document));
    const fixtureBytes = zipSync(fixture.entries), data = readTemplate(fixtureBytes).data;
    const item = data.departments[0].items.lastWeek[0];
    expect(item.assignee).toBe("업무담당자");
    item.assignee = "검검검검검";
    const result = readTemplate(generateHwpx(data, fixtureBytes)).items.get(id)!;
    expect(result.data.assignee).toBe(item.assignee);
    expect(paragraphText(paragraphs(result.assignee)[0])).toBe(" \uf0d8 (업무담당자) 검검검검검");
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
  test("editing elsewhere in a title keeps the template's superscript, not on newly blue text",()=>{
    const data=structuredClone(seed),item=data.departments[0].items.lastWeek[1];
    item.title.unshift({text:"추가 ",color:"blue",bold:true});
    const t=readTemplate(generate(data)),p=paragraphs(t.items.get(item.id)!.body)[0];
    const runs=children(p,"hp:run"),last=runs.at(-1)!;
    expect(children(t.charProperties.get(last.attributes.charPrIDRef)!,"hh:supscript")).toHaveLength(1);
    expect(children(t.charProperties.get(runs.find(r=>serialize(r).includes("추가"))!.attributes.charPrIDRef)!,"hh:supscript")).toHaveLength(0);
  });
  test("appending a third table keeps the original pair in one inline paragraph",()=>{
    const data=structuredClone(seed),it=data.departments[2].items.ongoing[0];
    it.tables.push({...structuredClone(it.tables[0]),id:"added"});
    const xml=readTemplate(generate(data));
    expect(paragraphs(xml.items.get(it.id)!.body).map(p=>descendants(p,"hp:tbl").length).filter(Boolean)).toEqual([2,1]);
  });
  test.each([false,true])("new tables use the form's cell typography and margins (beside=%s)",beside=>{
    const data=structuredClone(seed),item=data.departments[1].items.ongoing[0];
    item.tables=[newTable(3,2,20000,1466),{...newTable(3,2,20000,1466),beside}];
    for(const table of item.tables) {
      table.cells[0].alignment="center";
      table.cells[0].paragraphs=[[{text:"검토 항목",bold:true,color:"blue"}]];
      table.cells[1].background="header";
      for(const cell of table.cells.slice(1))cell.alignment="left";
      table.cells[2].paragraphs=[[{text:"추진 계획",bold:false}]];
      table.cells[2].background="gray";
    }
    const output=readTemplate(generate(data)),body=output.items.get(item.id)!.body;
    const ps=paragraphs(body),tables=descendants(body,"hp:tbl");
    const tablePs=ps.filter(p=>descendants(p,"hp:tbl").length);
    expect(tablePs).toHaveLength(beside?1:2);
    expect(ps.at(-1)).toBe(ps.findLast(p=>descendants(p,"hp:tbl").length));
    expect(ps.filter(p=>!descendants(p,"hp:tbl").length && !paragraphText(p).trim())).toHaveLength(0);
    for(const table of tables) {
      expect(child(table,"hp:outMargin").attributes).toEqual({left:"0",right:"0",top:"0",bottom:"0"});
      expect(child(table,"hp:inMargin").attributes).toEqual({left:"0",right:"0",top:"0",bottom:"0"});
      expect(child(table,"hp:pos").attributes.treatAsChar).toBe("1");
      expect(child(table,"hp:sz").attributes.height).toBe("4398");
      for(const [i,c] of tableCells(table).entries()) {
        expect(c.attributes.hasMargin).toBe("1");
        expect(child(c,"hp:cellMargin").attributes).toEqual({left:"283",right:"283",top:"283",bottom:"283"});
        expect(child(c,"hp:cellSz").attributes.height).toBe("1466");
        const fill=descendants(output.header,"hh:borderFill").find(f=>f.attributes.id===c.attributes.borderFillIDRef)!;
        const address=child(c,"hp:cellAddr").attributes,span=child(c,"hp:cellSpan").attributes;
        for(const side of ["left","right","top","bottom"])
          expect(child(fill,`hh:${side}Border`).attributes).toEqual({
            type:(side==="left"&&address.colAddr==="0")||
              (side==="right"&&Number(address.colAddr)+Number(span.colSpan)===2)?"NONE":"SOLID",
            width:side==="top"&&address.rowAddr==="0"?"0.12 mm":"0.1 mm",color:"#000000"});
        const p=paragraphs(c)[0],property=output.paraProperties.get(p.attributes.paraPrIDRef)!;
        const expected=clone(output.paraProperties.get("31")!);
        setAttribute(expected,"id",property.attributes.id);
        setAttribute(child(expected,"hh:align"),"horizontal",i===0?"CENTER":"LEFT");
        expect(serialize(property)).toBe(serialize(expected));
        for(const run of children(p,"hp:run")) {
          const actual=clone(output.charProperties.get(run.attributes.charPrIDRef)!);
          const base=clone(output.charProperties.get("62")!);
          setAttribute(base,"id",actual.attributes.id);
          setAttribute(base,"textColor",i===0?"#0000FF":"#000000");
          expect(children(actual,"hh:bold")).toHaveLength(i<2?1:0);
          for(const p of [base,actual])p.children=p.children.filter(n=>typeof n==="string"||n.name!=="hh:bold");
          expect(serialize(actual)).toBe(serialize(base));
        }
      }
    }
    expect(child(body,"hp:cellMargin").attributes).toEqual({left:"140",right:"140",top:"138",bottom:"140"});
    expect(child(body,"hp:subList").attributes.vertAlign).toBe("CENTER");
    expect(child(body,"hp:cellSz").attributes.height).toBe(beside?"8863":"13811");
    const before=ps[ps.findIndex(p=>descendants(p,"hp:tbl").length)-1];
    expect(before.attributes.paraPrIDRef).toBe("54");
    for(const [index,p] of tablePs.entries()){
      const property=output.paraProperties.get(p.attributes.paraPrIDRef)!;
      const expected=clone(output.paraProperties.get("49")!);
      setAttribute(expected,"id",property.attributes.id);
      for(const [i,margin] of descendants(expected,"hh:margin").entries()){
        setAttribute(child(margin,"hc:prev"),"value",(index===0?408:0)*(i+1));
      }
      expect(serialize(property)).toBe(serialize(expected));
    }
  });
  test.each([2,3])("new groups of %i tables use the form's inline runs and unique IDs", count=>{
    const data=structuredClone(seed),item=data.departments[1].items.ongoing[2];
    item.tables=Array.from({length:count},(_,index)=>({
      ...structuredClone(item.tables[0]),id:`inline-${index}`,beside:index>0,
      columnWidths:item.tables[0].columnWidths.map(()=>1000),
    }));
    const output=readTemplate(generate(data)),body=output.items.get(item.id)!.body;
    const ps=paragraphs(body).filter(p=>descendants(p,"hp:tbl").length);
    expect(ps.map(p=>descendants(p,"hp:tbl").length)).toEqual([count]);
    const runs=children(ps[0],"hp:run");
    expect(runs.map(r=>r.attributes.charPrIDRef)).toEqual(count===2?["60","37","29","37"]:["60","37","29","37","29","37"]);
    expect(runs.filter(r=>paragraphText(element(`<hp:p>${serialize(r)}</hp:p>`))===" ")).toHaveLength(count);
    expect(descendants(ps[0],"hp:tbl").map(table=>child(table,"hp:pos").attributes.treatAsChar)).toEqual(Array(count).fill("1"));
    for(const name of ["hp:p","hp:tbl"]){
      const ids=descendants(output.section,name).map(node=>node.attributes.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  test("legacy omitted beside flags retain the original section XML and layout defaults",()=>{
    const data=structuredClone(seed);
    for(const department of data.departments)for(const items of Object.values(department.items))
      for(const item of items)for(const table of item.tables)delete table.beside;
    expect(strFromU8(unzipSync(generate(data))["Contents/section0.xml"]))
      .toBe(strFromU8(unzipSync(generate())["Contents/section0.xml"]));
    const original=readTemplate(template),styles=templateTableStyles(original);
    expect(styles.inline).toEqual({leading:450,gap:550,trailing:534,beforeSpacing:408,slack:399,
      bodyMargin:{left:140,right:140,top:138,bottom:140}});
    expect(styles.margin).toEqual({left:0,right:0});
    for(const id of ["item-166","item-228","item-290"]){
      const item=original.items.get(id)!;
      expect(item.data.tables.map(table=>table.beside)).toEqual([undefined,true]);
      expect(item.data.tables.map(table=>styles.tables[table.id].beside)).toEqual([false,true]);
      expect(bodyContentWidth(item)).toBe(51502);
    }
  });
  test("turning beside off splits the original pair without duplicate paragraph or table IDs",()=>{
    const data=structuredClone(seed),item=data.departments[2].items.ongoing[0];
    item.tables[1].beside=false;
    const output=readTemplate(generate(data));
    expect(paragraphs(output.items.get(item.id)!.body).map(p=>descendants(p,"hp:tbl").length).filter(Boolean)).toEqual([1,1]);
    for(const name of ["hp:p","hp:tbl"]){
      const ids=descendants(output.section,name).map(node=>node.attributes.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  test("a third table attached to an original pair joins the entire requested row",()=>{
    const data=structuredClone(seed),item=data.departments[2].items.ongoing[0];
    item.tables.push({...structuredClone(item.tables[0]),id:"third-inline",beside:true});
    for(const table of item.tables)table.columnWidths=table.columnWidths.map(()=>1000);
    const output=readTemplate(generate(data));
    expect(paragraphs(output.items.get(item.id)!.body).map(p=>descendants(p,"hp:tbl").length).filter(Boolean)).toEqual([3]);
  });
  test("export rejects grouped overflow using the moved item's actual destination width",()=>{
    const data=structuredClone(seed),item=structuredClone(data.departments[2].items.ongoing[0]);
    item.id="copied-pair";item.templateItemId="item-166";
    data.departments[0].items.thisWeek.push(item);
    expect(()=>generate(data)).toThrow("앞 표와 합친 폭");
  });
  test.each([1,2])("new row of %i tables reserves the original trailing space",count=>{
    const data=structuredClone(seed),item=data.departments[1].items.ongoing[0];
    item.tables=Array.from({length:count},(_,i)=>({...newTable(3,4,count===1?50802:25126,1466),beside:i>0}));
    if(count===1){
      const output=readTemplate(generate(data));
      expect(child(descendants(output.items.get(item.id)!.body,"hp:tbl")[0],"hp:sz").attributes.width).toBe("50801");
    }else expect(()=>generate(data)).toThrow("폭");
  });
  test("export fitting uses the destination cell margins for a moved single table",()=>{
    const data=structuredClone(seed),item=structuredClone(data.departments[1].items.ongoing[2]);
    item.id="copied-single";item.templateItemId="item-115";
    data.departments[0].items.thisWeek.push(item);
    const output=section(generate(data));
    const main=descendants(output,"hp:tbl").find(table=>table.attributes.id==="1178668902")!;
    const body=child(children(main,"hp:tr").at(-2)!,"hp:tc");
    const destination=children(children(main,"hp:tr").at(-2)!,"hp:tc")[1];
    expect(child(destination,"hp:cellMargin").attributes).toMatchObject({left:"138",right:"138"});
    expect(Number(child(descendants(destination,"hp:tbl")[0],"hp:sz").attributes.width)).toBe(24341);
    expect(descendants(body,"hp:tbl")).toHaveLength(0);
  });
  test("colored cells share fills by original border and color while preserving all other markup",()=>{
    const data=structuredClone(seed),item=data.departments[2].items.ongoing[0],table=item.tables[0];
    const grayIndexes=[2,4].map(column=>table.cells.findIndex(cell=>cell.row===1 && cell.column===column));
    for(const index of grayIndexes)table.cells[index].background="gray";
    const bodyCell=table.cells.find(cell=>cell.row===2 && cell.column===0)!;
    bodyCell.background="header";
    const original=readTemplate(template),output=readTemplate(generate(data));
    const cells=tableCells(descendants(output.items.get(item.id)!.body,"hp:tbl")[0]);
    const originalCells=tableCells(original.tables.get(table.id)!);
    const originalFills=descendants(original.header,"hh:borderFill"),fills=descendants(output.header,"hh:borderFill");
    expect(cells[grayIndexes[0]].attributes.borderFillIDRef).toBe(cells[grayIndexes[1]].attributes.borderFillIDRef);
    expect(fills).toHaveLength(originalFills.length+2);
    expect(descendants(output.header,"hh:borderFills")[0].attributes.itemCnt).toBe(String(fills.length));
    for(const [index,color] of [[grayIndexes[0],"#F2F2F2"],[table.cells.indexOf(bodyCell),"#D9D9D9"]] as const){
      const base=originalFills.find(fill=>fill.attributes.id===originalCells[index].attributes.borderFillIDRef)!;
      const actual=fills.find(fill=>fill.attributes.id===cells[index].attributes.borderFillIDRef)!;
      expect(actual.attributes.id).not.toBe(base.attributes.id);
      expect(descendants(actual,"hc:winBrush")[0].attributes.faceColor).toBe(color);
      const expected=clone(base);
      setAttribute(expected,"id",actual.attributes.id);
      const brush=descendants(expected,"hc:winBrush")[0];
      if(brush){
        setAttribute(brush,"faceColor",color);
        expect(serialize(actual)).toBe(serialize(expected));
      }else{
        const withoutFill=clone(actual);
        withoutFill.children=withoutFill.children.filter(node=>typeof node==="string"||node.name!=="hc:fillBrush");
        expect(serialize(withoutFill)).toBe(serialize(expected));
      }
    }
    expect(cells[0].attributes.borderFillIDRef).toBe(originalCells[0].attributes.borderFillIDRef);
  });
  test.each(["missing-fill","missing-win"] as const)("coloring creates a missing brush (%s) while retaining the borders",kind=>{
    const fixture=readTemplate(template),item=fixture.data.departments[2].items.ongoing[0],table=item.tables[0];
    const baseId=tableCells(fixture.tables.get(table.id)!)[0].attributes.borderFillIDRef;
    const fill=descendants(fixture.header,"hh:borderFill").find(fill=>fill.attributes.id===baseId)!;
    if(kind==="missing-fill")fill.children=fill.children.filter(node=>typeof node==="string"||node.name!=="hc:fillBrush");
    else child(fill,"hc:fillBrush").children=[];
    fixture.entries["Contents/header.xml"]=strToU8(serialize(fixture.header));
    table.cells[0].background="gray";
    const output=readTemplate(generateHwpx(fixture.data,zipSync(fixture.entries)));
    const outputCell=tableCells(descendants(output.items.get(item.id)!.body,"hp:tbl")[0])[0];
    const colored=descendants(output.header,"hh:borderFill").find(fill=>fill.attributes.id===outputCell.attributes.borderFillIDRef)!;
    expect(descendants(colored,"hc:winBrush")[0].attributes.faceColor).toBe("#F2F2F2");
    expect(children(colored).filter(node=>node.name!=="hc:fillBrush").map(serialize))
      .toEqual(children(fill).filter(node=>node.name!=="hc:fillBrush").map(serialize));
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
      expect(result.attributes.pageBreak).toBe(outer.attributes.pageBreak);
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
      expect(outer.attributes.pageBreak).toBe(readTemplate(template).departments[1].ongoing.attributes.pageBreak);
    }
    const data = structuredClone(seed);
    const items = data.departments[1].items.ongoing;
    items[0].tables.push({ ...structuredClone(items[2].tables[0]), id: "added-endpoint" });
    items[1].content = [];
    items[1].notes = [];
    const doc = section(generate(data));
    const outer = descendants(doc, "hp:tbl").find((t) => t.attributes.id === "1233225380")!;
    const bodies = tableCells(outer).filter((c) => ["108", "111"].includes(paragraphs(c)[0].attributes.id));
    expect(bodies.map((c) => child(c, "hp:cellSz").attributes.height)).toEqual(["8311", "0"]);
    expect(bodies.map((c) => child(c, "hp:cellMargin").attributes.top)).toEqual(["138", "566"]);
    expect(bodies.map((c) => child(c, "hp:cellMargin").attributes.bottom)).toEqual(["140", "566"]);
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
  test("every outer table retains its template page-break mode after growth or shrinkage", () => {
    const original = readTemplate(template);
    for (const grow of [true, false]) {
      const data = structuredClone(seed);
      for (const department of data.departments) for (const items of Object.values(department.items))
        items[0].content = grow ? Array.from({ length: 43 }, (_, i) => [{ text: ` ○ 내용 ${i + 1}` }]) : [];
      const result = readTemplate(generate(data));
      for (const [i, department] of result.departments.entries())
        for (const key of ["main", "ongoing"] as const)
          expect(department[key].attributes.pageBreak).toBe(original.departments[i][key].attributes.pageBreak);
    }
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
    const body=tableCells(main).find(cell=>descendants(cell,"hp:tbl").includes(nested))!;
    expect(child(body,"hp:cellMargin").attributes).toEqual({left:"140",right:"140",top:"138",bottom:"140"});
    expect(Number(child(nested,"hp:sz").attributes.width)+450+534+280)
      .toBe(Number(child(body,"hp:cellSz").attributes.width));
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
