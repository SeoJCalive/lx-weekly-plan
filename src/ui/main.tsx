import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { Organisation, Person, WeekView } from "../shared/api";
import { api, roles } from "./api";
import { SignIn } from "./SignIn";
import { Writing } from "./Writing";

function App() {
  const [accounts, setAccounts] = useState<Person[]>([]), [units, setUnits] = useState<Organisation[]>([]);
  const [person, setPerson] = useState<Person | null>(), [week, setWeek] = useState<WeekView>();
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<Person[]>("accounts"), api<Organisation[]>("organisations"), api<{person: Person|null}>("session")])
      .then(([people, org, session]) => {setAccounts(people);setUnits(org);setPerson(session.person);})
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (person) api<WeekView>("week").then(setWeek).catch(e => setError(e.message));
  }, [person]);
  if (error) return <main className="page"><h1>불러오기 실패</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>다시 시도</button></main>;
  if (person === null) return <SignIn accounts={accounts} units={units} onSignIn={p => {
    setAccounts(old => old.some(a => a.id === p.id) ? old : [...old,p]);setPerson(p);
  }} />;
  if (!person || !week) return <main className="page" role="status">주간업무 계획을 불러오는 중…</main>;
  const org = units.find(o => o.id === person.organisationId);
  return <><header className="mast"><strong>주간업무 계획</strong>
    <nav aria-label="주 메뉴">{["첫 화면","작성","현황판","게시판","기록"].map(m =>
      m === "작성" ? <a key={m} href="#writing" aria-current="page">작성</a> :
        <button key={m} disabled title="아직 제공하지 않는 메뉴">{m}</button>)}</nav>
    <div className="identity"><b>{person.name} {person.title}</b><span>{org?.name} · {roles[person.role]}</span>
      <button onClick={async () => {
        if (document.querySelector('[data-unsaved="true"]') && !confirm("저장하지 않은 변경을 버리고 계정을 전환할까요?")) return;
        try {await api("session","DELETE");setWeek(undefined);setPerson(null);}catch(e){setError((e as Error).message);}
      }}>계정 전환</button></div>
  </header>
  <Writing key={person.id} week={week} person={person} units={units} />
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
