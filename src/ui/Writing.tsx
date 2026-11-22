import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DepartmentView, ItemView, Organisation, Person, WeekView } from "../shared/api";
import { categories, plainText, type WorkCategory } from "../shared/weekly-plan";
import { api } from "./api";
import { Preview, tableGeometry } from "./Preview";
import { marked, sameLine } from "./text";
import { EmphasisField } from "./EmphasisField";
import { TableEditor } from "./TableEditor";
import { UndoInput } from "./UndoInput";
import { newTable } from "./table";
import { names, Status } from "./Workflow";
import { ReviewCard } from "./ReviewCard";

const itemPath=(it:ItemView)=>`items/${encodeURIComponent(it.id)}`;
function otherEditor(it:ItemView,person:Person){
  return it.lock && it.lock.personId!==person.id && it.lock.expiresAt>Date.now()?it.lock.name:undefined;
}
function EditorBadge({name}:{name:string}){
  return <span className="editor-badge" role="img" aria-label={`${name} 편집 중`} title={`${name} 편집 중`}>{Array.from(name)[0]}</span>;
}
function ExportMenu({weekId,scopes,unsaved}:{weekId:number;scopes:{id:string;name:string}[];unsaved:boolean}) {
  const [open,setOpen]=useState(false);
  const box=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    function outside(e:PointerEvent){if(!box.current?.contains(e.target as Node))setOpen(false);}
    function escape(e:KeyboardEvent){if(e.key==="Escape"){setOpen(false);trigger.current?.focus();}}
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return ()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[open]);
  return <div ref={box} className="export-menu" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    <button type="button" ref={trigger} aria-label="한글 파일 내려받기" aria-expanded={open} aria-controls="export-scopes"
      onClick={()=>setOpen(!open)}><span aria-hidden="true">↓</span> HWPX</button>
    <div id="export-scopes" hidden={!open} className="export-scopes">{scopes.map(u=><a className="button" key={u.id}
      href={`/api/week/hwpx?weekId=${weekId}${u.id?`&organisationId=${encodeURIComponent(u.id)}`:""}`} download
      onClick={e=>{if(unsaved && !confirm(`저장된 내용으로 ${u.name} 파일을 내려받을까요?`))e.preventDefault();setOpen(false);trigger.current?.focus();}}>{u.name}</a>)}</div>
  </div>;
}
export function Writing({person,week,units,departmentId,itemId,picker,history}:{person:Person;week:WeekView;units:Organisation[];departmentId?:string;itemId?:string;picker:ReactNode;history:(id:string)=>void}) {
  const sections=week.departments.filter(d=>{
    let id:string|null=d.id;
    while (id) { if (id===person.organisationId) return true; id=units.find(o=>o.id===id)?.parentId ?? null; }
    return false;
  });
  const [id,setId]=useState(departmentId ?? sections[0]?.id);
  const current=sections.find(d=>d.id===id);
  const office=units.find(o=>o.kind==="office" && o.id===units.find(d=>d.id===id)?.parentId &&
    (person.organisationId===o.id || person.organisationId===o.parentId));
  return <main id="writing" className="page">
    <div className="page-heading"><div><div className="context">{week.title} <span>/</span> 작성</div><h1>{current?.name} 업무 작성</h1></div>
      {picker}
    </div>
    {current ? <Desk key={current.id} initial={current} week={week} person={person} sections={sections} onSection={setId} itemId={itemId} history={history} office={office}/> : <p>작성 가능한 처가 없습니다.</p>}
  </main>;
}
function Desk({initial,week,person,sections,onSection,itemId,history,office}:{initial:DepartmentView;week:WeekView;person:Person;sections:DepartmentView[];onSection:(id:string)=>void;itemId?:string;history:(id:string)=>void;office?:Organisation}) {
  const key=`lx:${week.id}:${person.id}:${initial.id}`;
  const first=categories.flatMap(c=>initial.items[c]).find(it=>it.id===(itemId ?? sessionStorage.getItem(key))) ?? initial.items.thisWeek[0] ?? initial.items.lastWeek[0] ?? initial.items.ongoing[0];
  const [dept,setDept]=useState(initial), [cat,setCat]=useState<WorkCategory>(first?.category ?? "thisWeek");
  const [item,setItem]=useState<ItemView|undefined>(first), [draft,setDraft]=useState<ItemView|undefined>(first);
  const [label,setLabel]=useState(initial.labels.thisWeek), [editLabel,setEditLabel]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [feedback,setFeedback]=useState("");
  const [note,setNote]=useState("");
  const [toolField,setToolField]=useState("title"),[toolbar,setToolbar]=useState<HTMLDivElement|null>(null);
  const tools=(name:string)=>({toolbar:toolField===name?toolbar:null,activate:()=>setToolField(name)});
  const working=useRef(false), current=useRef<string|undefined>(first?.id), live=useRef(true), held=useRef<string|undefined>(undefined);
  const [online,setOnline]=useState(navigator.onLine);
  const [,setLastContact]=useState(Date.now());
  const dirty=!!draft && !!item && draft!==item && (draft.assignee!==item.assignee || !sameLine(draft.title,item.title,true) ||
    (["content","notes"] as const).some(k=>draft[k].length!==item[k].length || draft[k].some((line,i)=>!sameLine(line,item[k][i]))) ||
    (draft.tables!==item.tables && JSON.stringify(draft.tables)!==JSON.stringify(item.tables)));
  const labelDirty=label!==dept.labels.thisWeek;
  const editable=!!item?.canEdit && !!item.lock && item.lock.personId===person.id && item.lock.expiresAt>Date.now() && online;
  const other=item && otherEditor(item,person);
  function replace(it:ItemView) {
    setDept(d=>({...d,items:{...d.items,[it.category]:d.items[it.category].some(x=>x.id===it.id)
      ? d.items[it.category].map(x=>x.id===it.id?it:x) : [...d.items[it.category],it]}}));
  }
  function select(it:ItemView|undefined) {
    if(current.current!==it?.id){setNote("");setToolField("title");}
    current.current=it?.id;held.current=it?.lock?.personId===person.id ? it.id : undefined;
    setItem(it);setDraft(it);
    if (it) {replace(it);sessionStorage.setItem(key,it.id);}
  }
  function leaveOK() {return (!dirty && !note.trim()) || confirm("이 항목의 저장하지 않은 변경을 버릴까요?");}
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
    if(!dirty && !labelDirty && !note.trim()) return;
    const warn=(e:BeforeUnloadEvent)=>e.preventDefault();
    window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty,labelDirty,note]);
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
    if (!item)return;
    const mine=item.assignedPeople.some(p=>p.id===person.id);
    if (mine ? !confirm(dirty || note.trim()?"저장하지 않은 변경을 버리고 담당을 취소할까요?":"이 항목에서 담당을 취소할까요?") : !leaveOK())return;
    void action(async()=>{
      const next=await api<ItemView>(itemPath(item)+"/assignment",mine?"DELETE":"POST");select(next);
      if (mine)setNote("");else await open(next);
    });
  }
  const focusAdded=useRef<string|null>(null);
  useEffect(()=>{
    if(!busy && editable && item?.id===focusAdded.current){
      document.querySelector<HTMLInputElement>("#item-title")?.focus();
      focusAdded.current=null;
    }
  },[busy,editable,item?.id]);
  function add() {
    if(!leaveOK())return;
    void action(async()=>{
      await release();
      const next=await api<ItemView>(`items?weekId=${week.id}`,"POST",{departmentId:dept.id,category:cat});
      select(next);select(await api<ItemView>(itemPath(next)+"/assignment","POST"));await open(next);
      focusAdded.current=next.id;
    });
  }
  const rendered=draft && item ? {...draft,content:marked(draft.content,item.content,false),notes:marked(draft.notes,item.notes,true)} : undefined;
  useEffect(()=>{
    const pane=document.querySelector<HTMLElement>(".workspace .preview-pane");
    const td=pane?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item?.id??"")}"]`);
    if(pane && td && pane.scrollHeight>pane.clientHeight) {
      const delta=td.getBoundingClientRect().top-pane.getBoundingClientRect().top;
      if(delta<0 || delta+td.offsetHeight>pane.clientHeight)pane.scrollTop+=delta-pane.clientHeight/4;
    }
  },[item?.id]);
  async function save() {
    if(!item || !rendered)return;
    const {title,content,notes,tables,assignee}=rendered;
    select(await api<ItemView>(itemPath(item),"PUT",{title,content,notes,tables,...(assignee!==item.assignee ? {assignee} : {})}));
  }
  const previewDept={...dept,labels:{...dept.labels,thisWeek:label},items:{...dept.items,[cat]:dept.items[cat].map(it=>it.id===rendered?.id?rendered:it)}};
  const mine=item?.assignedPeople.some(p=>p.id===person.id), number=dept.items[cat].findIndex(it=>it.id===item?.id)+1;
  const message=item?.review.messages.at(-1);
  function review(method:"request-review"|"withdraw") {
    if(!item)return;
    void action(async()=>{
      if(dirty)await save();
      const updated=await api<ItemView>(itemPath(item)+"/"+method,"POST",method==="request-review"?{note}:undefined);
      setNote("");
      select(updated);
      if(method==="withdraw")await open(updated);
      setFeedback(method==="withdraw"?"회수했습니다.":"검토를 요청했습니다.");
    });
  }
  return <>{sections.length>1 && <label className="scope">작성할 처<select value={dept.id} disabled={busy} onChange={e=>{
    const next=e.target.value;
    if ((!dirty && !labelDirty && !note.trim()) || confirm("저장하지 않은 변경을 버리고 처를 바꿀까요?"))
      void action(async()=>{await release();onSection(next);});
  }}>{sections.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
  <div className="workspace" data-unsaved={dirty || labelDirty || !!note.trim()}>
    <section className="input-pane"><div className="section-head"><h2>업무 항목</h2></div>
      <div className="categories" aria-label="업무 구분">{categories.map(c=><button key={c} aria-pressed={cat===c} disabled={busy}
        onClick={()=>{if(cat!==c)switchTo(c,dept.items[c][0]);}}>{names[c]} <small>{dept.items[c].length}</small></button>)}</div>
      <ol className="items">{dept.items[cat].map((it,i)=>{const editor=otherEditor(it,person);return <li key={it.id} data-locked={!!editor} data-returned={it.status==="수정 요청"}><button aria-current={it.id===item?.id?"true":undefined}
        disabled={busy} onClick={()=>{if(it.id!==item?.id)switchTo(cat,it);}}><span className="num">{String(i+1).padStart(2,"0")}</span>
        <span>{plainText(it.title) || "제목 없는 항목"}</span><span className="actions">{editor && <EditorBadge name={editor}/>}<Status value={it.status}/></span></button></li>;})}</ol>
      {!dept.items[cat].length && <p>아직 등록된 항목이 없습니다.</p>}
      {person.departmentId===dept.id && <button disabled={busy || !online} onClick={add}>+ 항목 추가</button>}
      {error && <p role="alert">{error}</p>}{!online && <p role="alert">오프라인입니다. 연결 후 저장하세요.</p>}
      {item && draft && <section className="editor" data-locked={!!other} data-returned={item.status==="수정 요청"}><div className="section-head"><h2>{names[cat]} {number}번</h2>
        <div className="actions">{other && <EditorBadge name={other}/>}<Status value={item.status}/><button disabled={busy} onClick={()=>history(item.id)}>처리 이력</button></div></div>
        <div className="edit-tools">{!other && !editable && <span>읽기 전용</span>}
          {item.status==="검토 요청" && item.actions.includes("withdraw") && <button disabled={busy || !online} onClick={()=>review("withdraw")}>회수</button>}
          {item.status!=="검토 요청" && !other && (mine && !editable ? <button disabled={busy || !online} onClick={()=>void action(async()=>{
            const renewed=await api<ItemView>(itemPath(item)+"/lock","POST");held.current=renewed.id;
            if(dirty){setItem(renewed);replace(renewed);}else select(renewed);
          })}>편집 시작</button> : !mine && <button className="primary" disabled={busy || !online} onClick={assign}>담당 지정 후 작성</button>)}</div>
        {message && message.versionId===item.review.version?.id && <ReviewCard key={`request:${message.id}:${item.status}`} kind="request"
          message={message.message} at={message.at} sender={`${message.senderName} ${message.senderTitle}`}
          reviewUnit={message.reviewUnit} open={item.status==="수정 요청"}/>}
        {item.review.version?.note && <ReviewCard key={`note:${item.review.version.id}`} kind="note"
          message={item.review.version.note} at={item.review.version.requestedAt} open/>}
        <form className="fields" onSubmit={e=>{e.preventDefault();if(editable && dirty)void action(save);}}>
          <EmphasisField {...tools("title")} key={`${draft.id}/title`} id="item-title" label="제목" lines={[draft.title]} readOnly={!editable || busy}
            change={([title])=>setDraft({...draft,title})}/>
          <div ref={setToolbar} hidden={!editable || busy}/>
          <EmphasisField {...tools("content")} key={`${draft.id}/content`} id="item-content" label="내용" rows={3} lines={draft.content} readOnly={!editable || busy}
            change={content=>setDraft({...draft,content})}/>
          <EmphasisField {...tools("notes")} key={`${draft.id}/notes`} id="item-notes" label="참고 사항" rows={2} lines={draft.notes} readOnly={!editable || busy}
            change={notes=>setDraft({...draft,notes})}/>
          {editable ? <fieldset className="table-field" disabled={busy}><legend>표</legend>
            {draft.tables.map((table,i)=><TableEditor key={table.id} table={table} index={i+1}
              change={next=>setDraft({...draft,tables:draft.tables.map(t=>t===table?next:t)})}
              remove={()=>setDraft({...draft,tables:draft.tables.filter(t=>t!==table)})}/>)}
            <button type="button" onClick={()=>{
              const {width,height}=tableGeometry(draft.templateItemId??draft.id,`${dept.id}/${cat}`);
              setDraft({...draft,tables:[...draft.tables,newTable(cat==="ongoing"?3:2,cat==="ongoing"?4:3,width,height)]});
            }}>+ 표 추가</button></fieldset> :
            !!draft.tables.length && <p className="table-note">표 {draft.tables.length}개 · 양식 미리보기에서 확인</p>}
          <label>업무담당자<UndoInput key={`${draft.id}/assignee`} value={draft.assignee} readOnly={!editable || busy}
            change={assignee=>setDraft({...draft,assignee})}/></label>
          {feedback && <p role="status">{feedback}</p>}
          {(editable || item.actions.includes("request-review")) && <div className="save-line">
            <div className="revision-submit">
            {item.review.version && (item.actions.includes("request-review") || (editable && dirty)) && <label className="revision-note">수정 사유 (선택)
              <UndoInput key={`${draft.id}/note`} value={note} disabled={busy || !online} change={setNote}/></label>}
            <div className="actions">{editable && <><span className="save-dot" data-dirty={dirty} role="img" aria-label={dirty?"저장되지 않음":"저장됨"} title={dirty?"저장되지 않음":"저장됨"}/>
              <button className={dirty?"primary":""} disabled={busy || !dirty}>임시 저장</button></>}
            {(item.actions.includes("request-review") || (editable && dirty)) && <button type="button" className={dirty?"":"primary"}
              disabled={busy || !online} onClick={()=>review("request-review")}>{dirty?"저장 후 검토 요청":item.review.version?"검토 재요청":"검토 요청"}</button>}</div></div></div>}
        </form>
        {mine && editable && <div className="assignment-end"><button className="quiet-action" disabled={busy || !online} onClick={assign}>담당 취소</button></div>}
      </section>}
    </section>
    <aside className="preview-pane" aria-label="양식 미리보기"><div className="section-head export-head"><h2>양식 미리보기</h2>
      <ExportMenu weekId={week.id} scopes={[{id:"",name:"전체 주차"},...(office?[office]:[]),dept]} unsaved={dirty || labelDirty}/></div>
      {person.departmentId===dept.id && <div className="label-tools">{editLabel ? <form onSubmit={e=>{
        e.preventDefault();void action(async()=>{
          const result=await api<Pick<DepartmentView,"labels">>(`departments/${dept.id}/label?weekId=${week.id}`,"PUT",{thisWeek:label});
          setDept(d=>({...d,labels:result.labels}));setLabel(result.labels.thisWeek);setEditLabel(false);
        });}}><label>금주 계획 소제목<UndoInput value={label} required change={setLabel}/></label>
        <button disabled={busy || !online || !label.trim()}>적용</button><button type="button" onClick={()=>{setLabel(dept.labels.thisWeek);setEditLabel(false);}}>취소</button></form>
        : <><span>금주 계획 소제목 <b>{label}</b></span><button onClick={()=>setEditLabel(true)}>소제목 변경</button></>}</div>}
      <Preview dept={previewDept} week={week}/>
    </aside>
  </div></>;
}
