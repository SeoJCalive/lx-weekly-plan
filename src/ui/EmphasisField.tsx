import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type RichText } from "../shared/weekly-plan";
import { editLines, editText, emphasize, linesText, selectionMarks, type Emphasis } from "./text";
import { startsWord, useUndo, type Caret, type Step } from "./undo";

export function EmphasisField({id,label,lines,rows,readOnly,toolbar,activate,change}:{id:string;label:string;lines:RichText[];
  rows?:number;readOnly:boolean;toolbar:HTMLElement|null;activate:()=>void;change:(lines:RichText[])=>void}) {
  const field=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null);
  const mirror=useRef<HTMLDivElement|null>(null);
  const visited=useRef(false),caret=useRef<Caret|null>(null),before=useRef<Caret>({start:0,end:0});
  const history=useUndo<RichText[]>();
  const [range,setRange]=useState([0,0]);
  const pressed=selectionMarks(lines,range[0],range[1]);
  function sync() {
    const el=field.current, layer=mirror.current;
    if (!el || !layer)return;
    layer.style.width=`${el.getBoundingClientRect().width-el.offsetWidth+el.clientWidth+2}px`;
    layer.style.height=`${el.getBoundingClientRect().height-el.offsetHeight+el.clientHeight+2}px`;
    layer.scrollTop=el.scrollTop;layer.scrollLeft=el.scrollLeft;
  }
  useLayoutEffect(()=>{
    const el=field.current;
    if (!el)return;
    const selection=()=>setRange(old=>{
      const a=el.selectionStart??0,b=el.selectionEnd??0;
      return old[0]===a && old[1]===b?old:[a,b];
    });
    const input=()=>{before.current={start:el.selectionStart??0,end:el.selectionEnd??0};};
    el.addEventListener("selectionchange",selection);el.addEventListener("beforeinput",input);
    const observer=new ResizeObserver(sync);
    observer.observe(el);
    return ()=>{observer.disconnect();el.removeEventListener("selectionchange",selection);el.removeEventListener("beforeinput",input);};
  },[]);
  useLayoutEffect(()=>{
    sync();
    if (caret.current!==null && field.current) {
      field.current.focus();field.current.setSelectionRange(caret.current.start,caret.current.end);caret.current=null;
    }
  });
  function update(value:string) {
    change(rows ? editLines(lines,value) : [editText(lines[0],value,true)]);
  }
  const current=()=>({value:lines,caret:{start:field.current?.selectionStart??0,end:field.current?.selectionEnd??0}});
  function restore(step:Step<RichText[]>) {caret.current=step.caret;change(step.value);}
  const attrs={id,readOnly,value:linesText(lines),ref:(el:HTMLInputElement|HTMLTextAreaElement|null)=>{field.current=el;},
    onFocus:()=>{visited.current=true;activate();},
    onSelect:()=>{const el=field.current;if(el)setRange([el.selectionStart??0,el.selectionEnd??0]);},
    onScroll:sync,
    onKeyDown:(e:React.KeyboardEvent)=>{if(!readOnly)history.keyDown(e,current,restore);},
    onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{
      const el=e.target;
      history.record({value:lines,caret:before.current},{time:e.timeStamp,caret:{start:el.selectionStart??0,end:el.selectionEnd??0},
        newWord:startsWord(linesText(lines),el.value)});
      update(el.value);
    }};
  function insert(text:string) {
    const el=field.current;
    if (!el || readOnly)return;
    const start=visited.current ? el.selectionStart??0 : el.value.length;
    const end=visited.current ? el.selectionEnd??start : start;
    const pair=text==="「」",selection=el.value.slice(start,end);
    const replacement=pair ? `「${selection}」` : text;
    const at=start+(pair && !selection ? 1 : replacement.length);
    history.record({value:lines,caret:{start,end}});
    caret.current={start:at,end:at};
    update(el.value.slice(0,start)+replacement+el.value.slice(end));
  }
  function apply(mark:Emphasis) {
    const el=field.current;
    if (!el || readOnly || range[0]===range[1])return;
    history.record({value:lines,caret:{start:range[0],end:range[1]}});
    change(emphasize(lines,range[0],range[1],mark));
    el.focus();el.setSelectionRange(range[0],range[1]);
  }
  return <div className="emphasis-field"><label htmlFor={id}>{label}</label>
    {!readOnly && toolbar && createPortal(<div className="field-tools" role="group" aria-label={`${label} 편집 도구`}>
    <div className="mark-tools" role="group" aria-label={`${label} 선택 글자 강조`}>
      {([["bold","굵게"],["blue","파랑"],["red","빨강"]] as const).map(([mark,text])=>
        <button type="button" key={mark} data-mark={mark} aria-pressed={pressed.includes(mark)} disabled={range[0]===range[1]} onMouseDown={e=>e.preventDefault()}
          onClick={()=>apply(mark)}>{text}</button>)}</div>
    <div className="insert-tools" role="group" aria-label={`${label} 특수 문자 넣기`}>
      {([["○","빈 원"],["·","가운뎃점"],["→","오른쪽 화살표"],["「」","홑낫표 쌍"],["‘","여는 작은따옴표"],
        ["□","빈 사각형"],[" ○ (내용) ","내용 머리말"],["   * ","참고 사항 머리말"]] as const).map(([text,name])=>
        <button type="button" key={text} aria-label={`${name} 넣기`} title={`${name} 넣기`}
          onMouseDown={e=>e.preventDefault()} onClick={()=>insert(text)}>{text}</button>)}
    </div></div>,toolbar)}
    <div className="emphasis-box" data-multiline={!!rows} data-readonly={readOnly}>
      <div className="emphasis-mirror" ref={mirror} aria-hidden="true">{lines.map((line,i)=>
        <Fragment key={i}>{i>0 && "\n"}{line.map((span,j)=>
          <span key={j} data-color={span.color} data-bold={span.bold}>{span.text}</span>)}</Fragment>)}</div>
      {rows ? <textarea {...attrs} rows={rows}/> : <input {...attrs}/>}
    </div></div>;
}
