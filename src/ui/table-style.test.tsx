import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seed } from "../shared/seed";
import { tableCellStyle } from "../shared/table-style";
import { templateTableStyles } from "../server/table-style";
import { paragraphs, readTemplate, tableCells } from "../server/template";
import { generateHwpx } from "../server/hwpx";
import { child, children, descendants, parseXml } from "../server/xml";
import { Nested, TableRows, tableGeometry } from "./Preview";
import { merge, newTable, resize, split } from "./table";
import { TableEditor } from "./TableEditor";

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
      const fill=descendants(output.header,"hh:borderFill").find(f=>f.attributes.id===cells[i].attributes.borderFillIDRef)!;
      for(const side of ["left","right","top","bottom"] as const){
        const border=child(fill,`hh:${side}Border`).attributes;
        expect(`${border.width.replace(" ","")} ${border.type.toLowerCase()} ${border.color}`).toBe(expected.borders[side]);
      }
      const color=descendants(fill,"hc:winBrush")[0]?.attributes.faceColor;
      expect(color && color!=="none" ? color : "#FFFFFF").toBe(expected.background);
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

test("new table geometry fills the body with form-height centered padded cells",()=>{
  const geometry=tableGeometry("item-108","department-2/ongoing");
  const table=newTable(3,4,geometry.width,geometry.height);
  expect(table.rowHeights).toEqual([1466,1466,1466]);
  expect(geometry.bodyWidth).toBe(51785);
  expect(table.columnWidths.reduce((a,b)=>a+b,0)).toBe(50801);
  expect(table.cells.every(c=>c.alignment==="center")).toBe(true);
  const preview=parseXml(renderToStaticMarkup(createElement(Nested,{table})));
  for(const [index,cell] of descendants(preview,"td").entries()) {
    expect(cell.attributes.style).toContain("padding:3.7733333333333334px");
    expect(cell.attributes.style).toContain("line-height:1");
    expect(cell.attributes.style).toContain("letter-spacing:0em");
    expect(cell.attributes.style).toContain("한양중고딕");
    for(const side of ["left","right","top","bottom"])
      expect(cell.attributes.style).toContain(`border-${side}:${side==="top"&&index<4?"0.12":"0.1"}mm ${
        (side==="left"&&index%4===0)||(side==="right"&&index%4===3)?"none":"solid"} #000000`);
  }
});

test("new cell borders follow current edges after merging, splitting and column changes",async()=>{
  const template=new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
  const fresh=newTable(3,4,24000,1466);
  fresh.cells[0].background="header";fresh.cells[3].background="gray";
  const merged=merge(fresh,{type:"SUM",from:{row:0,column:0},to:{row:0,column:3}});
  const separated=split(merged,merged.cells[0]);
  for(const table of [fresh,merged,separated,resize(separated,"column",null),resize(separated,"column",1)]){
    const data=structuredClone(seed),item=data.departments[1].items.ongoing[0];
    item.tables=[table];
    const output=readTemplate(generateHwpx(data,template));
    const cells=tableCells(descendants(output.items.get(item.id)!.body,"hp:tbl")[0]);
    const screenCells=descendants(parseXml(renderToStaticMarkup(createElement(Nested,{table}))),"td");
    for(const [index,cell] of table.cells.entries()){
      const fill=descendants(output.header,"hh:borderFill").find(f=>f.attributes.id===cells[index].attributes.borderFillIDRef)!;
      for(const side of ["left","right","top","bottom"]){
        const type=(side==="left"&&cell.column===0)||(side==="right"&&cell.column+cell.colSpan===table.columns)?"NONE":"SOLID";
        const width=side==="top"&&cell.row===0?"0.12 mm":"0.1 mm";
        expect(child(fill,`hh:${side}Border`).attributes).toEqual({type,width,color:"#000000"});
        expect(screenCells[index].attributes.style).toContain(`border-${side}:${width.replace(" ","")} ${type.toLowerCase()} #000000`);
      }
    }
  }
});

test.each([[1,50801,1],[2,25125,1],[2,25126,2],[3,16567,1]])("new table width choice %i preserves trailing space and gives the last part the remainder",async(parts,width,index)=>{
  const template=new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer());
  const styles=templateTableStyles(readTemplate(template));
  const geometry=tableGeometry("item-108","department-2/ongoing"),table=newTable(3,4,width,geometry.height);
  const editor=parseXml(renderToStaticMarkup(createElement(TableEditor,{table,index,styles,bodyWidth:geometry.bodyWidth,
    change:()=>{},remove:()=>{},validate:()=>{}})));
  expect(descendants(editor,"option").find(option=>"selected" in option.attributes)?.attributes.value).toBe(String(parts));
});
