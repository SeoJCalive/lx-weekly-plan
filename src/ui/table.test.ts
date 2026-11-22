import { expect, test } from "bun:test";
import { seed } from "../shared/seed";
import { validateTable } from "../shared/table-validation";
import { merge, newTable, paint, rectangle, resize, selectedRange, split, sumSelection } from "./table";
import { tableCellStyle } from "../shared/table-style";
import { templateTableStyles } from "../server/table-style";
import { readTemplate } from "../server/template";

test("merge and split preserve rectangular coverage and never discard neighbouring content",()=>{
  const t=newTable(3,4,50001,1282), range=rectangle("B2:A1",t), m=merge(t,range);
  expect(m.cells[0]).toMatchObject({rowSpan:2,colSpan:2});
  expect(()=>validateTable(m)).not.toThrow();
  expect(split(m,m.cells[0])).toEqual(t);
  expect(()=>merge(m,rectangle("B2:C2",m))).toThrow("기존 병합");
  t.cells[1].paragraphs=[[{text:"기존 내용"}]];
  expect(()=>merge(t,range)).toThrow("먼저 옮기세요");
});
test("reversed drag includes complete cells and SUM uses an adjacent empty cell",()=>{
  const t=newTable(3,3,24000,1282),r=selectedRange(t.cells[1],t.cells[0]);
  expect(r).toEqual(rectangle("A1:B1",t));
  expect(sumSelection(t,r).cells[2].formula).toEqual(r);
  t.cells[2].paragraphs=[[{text:"기존 내용"}]];
  expect(sumSelection(t,r).cells[3].formula).toEqual(r);
  t.cells[3].paragraphs=[[{text:"유지"}]];
  expect(()=>sumSelection(t,r)).toThrow("빈 셀");
  const m=merge(t,r);
  expect(selectedRange(m.cells[0],m.cells[0])).toEqual(r);
  const column=selectedRange(t.cells[0],t.cells[3]);
  expect(sumSelection(t,column).cells[6].formula).toEqual(column);
});
test("row/column edits keep seed widths proportional, preserve SUM addresses or explain refusal",()=>{
  const t=seed.departments[1].items.ongoing[2].tables[0], grown=resize(t,"column",null);
  expect(grown.columnWidths.reduce((a,b)=>a+b)).toBe(t.columnWidths.reduce((a,b)=>a+b));
  expect(grown.columnWidths[0]/grown.columnWidths[2]).toBeCloseTo(t.columnWidths[0]/t.columnWidths[2],3);
  expect(()=>resize(t,"column",0)).toThrow("병합");
  const a=newTable(2,3,24000,1282);
  a.cells[5].formula=rectangle("B1",a);
  expect(()=>resize(a,"row",0)).toThrow("합계");
  const b=resize(a,"column",0);
  expect(b.cells.at(-1)!.formula).toEqual(rectangle("A1",b));
  expect(()=>validateTable(b)).not.toThrow();
});
test("new tables shade only their header and added rows and columns inherit their neighbour", async()=>{
  const styles=templateTableStyles(readTemplate(new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer())));
  const table=newTable(3,4,49000,1282);
  expect(table.cells.map(c=>tableCellStyle(table,c,styles).background)).toEqual([
    "#E5E5E5","#E5E5E5","#E5E5E5","#E5E5E5",
    "#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF",
    "#FFFFFF","#FFFFFF","#FFFFFF","#FFFFFF",
  ]);
  const source=seed.departments[2].items.ongoing[0].tables[0];
  const grown=resize(resize(source,"row",null),"column",null);
  for(const c of grown.cells){
    const original=source.cells.find(s=>s.row<=Math.min(c.row,2) && Math.min(c.row,2)<s.row+s.rowSpan &&
      s.column<=Math.min(c.column,7) && Math.min(c.column,7)<s.column+s.colSpan)!;
    expect(tableCellStyle(grown,c,styles)).toEqual(tableCellStyle(source,original,styles));
  }
  const oneRow=newTable(1,2,24000,1282),next=resize(oneRow,"row",null);
  expect(next.cells.every(c=>tableCellStyle(next,c,styles).background==="#E5E5E5")).toBe(true);
  const removed=resize(table,"row",0);
  expect(removed.cells.every(c=>tableCellStyle(removed,c,styles).background==="#FFFFFF")).toBe(true);
});

test("painting changes only the selected cells and clearing restores their form backgrounds",()=>{
  const table=newTable(3,3,24000,1282),range=rectangle("A2:B2",table);
  const painted=paint(table,range,"gray");
  expect(painted.cells.map(c=>c.background)).toEqual([
    undefined,undefined,undefined,"gray","gray",undefined,undefined,undefined,undefined,
  ]);
  expect(paint(painted,range)).toEqual(table);
  expect(table.cells.every(c=>c.background===undefined)).toBe(true);
});

test("merge, split and resizing retain painted cells while new cells inherit only the form style",()=>{
  const table=newTable(3,3,24000,1282),range=rectangle("A2:B2",table);
  const painted=paint(table,range,"gray"),merged=merge(painted,range);
  expect(merged.cells.find(c=>c.row===1 && c.column===0)?.background).toBe("gray");
  const unmerged=split(merged,merged.cells.find(c=>c.row===1 && c.column===0)!);
  expect(unmerged.cells.filter(c=>c.row===1 && c.column<2).map(c=>c.background)).toEqual(["gray","gray"]);
  const grown=resize(resize(painted,"row",null),"column",null);
  expect(grown.cells.filter(c=>c.row===1 && c.column<2).map(c=>c.background)).toEqual(["gray","gray"]);
  expect(grown.cells.filter(c=>c.row===3 || c.column===3).every(c=>c.background===undefined)).toBe(true);
  const shifted=resize(resize(painted,"row",0),"column",2);
  expect(shifted.cells.filter(c=>c.row===0).map(c=>c.background)).toEqual(["gray","gray"]);
});
