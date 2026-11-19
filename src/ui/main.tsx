import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { DashboardView, Organisation, Person, TodoView, WeekView } from "../shared/api";
import { api, roles } from "./api";
import { SignIn } from "./SignIn";
import { Writing } from "./Writing";
import { Dashboard } from "./Dashboard";
import { Todos, type Place } from "./Workflow";

function Screen({person,units,place,go}:{person:Person;units:Organisation[];place:Place;go:(p:Place)=>void}) {
  const [data,setData]=useState<{week:WeekView;board?:DashboardView;todos?:TodoView}>();
  const [error,setError]=useState(""),[change,setChange]=useState(0);
  const refresh=()=>setChange(n=>n+1);
  useEffect(()=>{
    let stopped=false,timer:number,revision=-1,interval=1000;
    async function load(){
      try{
        if(place.page==="작성"){
          const week=await api<WeekView>("week");if(!stopped)setData({week});
        }else{
          const todos=place.page==="첫 화면"?await api<TodoView>("todos"):undefined;
          const summary=todos ?? await api<DashboardView>("dashboard");
          interval=summary.pollIntervalMs;
          if(!stopped && summary.revision!==revision){
            const [week,board]=await Promise.all([api<WeekView>("week"),"stages" in summary?summary:api<DashboardView>("dashboard")]);
            if(!stopped){revision=summary.revision;setData({week,board,todos});}
          }
        }
        if(!stopped)setError("");
      }catch(e){if(!stopped)setError(navigator.onLine?(e as Error).message:"오프라인입니다. 연결 후 다시 시도하세요.");}
      if(!stopped && place.page!=="작성")timer=window.setTimeout(load,interval);
    }
    void load();return ()=>{stopped=true;clearTimeout(timer);};
  },[change,place.page]);
  return <>{error && <p className="notice" role="alert">{error} <button onClick={refresh}>다시 시도</button></p>}
    {!data?<main className="page" role="status">주간업무 계획을 불러오는 중…</main>:
    place.page==="작성"?<Writing person={person} week={data.week} units={units} departmentId={place.departmentId} itemId={place.itemId}/>:
    place.page==="현황판" && data.board?<Dashboard person={person} units={units} place={place} week={data.week} board={data.board} refresh={refresh}/>:
    data.todos && data.board?<Todos week={data.week} view={data.todos} board={data.board} units={units} person={person} go={go}/>:null}</>;
}

function App() {
  const [accounts, setAccounts] = useState<Person[]>([]), [units, setUnits] = useState<Organisation[]>([]);
  const [person, setPerson] = useState<Person | null>(), [place,setPlace]=useState<Place>({page:"첫 화면"});
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<Person[]>("accounts"), api<Organisation[]>("organisations"), api<{person: Person|null}>("session")])
      .then(([people, org, session]) => {setAccounts(people);setUnits(org);setPerson(session.person);})
      .catch(e => setError(e.message));
  }, []);
  function go(next:Place){
    if(document.querySelector('[data-unsaved="true"]') && !confirm("저장하지 않은 변경을 버리고 이동할까요?"))return;
    if(place.page==="작성")window.dispatchEvent(new Event("lx:leave-writing"));
    setPlace(next);window.scrollTo(0,0);
  }
  if (error) return <main className="page"><h1>불러오기 실패</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>다시 시도</button></main>;
  if (person === null) return <SignIn accounts={accounts} units={units} onSignIn={p => {
    setAccounts(old => old.some(a => a.id === p.id) ? old : [...old,p]);setPerson(p);
  }} />;
  if (!person) return <main className="page" role="status">주간업무 계획을 불러오는 중…</main>;
  const org = units.find(o => o.id === person.organisationId);
  return <><header className="mast"><strong>주간업무 계획</strong>
    <nav aria-label="주 메뉴">{(["첫 화면","작성","현황판","게시판","기록"] as const).map(m =>
      m==="게시판" || m==="기록"?<button key={m} disabled title="아직 제공하지 않는 메뉴">{m}</button>:
      <button key={m} aria-current={place.page===m?"page":undefined} onClick={()=>{if(place.page!==m)go({page:m});}}>{m}</button>)}</nav>
    <div className="identity"><b>{person.name} {person.title}</b><span>{org?.name} · {roles[person.role]}</span>
      <button onClick={async () => {
        if (document.querySelector('[data-unsaved="true"]') && !confirm("저장하지 않은 변경을 버리고 계정을 전환할까요?")) return;
        try {await api("session","DELETE");setPlace({page:"첫 화면"});setPerson(null);}catch(e){setError((e as Error).message);}
      }}>계정 전환</button></div>
  </header>
  <Screen key={`${person.id}:${place.page}`} person={person} units={units} place={place} go={go}/>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
