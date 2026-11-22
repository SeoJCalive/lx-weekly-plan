import type { ReactNode } from "react";
import type { DashboardDepartment, DashboardView, ItemStatus, Organisation, WeekSummary, WeekView } from "../shared/api";

export const names = { lastWeek:"전주 실적", thisWeek:"금주 계획", ongoing:"계속업무" };
export type Place = { page:"게시판"|"작성"|"현황판"|"기록"; departmentId?:string; itemId?:string; stepId?:number; stageId?:number; weekId?:number; postId?:number; recordsTab?:"기록"|"통계" };
export function Status({value,label=value}:{value:ItemStatus;label?:string}) {
  return <span className="status" data-status={value}>{label}</span>;
}
export function StageProgress({dept,board,units}:{dept:DashboardDepartment;board:DashboardView;units:Organisation[]}) {
  const {counts}=dept;
  const started=counts["작성 중"] || counts["검토 요청"] || counts["승인"];
  const itemState:ItemStatus=counts["수정 요청"]?"수정 요청":
    counts["작성 중"] || (counts["미작성"] && started)?"작성 중":
    counts["검토 요청"]?"검토 요청":counts["승인"]?"승인":"미작성";
  const steps=[];
  let stage=board.stages.find(s=>s.organisationId===dept.departmentId);
  while(stage){
    const {id,parentStageId,organisationId}=stage;
    const unit=units.find(u=>u.id===organisationId);
    if(!unit)break;
    const name={department:"처",office:"실",headquarters:"본부"}[unit.kind];
    const status=stage.reviewUnit==="item"?itemState:dept.reviews.find(r=>r.stageId===id)?.status;
    steps.push({name,status,label:`${name}: ${status??"미도달"}`});
    stage=board.stages.find(s=>s.id===parentStageId);
  }
  return <span className="stage-bar" role="img" aria-label={steps.map(s=>s.label).join(", ")}>
    {steps.map(s=><span key={s.name} data-status={s.status} title={s.label}>{s.name}</span>)}</span>;
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
