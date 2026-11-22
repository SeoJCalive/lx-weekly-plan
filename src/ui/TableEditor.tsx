import { useLayoutEffect, useRef, useState } from "react";
import { sumValue, type TableCell, type WorkTable } from "../shared/weekly-plan";
import { validateTable } from "../shared/table-validation";
import { besidePrevious, tableCellStyle, tableMargins, tablePartWidth, type TableStyles } from "../shared/table-style";
import { editLines, linesText } from "./text";
import { cellName, intersects, merge, paint, resize, selectedRange, split, sumSelection } from "./table";
import { startsWord, useUndo, type Caret, type Step, type Typing } from "./undo";

const caretIn=(el:HTMLTextAreaElement):Caret=>({cell:el.getAttribute("aria-label")!,start:el.selectionStart,end:el.selectionEnd});

export function TableEditor({table,index,change,remove,styles,bodyWidth,validate}:{
  table:WorkTable;index:number;change:(next:WorkTable)=>void;remove:()=>void;
  styles:TableStyles;bodyWidth:number;validate:(next:WorkTable)=>void}) {
  const [active,setActive]=useState("A1"),[end,setEnd]=useState("A1"),[error,setError]=useState("");
  const dragging=useRef(false),box=useRef<HTMLElement>(null),before=useRef<Caret>({start:0,end:0}),restored=useRef<Caret|null>(null);
  const history=useUndo<WorkTable>();
  useLayoutEffect(()=>{
    const el=box.current!;
    const input=(e:Event)=>{if(e.target instanceof HTMLTextAreaElement)before.current=caretIn(e.target);};
    el.addEventListener("beforeinput",input);return ()=>el.removeEventListener("beforeinput",input);
  },[]);
  useLayoutEffect(()=>{
    const at=restored.current;
    if(!at)return;
    const el=box.current?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${at.cell}"]`);
    if(el){el.focus();el.setSelectionRange(at.start,at.end);}
    restored.current=null;
  });
  const cell=table.cells.find(c=>cellName(c)===active) ?? table.cells[0];
  const selection=selectedRange(cell,table.cells.find(c=>cellName(c)===end)??cell);
  const selected=table.cells.filter(c=>intersects(c,selection)),beside=besidePrevious(table,styles);
  let besideError="";
  if(index>1 && !beside)try{validate({...table,beside:true});}catch(e){if(e instanceof Error)besideError=e.message;else throw e;}
  function choose(c:TableCell){setActive(cellName(c));setEnd(cellName(c));setError("");}
  function caret():Caret {
    const el=document.activeElement;
    return {...(el instanceof HTMLTextAreaElement && box.current?.contains(el) ? caretIn(el) : {cell:active,start:0,end:0}),endCell:end};
  }
  function commit(next:WorkTable,typing?:Typing){history.record({value:table,caret:typing?before.current:caret()},typing);change(next);}
  function restore(step:Step<WorkTable>){validate(step.value);restored.current=step.caret;setActive(step.caret.cell??"A1");setEnd(step.caret.endCell??step.caret.cell??"A1");setError("");change(step.value);}
  function apply(next:WorkTable){validateTable(next);validate(next);commit(next);setError("");}
  function update(c:TableCell) {apply({...table,cells:table.cells.map(x=>x===cell?c:x)});}
  function run(action:()=>void){try{action();setError("");}catch(e){if(e instanceof Error)setError(e.message);else throw e;}}
  function selectRow(row:number){
    const cells=table.cells.filter(c=>c.row<=row && c.row+c.rowSpan>row).sort((a,b)=>a.column-b.column);
    setActive(cellName(cells[0]));setEnd(cellName(cells[cells.length-1]));setError("");
  }
  const margin=tableMargins(table,styles),total=table.columnWidths.reduce((a,b)=>a+b,0);
  const widthFor=(parts:number)=>tablePartWidth(parts,bodyWidth,styles,margin,(index-1)%parts);
  const sizes=[1,2,3],size=sizes.find(n=>widthFor(n)===total);
  function setWidth(parts:number){
    const width=widthFor(parts);let used=0;
    apply({...table,columnWidths:table.columnWidths.map(w=>{
      const start=Math.floor(used*width/total);used+=w;return Math.floor(used*width/total)-start;
    })});
  }
  function alter(axis:"row"|"column",deleting:boolean) {
    run(()=>{const next=resize(table,axis,deleting?cell[axis]:null);
      apply(next);choose(deleting ? next.cells.find(c=>cellName(c)===active) ?? next.cells.at(-1)! : cell);});
  }
  return <section ref={box} className="table-edit" aria-label={`표 ${index} 편집`}
    onKeyDown={e=>run(()=>history.keyDown(e,()=>({value:table,caret:caret()}),restore))}>
    <div className="field-heading"><h3>표 {index} <small>{table.rows}행 × {table.columns}열</small></h3>
      <button type="button" onClick={()=>{if(confirm(`표 ${index}번을 항목에서 삭제할까요?`))remove();}}>표 삭제</button></div>
    <div className="table-placement">
      <label>표 너비<select aria-label={`표 ${index} 너비`} value={size??"current"} onChange={e=>run(()=>setWidth(Number(e.target.value)))}>
        {!size && <option value="current">현재 너비</option>}<option value="1">전체</option><option value="2">절반</option><option value="3">3분의 1</option>
      </select></label>
      {index>1 && <button type="button" aria-pressed={beside} disabled={!beside && !!besideError}
        onClick={()=>run(()=>apply({...table,beside:!beside}))}>앞 표 옆에 붙이기</button>}
    </div>
    {(error || besideError) && <p role="alert">{error || besideError}</p>}
    {!!table.caption.length && <p>{linesText(table.caption)}</p>}
    <div className="grid-scroll"><table aria-label={`표 ${index} 셀`}><thead><tr><td/>{table.columnWidths.map((_,column)=>
      <th key={column} scope="col">{cellName({row:0,column}).slice(0,-1)}</th>)}</tr></thead>
      <tbody>{table.rowHeights.map((_,row)=><tr key={row}><th scope="row"><button type="button"
        aria-label={`${row+1}행 전체 선택`} onClick={()=>selectRow(row)}>{row+1}</button></th>
        {table.cells.filter(c=>c.row===row).sort((a,b)=>a.column-b.column).map(c=>
          <td key={c.column} colSpan={c.colSpan} rowSpan={c.rowSpan} data-selected={intersects(c,selection)} data-formula={!!c.formula}
            style={{background:tableCellStyle(table,c,styles).background}}
            onMouseDown={e=>{if(e.button!==0)return;dragging.current=true;
              if(e.shiftKey){e.preventDefault();setEnd(cellName(c));setError("");}else choose(c);}}
            onMouseEnter={e=>{if(e.buttons===1 && dragging.current){setEnd(cellName(c));setError("");}else dragging.current=false;}}
            onMouseUp={()=>{dragging.current=false;}}>
            <textarea aria-label={cellName(c)} rows={1} readOnly={!!c.formula}
              style={{textAlign:c.alignment}} value={c.formula ? String(sumValue(table,c.formula)) : linesText(c.paragraphs)}
              onFocus={()=>{if(!restored.current)choose(c);}}
              onChange={e=>commit({...table,cells:table.cells.map(x=>x===c?{...c,paragraphs:editLines(c.paragraphs,e.target.value)}:x)},
                {time:e.timeStamp,caret:caretIn(e.target),newWord:startsWord(linesText(c.paragraphs),e.target.value)})}/>
          </td>)}</tr>)}</tbody></table></div>
    <div className="table-tools">
      <div className="actions"><b>{cellName(cell)}</b>
        <button type="button" aria-pressed={cell.alignment==="center"} onClick={()=>update({...cell,alignment:cell.alignment==="center"?"left":"center"})}>가운데 정렬</button>
        <button type="button" onClick={()=>alter("row",false)}>행 추가</button>
        <button type="button" onClick={()=>alter("column",false)}>열 추가</button>
        <button type="button" disabled={table.rows===1} onClick={()=>alter("row",true)}>행 삭제</button>
        <button type="button" disabled={table.columns===1} onClick={()=>alter("column",true)}>열 삭제</button></div>
      <div className="actions">
        <button type="button" aria-pressed={selected.every(c=>c.background==="header")} onClick={()=>apply(paint(table,selection,"header"))}>머리 색</button>
        <button type="button" aria-pressed={selected.every(c=>c.background==="gray")} onClick={()=>apply(paint(table,selection,"gray"))}>회색</button>
        <button type="button" onClick={()=>apply(paint(table,selection))}>색 지우기</button>
      </div>
      <div className="actions">
        <button type="button" onClick={()=>run(()=>{const next=merge(table,selection);apply(next);choose(next.cells.find(c=>cellName(c)===cellName(selection.from))!);})}>병합</button>
        <button type="button" disabled={cell.rowSpan===1 && cell.colSpan===1} onClick={()=>{apply(split(table,cell));choose(cell);}}>나누기</button>
        <button type="button" onClick={()=>run(()=>apply(sumSelection(table,selection)))}>합계 넣기</button>
        {cell.formula && <button type="button" onClick={()=>{const {formula,...rest}=cell;update({...rest,paragraphs:[[{text:String(sumValue(table,formula!))}]]});}}>합계 해제</button>}</div>
    </div>
  </section>;
}
