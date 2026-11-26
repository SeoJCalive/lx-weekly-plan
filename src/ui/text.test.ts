import { expect, test } from "bun:test";
import { editLines, editText, emphasize, linesText, marked, selectionMarks, sameLine } from "./text";
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
  expect(selectionMarks(result,1,4)).toEqual(["red"]);
  expect(selectionMarks(result,2,3)).toEqual([]);
  expect(selectionMarks(result,1,1)).toEqual([]);
  expect(emphasize(result,1,2,"bold")[0][1]).toEqual({text:"뒤",bold:false,color:"red"});
  const cleared=emphasize(result,1,4,"red");
  expect(cleared[0][1].bold).toBe(true);
  expect(selectionMarks(cleared,1,4)).toEqual([]);
  expect(selectionMarks(emphasize(result,1,4,"bold"),1,4)).toEqual(["bold","red"]);
  expect(sameLine(emphasize(emphasize(lines,0,1,"red"),0,1,"red")[0],lines[0])).toBe(true);
  expect(sameLine(result[0],lines[0])).toBe(false);
});
test("splitting and joining paragraphs preserve the untouched emphasis on both sides",()=>{
  const old:RichText[]=[[{text:"앞뒤",color:"red",bold:true}],[{text:"다음",color:"blue"}]];
  const split=editLines(old,"앞\n뒤\n다음");
  expect(split).toEqual([[{text:"앞",color:"red",bold:true}],[{text:"뒤",color:"red",bold:true}],old[1]]);
  expect(split[2]).toBe(old[1]);
  expect(editLines(old,"앞뒤다음")).toEqual([[...old[0],...old[1]]]);
  expect(editLines(old,"앞새음")).toEqual([[
    {text:"앞",color:"red",bold:true},{text:"새",color:"red",bold:true},{text:"음",color:"blue"},
  ]]);
});
test("paragraph edits retain empty and trailing lines without inventing text",()=>{
  for(const value of ["","\n","a\n","a\n\nb","\n\n"]) {
    const edited=editLines([[{text:"old",color:"blue"}]],value);
    expect(linesText(edited)).toBe(value);
    expect(editLines(edited,value)).toBe(edited);
  }
  expect(editLines([[{text:"a"}]],"a\n")).toEqual([[{text:"a"}],[]]);
  expect(editLines([[{text:"a"}],[]],"a")).toEqual([[{text:"a"}]]);
});
test("existing hyphen markers and their literal whitespace are kept in notes",()=>{
  const lines:RichText[]=[
    [{text:"   - "},{text:"참고",bold:true}],
    [{text:"\u3000-\u3000"},{text:"다음",color:"red"}],
    [{text:"   "}],
  ];
  expect(marked(lines,[],true)).toEqual(lines);
  marked(lines,[],true).forEach((line,i)=>expect(line).toBe(lines[i]));
});
