import type { ReactNode } from "react";
import type { DashboardView, ItemStatus, Organisation, Person, TodoView, WeekSummary, WeekView } from "../shared/api";
import { categories, plainText } from "../shared/weekly-plan";

export const names = { lastWeek:"전주 실적", thisWeek:"금주 계획", ongoing:"계속업무" };
export type Place = { page:"첫 화면"|"작성"|"현황판"|"게시판"; departmentId?:string; itemId?:string; stageId?:number; weekId?:number; postId?:number };
export function Status({value}:{value:ItemStatus}) {
  return <span className="status" data-status={value}>{value}</span>;
}
export function WeekPicker({weeks,id,select}:{weeks:WeekSummary[];id:number;select:(id:number)=>void}) {
  const period=(w:WeekSummary)=>`${w.writtenDate.slice(0,4)}년 ${w.thisWeekPeriod.replace(/[()]/g,"")}`;
  if(weeks.length===1)return <div className="week"><span>현재 주차</span><b>{period(weeks[0])}</b></div>;
  return <label className="week">작업 주차<select value={id} onChange={e=>select(Number(e.target.value))}>
    {weeks.map(w=><option key={w.id} value={w.id}>{w.isCurrent?"현재":"이전"} 주차 · {period(w)}</option>)}</select></label>;
}
export function Heading({week,title,picker}:{week:WeekView;title:string;picker:ReactNode}) {
  return <div className="page-heading"><div><div className="context">{week.title}</div><h1>{title}</h1></div>{picker}</div>;
}
export function Todos({week,view,board,units,person,go,picker,release}:{week:WeekView;view:TodoView;board:DashboardView;
  units:Organisation[];person:Person;go:(place:Place)=>void;picker:ReactNode;release?:ReactNode}) {
  const todos=view.todos.toSorted((a,b)=>Number("status" in b && b.status==="수정 요청")-Number("status" in a && a.status==="수정 요청"));
  return <main className="page"><Heading title="내가 할 일" week={week} picker={picker}/>{release}
    <section className="task-list" aria-label="내가 처리할 업무">
      {!todos.length && !release && <div className="empty"><h2>지금 처리할 일이 없습니다.</h2><p>{person.departmentId?"작성 화면에서 업무 항목을 선택해 본인에게 할당할 수 있습니다.":"현황판에서 조직별 진행 상태를 확인할 수 있습니다."}</p>
        <button className="primary" onClick={()=>go({page:person.departmentId?"작성":"현황판"})}>{person.departmentId?"작성으로 이동":"현황판으로 이동"}</button></div>}
      {todos.map(t=>{
        const dept="departmentId" in t?week.departments.find(d=>d.id===t.departmentId):undefined;
        const it="itemId" in t && dept?categories.flatMap(c=>dept.items[c]).find(i=>i.id===t.itemId):undefined;
        const stage="stageId" in t?board.stages.find(s=>s.id===t.stageId):undefined;
        const unit=units.find(u=>u.id===stage?.organisationId);
        const action=t.kind==="write"?"작성":t.kind==="submit"?"상신":"검토";
        const title=it?plainText(it.title)||"제목 없는 항목":t.kind==="submit"?`${unit?.name} 취합본`:`${dept?.name} 섹션`;
        return <button className="task-row" key={`${t.kind}:${it?.id??dept?.id??stage?.id}`} onClick={()=>go({page:t.kind==="write"?"작성":"현황판",
          departmentId:dept?.id,itemId:it?.id,stageId:stage?.id})}>
          <span className="task-object"><small>{it?`${dept?.name} / ${names[it.category]}`:unit?.name}</small><b>{title}</b></span>
          <Status value={"status" in t?t.status:t.kind==="submit"?"승인":"검토 요청"}/><span>{action} →</span></button>;
      })}
    </section></main>;
}
