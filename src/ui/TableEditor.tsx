import { useState } from "react";
import { sumValue, type TableCell, type WorkTable } from "../shared/weekly-plan";
import { validateTable } from "../shared/table-validation";
import { editLines, linesText } from "./text";
import { cellName, intersects, merge, rectangle, resize, split } from "./table";

export function TableEditor({table,index,change,remove}:{table:WorkTable;index:number;change:(next:WorkTable)=>void;remove:()=>void}) {
  const [active,setActive]=useState("A1"),[range,setRange]=useState("A1"),[error,setError]=useState("");
  const cell=table.cells.find(c=>cellName(c)===active) ?? table.cells[0];
  function choose(c:TableCell){setActive(cellName(c));setRange(c.formula?`${cellName(c.formula.from)}:${cellName(c.formula.to)}`:cellName(c));setError("");}
  function apply(next:WorkTable){validateTable(next);change(next);setError("");}
  function update(c:TableCell) {apply({...table,cells:table.cells.map(x=>x===cell?c:x)});}
  function run(action:()=>void){try{action();setError("");}catch(e){setError((e as Error).message);}}
  function alter(axis:"row"|"column",deleting:boolean) {
    run(()=>{const next=resize(table,axis,deleting?cell[axis]:null);
      apply(next);choose(deleting ? next.cells.find(c=>cellName(c)===active) ?? next.cells.at(-1)! : cell);});
  }
  function sum() {
    const formula=rectangle(range,table);
    update({...cell,formula,paragraphs:[]});
  }
  let selection:ReturnType<typeof rectangle>|undefined;
  try{selection=rectangle(range,table);}catch{ /* Incomplete address while typing. */ }
  return <section className="table-edit" aria-label={`표 ${index} 편집`}>
    <div className="field-heading"><h3>표 {index} <small>{table.rows}행 × {table.columns}열</small></h3>
      <button type="button" onClick={()=>{if(confirm(`표 ${index}을(를) 항목에서 삭제할까요?`))remove();}}>표 삭제</button></div>
    {!!table.caption.length && <p>{linesText(table.caption)}</p>}
    <div className="grid-scroll"><table aria-label={`표 ${index} 셀`}><thead><tr><td/>{table.columnWidths.map((_,column)=>
      <th key={column} scope="col">{cellName({row:0,column}).slice(0,-1)}</th>)}</tr></thead>
      <tbody>{table.rowHeights.map((_,row)=><tr key={row}><th scope="row">{row+1}</th>
        {table.cells.filter(c=>c.row===row).sort((a,b)=>a.column-b.column).map(c=>
          <td key={c.column} colSpan={c.colSpan} rowSpan={c.rowSpan} data-selected={c===cell || (!!selection && intersects(c,selection))}>
            <textarea aria-label={cellName(c)} rows={1} readOnly={!!c.formula}
              style={{textAlign:c.alignment}} value={c.formula ? String(sumValue(table,c.formula)) : linesText(c.paragraphs)}
              onFocus={()=>choose(c)} onMouseDown={e=>{if(e.shiftKey){e.preventDefault();setRange(`${cellName(cell)}:${cellName(c)}`);setError("");}}}
              onChange={e=>change({...table,cells:table.cells.map(x=>x===c?{...c,paragraphs:editLines(c.paragraphs,e.target.value)}:x)})}/>
          </td>)}</tr>)}</tbody></table></div>
    <div className="table-tools">
      <div className="actions"><b>{cellName(cell)}</b>
        <button type="button" aria-pressed={cell.alignment==="center"} onClick={()=>update({...cell,alignment:cell.alignment==="center"?"left":"center"})}>가운데 정렬</button>
        <button type="button" onClick={()=>alter("row",false)}>행 추가</button>
        <button type="button" onClick={()=>alter("column",false)}>열 추가</button>
        <button type="button" disabled={table.rows===1} onClick={()=>alter("row",true)}>행 삭제</button>
        <button type="button" disabled={table.columns===1} onClick={()=>alter("column",true)}>열 삭제</button></div>
      <div className="actions"><label>범위<input aria-label="셀 범위" value={range} onChange={e=>setRange(e.target.value)}/></label>
        <button type="button" onClick={()=>run(()=>{const r=rectangle(range,table);apply(merge(table,r));setActive(cellName(r.from));})}>병합</button>
        <button type="button" disabled={cell.rowSpan===1 && cell.colSpan===1} onClick={()=>{apply(split(table,cell));setRange(cellName(cell));}}>나누기</button>
        <button type="button" onClick={()=>run(sum)}>SUM 적용</button>
        {cell.formula && <button type="button" onClick={()=>{const {formula,...rest}=cell;update({...rest,paragraphs:[[{text:String(sumValue(table,formula!))}]]});}}>수식 해제</button>}</div>
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
