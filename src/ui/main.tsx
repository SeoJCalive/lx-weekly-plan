import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { BoardPost, DashboardView, DeadlineView, Organisation, Person, StatisticsView, TodoView, WeekSummary, WeekView } from "../shared/api";
import { api, roles } from "./api";
import { SignIn } from "./SignIn";
import { Writing } from "./Writing";
import { Dashboard } from "./Dashboard";
import { WeekPicker, type Place } from "./Workflow";
import { Publications, Release } from "./Publishing";
import { Deadline } from "./Deadline";
import { Records } from "./Records";
import { HistoryDialog } from "./HistoryDialog";

function Screen({person,units,place,go}:{person:Person;units:Organisation[];place:Place;go:(p:Place)=>void}) {
  const [data,setData]=useState<{week:WeekView;board?:DashboardView;posts?:BoardPost[]}>();
  const [weeks,setWeeks]=useState<WeekSummary[]>([]);
  const [deadline,setDeadline]=useState<DeadlineView>(),[stats,setStats]=useState<StatisticsView>();
  const [error,setError]=useState(""),[change,setChange]=useState(0);
  const [historyItem,setHistoryItem]=useState<string>();
  const refresh=()=>setChange(n=>n+1);
  useEffect(()=>{
    let stopped=false,timer:number,revision=-1,interval=1000,writingWeek:number|undefined;
    async function load(){
      try{
        const list=await api<WeekSummary[]>("weeks");
        if(stopped)return;
        setWeeks(list);
        const id=place.weekId ?? writingWeek ?? list.find(w=>w.isCurrent)!.id;
        const q=`?weekId=${id}`;
        if(place.page==="기록"){
          const s=await api<StatisticsView>("statistics"+q);if(stopped)return;setStats(s);
        }else{
          const d=await api<DeadlineView>("deadline"+q);if(stopped)return;setDeadline(d);
        }
        if(place.page==="작성"){
          if(!writingWeek){
            const week=await api<WeekView>("week"+q);if(!stopped){writingWeek=week.id;setData({week});}
          }
          interval=3000;
        }else{
          const board=await api<DashboardView>("dashboard"+q);
          interval=board.pollIntervalMs;
          if(!stopped && board.revision!==revision){
            const [week,posts]=await Promise.all([api<WeekView>("week"+q),person.role==="director"?api<BoardPost[]>("board"):undefined]);
            if(!stopped){revision=board.revision;setData({week,board,posts});}
          }
        }
        if(!stopped)setError("");
      }catch(e){if(!stopped)setError(navigator.onLine?(e as Error).message:"오프라인입니다. 연결 후 다시 시도하세요.");}
      if(!stopped)timer=window.setTimeout(load,interval);
    }
    void load();return ()=>{stopped=true;clearTimeout(timer);};
  },[change,place.page,place.weekId,person.role]);
  const week=weeks.find(w=>w.id===data?.week.id);
  const weekPicker=(context:Pick<Place,"recordsTab"|"departmentId">={})=>week && <div className="week-context"><WeekPicker weeks={weeks} id={week.id} select={id=>go({page:place.page,weekId:id,...context})}/>
    {deadline?.weekId===week.id && <Deadline value={deadline} manage={place.page!=="작성"} update={v=>{setDeadline(v);refresh();}}/>}</div>;
  const picker=weekPicker();
  const history=(itemId:string)=>setHistoryItem(itemId);
  const stage=data?.board?.stages.find(s=>s.reviewerId===person.id && s.reviewUnit==="section" && s.parentStageId===null);
  const release=stage && week && data?.board && data.posts && <Release key={week.id} week={week} board={data.board} stageId={stage.id} posts={data.posts} go={go}
    openWeek={id=>go({page:place.page,weekId:id})}/>;
  return <>{error && <p className="notice" role="alert">{error} <button onClick={refresh}>다시 시도</button></p>}
    {!data?<main className="page" role="status">주간업무 계획을 불러오는 중…</main>:
    place.page==="기록" && data.board && stats?<Records key={data.week.id} week={data.week} board={data.board} stats={stats} place={place} picker={weekPicker}/>:
    place.page==="작성"?<Writing person={person} week={data.week} units={units} departmentId={place.departmentId} itemId={place.itemId} picker={picker} history={history}/>:
    place.page==="현황판" && data.board?<Dashboard key={data.week.id} person={person} units={units} place={place} week={data.week} board={data.board} refresh={refresh} picker={picker} release={release} history={history}/>:null}
    {historyItem && data && <HistoryDialog itemId={historyItem} weekId={data.week.id} close={()=>setHistoryItem(undefined)}
      openRecord={(itemId,stepId)=>go({page:"기록",itemId,stepId,weekId:data.week.id})}/>}</>;
}

