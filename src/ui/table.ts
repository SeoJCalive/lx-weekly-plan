import { plainText, type CellAddress, type SumFormula, type TableCell, type WorkTable } from "../shared/weekly-plan";
import { cellOrigin } from "../shared/table-style";

export function cellName({row,column}:CellAddress) {
  let letters="";
  for(let n=column+1;n;n=Math.floor((n-1)/26))letters=String.fromCharCode(65+(n-1)%26)+letters;
  return letters+(row+1);
}
export function rectangle(value:string,table:WorkTable):SumFormula {
  const m=/^\s*([A-Z]+)([1-9]\d*)\s*(?::\s*([A-Z]+)([1-9]\d*))?\s*$/.exec(value.toUpperCase());
  if(!m)throw Error("범위는 A1:B2처럼 입력하세요.");
  const address=(c:string,r:string)=>({row:Number(r)-1,column:[...c].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1});
  const a=address(m[1],m[2]), b=address(m[3]??m[1],m[4]??m[2]);
  const to={row:Math.max(a.row,b.row),column:Math.max(a.column,b.column)};
  if(to.row>=table.rows || to.column>=table.columns)throw Error("범위가 표 밖으로 나갑니다.");
  return {type:"SUM",from:{row:Math.min(a.row,b.row),column:Math.min(a.column,b.column)},to};
}
const blank=(row:number,column:number):TableCell=>({row,column,rowSpan:1,colSpan:1,alignment:"left",paragraphs:[]});
const order=(a:TableCell,b:TableCell)=>a.row-b.row || a.column-b.column;
function widths(width:number,n:number) {
  return Array.from({length:n},(_,i)=>Math.floor((i+1)*width/n)-Math.floor(i*width/n));
}
export function newTable(rows:number,columns:number,width:number,height:number):WorkTable {
  return {id:crypto.randomUUID(),rows,columns,columnWidths:widths(width,columns),rowHeights:Array(rows).fill(height),
    caption:[],cells:Array.from({length:rows*columns},(_,i)=>blank(Math.floor(i/columns),i%columns))};
}
export function resize(table:WorkTable,axis:"row"|"column",remove:number|null) {
  const horizontal=axis==="column",size=horizontal?table.columns:table.rows;
  const n=size+(remove===null?1:-1),span=horizontal?"colSpan":"rowSpan";
  if(n<1)throw Error(`${horizontal?"열":"행"}은 하나 이상 남겨야 합니다.`);
  const cells:TableCell[]=[];
  for(const c of table.cells) {
    if(remove===null){cells.push({...c,styleFrom:cellOrigin(c)});continue;}
    if(c[axis]<=remove && remove<c[axis]+c[span] && c[span]>1)throw Error("삭제할 위치에 병합 셀이 있습니다. 먼저 셀을 나누세요.");
    if(c[axis]===remove)continue;
    let formula=c.formula;
    if(formula){
      if(formula.from[axis]<=remove && remove<=formula.to[axis])throw Error("합계 범위에 포함되어 있습니다. 먼저 수식을 변경하거나 해제하세요.");
      if(remove<formula.from[axis])formula={...formula,from:{...formula.from,[axis]:formula.from[axis]-1},to:{...formula.to,[axis]:formula.to[axis]-1}};
    }
    cells.push({...c,styleFrom:cellOrigin(c),[axis]:c[axis]-Number(c[axis]>remove),...(formula?{formula}:{})});
  }
  if(remove===null)for(let i=0;i<(horizontal?table.rows:table.columns);i++) {
    const row=horizontal?i:size-1,column=horizontal?size-1:i;
    const neighbour=table.cells.find(c=>c.row<=row && row<c.row+c.rowSpan && c.column<=column && column<c.column+c.colSpan)!;
    cells.push({...(horizontal?blank(i,size):blank(size,i)),styleFrom:cellOrigin(neighbour)});
  }
  if(!horizontal)return {...table,cells:cells.sort(order),rows:n,rowHeights:remove===null?
    [...table.rowHeights,table.rowHeights.findLast(h=>h>0) ?? 0]:table.rowHeights.filter((_,i)=>i!==remove)};
  const total=table.columnWidths.reduce((a,b)=>a+b,0);
  if(n>total)throw Error("이 너비에는 열을 더 추가할 수 없습니다.");
  const weights=remove===null?[...table.columnWidths,total/size]:table.columnWidths.filter((_,i)=>i!==remove);
  let allocated=0,weight=0;
  const weightTotal=weights.reduce((a,b)=>a+b,0);
  const columnWidths=Math.max(...table.columnWidths)-Math.min(...table.columnWidths)>1 ?
    weights.map((w,i)=>{weight+=w;const end=i===weights.length-1?total:Math.round(total*weight/weightTotal);
      const result=end-allocated;allocated=end;return result;}) : widths(total,n);
  return {...table,cells:cells.sort(order),columns:n,columnWidths};
}
export function intersects(c:TableCell,{from,to}:SumFormula) {
  return c.row<=to.row && c.row+c.rowSpan>from.row && c.column<=to.column && c.column+c.colSpan>from.column;
}
export function merge(table:WorkTable,range:SumFormula) {
  const {from,to}=range, cells=table.cells.filter(c=>intersects(c,range));
  if(cells.length<2)throw Error("병합할 셀을 두 개 이상 지정하세요.");
  if(cells.some(c=>c.row<from.row || c.column<from.column || c.row+c.rowSpan-1>to.row || c.column+c.colSpan-1>to.column))
    throw Error("범위가 기존 병합 셀에 걸칩니다. 셀 전체를 선택하세요.");
  const first=cells.find(c=>c.row===from.row && c.column===from.column)!;
  if(cells.some(c=>c!==first && (c.formula || c.paragraphs.some(l=>plainText(l).length))))
    throw Error("왼쪽 위 셀 이외의 값이 사라집니다. 내용을 먼저 옮기세요.");
  const merged={...first,rowSpan:to.row-from.row+1,colSpan:to.column-from.column+1};
  if(first.formula && intersects(merged,first.formula))throw Error("합계 셀은 자기 범위와 병합할 수 없습니다.");
  return {...table,cells:[...table.cells.filter(c=>!cells.includes(c)),merged].sort(order)};
}
export function split(table:WorkTable,c:TableCell) {
  const cells=table.cells.filter(x=>x!==c);
  for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.column;col<c.column+c.colSpan;col++)
    cells.push(r===c.row && col===c.column?{...c,rowSpan:1,colSpan:1}:
      {...blank(r,col),...(c.styleFrom?{styleFrom:c.styleFrom}:{})});
  return {...table,cells:cells.sort(order)};
}
