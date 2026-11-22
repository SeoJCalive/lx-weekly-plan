import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seed } from "../shared/seed";
import { tableCellStyle } from "../shared/table-style";
import { templateTableStyles } from "../server/table-style";
import { paragraphs, readTemplate, tableCells } from "../server/template";
import { generateHwpx } from "../server/hwpx";
import { children, descendants, parseXml } from "../server/xml";
import { Nested, TableRows } from "./Preview";
import { newTable, resize } from "./table";

test("seed, new and expanded table cell styles agree in the shared rule, preview and output", async()=>{
  const template=new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
  const styles=templateTableStyles(readTemplate(template));
  const seedTable=seed.departments[1].items.ongoing[2].tables[0],fresh=newTable(4,5,24000,1282);
  for(const table of [seedTable,seed.departments[2].items.ongoing[0].tables[0],fresh,resize(resize(seedTable,"row",null),"column",null)]){
    const data=structuredClone(seed),item=data.departments[1].items.ongoing[2];
    item.tables=[table];
    const output=readTemplate(generateHwpx(data,template));
    const cells=tableCells(descendants(output.items.get(item.id)!.body,"hp:tbl")[0]);
    const preview=parseXml(renderToStaticMarkup(createElement(Nested,{table})));
    const screenCells=descendants(preview,"td");
    expect(screenCells).toHaveLength(table.cells.length);
    for(const [i,cell] of table.cells.entries()){
      const expected=tableCellStyle(table,cell,styles);
      expect(cells[i].attributes.borderFillIDRef).toBe(expected.borderFillId);
      const run=children(paragraphs(cells[i])[0],"hp:run")[0],property=output.charProperties.get(run.attributes.charPrIDRef)!;
      expect(Number(property.attributes.height)/100).toBe(expected.fontSize);
      expect(children(property,"hh:bold").length>0).toBe(cell.paragraphs[0]?.[0]?.bold??expected.bold);
      expect(screenCells[i].attributes.style).toContain(`font-size:${expected.fontSize}pt`);
      expect(screenCells[i].attributes.style).toContain(`background:${expected.background}`);
      expect(screenCells[i].attributes.style).toContain(`font-weight:${expected.bold?700:400}`);
    }
  }
});

test.each([
  ["header", "#D9D9D9"],
  ["gray", "#F2F2F2"],
] as const)("preview shows the chosen %s fill on a body cell", (background,color)=>{
  const table=newTable(2,2,24000,1282);
  table.cells[2].background=background;
  const preview=parseXml(renderToStaticMarkup(createElement(Nested,{table})));
  const cells=descendants(preview,"td");
  expect(cells[2].attributes.style).toContain(`background:${color}`);
  expect(cells[3].attributes.style).toContain("background:#FFFFFF");
});

test("preview preserves legacy form rows and starts a new row when beside is explicitly off",()=>{
  const original=structuredClone(seed.departments[2].items.ongoing[0].tables);
  delete original[1].beside;
  const standalone=newTable(2,2,12000,1282);
  const rowCounts=(tables:typeof original)=>descendants(
    parseXml(renderToStaticMarkup(createElement(TableRows,{tables}))),"div")
    .filter(n=>n.attributes.class==="table-row").map(n=>descendants(n,"table").length);
  expect(rowCounts([...original,standalone])).toEqual([2,1]);
  expect(rowCounts([original[0],{...original[1],beside:false},standalone])).toEqual([1,1,1]);
  expect(rowCounts([standalone,{...standalone,id:"second",beside:true},
    {...standalone,id:"third",beside:true}])).toEqual([3]);
});
