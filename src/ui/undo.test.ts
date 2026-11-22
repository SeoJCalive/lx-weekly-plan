import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { record, redo, shortcut, startsWord, undo, useUndo, type Step, type Undo } from "./undo";

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

function keyEvent(code:string):React.KeyboardEvent {
  const keys={altKey:false,ctrlKey:true,metaKey:false,shiftKey:false,charCode:0,keyCode:0,
    code,key:code==="KeyZ"?"z":"y",location:0,repeat:false,which:0,getModifierState:()=>false};
  const nativeEvent=Object.assign(new Event("keydown",{cancelable:true}),keys,{
    isComposing:false,detail:0,view:null,initUIEvent(){},initKeyboardEvent(){},
    DOM_KEY_LOCATION_STANDARD:0,DOM_KEY_LOCATION_LEFT:1,DOM_KEY_LOCATION_RIGHT:2,DOM_KEY_LOCATION_NUMPAD:3,
  } as const);
  return {...keys,nativeEvent,locale:"",detail:0,bubbles:false,cancelable:true,defaultPrevented:false,eventPhase:0,
    isTrusted:false,target:new EventTarget(),timeStamp:0,type:"keydown",
    get currentTarget():never {throw new TypeError("This keyboard fixture has no DOM target");},
    get view():never {throw new TypeError("This keyboard fixture has no DOM view");},
    preventDefault:()=>nativeEvent.preventDefault(),stopPropagation:()=>nativeEvent.stopPropagation(),
    isDefaultPrevented:()=>nativeEvent.defaultPrevented,isPropagationStopped:()=>nativeEvent.cancelBubble,persist(){}};
}

test.each([
  {way:"undo",code:"KeyZ",target:"A",retry:["A","A","B","C","D","D"],keys:["KeyZ","KeyZ","KeyY","KeyY","KeyY","KeyY"]},
  {way:"redo",code:"KeyY",target:"C",retry:["C","D","D","C","B","A","A"],keys:["KeyY","KeyY","KeyY","KeyZ","KeyZ","KeyZ","KeyZ"]},
])("rejected $way preserves both histories and retries the same step", ({code,target,retry,keys}) => {
  const captured:ReturnType<typeof useUndo<string>>[]=[];
  function Capture() {captured.push(useUndo<string>());return null;}
  renderToStaticMarkup(createElement(Capture));
  const history=captured[0];
  if(!history)throw new TypeError("React did not render the hook capture");
  const steps=["A","B","C","D"].map((value,i)=>({value,caret:{cell:`A${i+1}`,start:i,end:i+1}}));
  let current:Step<string>=steps[3];
  const restore=(step:Step<string>)=>{current=step;};
  const press=(key:string)=>history.keyDown(keyEvent(key),()=>current,restore);
  steps.slice(0,3).forEach(step=>history.record(step));
  press("KeyZ");
  press("KeyZ");
  const rejected:Step<string>[]=[];
  const error=new RangeError("Table group exceeds the body width");

  expect(()=>history.keyDown(keyEvent(code),()=>current,step=>{rejected.push(step);throw error;})).toThrow(error);

  expect(rejected).toEqual(steps.filter(step=>step.value===target));
  expect(current).toEqual(steps[1]);
  expect(keys.map(key=>{press(key);return current;})).toEqual(retry.flatMap(value=>steps.filter(step=>step.value===value)));
});
