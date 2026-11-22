import { useEffect, useState, type ReactNode } from "react";
import { itemStatuses, type DashboardView, type DepartmentView, type ItemChange, type ItemView, type Organisation, type Person, type WeekView } from "../shared/api";
import { categories, plainText, type WorkItem } from "../shared/weekly-plan";
import { api } from "./api";
import { Nested, Preview, Runs } from "./Preview";
import { Heading, names, type Place, StageProgress, Status } from "./Workflow";
import { ReviewCard } from "./ReviewCard";

function Decision({path,actions,items,done,weekId}:{path:string;actions:readonly string[];items?:ItemView[];done:(text:string)=>void;weekId?:number}) {
  const [returning,setReturning]=useState(false),[message,setMessage]=useState(""),[ids,setIds]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function decide(action:"approve"|"return") {
    setBusy(true);setError("");
    try {
      await api(`${path}/${action}${weekId?`?weekId=${weekId}`:""}`,"POST",action==="approve"?undefined:{message,...(items?{itemIds:ids}:{})});
      setReturning(false);setMessage("");setIds([]);done(action==="approve"?"승인했습니다.":"수정 요청을 보냈습니다.");
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  if(!actions.includes("return") && !actions.includes("approve"))return null;
  return <div className="decision">
    {returning && actions.includes("return") ? <form className="fields" onSubmit={e=>{e.preventDefault();void decide("return");}}>
      {items && <fieldset><legend>수정할 항목 선택</legend>{items.map(it=><label className="check" key={it.id}>
        <input type="checkbox" checked={ids.includes(it.id)} onChange={e=>setIds(e.target.checked?[...ids,it.id]:ids.filter(id=>id!==it.id))}/>
        {names[it.category]} · {plainText(it.title)||"제목 없는 항목"}</label>)}</fieldset>}
      <label>수정 요청 사유<textarea required autoFocus value={message} onChange={e=>setMessage(e.target.value)}/></label>
      <div className="actions"><button className="primary" disabled={busy || !message.trim() || (!!items&&!ids.length)}>수정 요청 보내기</button>
        <button type="button" disabled={busy} onClick={()=>setReturning(false)}>취소</button></div>
    </form>:<div className="actions">
      {actions.includes("approve") && <button className="primary" disabled={busy} onClick={()=>void decide("approve")}>승인</button>}
      {actions.includes("return") && <button disabled={busy} onClick={()=>setReturning(true)}>수정 요청</button>}
    </div>}{error && <p role="alert">{error}</p>}</div>;
}

function ItemContent({item}:{item:ItemView}) {
  const v=item.review.version,submitted=v && (item.status==="검토 요청" || item.status==="승인" || item.status==="수정 요청");
  const text=submitted?v.content:item;
  return <><VersionContent text={text} label={submitted?`제출 내용 · ${v.number}차`:"작성 중인 내용"}/>
    {submitted && v.note && <ReviewCard kind="note" message={v.note} at={v.requestedAt} open/>}</>;
}
export function VersionContent({text,label,changes=[]}:{text:WorkItem;label?:string;changes?:readonly ItemChange[]}) {
  return <div className="review-copy">
    {label && <small>{label}</small>}
    <h3 tabIndex={-1} data-changed={changes.some(c=>c.field==="title")}><Runs line={text.title}/></h3>
    {text.content.map((line,i)=><p key={i} data-changed={changes.some(c=>c.field==="content" && !c.oldValue.some(old=>JSON.stringify(old)===JSON.stringify(line)))}><Runs line={line}/></p>)}
    {text.notes.map((line,i)=><p key={i} data-changed={changes.some(c=>c.field==="notes" && !c.oldValue.some(old=>JSON.stringify(old)===JSON.stringify(line)))}><Runs line={line}/></p>)}
    {text.tables.map(table=><div className="review-table" data-changed={changes.some(c=>c.field==="tables" && !c.oldValue.some(old=>JSON.stringify(old)===JSON.stringify(table)))} key={table.id}><Nested table={table}/></div>)}
    <p data-changed={changes.some(c=>c.field==="assignee")}>업무담당자 · {text.assignee || "미지정"}</p>
  </div>;
}
export function Dashboard({board,week,units,person,place,refresh,picker,release,history}:{board:DashboardView;week:WeekView;units:Organisation[];person:Person;place:Place;refresh:()=>void;picker:ReactNode;release?:ReactNode;history:(id:string)=>void}) {
  const target=board.stages.find(s=>s.id===place.stageId);
  const [departmentId,setDepartment]=useState(place.departmentId ?? (target && board.departments.find(d=>
    d.departmentId===target.organisationId || d.reviews.some(r=>r.stageId===target.id))?.departmentId) ??
    board.departments.find(d=>d.items.some(i=>i.actions.includes("approve")) || d.reviews.some(r=>r.actions.includes("approve")))?.departmentId ??
    person.departmentId ?? board.departments.find(d=>d.items.length)?.departmentId);
  const [selected,setSelected]=useState(place.itemId),[feedback,setFeedback]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(place.itemId)document.querySelector<HTMLElement>(".review-copy h3")?.focus();
  },[place.itemId]);
  const dept=board.departments.find(d=>d.departmentId===departmentId), source=week.departments.find(d=>d.id===departmentId);
  const items=source?categories.flatMap(c=>source.items[c]):[];
  const activeId=selected ?? dept?.items.find(i=>i.actions.includes("approve"))?.id ?? items[0]?.id;
  function choose(id:string){setDepartment(id);setSelected(undefined);setFeedback("");setError("");}
  function done(text:string){setFeedback(text);refresh();}
  const orgName=(id?:string)=>units.find(u=>u.id===id)?.name;
  const stageName=(id:number)=>orgName(board.stages.find(s=>s.id===id)?.organisationId);
  const stage=board.stages.find(s=>s.reviewerId===person.id && s.reviewUnit==="section" && dept?.reviews.some(r=>r.stageId===s.id));
  const sectionReview=dept?.reviews.find(r=>r.stageId===stage?.id);
  const submitted=!!sectionReview && ["승인","검토 요청","수정 요청"].includes(sectionReview.status);
  const section:DepartmentView|undefined=source && submitted?{...source,items:{...source.items}}:undefined;
  if(section && source && sectionReview) for(const c of categories) section.items[c]=source.items[c].flatMap(it=>{
    const v=it.review.version;return v && sectionReview.versionIds.includes(v.id)?[{...it,...v.content}]:[];
  });
  async function submit(id:number){
    setBusy(true);setError("");try{await api(`review-stages/${id}/submit?weekId=${week.id}`,"POST");done(`${stageName(id)} 취합본을 상신했습니다.`);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function unitRow(id:string){
    const d=board.departments.find(u=>u.departmentId===id);
    return d && <button key={id} className="unit-row" aria-pressed={departmentId===id} onClick={()=>choose(id)}>
      <span>{d.name}</span><span className="section-status"><StageProgress dept={d} board={board} units={units}/><Status value={d.status}/></span></button>;
  }
  return <main className="page"><Heading title="검토 현황" week={week} picker={picker}/>{release}
    <div className="board"><aside aria-label="조직별 현황"><h2>조직별 현황</h2>
      {board.offices.map(o=><section className="org-group" key={o.organisationId}><h3>{o.name}<Status value={o.status}/></h3>
        {o.departmentIds.map(unitRow)}</section>)}
      {board.departments.filter(d=>!board.offices.some(o=>o.departmentIds.includes(d.departmentId))).map(d=>unitRow(d.departmentId))}
    </aside>
    {dept && source && <section className="board-detail"><div className="section-head"><h2>{dept.name}</h2>
      <span className="section-status"><StageProgress dept={dept} board={board} units={units}/><Status value={dept.status}/></span></div>
      {!!dept.reviews.length && <div className="review-trail">{dept.reviews.map(r=><span key={r.stageId}>{stageName(r.stageId)} 검토 <Status value={r.status}/></span>)}</div>}
      {board.stages.filter(s=>s.actions.includes("submit") && (s.organisationId===departmentId || dept.reviews.some(r=>r.stageId===s.id))).map(s=>
        <div className="submit-line" key={s.id}><span>소속 {s.reviewUnit==="item"?"항목":"처 섹션"} 모두 승인</span>
          <button className="primary" disabled={busy} onClick={()=>void submit(s.id)}>{orgName(s.organisationId)} 취합본 상신</button></div>)}
      {feedback && <p role="status" className="notice">{feedback}</p>}{error && <p role="alert">{error}</p>}
      {!dept.items.length?<><p>항목별 상태 집계</p><dl className="counts">{itemStatuses.map(s=><div key={s}><dt><Status value={s}/></dt><dd>{dept.counts[s]}건</dd></div>)}</dl></>:
        section && sectionReview ? <>
          <h3>처 전체 제출 내용</h3>
          {dept.items.filter(i=>i.changed).map(i=><p className="change-note" key={i.id}>변경 항목 · {plainText(items.find(it=>it.id===i.id)!.title)}</p>)}
          <Decision key={`${dept.departmentId}:${stage?.id}:${sectionReview.submittedAt}`} path={`review-stages/${stage?.id}/sections/${dept.departmentId}`}
            actions={sectionReview.actions} items={items} done={done} weekId={week.id}/>
          {categories.flatMap(c=>section.items[c]).map(it=>{
            const v=it.review.version;
            return v?.note && <ReviewCard key={v.id} kind="note" message={v.note} at={v.requestedAt}
              context={plainText(v.content.title)} open/>;
          })}
          <Preview dept={section} week={week} history={history}/>
        </>: <div className="review-list">{categories.map(c=><section key={c}><h3>{names[c]}</h3>
          {source.items[c].length===0 && <p>등록된 항목이 없습니다.</p>}
          {source.items[c].map((it,index)=>{
            const row=dept.items.find(i=>i.id===it.id);if(!row)return null;
            const open=activeId===it.id;
            return <div className="review-row" key={it.id}><div className="review-heading"><button className="review-toggle" aria-expanded={open} onClick={()=>{setSelected(open?"":it.id);setFeedback("");}}>
              <span className="num">{String(index+1).padStart(2,"0")}</span><b>{plainText(it.title)||"제목 없는 항목"} {row.changed && <small> · 변경 항목</small>}</b><Status value={row.status}/></button>
              <button className="history-link" aria-label={`${plainText(it.title)||"제목 없는 항목"} 처리 이력`} onClick={()=>history(it.id)}>처리 이력</button></div>
              {open && <div className="item-detail"><ItemContent item={it}/><Decision key={it.review.version?.id} path={`items/${it.id}`} actions={row.actions} done={done}/></div>}
            </div>;
          })}</section>)}</div>}
    </section>}</div></main>;
}
