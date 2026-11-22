import { useEffect, useState } from "react";
import type { BoardDocument, BoardPost, DashboardView, Person, PublishResult, WeekSummary } from "../shared/api";
import { api } from "./api";
import { Cover, Preview } from "./Preview";
import type { Place } from "./Workflow";

export function Release({week,board,stageId,posts,go,openWeek}:{week:WeekSummary;board:DashboardView;stageId:number;posts:BoardPost[];go:(p:Place)=>void;openWeek:(id:number)=>void}) {
  const missing=board.departments.filter(d=>d.status!=="승인" || !d.reviews.some(r=>r.stageId===stageId && r.status==="승인"));
  const ready=board.departments.length>0 && !missing.length;
  const version=(posts.find(p=>p.weekId===week.id)?.version ?? 0)+1;
  const title=`${week.title} ${week.titlePeriod.replace(/\s/g,"")} ${version}차`;
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function act(publish:boolean) {
    if(!confirm(publish?`「${title}」을 게시판에 배포할까요?\n배포 후 모든 구성원이 이 버전을 열람할 수 있습니다.`:
      "배포 전에 다음 주차를 열까요?\n현재 금주 계획과 계속업무를 복사하고, 다음 주차를 현재 주차로 지정합니다."))return;
    setBusy(true);setError("");
    try{
      if(publish){
        const {post}=await api<PublishResult>(`weeks/${week.id}/publish`,"POST");
        go({page:"게시판",postId:post.id,weekId:undefined});
      }else{
        const next=await api<WeekSummary>(`weeks/${week.id}/open-next`,"POST");
        openWeek(next.id);
      }
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="release" aria-label="주간업무 계획 배포"><div>
    <h2>{ready?"배포할 문서":"최종 승인 대기"}</h2>
    <p>{ready?title:`${missing.map(d=>d.name).join(", ")} · 최종 승인 후 배포할 수 있습니다.`}</p>
  </div><div className="actions release-actions">
    {ready && <button className="primary" disabled={busy} onClick={()=>void act(true)}>게시판에 배포</button>}
    {week.nextWeekId===null && <button className="quiet-action" disabled={busy} onClick={()=>void act(false)}>다음 주차 열기</button>}
  </div>{error && <p role="alert">{error}</p>}</section>;
}

export function Publications({accounts,postId}:{accounts:Person[];postId?:number}) {
  const [posts,setPosts]=useState<BoardPost[]>(),[id,setId]=useState(postId),[doc,setDoc]=useState<BoardDocument>();
  const [listError,setListError]=useState(""),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let stopped=false,timer:number;
    async function load(){
      try{
        const list=await api<BoardPost[]>("board");
        if(!stopped){setPosts(list);setId(old=>old??list[0]?.id);setListError("");}
      }catch(e){if(!stopped)setListError(navigator.onLine?(e as Error).message:"오프라인입니다. 연결 후 다시 시도하세요.");}
      if(!stopped)timer=window.setTimeout(load,3000);
    }
    void load();return ()=>{stopped=true;clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    if(!id)return;
    let stopped=false;setError("");
    api<BoardDocument>(`board/${id}`).then(p=>{if(!stopped)setDoc(p);})
      .catch(e=>{if(!stopped)setError(navigator.onLine?e.message:"오프라인입니다. 연결 후 다시 시도하세요.");});
    return ()=>{stopped=true;};
  },[id,retry]);
  return <main className="page"><div className="page-heading"><h1>게시판</h1></div>
    {listError && <p role="alert">{listError}</p>}
    {!posts?<p role="status">배포본을 불러오는 중…</p>:!posts.length?<div className="empty task-list"><h2>아직 배포된 문서가 없습니다.</h2><p>최종 승인된 계획을 배포하면 여기에 게시됩니다.</p></div>:
    <div className="board publications"><aside aria-label="배포본 목록"><h2>배포본 목록</h2>
      {posts.map(p=>{
        const person=accounts.find(a=>a.id===p.publishedBy);
        return <button key={p.id} className="post-row" aria-pressed={p.id===id} onClick={()=>setId(p.id)}><b>{p.title}</b>
          {p.id===postId && <strong role="status">배포 완료</strong>}
          <span><time dateTime={new Date(p.publishedAt).toISOString()}>{new Date(p.publishedAt).toLocaleString("ko-KR",{dateStyle:"short",timeStyle:"short"})}</time> · {person?`${person.name} ${person.title}`:"배포자 미확인"}</span></button>;
      })}</aside>
      <section aria-label="선택한 배포본" className="board-detail">{error?<p role="alert">{error} <button onClick={()=>setRetry(r=>r+1)}>다시 시도</button></p>:
        !doc || doc.id!==id?<p role="status">문서를 불러오는 중…</p>:
        <><div className="section-head"><h2>{doc.title}</h2><a className="button" download href={`/api/board/${doc.id}/hwpx`}>HWPX 다운로드</a></div>
          <div key={doc.id} className="post-document" role="region" aria-label="배포 문서 본문" tabIndex={0}>
            <Cover week={doc.document}/>{doc.document.departments.map(d=><Preview key={d.id} dept={d} week={doc.document}/>)}</div></>}
      </section></div>}</main>;
}
