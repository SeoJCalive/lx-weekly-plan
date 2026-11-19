import { useRef, useState } from "react";
import { type RichText } from "../shared/weekly-plan";
import { editLines, editText, emphasize, linesText, type Emphasis } from "./text";

export function EmphasisField({id,label,lines,rows,readOnly,change}:{id:string;label:string;lines:RichText[];
  rows?:number;readOnly:boolean;change:(lines:RichText[])=>void}) {
  const field=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null);
  const [range,setRange]=useState([0,0]);
  const attrs={id,readOnly,value:linesText(lines),ref:(el:HTMLInputElement|HTMLTextAreaElement|null)=>{field.current=el;},
    onSelect:()=>{const el=field.current!;setRange([el.selectionStart!,el.selectionEnd!]);},
    onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>change(rows ? editLines(lines,e.target.value) :
      [editText(lines[0],e.target.value,true)])};
  function apply(mark:Emphasis) {
    if (readOnly || range[0]===range[1])return;
    change(emphasize(lines,range[0],range[1],mark));
    field.current!.focus();field.current!.setSelectionRange(range[0],range[1]);
  }
  return <div className="emphasis-field"><div className="field-heading"><label htmlFor={id}>{label}</label>
    {!readOnly && <div className="mark-tools" role="group" aria-label={`${label} 선택 글자 강조`}>
      {([["bold","굵게"],["blue","파랑"],["red","빨강"],["clear","강조 해제"]] as const).map(([mark,text])=>
        <button type="button" key={mark} disabled={range[0]===range[1]} onMouseDown={e=>e.preventDefault()}
          onClick={()=>apply(mark)}>{text}</button>)}</div>}</div>
    {rows ? <textarea {...attrs} rows={rows}/> : <input {...attrs}/>}</div>;
}
