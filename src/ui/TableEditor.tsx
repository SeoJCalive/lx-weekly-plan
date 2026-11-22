import { useLayoutEffect, useRef, useState } from "react";
import { sumValue, type TableCell, type WorkTable } from "../shared/weekly-plan";
import { validateTable } from "../shared/table-validation";
import { editLines, linesText } from "./text";
import { cellName, intersects, merge, resize, selectedRange, split, sumSelection } from "./table";
import { startsWord, useUndo, type Caret, type Step, type Typing } from "./undo";

const caretIn=(el:HTMLTextAreaElement):Caret=>({cell:el.getAttribute("aria-label")!,start:el.selectionStart,end:el.selectionEnd});

export function TableEditor({table,index,change,remove}:{table:WorkTable;index:number;change:(next:WorkTable)=>void;remove:()=>void}) {
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
    restored.current=null;
    const el=box.current?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${at.cell}"]`);
    if(el){el.focus();el.setSelectionRange(at.start,at.end);}
  });
  const cell=table.cells.find(c=>cellName(c)===active) ?? table.cells[0];
  const selection=selectedRange(cell,table.cells.find(c=>cellName(c)===end)??cell);
  function choose(c:TableCell){setActive(cellName(c));setEnd(cellName(c));setError("");}
  function caret():Caret {
    const el=document.activeElement;
    return el instanceof HTMLTextAreaElement && box.current?.contains(el) ? caretIn(el) : {cell:active,start:0,end:0};
  }
  function commit(next:WorkTable,typing?:Typing){history.record({value:table,caret:typing?before.current:caret()},typing);change(next);}
  function restore(step:Step<WorkTable>){restored.current=step.caret;setActive(step.caret.cell!);setEnd(step.caret.cell!);setError("");change(step.value);}
  function apply(next:WorkTable){validateTable(next);commit(next);setError("");}
  function update(c:TableCell) {apply({...table,cells:table.cells.map(x=>x===cell?c:x)});}
  function run(action:()=>void){try{action();setError("");}catch(e){setError((e as Error).message);}}
  function alter(axis:"row"|"column",deleting:boolean) {
    run(()=>{const next=resize(table,axis,deleting?cell[axis]:null);
      apply(next);choose(deleting ? next.cells.find(c=>cellName(c)===active) ?? next.cells.at(-1)! : cell);});
  }
  return <section ref={box} className="table-edit" aria-label={`표 ${index} 편집`}
    onKeyDown={e=>history.keyDown(e,()=>({value:table,caret:caret()}),restore)}>
    <div className="field-heading"><h3>표 {index} <small>{table.rows}행 × {table.columns}열</small></h3>
      <button type="button" onClick={()=>{if(confirm(`표 ${index}번을 항목에서 삭제할까요?`))remove();}}>표 삭제</button></div>
    {!!table.caption.length && <p>{linesText(table.caption)}</p>}
    <div className="grid-scroll"><table aria-label={`표 ${index} 셀`}><thead><tr><td/>{table.columnWidths.map((_,column)=>
      <th key={column} scope="col">{cellName({row:0,column}).slice(0,-1)}</th>)}</tr></thead>
      <tbody>{table.rowHeights.map((_,row)=><tr key={row}><th scope="row">{row+1}</th>
        {table.cells.filter(c=>c.row===row).sort((a,b)=>a.column-b.column).map(c=>
          <td key={c.column} colSpan={c.colSpan} rowSpan={c.rowSpan} data-selected={intersects(c,selection)} data-formula={!!c.formula}
            onMouseDown={e=>{if(e.button!==0)return;dragging.current=true;
              if(e.shiftKey){e.preventDefault();setEnd(cellName(c));setError("");}else choose(c);}}
            onMouseEnter={e=>{if(e.buttons===1 && dragging.current){setEnd(cellName(c));setError("");}else dragging.current=false;}}
            onMouseUp={()=>{dragging.current=false;}}>
            <textarea aria-label={cellName(c)} rows={1} readOnly={!!c.formula}
              style={{textAlign:c.alignment}} value={c.formula ? String(sumValue(table,c.formula)) : linesText(c.paragraphs)}
              onFocus={()=>choose(c)}
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
        <button type="button" onClick={()=>run(()=>{const next=merge(table,selection);apply(next);choose(next.cells.find(c=>cellName(c)===cellName(selection.from))!);})}>병합</button>
        <button type="button" disabled={cell.rowSpan===1 && cell.colSpan===1} onClick={()=>{apply(split(table,cell));choose(cell);}}>나누기</button>
        <button type="button" onClick={()=>run(()=>apply(sumSelection(table,selection)))}>합계 넣기</button>
        {cell.formula && <button type="button" onClick={()=>{const {formula,...rest}=cell;update({...rest,paragraphs:[[{text:String(sumValue(table,formula!))}]]});}}>합계 해제</button>}</div>
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
