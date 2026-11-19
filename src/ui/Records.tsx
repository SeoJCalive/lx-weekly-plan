import { useEffect, useState, type ReactNode } from "react";
import type { DashboardView, ItemChange, ItemHistory, StatisticsView, WeekView } from "../shared/api";
import { categories, plainText } from "../shared/weekly-plan";
import { api } from "./api";
import { VersionContent } from "./Dashboard";
import { Heading, names, Status } from "./Workflow";
import { Runs } from "./Preview";

const actions={requested:"검토 요청",returned:"수정 요청",approved:"승인"} as const;
const eventTime=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"medium"});
const fields={title:"제목",content:"내용",notes:"부가 설명",assignee:"업무담당자",tables:"표"};
function Difference({change}:{change:ItemChange}) {
  if(change.field==="tables"){
    const {oldValue:old,newValue:next}=change;
    return <div>{[...new Set([...old,...next].map(t=>t.id))].map(id=>{
      const a=old.findIndex(t=>t.id===id),b=next.findIndex(t=>t.id===id);
      if(a===b && JSON.stringify(old[a])===JSON.stringify(next[b]))return null;
      return <p key={id}>표 {(b===-1?a:b)+1} · {a===-1?"추가":b===-1?"삭제":"변경"}</p>;
    })}</div>;
  }
  const [old,next]=change.field==="assignee"?[[[{text:change.oldValue}]],[[{text:change.newValue}]]]:
    change.field==="title"?[[change.oldValue],[change.newValue]]:[change.oldValue,change.newValue];
  let start=0,end=0;
  const same=(a:number,b:number)=>JSON.stringify(old[a])===JSON.stringify(next[b]);
  while(start<Math.min(old.length,next.length) && same(start,start))start++;
  while(end<Math.min(old.length,next.length)-start && same(old.length-1-end,next.length-1-end))end++;
  return <div className="difference"><b>{fields[change.field]}</b>
    {old.slice(start,old.length-end).map((l,i)=><div key={i}><small>삭제</small><del><Runs line={l}/></del></div>)}
    {next.slice(start,next.length-end).map((l,i)=><div key={i}><small>추가</small><ins><Runs line={l}/></ins></div>)}
  </div>;
}
export function Records({week,board,stats,itemId,picker}:{week:WeekView;board:DashboardView;stats:StatisticsView;itemId?:string;picker:ReactNode}) {
  const groups=week.departments.map(d=>{
    const allowed=new Set(board.departments.find(s=>s.departmentId===d.id)?.items.map(it=>it.id));
    return {name:d.name,items:categories.flatMap(c=>d.items[c].filter(it=>allowed.has(it.id)))};
  }).filter(d=>d.items.length);
  const [id,select]=useState(itemId??groups[0]?.items[0]?.id);
  const [result,setResult]=useState<ItemHistory>(),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let stopped=false;setError("");
    if(id)api<ItemHistory>(`items/${encodeURIComponent(id)}/history`).then(h=>{if(!stopped)setResult(h);})
      .catch(e=>{if(!stopped)setError(navigator.onLine?e.message:"오프라인입니다. 연결 후 다시 시도하세요.");});
    return ()=>{stopped=true;};
  },[id,board.revision,retry]);
  return <main className="page"><Heading week={week} title="기록" picker={picker}/>
    <div className="records"><section aria-label="항목별 이력"><h2>항목별 이력</h2>
      {groups.length>0 && <label className="record-picker">업무 항목<select value={id} onChange={e=>select(e.target.value)}>
        {groups.map(d=><optgroup key={d.name} label={d.name}>{d.items.map(it=><option key={it.id} value={it.id}>{d.name} · {names[it.category]} · {plainText(it.title)||"제목 없는 항목"}</option>)}</optgroup>)}
      </select></label>}
      {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>다시 시도</button></p>:
        !id?<p>이 주차에 열람할 수 있는 항목이 없습니다.</p>:
        !result || result.itemId!==id?<p role="status">기록을 불러오는 중…</p>:
        !result.entries.length?<p className="empty-history">아직 검토 기록이 없습니다. 검토 요청부터 기록됩니다.</p>:
        <ol className="history">{result.entries.map(e=><li key={e.id}><div className="history-meta">
          <Status value={actions[e.action]}/><b>{e.actor.name} {e.actor.title}</b><time dateTime={new Date(e.at).toISOString()}>{eventTime.format(e.at)}</time></div>
          {e.message && <p className="review-message"><b>수정 요청 사유</b>{e.message}</p>}
          {e.changes.length>0 && <div className="differences"><h3>직전 기록과 달라진 부분</h3>{e.changes.map(c=><Difference key={c.field} change={c}/>)}</div>}
          <details><summary>{e.versionNumber}차 제출 내용</summary><VersionContent text={e.content}/></details>
        </li>)}</ol>}
    </section><section aria-label="처별 통계"><h2>처별 통계</h2>
      <table className="statistics"><thead><tr><th scope="col">처</th><th scope="col">수정</th><th scope="col">수정 요청</th><th scope="col">마감 준수</th></tr></thead>
        <tbody>{stats.departments.map(d=><tr key={d.departmentId}><th scope="row">{d.name}</th><td>{d.revisions}</td><td>{d.revisionRequests}</td>
          <td>{d.deadlineMet===null?"미상신":d.deadlineMet?"준수":"미준수"}</td></tr>)}</tbody></table>
      <p className="stats-note">수정은 재요청 횟수이며, 마감 준수는 처 취합본의 최초 상신 시각 기준입니다.</p>
    </section></div></main>;
}
