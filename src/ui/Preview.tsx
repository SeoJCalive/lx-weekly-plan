import { Fragment, useEffect, useRef, useState } from "react";
import { plainText, sumValue, type Department, type WeeklyPlan, type WorkItem, type RichText, type WorkTable } from "../shared/weekly-plan";
import { formLayout } from "./form-layout" with {type:"macro"};
import { formRuns } from "../shared/form-runs";
import { hangingPrefix } from "../shared/paragraph";
import { tableCellStyle, tableMargins, tablePartWidth, tableRowLeading, tableRows } from "../shared/table-style";

const layout = await formLayout();
export const tableStyles=layout.tableStyles;
export const tableGeometry=(id:string,fallback:string)=>{
  const bodyWidth=(layout.byItem[id]??layout.byItem[fallback])[2]+tableStyles.margin.left+tableStyles.margin.right;
  return {width:tablePartWidth(1,bodyWidth,tableStyles),height:layout.rowHeight,bodyWidth};
};
const px = (units: number) => units/75;
export function Runs({line}:{line:RichText}) {
  return <>{line.map((s,i) => <span key={i} data-color={s.color}
    style={{fontWeight:s.bold === undefined ? undefined : s.bold ? 700 : 400}}>{s.text}</span>)}</>;
}
function Paragraph({line,note=false}:{line:RichText;note?:boolean}) {
  const length=hangingPrefix(plainText(line)).length;
  let offset=0;
  const prefix:RichText=[],body:RichText=[];
  for(const span of line) {
    const cut=Math.max(0,Math.min(span.text.length,length-offset));
    if(cut)prefix.push({...span,text:span.text.slice(0,cut)});
    if(cut<span.text.length)body.push({...span,text:span.text.slice(cut)});
    offset+=span.text.length;
  }
  return <div className={note?"doc-note":"doc-content"}
    style={length?{display:"grid",gridTemplateColumns:"max-content minmax(0,1fr)"}:undefined}>
    {length?<><span><Runs line={prefix}/></span><span><Runs line={body}/></span></>:<Runs line={line}/>}
  </div>;
}
function Title({item,number}:{item:WorkItem;number:number}){
  const line=[{text:`${number}. `},...item.title],source=layout.titleStyles[item.templateItemId??item.id];
  return <div className="doc-title">{source?formRuns(line,source,false).map(({span,style},i)=>
    style?<sup key={i}><Runs line={[span]}/></sup>:<Runs key={i} line={[span]}/>):<Runs line={line}/>}</div>;
}
export function Nested({table}:{table:WorkTable}) {
  const total = table.columnWidths.reduce((a,b)=>a+b);
  return <table className="nested" style={{width:"100%"}}>
    {!!table.caption.length && <caption>{table.caption.map((l,i)=><div key={i}><Runs line={l}/></div>)}</caption>}
    <colgroup>{table.columnWidths.map((n,i)=><col key={i} style={{width:`${n/total*100}%`}}/>)}</colgroup>
    <tbody>{Array.from({length:table.rows},(_,r)=><tr key={r} style={{height:px(table.rowHeights[r])}}>
      {table.cells.filter(c=>c.row===r).sort((a,b)=>a.column-b.column).map(c=>{
        const style=tableCellStyle(table,c,layout.tableStyles);
        return <td key={c.column} rowSpan={c.rowSpan} colSpan={c.colSpan}
          style={{textAlign:c.alignment,background:style.background,fontSize:`${style.fontSize}pt`,fontWeight:style.bold?700:400,
            fontFamily:`"${style.fontFamily}",var(--form-sans)`,lineHeight:style.lineHeight,letterSpacing:`${style.letterSpacing}em`,
            padding:`${px(style.padding.top)}px ${px(style.padding.right)}px ${px(style.padding.bottom)}px ${px(style.padding.left)}px`,
            borderLeft:style.borders.left,borderRight:style.borders.right,borderTop:style.borders.top,borderBottom:style.borders.bottom}}>
          {c.formula ? sumValue(table,c.formula) : c.paragraphs.map((l,i)=><div key={i}><Runs line={l}/></div>)}
        </td>;
      })}</tr>)}</tbody></table>;
}
export function TableRows({tables}:{tables:WorkTable[]}) {
  const rows=tableRows(tables,tableStyles);
  return <div className="subtables" style={{marginTop:!tableStyles.tables[tables[0].id]?px(tableStyles.inline.beforeSpacing):0}}>{rows.map((row,index)=>
    <div className="table-row" key={row[0].id} style={{
      marginTop:index?px(rows[index-1].length>1?tableStyles.inline.groupSpacing:tableStyles.inline.rowSpacing):0,
      paddingLeft:px(tableRowLeading(row,tableStyles)),gap:row.length>1?px(tableStyles.inline.gap):0}}>
      {row.map(table=>{
        const margin=tableMargins(table,tableStyles);
        return <div className="table-slot" key={table.id} style={{width:px(table.columnWidths.reduce((a,b)=>a+b,0)),marginLeft:px(margin.left),marginRight:px(margin.right)}}>
          <Nested table={table}/>
        </div>;
      })}
    </div>)}</div>;
}
function rows(groups: (WorkItem|undefined)[][], ongoing=false, options?:{history?:(id:string)=>void;number?:number}) {
  return groups.map((pair,i)=><Fragment key={pair.find(Boolean)?.id ?? i}>
    <tr>{pair.map((item,j)=><td className="doc-body" data-item={item?.id} key={j} style={{
      height:px(layout.byItem[item?.templateItemId ?? item?.id ?? ""]?.[0] ?? (ongoing ? 5900 : 8900)),
      ...(item?.tables.some(table=>!tableStyles.tables[table.id])?{
        height:"auto",
        padding:`${px(tableStyles.inline.bodyMargin.top+Math.floor(tableStyles.inline.slack/2))}px ${px(tableStyles.inline.bodyMargin.right)}px ${px(tableStyles.inline.bodyMargin.bottom+tableStyles.inline.slack-Math.floor(tableStyles.inline.slack/2))}px ${px(tableStyles.inline.bodyMargin.left)}px`,
        verticalAlign:"middle"}:{})}}>
      {item && <>{options?.history?<button className="doc-history" title="처리 이력" aria-label={`${plainText(item.title)} 처리 이력`} onClick={()=>options.history?.(item.id)}>
        <Title item={item} number={options.number??i+1}/>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2"/></svg>
      </button>:<Title item={item} number={options?.number??i+1}/>}
        {item.content.map((l,k)=><Paragraph line={l} key={k}/>)}
        {item.notes.map((l,k)=><Paragraph line={l} note key={k}/>)}
        {!!item.tables.length && <TableRows tables={item.tables}/>}
      </>}</td>)}</tr>
    <tr>{pair.map((item,j)=><td className="doc-assignee" key={j} style={{height:px(layout.byItem[item?.templateItemId ?? item?.id ?? ""]?.[1] ?? 2100)}}>
      {item && <><b>➢ (업무담당자)</b> {item.assignee}</>}</td>)}</tr>
  </Fragment>);
}
export function ItemPreview({dept,item}:{dept:Department;item:WorkItem}) {
  const category=(["lastWeek","thisWeek","ongoing"] as const).find(c=>dept.items[c].some(it=>it.id===item.id)) ?? "thisWeek";
  const geometry=layout.bySection[dept.id],number=dept.items[category].findIndex(it=>it.id===item.id)+1;
  const width=px(category==="ongoing"?geometry[1][0]:geometry[0][0]/2);
  return <div className="paper-frame"><article className="form-paper" aria-label="항목 한글 양식" style={{width}}>
    <table className="outer ongoing" style={{width:"100%"}}><tbody>{rows([[item]],category==="ongoing",{number})}</tbody></table>
  </article></div>;
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
    </thead><tbody>{rows(Array.from({length:Math.max(left.length,right.length)},(_,i)=>[left[i],right[i]]),false,{history})}</tbody></table>
    <table className="outer ongoing" style={{width:px(ongoing[0]),marginTop:px(ongoing[4] ?? 2400)}}><thead><tr style={{height:px(ongoing[1])}}>
      <th>{dept.labels.ongoing}</th></tr></thead><tbody>{rows(dept.items.ongoing.map(it=>[it]),true,{history})}</tbody></table>
  </article></div>;
}
