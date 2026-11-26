import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type RichText } from "../shared/weekly-plan";
import { editLines, editText, emphasize, linesText, selectionMarks, type Emphasis } from "./text";
import { startsWord, useUndo, type Caret, type Step } from "./undo";
import { measureParagraphs, readParagraphs, renderParagraphs, selectParagraphs } from "./paragraph-editor";

export function EmphasisField({id,label,lines,rows,readOnly,toolbar,activate,change}:{id:string;label:string;lines:RichText[];
  rows?:number;readOnly:boolean;toolbar:HTMLElement|null;activate:()=>void;change:(lines:RichText[])=>void}) {
  const field=useRef<HTMLInputElement|null>(null),editor=useRef<HTMLDivElement|null>(null);
  const mirror=useRef<HTMLDivElement|null>(null);
  const visited=useRef(false),caret=useRef<Caret|null>(null),before=useRef<Caret>({start:0,end:0});
  const selected=useRef<Caret>({start:0,end:0}),live=useRef(lines),painted=useRef("");
  const composition=useRef<Step<RichText[]>|null>(null);
  const history=useUndo<RichText[]>();
  const [range,setRange]=useState([0,0]);
  const pressed=selectionMarks(lines,range[0],range[1]);
  function remember(at:Caret) {
    selected.current=at;
    setRange(old=>old[0]===at.start && old[1]===at.end?old:[at.start,at.end]);
  }
  function selection():Caret {
    const el=field.current;
    if(el)return {start:el.selectionStart??0,end:el.selectionEnd??0,direction:el.selectionDirection==="backward"?"backward":"forward"};
    return (editor.current && readParagraphs(editor.current).caret) || selected.current;
  }
  function paint(value:RichText[],at?:Caret,focus=false,reveal=false) {
    const el=editor.current;
    if(!el || composition.current)return;
    const top=el.scrollTop,left=el.scrollLeft;
    renderParagraphs(el,value);painted.current=JSON.stringify(value);
    if(focus)el.focus({preventScroll:true});
    el.scrollTop=top;el.scrollLeft=left;
    if(at){selectParagraphs(el,at,reveal);remember(at);}
  }
  function publish(value:RichText[],at?:Caret,reveal=false) {
    live.current=value;
    if(editor.current)paint(value,at,!!at,reveal);
    else if(at)caret.current=at;
    change(value);
  }
  function sync() {
    const el=field.current, layer=mirror.current;
    if (!el || !layer)return;
    layer.style.width=`${el.getBoundingClientRect().width-el.offsetWidth+el.clientWidth+2}px`;
    layer.style.height=`${el.getBoundingClientRect().height-el.offsetHeight+el.clientHeight+2}px`;
    layer.scrollTop=el.scrollTop;layer.scrollLeft=el.scrollLeft;
  }
  useLayoutEffect(()=>{
    const el=field.current ?? editor.current;
    if (!el)return;
    const track=()=>{
      if(editor.current) {
        const at=readParagraphs(editor.current).caret;
        if(at)remember(at);
      } else if(document.activeElement===el)remember(selection());
    };
    document.addEventListener("selectionchange",track);
    const resize=()=>{sync();if(editor.current && !composition.current)measureParagraphs(editor.current);};
    const observer=new ResizeObserver(resize);
    observer.observe(el);
    document.fonts.addEventListener("loadingdone",resize);
    return ()=>{observer.disconnect();document.removeEventListener("selectionchange",track);document.fonts.removeEventListener("loadingdone",resize);};
  },[]);
  useLayoutEffect(()=>{
    const el=field.current ?? editor.current;
    if(!el)return;
    function input(e:InputEvent) {
      before.current=selection();
      if(!editor.current || readOnly || composition.current || e.isComposing)return;
      if(e.inputType==="insertParagraph" || e.inputType==="insertLineBreak") {
        e.preventDefault();replace("\n");
      } else if(e.inputType==="historyUndo" || e.inputType==="historyRedo") {
        e.preventDefault();history.move(e.inputType==="historyUndo"?"undo":"redo",current,restore);
      } else if(e.inputType.startsWith("format"))e.preventDefault();
    }
    el.addEventListener("beforeinput",input);
    return ()=>el.removeEventListener("beforeinput",input);
  });
  useLayoutEffect(()=>{
    live.current=lines;
    if(editor.current && !composition.current && painted.current!==JSON.stringify(lines)) {
      paint(lines,readParagraphs(editor.current).caret);
    }
    sync();
    if (caret.current!==null && field.current) {
      field.current.focus({preventScroll:true});field.current.setSelectionRange(caret.current.start,caret.current.end,caret.current.direction);caret.current=null;
    }
  });
  function update(value:string,at?:Caret,reveal=false) {
    publish(rows ? editLines(live.current,value) : [editText(live.current[0],value,true)],at,reveal);
  }
  const current=()=>({value:live.current,caret:selection()});
  function restore(step:Step<RichText[]>) {publish(step.value,step.caret,true);}
  const common={
    onFocus:()=>{visited.current=true;activate();},
    onKeyDown:(e:React.KeyboardEvent)=>{if(!readOnly)history.keyDown(e,current,restore);},
  };
  const attrs={...common,id,readOnly,value:linesText(lines),ref:field,
    onSelect:()=>remember(selection()),onScroll:sync,
    onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{
      const el=e.target;
      history.record({value:live.current,caret:before.current},{time:e.timeStamp,caret:selection(),
        newWord:startsWord(linesText(live.current),el.value)});
      update(el.value);
    }};
  function replace(text:string,at=selection(),insidePair=false) {
    if(readOnly || composition.current)return;
    const value=linesText(live.current),end=at.start+text.length-(insidePair?1:0);
    history.record({value:live.current,caret:at});
    update(value.slice(0,at.start)+text+value.slice(at.end),{start:end,end},true);
  }
  function insert(text:string) {
    const value=linesText(live.current),at=visited.current?selection():{start:value.length,end:value.length};
    const pair=text==="「」",chosen=value.slice(at.start,at.end);
    replace(pair?`「${chosen}」`:text,at,pair && !chosen);
  }
  function apply(mark:Emphasis) {
    const at=selection();
    if(readOnly || composition.current || at.start===at.end)return;
    history.record({value:live.current,caret:at});
    publish(emphasize(live.current,at.start,at.end,mark),at);
  }
  function input(time:number) {
    const el=editor.current;
    if(!el || readOnly)return;
    const {text,caret:at=selected.current}=readParagraphs(el),previous=live.current;
    remember(at);
    if(text===linesText(previous))return;
    const next=editLines(previous,text);
    if(!composition.current)history.record({value:previous,caret:before.current},
      {time,caret:at,newWord:startsWord(linesText(previous),text)});
    publish(next,at);
  }
  function copy(e:React.ClipboardEvent,cut=false) {
    const at=selection();
    if(at.start===at.end)return;
    e.preventDefault();e.clipboardData.setData("text/plain",linesText(live.current).slice(at.start,at.end));
    if(cut && !readOnly)replace("",at);
  }
  return <div className="emphasis-field"><label id={`${id}-label`} htmlFor={id}>{label}</label>
    {!readOnly && toolbar && createPortal(<div className="field-tools" role="group" aria-label={`${label} 편집 도구`}>
    <div className="mark-tools" role="group" aria-label={`${label} 선택 글자 강조`}>
      {([["bold","굵게"],["blue","파랑"],["red","빨강"]] as const).map(([mark,text])=>
        <button type="button" key={mark} data-mark={mark} aria-pressed={pressed.includes(mark)} disabled={range[0]===range[1]} onMouseDown={e=>{if(!composition.current)e.preventDefault();}}
          onClick={()=>apply(mark)}>{text}</button>)}</div>
    <div className="insert-tools" role="group" aria-label={`${label} 특수 문자 넣기`}>
      {([["○","빈 원"],["·","가운뎃점"],["→","오른쪽 화살표"],["「」","홑낫표 쌍"],["‘","여는 작은따옴표"],
        ["□","빈 사각형"],[" ○ (내용) ","내용 머리말"],["   * ","참고 사항 머리말"]] as const).map(([text,name])=>
        <button type="button" key={text} aria-label={`${name} 넣기`} title={`${name} 넣기`}
          onMouseDown={e=>{if(!composition.current)e.preventDefault();}} onClick={()=>insert(text)}>{text}</button>)}
    </div></div>,toolbar)}
    <div className="emphasis-box" data-multiline={!!rows} data-readonly={readOnly}>
      {rows ? <div {...common} id={id} ref={editor} className="emphasis-editor" contentEditable={!readOnly}
        role="textbox" aria-multiline="true" aria-readonly={readOnly} aria-labelledby={`${id}-label`} tabIndex={0}
        style={{height:`calc(${rows} * 1.55em + 2 * var(--s2) + 2px)`}}
        onInput={e=>input(e.timeStamp)}
        onCompositionStart={()=>{composition.current=current();}}
        onCompositionEnd={e=>{
          const first=composition.current,el=editor.current;
          if(!first || !el)return;
          input(e.timeStamp);composition.current=null;
          const at=selection(),value=live.current;
          if(linesText(first.value)!==linesText(value))history.record(first,
            {time:e.timeStamp,caret:at,newWord:startsWord(linesText(first.value),linesText(value))});
          paint(value,at);
        }}
        onCopy={e=>copy(e)} onCut={e=>copy(e,true)}
        onPaste={e=>{e.preventDefault();replace(e.clipboardData.getData("text/plain").replace(/\r\n?/g,"\n"));}}
        onDragOver={e=>{if(!readOnly)e.preventDefault();}}
        onDrop={e=>{
          e.preventDefault();
          const point=document.caretRangeFromPoint(e.clientX,e.clientY);
          if(point && editor.current?.contains(point.startContainer)) {
            const s=document.getSelection();s?.removeAllRanges();s?.addRange(point);
          }
          replace(e.dataTransfer.getData("text/plain").replace(/\r\n?/g,"\n"));
        }}/> : <><div className="emphasis-mirror" ref={mirror} aria-hidden="true">{lines.map((line,i)=>
        <Fragment key={i}>{i>0 && "\n"}{line.map((span,j)=>
          <span key={j} data-color={span.color} data-bold={span.bold}>{span.text}</span>)}</Fragment>)}</div>
        <input {...attrs}/></>}
    </div></div>;
}
