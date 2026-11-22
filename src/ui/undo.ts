import { useRef } from "react";

export type Caret = {cell?:string;endCell?:string;start:number;end:number};
export type Step<T> = {value:T;caret:Caret};
export type Typing = {time:number;caret:Caret;newWord:boolean};
export type Undo<T> = {past:Step<T>[];future:Step<T>[];typing?:Typing};

export const typingPause = 1000;
const limit = 100;
const sameCaret = (a:Caret,b:Caret) => a.cell===b.cell && a.start===b.start && a.end===b.end;

/** Keep the state before a change. Typing joins the previous step until a pause, a caret jump or a new word. */
export function record<T>(h:Undo<T>,before:Step<T>,typing?:Typing):Undo<T> {
  const last=h.typing;
  const join=!!typing && !!last && !typing.newWord && typing.time-last.time<typingPause && sameCaret(before.caret,last.caret);
  return {past:join ? h.past : [...h.past,before].slice(-limit),future:[],typing};
}
export function undo<T>(h:Undo<T>,current:Step<T>):[Undo<T>,Step<T>]|undefined {
  const step=h.past.at(-1);
  return step && [{past:h.past.slice(0,-1),future:[...h.future,current]},step];
}
export function redo<T>(h:Undo<T>,current:Step<T>):[Undo<T>,Step<T>]|undefined {
  const step=h.future.at(-1);
  return step && [{past:[...h.past,current],future:h.future.slice(0,-1)},step];
}
export function startsWord(prev:string,next:string) {
  const added=next.length-prev.length;
  if (added<=0) return false;
  let left=0;
  while (left<prev.length && prev[left]===next[left]) left++;
  if (next.slice(left+added)!==prev.slice(left)) return false;
  return /^\S/.test(next.slice(left)) && (left===0 || /\s/.test(prev[left-1]));
}
/** `code` keeps the shortcut working while a Korean input method changes `key`. */
export function shortcut(e:{ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey:boolean;code:string}) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.code==="KeyZ") return e.shiftKey ? "redo" : "undo";
  if (e.code==="KeyY" && !e.shiftKey) return "redo";
}

export function useUndo<T>() {
  const history=useRef<Undo<T>>({past:[],future:[]});
  return {
    record(before:Step<T>,typing?:Typing) {history.current=record(history.current,before,typing);},
    keyDown(e:React.KeyboardEvent,current:()=>Step<T>,restore:(step:Step<T>)=>void) {
      const way=shortcut(e);
      if (!way || e.nativeEvent.isComposing) return;
      e.preventDefault();
      const result=(way==="undo" ? undo : redo)(history.current,current());
      if (result) {history.current=result[0];restore(result[1]);}
    },
  };
}
