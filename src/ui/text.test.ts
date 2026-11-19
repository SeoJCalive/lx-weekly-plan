import { expect, test } from "bun:test";
import { editLines, editText, emphasize, marked } from "./text";
import type { RichText } from "../shared/weekly-plan";

test("editing beside an emphasized word preserves the untouched runs", () => {
  const old: RichText = [{text:"일정 ",bold:true},{text:"완료",color:"blue",bold:true},{text:" 확인",color:"red"}];
  expect(editText(old,"주간 일정 완료 확인").slice(-3)).toEqual(old);
  expect(editText(old,"일정 완료 확인")).toBe(old);
});
test("inserting a line does not flatten or move formatting onto the following line", () => {
  const old: RichText[] = [[{text:"○ 원문"}],[{text:"추가",color:"red",bold:true}]];
  const edited=editLines(old,"○ 원문\n신규\n추가");
  expect(edited[2]).toBe(old[1]);
  expect(marked(edited,old,false)).toEqual([old[0],[{text:" ○ "},{text:"신규",bold:false}],old[1]]);
  expect(marked([[{text:"첫 줄"}],[{text:"둘째 줄"}]],[],true).map(line=>line[0].text)).toEqual([" * "," ** "]);
});
test("a textarea selection spans lines without replacing neighbouring emphasis",()=>{
  const lines:RichText[]=[[{text:"앞뒤",bold:true}],[{text:"파랑",color:"blue"}]];
  const result=emphasize(lines,1,4,"red");
  expect(result).toEqual([[{text:"앞",bold:true},{text:"뒤",bold:true,color:"red"}],
    [{text:"파",color:"red"},{text:"랑",color:"blue"}]]);
  expect(emphasize(result,1,2,"clear")[0][1]).toEqual({text:"뒤",bold:false});
});
