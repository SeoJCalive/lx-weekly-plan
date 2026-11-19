import { useEffect, useRef, useState } from "react";
import type { DepartmentView, ItemView, Organisation, Person, WeekView } from "../shared/api";
import { categories, plainText, type WorkCategory } from "../shared/weekly-plan";
import { api } from "./api";
import { Preview } from "./Preview";
import { editLines, editText, linesText, marked } from "./text";
import { names, Status } from "./Workflow";

const itemPath=(it:ItemView)=>`items/${encodeURIComponent(it.id)}`;
export function Writing({person,week,units,departmentId,itemId}:{person:Person;week:WeekView;units:Organisation[];departmentId?:string;itemId?:string}) {
  const sections=week.departments.filter(d=>{
    let id:string|null=d.id;
    while (id) { if (id===person.organisationId) return true; id=units.find(o=>o.id===id)?.parentId ?? null; }
    return false;
  });
  const [id,setId]=useState(departmentId ?? sections[0]?.id);
  const current=sections.find(d=>d.id===id);
  return <main id="writing" className="page">
    <div className="page-heading"><div><div className="context">{week.title} <span>/</span> 작성</div><h1>{current?.name} 업무 작성</h1></div>
      <div className="week"><span>현재 주차</span><b>{week.writtenDate.slice(0,4)}년 {week.thisWeekPeriod.replace(/[()]/g,"")}</b></div>
    </div>
    {current ? <Desk key={current.id} initial={current} week={week} person={person} sections={sections} onSection={setId} itemId={itemId}/> : <p>작성 가능한 처가 없습니다.</p>}
  </main>;
}
function Desk({initial,week,person,sections,onSection,itemId}:{initial:DepartmentView;week:WeekView;person:Person;sections:DepartmentView[];onSection:(id:string)=>void;itemId?:string}) {
  const key=`lx:${week.id}:${person.id}:${initial.id}`;
  const first=categories.flatMap(c=>initial.items[c]).find(it=>it.id===(itemId ?? sessionStorage.getItem(key))) ?? initial.items.thisWeek[0];
  const [dept,setDept]=useState(initial), [cat,setCat]=useState<WorkCategory>(first?.category ?? "thisWeek");
  const [item,setItem]=useState<ItemView|undefined>(first), [draft,setDraft]=useState<ItemView|undefined>(first);
  const [label,setLabel]=useState(initial.labels.thisWeek), [editLabel,setEditLabel]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [feedback,setFeedback]=useState("");
  const working=useRef(false), current=useRef<string|undefined>(first?.id), live=useRef(true), held=useRef<string|undefined>(undefined);
  const [online,setOnline]=useState(navigator.onLine);
  const [,setLastContact]=useState(Date.now());
  const dirty=!!draft && draft!==item, labelDirty=label!==dept.labels.thisWeek;
  const editable=!!item?.lock && item.lock.personId===person.id && item.lock.expiresAt>Date.now() && online;
  const other=!!item?.lock && item.lock.personId!==person.id;
  function replace(it:ItemView) {
    setDept(d=>({...d,items:{...d.items,[it.category]:d.items[it.category].some(x=>x.id===it.id)
      ? d.items[it.category].map(x=>x.id===it.id?it:x) : [...d.items[it.category],it]}}));
  }
  function select(it:ItemView|undefined) {
    current.current=it?.id;held.current=it?.lock?.personId===person.id ? it.id : undefined;
    setItem(it);setDraft(it);
    if (it) {replace(it);sessionStorage.setItem(key,it.id);}
  }
  function leaveOK() {return !dirty || confirm("이 항목의 저장하지 않은 변경을 버릴까요?");}
  async function action(fn:()=>Promise<void>) {
    if (working.current) return;
    working.current=true;setBusy(true);setError("");setFeedback("");
    try {await fn();} catch(e) {
      setError((e as Error).message);
      if(current.current) {
        const updated=await api<ItemView>(`items/${current.current}`).catch(()=>undefined);
        if (updated && live.current) {setItem(updated);replace(updated);if(!dirty)setDraft(updated);}
      }
    } finally {working.current=false;setBusy(false);}
  }
  async function release() {
    if (held.current) {await api(`items/${held.current}/lock`,"DELETE");held.current=undefined;}
  }
  async function open(it:ItemView|undefined) {
    if (!it) {select(undefined);return;}
    let fresh=await api<ItemView>(itemPath(it));
    if (fresh.canEdit) fresh=await api<ItemView>(itemPath(it)+"/lock","POST");
    if(live.current)select(fresh);
  }
  function switchTo(c:WorkCategory,it:ItemView|undefined) {
    if (!leaveOK()) return;
    void action(async()=>{await release();setCat(c);select(it);await open(it);});
  }
  useEffect(()=>{
    live.current=true;
    void action(async()=>{
      await open(first);
      if(live.current && first?.id===itemId)document.querySelector<HTMLInputElement>("#item-title")?.focus();
    });
    function unload() {if (held.current) void fetch(`/api/items/${held.current}/lock`,{method:"DELETE",keepalive:true}).catch(()=>{});}
    const network=()=>setOnline(navigator.onLine);
    window.addEventListener("online",network);window.addEventListener("offline",network);window.addEventListener("pagehide",unload);
    window.addEventListener("lx:leave-writing",unload);
    return ()=>{live.current=false;window.removeEventListener("lx:leave-writing",unload);window.removeEventListener("pagehide",unload);window.removeEventListener("online",network);window.removeEventListener("offline",network);};
  },[]);
  useEffect(()=>{
    if(!dirty && !labelDirty) return;
    const warn=(e:BeforeUnloadEvent)=>e.preventDefault();
    window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty,labelDirty]);
  useEffect(()=>{
    if(!item || !online)return;
    let cancelled=false;
    const id=item.id;
    const timer=window.setInterval(async()=>{
      if(working.current || current.current!==id)return;
      try{
        const updated=await api<ItemView>(itemPath(item)+(held.current===id ? "/lock" : ""),held.current===id?"POST":"GET");
        if(cancelled || working.current || current.current!==id)return;
        setLastContact(Date.now());
        if(JSON.stringify(updated)!==JSON.stringify(item)){
          if(updated.status!==item.status)setFeedback("");
          if(!dirty)select(updated);else{setItem(updated);replace(updated);}
        }
      }catch(e){if(!cancelled){held.current=undefined;setError((e as Error).message);setLastContact(Date.now());}}
    },held.current===id ? 25_000 : 1_000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[item,online,dirty]);
  function assign() {
    if (!item || !leaveOK())return;
    void action(async()=>{
      const mine=item.assignedPeople.some(p=>p.id===person.id);
      const next=await api<ItemView>(itemPath(item)+"/assignment",mine?"DELETE":"POST");select(next);
      if (!mine)await open(next);
    });
  }
  function add() {
    if(!leaveOK())return;
    void action(async()=>{
      await release();
      const next=await api<ItemView>("items","POST",{departmentId:dept.id,category:cat});
      select(next);select(await api<ItemView>(itemPath(next)+"/assignment","POST"));await open(next);
      document.querySelector<HTMLInputElement>("#item-title")?.focus();
    });
  }
  const rendered=draft && item ? {...draft,content:marked(draft.content,item.content,false),notes:marked(draft.notes,item.notes,true)} : undefined;
  async function save() {
    if(!item || !rendered)return;
    const {title,content,notes,tables,assignee}=rendered;
    select(await api<ItemView>(itemPath(item),"PUT",{title,content,notes,tables,...(assignee!==item.assignee ? {assignee} : {})}));
    setFeedback("중간 저장됨");
  }
  const previewDept={...dept,labels:{...dept.labels,thisWeek:label},items:{...dept.items,[cat]:dept.items[cat].map(it=>it.id===rendered?.id?rendered:it)}};
  const mine=item?.assignedPeople.some(p=>p.id===person.id), number=dept.items[cat].findIndex(it=>it.id===item?.id)+1;
  const message=item?.review.messages.at(-1);
  function review(method:"request-review"|"withdraw") {
    if(!item)return;
    void action(async()=>{
      if(dirty)await save();
      const updated=await api<ItemView>(itemPath(item)+"/"+method,"POST");
      select(updated);
      if(method==="withdraw")await open(updated);
      setFeedback(method==="withdraw"?"회수했습니다.":"검토를 요청했습니다.");
    });
  }
  return <>{sections.length>1 && <label className="scope">작성할 처<select value={dept.id} disabled={busy} onChange={e=>{
    const next=e.target.value;
    if ((!dirty && !labelDirty) || confirm("저장하지 않은 변경을 버리고 처를 바꿀까요?"))
      void action(async()=>{await release();onSection(next);});
  }}>{sections.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
  <div className="workspace" data-unsaved={dirty || labelDirty}>
    <section className="input-pane"><div className="section-head"><h2>업무 항목</h2>
      {person.departmentId===dept.id && <button disabled={busy || !online} onClick={add}>+ 항목 추가</button>}</div>
      <div className="categories" aria-label="업무 구분">{categories.map(c=><button key={c} aria-pressed={cat===c} disabled={busy}
        onClick={()=>{if(cat!==c)switchTo(c,dept.items[c][0]);}}>{names[c]} <small>{dept.items[c].length}</small></button>)}</div>
      <ol className="items">{dept.items[cat].map((it,i)=><li key={it.id}><button aria-current={it.id===item?.id?"true":undefined}
        disabled={busy} onClick={()=>{if(it.id!==item?.id)switchTo(cat,it);}}><span className="num">{String(i+1).padStart(2,"0")}</span>
        <span>{plainText(it.title) || "제목 없는 항목"}</span><Status value={it.status}/></button></li>)}</ol>
      {!dept.items[cat].length && <p>아직 등록된 항목이 없습니다.</p>}
      {error && <p role="alert">{error}</p>}{!online && <p role="alert">오프라인입니다. 연결 후 저장하세요.</p>}
      {item && draft && <section className="editor"><div className="section-head"><h2>{names[cat]} {number}번</h2>
        <Status value={item.status}/></div>
        <div className="edit-tools"><span role="status">{other ? item.lock!.message : editable ? `${person.name} 편집 중` : "읽기 전용"}</span>
          {item.status==="검토 요청" && item.actions.includes("withdraw") && <button disabled={busy || !online} onClick={()=>review("withdraw")}>회수</button>}
          {item.status!=="검토 요청" && !other && (mine && !editable ? <button disabled={busy || !online} onClick={()=>void action(async()=>{
            const renewed=await api<ItemView>(itemPath(item)+"/lock","POST");held.current=renewed.id;
            if(dirty){setItem(renewed);replace(renewed);}else select(renewed);
          })}>편집 시작</button> : <button className={mine?"":"primary"} disabled={busy || !online} onClick={assign}>{mine?"내 담당 해제":"내게 할당하고 편집"}</button>)}</div>
        {message && message.versionId===item.review.version?.id && <p className="review-message"><b>수정 요청 사유</b>{message.message}</p>}
        <form className="fields" onSubmit={e=>{e.preventDefault();if(editable && dirty)void action(save);}}>
          <label>제목<input id="item-title" value={plainText(draft.title)} readOnly={!editable || busy}
            onChange={e=>setDraft({...draft,title:editText(draft.title,e.target.value,true)})}/></label>
          <label>내용<textarea rows={3} value={linesText(draft.content)} readOnly={!editable || busy}
            onChange={e=>setDraft({...draft,content:editLines(draft.content,e.target.value)})}/></label>
          <label>부가 설명<textarea rows={2} value={linesText(draft.notes)} readOnly={!editable || busy}
            onChange={e=>setDraft({...draft,notes:editLines(draft.notes,e.target.value)})}/></label>
          {!!draft.tables.length && <p className="table-note">표 {draft.tables.length}개 · 양식 미리보기에서 확인</p>}
          <label>업무담당자<input value={draft.assignee} readOnly={!editable || busy}
            onChange={e=>setDraft({...draft,assignee:e.target.value})}/></label>
          {(editable || feedback || item.actions.includes("request-review")) && <div className="save-line"><span role="status">{dirty?"저장하지 않은 변경":feedback || "저장된 내용"}</span>
            <div className="actions">{editable && <button className={dirty?"primary":""} disabled={busy || !dirty}>중간 저장</button>}
            {(item.actions.includes("request-review") || (editable && dirty)) && <button type="button" className={dirty?"":"primary"}
              disabled={busy || !online} onClick={()=>review("request-review")}>{dirty?"저장 후 검토 요청":item.review.version?"검토 재요청":"검토 요청"}</button>}</div></div>}
        </form>
      </section>}
    </section>
    <aside className="preview-pane" aria-label="양식 미리보기"><div className="section-head"><h2>양식 미리보기</h2>
      <a className="button" href="/api/week/hwpx" download onClick={e=>{
        if((dirty || labelDirty) && !confirm("저장된 내용으로 전체 주차 파일을 내려받을까요?"))e.preventDefault();
      }}>전체 주차 HWPX 다운로드</a></div>
      {person.departmentId===dept.id && <div className="label-tools">{editLabel ? <form onSubmit={e=>{
        e.preventDefault();void action(async()=>{
          const result=await api<Pick<DepartmentView,"labels">>(`departments/${dept.id}/label`,"PUT",{thisWeek:label});
          setDept(d=>({...d,labels:result.labels}));setLabel(result.labels.thisWeek);setEditLabel(false);
        });}}><label>오른쪽 소제목<input value={label} required onChange={e=>setLabel(e.target.value)}/></label>
        <button disabled={busy || !online || !label.trim()}>적용</button><button type="button" onClick={()=>{setLabel(dept.labels.thisWeek);setEditLabel(false);}}>취소</button></form>
        : <><span>오른쪽 소제목 <b>{label}</b></span><button onClick={()=>setEditLabel(true)}>소제목 변경</button></>}</div>}
      <Preview dept={previewDept} week={week}/>
    </aside>
  </div></>;
}
