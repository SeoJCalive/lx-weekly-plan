import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ItemChange, ItemHistory, ItemHistoryEntry, SectionHistory, SectionHistoryEntry } from "../shared/api";
import { plainText } from "../shared/weekly-plan";
import { api } from "./api";
import { VersionContent } from "./Dashboard";
import { Runs } from "./Preview";
import { ReviewCard } from "./ReviewCard";
import { Status } from "./Workflow";

export type HistoryTarget = { readonly kind:"item"|"section"; readonly id:string };
const actions={requested:"검토 요청",returned:"수정 요청",approved:"승인",submitted:"상신"} as const;
const eventTime=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"medium"});
const shortTime=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
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
export function History({target,weekId,stepId,revision=0,narrow=false,navigation,preview,openItem,openRecord}:{
  target:HistoryTarget;weekId:number;stepId?:number;revision?:number;narrow?:boolean;
  navigation?:(steps:ReactNode)=>ReactNode;preview?:(entry:ItemHistoryEntry)=>ReactNode;
  openItem?:(itemId:string,stepId:number)=>void;openRecord?:(itemId:string,stepId:number)=>void;
}) {
  const [entries,setEntries]=useState<readonly (ItemHistoryEntry|SectionHistoryEntry)[]>();
  const list=useRef<HTMLElement>(null);
  const [chosen,choose]=useState(stepId),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let stopped=false;setError("");
    const path=target.kind==="item"?"items":"sections";
    api<ItemHistory|SectionHistory>(`${path}/${encodeURIComponent(target.id)}/history?weekId=${weekId}`)
      .then(h=>{if(!stopped)setEntries(h.entries.toReversed());})
      .catch(e=>{if(!stopped)setError(navigator.onLine?e.message:"오프라인입니다. 연결 후 다시 시도하세요.");});
    return ()=>{stopped=true;};
  },[target.id,target.kind,weekId,revision,retry]);
  const selected=entries?.find(e=>e.id===chosen) ?? entries?.[0];
  useEffect(()=>{
    const pane=list.current,row=pane?.querySelector<HTMLElement>(".history-step[aria-current]");
    if(pane && row)pane.scrollTop+=row.getBoundingClientRect().top-pane.getBoundingClientRect().top-(pane.clientHeight-row.offsetHeight)/2;
  },[selected?.id]);
  const steps=error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>다시 시도</button></p>:
    !entries?<p role="status">기록을 불러오는 중…</p>:!entries.length?<p className="empty-history">아직 검토 기록이 없습니다.</p>:
    <ol className="history-steps">{entries.map(e=><li key={e.id}><button className="history-step"
      aria-current={selected?.id===e.id?"step":undefined} data-step-id={e.id}
      title={`${actions[e.action]} · ${e.actor.name} ${e.actor.title} · ${eventTime.format(e.at)}${e.reviewUnit==="section"?" · 처 전체 검토":""}`}
      onClick={()=>choose(e.id)}>
      <Status value={e.action==="submitted"?"검토 요청":actions[e.action]} label={actions[e.action]}/>
      {!narrow && <span className="step-actor">{e.actor.name}</span>}
      {target.kind==="item" && e.reviewUnit==="section" && <small>{narrow?"전체":"처 전체 검토"}</small>}
      <time dateTime={new Date(e.at).toISOString()}>{shortTime.format(e.at)}</time>
    </button></li>)}</ol>;
  return <div className="history-browser" data-variant={narrow?"popup":"page"}>
    <aside ref={list} className="history-list" aria-label="검토 단계 목록">{navigation?navigation(steps):steps}</aside>
    <section className="history-detail" aria-label="선택한 단계 내용" key={selected?.id}>
      {!selected?<p>목록에서 기록을 선택하세요.</p>:<>
        <div className="history-meta"><h2>{actions[selected.action]}{"versionNumber" in selected && ` · ${selected.versionNumber}차`}</h2>
          <span>{selected.actor.name} {selected.actor.title}</span>
          <time dateTime={new Date(selected.at).toISOString()}>{eventTime.format(selected.at)}</time>
          {selected.reviewUnit==="section" && <span>처 전체 검토</span>}</div>
        {selected.message && <ReviewCard kind="request" message={selected.message} at={selected.at}
          sender={`${selected.actor.name} ${selected.actor.title}`} reviewUnit={selected.reviewUnit} open/>}
        {"content" in selected?<>
          {selected.note && <ReviewCard kind="note" message={selected.note}
            at={entries?.find(e=>"versionId" in e && e.versionId===selected.versionId && e.action==="requested")?.at??selected.at} open/>}
          {selected.changes.length>0 && <div className="differences"><h3>직전 버전과 달라진 부분</h3>
            {selected.changes.map(c=><Difference key={c.field} change={c}/>)}</div>}
          <section className="history-content"><h3>제출 내용</h3><VersionContent text={selected.content} changes={selected.changes}/></section>
          {preview?.(selected)}
          {openRecord && <button className="history-link" onClick={()=>openRecord(target.id,selected.id)}>기록에서 양식으로 보기</button>}
        </>:selected.items.length>0 && <section className="history-targets"><h3>수정할 항목</h3>
          {selected.items.map(it=><button key={it.itemId} className="history-link"
            onClick={()=>openItem?.(it.itemId,it.entryId)}>{plainText(it.title)||"제목 없는 항목"}</button>)}</section>}
      </>}
    </section>
  </div>;
}