function App() {
  const [accounts, setAccounts] = useState<Person[]>([]), [units, setUnits] = useState<Organisation[]>([]);
  const [person, setPerson] = useState<Person | null>(), [place,setPlace]=useState<Place>({page:"게시판"});
  const [error, setError] = useState(""), [todo,setTodo]=useState<TodoView>();
  useEffect(() => {
    Promise.all([api<Person[]>("accounts"), api<Organisation[]>("organisations"), api<{person: Person|null}>("session")])
      .then(([people, org, session]) => {setAccounts(people);setUnits(org);setPerson(session.person);})
      .catch(e => setError(e.message));
  }, []);
  useEffect(()=>{
    setTodo(undefined);
    if(!person)return;
    let stopped=false,timer:number;
    async function load(){
      let interval=3000;
      try{
        const view=await api<TodoView>(`todos${place.weekId?`?weekId=${place.weekId}`:""}`);
        if(stopped)return;
        setTodo(view);interval=view.pollIntervalMs;
      }catch{if(!stopped)setTodo(undefined);} // 오류는 화면 본문이 알리고, 메뉴는 지난 숫자를 남기지 않는다.
      if(!stopped)timer=window.setTimeout(load,interval);
    }
    void load();return ()=>{stopped=true;clearTimeout(timer);};
  },[person,place.weekId]);
  function go(next:Place){
    if(document.querySelector('[data-unsaved="true"]') && !confirm("저장하지 않은 변경을 버리고 이동할까요?"))return;
    if(place.page==="작성")window.dispatchEvent(new Event("lx:leave-writing"));
    setPlace({weekId:place.weekId,...next});window.scrollTo(0,0);
  }
  if (error) return <main className="page"><h1>불러오기 실패</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>다시 시도</button></main>;
  if (person === null) return <SignIn accounts={accounts} units={units} onSignIn={p => {
    setAccounts(old => old.some(a => a.id === p.id) ? old : [...old,p]);setPerson(p);
  }} />;
  if (!person) return <main className="page" role="status">주간업무 계획을 불러오는 중…</main>;
  const org = units.find(o => o.id === person.organisationId);
  const counts:Partial<Record<Place["page"],number>>={
    작성:todo?.todos.filter(t=>t.kind==="write" && t.status==="수정 요청").length,
    현황판:todo?.todos.filter(t=>t.kind!=="write").length};
  return <><header className="mast"><strong>주간업무 계획</strong>
    <nav aria-label="주 메뉴">{(["게시판","작성","현황판","기록"] as const).map(m =>
      <button key={m} aria-current={place.page===m?"page":undefined} onClick={()=>{if(place.page!==m)go({page:m});}}>{m==="현황판"?"검토 현황":m==="기록"?"이력":m}
        {!!counts[m] && <span className="count" data-status={m==="작성"?"수정 요청":"검토 요청"}>{counts[m]}</span>}</button>)}</nav>
    <div className="identity"><b>{person.name} {person.title}</b><span>{org?.name} · {roles[person.role]}</span>
      <button onClick={async () => {
        if (document.querySelector('[data-unsaved="true"]') && !confirm("저장하지 않은 변경을 버리고 사용자를 변경할까요?")) return;
        try {await api("session","DELETE");setPlace({page:"게시판"});setPerson(null);}catch(e){setError((e as Error).message);}
      }}>사용자 변경</button></div>
  </header>
  {place.page==="게시판"?<Publications accounts={accounts} postId={place.postId}/>:
    <Screen key={`${person.id}:${place.page}:${place.weekId}`} person={person} units={units} place={place} go={go}/>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
