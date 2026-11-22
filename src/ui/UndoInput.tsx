import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { startsWord, useUndo, type Caret } from "./undo";

const caretOf=(el:HTMLInputElement):Caret=>({start:el.selectionStart??0,end:el.selectionEnd??0});
export function UndoInput({value,change,...rest}:{value:string;change:(value:string)=>void}&Omit<InputHTMLAttributes<HTMLInputElement>,"value"|"onChange">) {
  const field=useRef<HTMLInputElement>(null),before=useRef<Caret>({start:0,end:0}),caret=useRef<Caret|null>(null);
  const history=useUndo<string>();
  useLayoutEffect(()=>{
    const el=field.current!;
    const input=()=>{before.current=caretOf(el);};
    el.addEventListener("beforeinput",input);return ()=>el.removeEventListener("beforeinput",input);
  },[]);
  useLayoutEffect(()=>{
    if(caret.current){field.current!.setSelectionRange(caret.current.start,caret.current.end);caret.current=null;}
  });
  return <input {...rest} ref={field} value={value}
    onChange={e=>{
      history.record({value,caret:before.current},{time:e.timeStamp,caret:caretOf(e.target),newWord:startsWord(value,e.target.value)});
      change(e.target.value);
    }}
    onKeyDown={e=>{if(!rest.readOnly)history.keyDown(e,()=>({value,caret:caretOf(field.current!)}),step=>{caret.current=step.caret;change(step.value);});}}/>;
}
