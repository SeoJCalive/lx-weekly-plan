import { Fragment, useEffect, useRef, useState } from "react";
import { sumValue, type Department, type WeeklyPlan, type WorkItem, type RichText, type WorkTable } from "../shared/weekly-plan";
import { formLayout } from "./form-layout" with {type:"macro"};
import { formRuns } from "../shared/form-runs";
import { tableCellStyle } from "../shared/table-style";

const layout = await formLayout();
export const tableGeometry=(id:string,fallback:string)=>({width:(layout.byItem[id]??layout.byItem[fallback])[2],height:layout.rowHeight});
const px = (units: number) => units/75;
export function Runs({line}:{line:RichText}) {
  return <>{line.map((s,i) => <span key={i} data-color={s.color}
    style={{fontWeight:s.bold === undefined ? undefined : s.bold ? 700 : 400}}>{s.text}</span>)}</>;
}
function Title({item,number}:{item:WorkItem;number:number}){
  const line=[{text:`${number}. `},...item.title],source=layout.titleStyles[item.templateItemId??item.id];
  return <div className="doc-title">{source?formRuns(line,source,false).map(({span,style},i)=>
    style?<sup key={i}><Runs line={[span]}/></sup>:<Runs key={i} line={[span]}/>):<Runs line={line}/>}</div>;
}
export function Nested({table}:{table:WorkTable}) {
  const total = table.columnWidths.reduce((a,b)=>a+b);
  return <table className="nested" style={{width:px(total)}}>
    {!!table.caption.length && <caption>{table.caption.map((l,i)=><div key={i}><Runs line={l}/></div>)}</caption>}
    <colgroup>{table.columnWidths.map((n,i)=><col key={i} style={{width:`${n/total*100}%`}}/>)}</colgroup>
    <tbody>{Array.from({length:table.rows},(_,r)=><tr key={r} style={{height:px(table.rowHeights[r])}}>
      {table.cells.filter(c=>c.row===r).sort((a,b)=>a.column-b.column).map(c=>{
        const style=tableCellStyle(table,c,layout.tableStyles);
        return <td key={c.column} rowSpan={c.rowSpan} colSpan={c.colSpan}
          style={{textAlign:c.alignment,background:style.background,fontSize:`${style.fontSize}pt`,fontWeight:style.bold?700:400}}>
          {c.formula ? sumValue(table,c.formula) : c.paragraphs.map((l,i)=><div key={i}><Runs line={l}/></div>)}
        </td>;
      })}</tr>)}</tbody></table>;
}
function rows(groups: (WorkItem|undefined)[][], ongoing=false, history?:(id:string)=>void) {
  return groups.map((pair,i)=><Fragment key={pair.find(Boolean)?.id ?? i}>
    <tr>{pair.map((item,j)=><td className="doc-body" data-item={item?.id} key={j} style={{height:px(layout.byItem[item?.templateItemId ?? item?.id ?? ""]?.[0] ?? (ongoing ? 5900 : 8900))}}>
      {item && <>{history?<button className="doc-history" title="항목 기록" onClick={()=>history(item.id)}><Title item={item} number={i+1}/></button>:<Title item={item} number={i+1}/>}
        {item.content.map((l,k)=><div className="doc-content" key={k}><Runs line={l}/></div>)}
        {item.notes.map((l,k)=><div className="doc-note" key={k}><Runs line={l}/></div>)}
        {!!item.tables.length && <div className="subtables">{item.tables.map(t=><Nested key={t.id} table={t}/>)}</div>}
      </>}</td>)}</tr>
    <tr>{pair.map((item,j)=><td className="doc-assignee" key={j} style={{height:px(layout.byItem[item?.templateItemId ?? item?.id ?? ""]?.[1] ?? 2100)}}>
      {item && <><b>➢ (업무담당자)</b> {item.assignee}</>}</td>)}</tr>
  </Fragment>);
}
export function Cover({week}:{week:WeeklyPlan}) {
  return <details className="cover"><summary>표지 보기</summary><div className="cover-paper" aria-label="문서 표지">
    <div className="cover-title"><img alt="" src={layout.cover[0]}/><b>{week.title}</b><b>{week.titlePeriod}</b><img alt="" src={layout.cover[1]}/></div>
    <b className="cover-date">{week.writtenDate}</b><div className="cover-logo"><img alt="LX" src={layout.cover[2]}/><img alt="한국국토정보공사" src={layout.cover[3]}/></div>
  </div></details>;
}
export function Preview({dept,week,history}:{dept:Department;week:WeeklyPlan;history?:(id:string)=>void}) {
  const host=useRef<HTMLDivElement>(null), [available,setAvailable]=useState(700);
  const [main,ongoing]=layout.bySection[dept.id] ?? [[51782,2500,2300,0],[51782,2300,0,0]];
  const width=Math.max(px(main[0]),px(ongoing[0])), scale=Math.max(.72,Math.min(1.15,available/width));
  useEffect(()=>{
    const observer=new ResizeObserver(([e])=>setAvailable(e.contentRect.width));
    observer.observe(host.current!);return ()=>observer.disconnect();
  },[]);
  const left=dept.items.lastWeek,right=dept.items.thisWeek;
  return <div className="paper-frame" ref={host}><article aria-label={`${dept.name} 한글 양식`} className="form-paper" style={{width,zoom:scale}}>
    <h3 style={{minHeight:px(main[3] || 2400)}}>[{dept.parentOffice ? `${dept.parentOffice}_` : ""}{dept.name}]</h3>
    <table className="outer" style={{width:px(main[0])}}><thead>
      <tr style={{height:px(main[1])}}>{[["전주 실적",week.lastWeekPeriod],["금주 계획",week.thisWeekPeriod]].map(([label,period])=>
        <th key={label}>{label}<span>{period}</span></th>)}</tr>
      <tr className="doc-sub" style={{height:px(main[2])}}><th>{dept.labels.lastWeek}</th><th>{dept.labels.thisWeek}</th></tr>
    </thead><tbody>{rows(Array.from({length:Math.max(left.length,right.length)},(_,i)=>[left[i],right[i]]),false,history)}</tbody></table>
    <table className="outer ongoing" style={{width:px(ongoing[0]),marginTop:px(ongoing[4] ?? 2400)}}><thead><tr style={{height:px(ongoing[1])}}>
      <th>{dept.labels.ongoing}</th></tr></thead><tbody>{rows(dept.items.ongoing.map(it=>[it]),true,history)}</tbody></table>
  </article></div>;
}
