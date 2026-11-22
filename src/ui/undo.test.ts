import { expect, test } from "bun:test";
import { record, redo, shortcut, startsWord, undo, type Undo } from "./undo";

const at = (start:number,end=start) => ({start,end});
test("continuous typing is one step; a pause, a caret jump or a new word starts another", () => {
  let h:Undo<string> = {past:[],future:[]};
  h=record(h,{value:"",caret:at(0)},{time:0,caret:at(1),newWord:true});
  h=record(h,{value:"가",caret:at(1)},{time:300,caret:at(2),newWord:false});
  expect(h.past.map(s=>s.value)).toEqual([""]);
  h=record(h,{value:"가나",caret:at(2)},{time:1500,caret:at(3),newWord:false});
  h=record(h,{value:"가나다",caret:at(0)},{time:1600,caret:at(1),newWord:false});
  h=record(h,{value:"x가나다",caret:at(1)},{time:1700,caret:at(2),newWord:false});
  h=record(h,{value:"x가나다 ",caret:at(5)},{time:1800,caret:at(6),newWord:true});
  expect(h.past.map(s=>s.value)).toEqual(["","가나","가나다","x가나다 "]);
});
test("a button action is always its own step, and undo and redo carry the caret both ways", () => {
  let h:Undo<string> = {past:[],future:[]};
  h=record(h,{value:"가",caret:at(0)},{time:0,caret:at(1),newWord:true});
  h=record(h,{value:"가나",caret:at(0,2)});
  h=record(h,{value:"*가나",caret:at(0,3)});
  expect(h.past.length).toBe(3);
  const [back,step]=undo(h,{value:"**가나",caret:at(0,4)})!;
  expect(step).toEqual({value:"*가나",caret:at(0,3)});
  const [again,next]=redo(back,step)!;
  expect(next).toEqual({value:"**가나",caret:at(0,4)});
  expect(again.past).toEqual(h.past);
  expect(redo(again,next)).toBeUndefined();
  expect(record(back,step).future).toEqual([]);
  expect(undo({past:[],future:[]},step)).toBeUndefined();
});
test("words start after a space, and an input method replacing a syllable stays inside the word", () => {
  expect(startsWord("일정","일정 ")).toBe(false);
  expect(startsWord("일정 ","일정 ㅇ")).toBe(true);
  expect(startsWord("일정 ㅇ","일정 와")).toBe(false);
  expect(startsWord("일정 와","일정 완")).toBe(false);
  expect(startsWord("","○")).toBe(true);
  expect(startsWord("ab","a")).toBe(false);
});
test("Ctrl or Cmd with Z undoes; with Shift+Z or Y it redoes", () => {
  const key=(code:string,mods:Partial<Record<"ctrlKey"|"metaKey"|"shiftKey"|"altKey",boolean>>)=>
    shortcut({ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,code,...mods});
  expect([key("KeyZ",{ctrlKey:true}),key("KeyZ",{metaKey:true}),key("KeyZ",{ctrlKey:true,shiftKey:true}),
    key("KeyY",{ctrlKey:true}),key("KeyZ",{}),key("KeyZ",{ctrlKey:true,altKey:true})]).toEqual(["undo","undo","redo","redo",undefined,undefined]);
});
