import type { DashboardView, ItemStatus, Organisation, Person, TodoView, WeekView } from "../shared/api";
import { categories, plainText } from "../shared/weekly-plan";

export const names = { lastWeek:"전주 실적", thisWeek:"금주 계획", ongoing:"계속업무" };
export type Place = { page:"첫 화면"|"작성"|"현황판"; departmentId?:string; itemId?:string; stageId?:number };
export function Status({value}:{value:ItemStatus}) {
  return <span className="status" data-status={value}>{value}</span>;
}
export function Heading({week,title}:{week:WeekView;title:string}) {
  return <div className="page-heading"><div><div className="context">{week.title}</div><h1>{title}</h1></div>
    <div className="week"><span>현재 주차</span><b>{week.writtenDate.slice(0,4)}년 {week.thisWeekPeriod.replace(/[()]/g,"")}</b></div></div>;
}
export function Todos({week,view,board,units,person,go}:{week:WeekView;view:TodoView;board:DashboardView;
  units:Organisation[];person:Person;go:(place:Place)=>void}) {
  const todos=view.todos.toSorted((a,b)=>Number("status" in b && b.status==="수정 요청")-Number("status" in a && a.status==="수정 요청"));
  return <main className="page"><Heading title="내가 할 일" week={week}/>
    <section className="task-list" aria-label="내가 처리할 업무">
      {!todos.length && <div className="empty"><h2>지금 처리할 일이 없습니다.</h2><p>{person.departmentId?"작성 화면에서 업무 항목을 선택해 본인에게 할당할 수 있습니다.":"현황판에서 조직별 진행 상태를 확인할 수 있습니다."}</p>
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
