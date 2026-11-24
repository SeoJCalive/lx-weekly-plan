import { useState, type FormEvent } from "react";
import type { Organisation, Person, SignInRequest } from "../shared/api";
import { api, roles } from "./api";

const demoFocus = [
  ["W2001", "업무 작성 · 검토 요청"],
  ["R0002", "처 업무 승인 · 수정 요청 · 처 취합본 상신"],
  ["O0001", "처 취합본 승인 · 실 취합본 상신"],
  ["D0001", "최종 승인 · 게시판 게시 · 이력 · 통계"],
] as const;
const demoNumbers = new Set<string>(demoFocus.map(([number]) => number));

export function SignIn({ accounts, units, onSignIn }: {
  accounts: Person[]; units: Organisation[]; onSignIn: (person: Person) => void;
}) {
  const [name, setName] = useState(""), [number, setNumber] = useState("");
  const [profile, setProfile] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function enter(request: SignInRequest) {
    setBusy(true); setError("");
    try { onSignIn((await api<{ person: Person }>("session", "POST", request)).person); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile && !accounts.some(a => a.employeeNumber === number.trim())) { setProfile(true); return; }
    const data = new FormData(e.currentTarget);
    void enter({ name: name.trim(), employeeNumber: number.trim(), ...(profile ? {
      departmentId: String(data.get("department")), title: String(data.get("title")).trim(),
    } : {}) });
  }
  const demo = demoFocus.flatMap(([number, focus]) => {
    const person = accounts.find(a => a.employeeNumber === number);
    return person ? [[`${person.name} (${roles[person.role]})`, focus] as const] : [];
  });
  return <><header className="mast"><strong>주간업무 계획</strong></header>
    <main className="entry">
      <section><h1>로그인</h1><p>이름과 사번으로 로그인합니다.</p>
        <form onSubmit={submit} className="fields">
          <label>이름<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
          <label>사번<input required autoComplete="username" value={number} onChange={e => {setNumber(e.target.value);setProfile(false);}} /></label>
          {profile && <><p role="status">처음 로그인하는 사용자입니다. 소속과 직급을 입력하세요.</p>
            <label>소속 처<select required name="department" defaultValue=""><option value="" disabled>처 선택</option>
              {units.filter(o => o.kind === "department").map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label>직급<input required name="title" /></label></>}
          {error && <p role="alert">{error}</p>}<button className="primary" disabled={busy}>로그인</button>
        </form>
      </section>
      <section aria-label="사용자 목록"><div className="account-head"><div><h2>사용자 선택</h2><p>이름을 선택하면 그 사용자로 로그인합니다.</p>
          {demo.length > 0 && <p className="recommend-note"><span className="recommend">추천</span> 추천 사용자<br />작성부터 최종 승인까지 이어지는 결재 라인입니다.</p>}</div>
        {demo.length > 0 && <aside className="recommend-focus" aria-label="추천 사용자별로 할 수 있는 일">
          <dl>{demo.map(([name, focus]) => <div key={name}><dt>{name}</dt><dd>{focus}</dd></div>)}</dl></aside>}</div>
        {units.filter(o => accounts.some(a => a.organisationId === o.id)).map(o => <section className="account-group" key={o.id}>
          <h3>{o.name}</h3><div className="account-list">{accounts.filter(a => a.organisationId === o.id).map(a =>
            <button key={a.id} disabled={busy} onClick={() => void enter({name:a.name,employeeNumber:a.employeeNumber})}>
              <b>{a.name}{demoNumbers.has(a.employeeNumber) && <>{" "}<span className="recommend">추천</span></>}</b><span>{a.title} · {roles[a.role]}</span><small>{a.employeeNumber}</small>
            </button>)}</div></section>)}
      </section>
    </main></>;
}
