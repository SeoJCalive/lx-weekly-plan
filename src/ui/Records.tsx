import { useState, type ReactNode } from "react";
import type { DashboardView, StatisticsView, WeekView } from "../shared/api";
import { categories, plainText } from "../shared/weekly-plan";
import { History, type HistoryTarget } from "./History";
import { ItemPreview } from "./Preview";
import { Heading, names } from "./Workflow";

export function Records({week,board,stats,itemId,stepId,picker}:{week:WeekView;board:DashboardView;stats:StatisticsView;itemId?:string;stepId?:number;picker:ReactNode}) {
  const groups=week.departments.filter(d=>board.departments.find(s=>s.departmentId===d.id)?.items.length);
  const initial=groups.find(d=>categories.some(c=>d.items[c].some(it=>it.id===itemId))) ?? groups[0];
  const [departmentId,setDepartment]=useState(initial?.id),[tab,setTab]=useState("기록");
  const [selection,select]=useState<{target:HistoryTarget;stepId?:number}>({
    target:{kind:itemId?"item":"section",id:itemId??initial?.id??""},stepId,
  });
  const dept=groups.find(d=>d.id===departmentId);
  function openItem(id:string,entryId?:number){select({target:{kind:"item",id},stepId:entryId});}
  return <main className="page records-page"><Heading week={week} title="기록" picker={picker}/>
    <div className="record-tabs" role="tablist" aria-label="기록과 통계">{["기록","통계"].map(t=>
      <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab===t} aria-controls={`panel-${t}`}
        onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==="기록"?<section role="tabpanel" id="panel-기록" aria-labelledby="tab-기록">
      {!dept?<p>이 주차에 열람할 수 있는 항목이 없습니다.</p>:
      <History key={`${selection.target.kind}:${selection.target.id}:${selection.stepId??""}`} target={selection.target} stepId={selection.stepId}
        weekId={week.id} revision={board.revision} openItem={openItem}
        preview={entry=><section className="history-form"><h3>양식 미리보기</h3><ItemPreview dept={dept} item={entry.content}/></section>}
        navigation={steps=><>
          <label className="record-picker">처<select value={departmentId} onChange={e=>{
            setDepartment(e.target.value);select({target:{kind:"section",id:e.target.value}});
          }}>{groups.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <button className="history-object" aria-expanded={selection.target.kind==="section"} onClick={()=>select({target:{kind:"section",id:dept.id}})}>처 전체</button>
          {selection.target.kind==="section" && steps}
          {categories.map(c=><section className="history-group" key={c}><h3>{names[c]}</h3>
            {!dept.items[c].length && <p>등록된 항목이 없습니다.</p>}
            {dept.items[c].map(it=><div key={it.id}><button className="history-object" aria-expanded={selection.target.id===it.id}
              onClick={()=>openItem(it.id)}>{plainText(it.title)||"제목 없는 항목"}</button>
              {selection.target.id===it.id && steps}</div>)}</section>)}
        </>}/>}
    </section>:<section role="tabpanel" id="panel-통계" aria-labelledby="tab-통계"><h2>처별 통계</h2>
      <table className="statistics"><thead><tr><th scope="col">처</th><th scope="col">수정</th><th scope="col">수정 요청</th><th scope="col">마감 준수</th></tr></thead>
        <tbody>{stats.departments.map(d=><tr key={d.departmentId}><th scope="row">{d.name}</th><td>{d.revisions}</td><td>{d.revisionRequests}</td>
          <td>{d.deadlineMet===null?"미상신":d.deadlineMet?"준수":"미준수"}</td></tr>)}</tbody></table>
      <p className="stats-note">수정은 재요청 횟수이며, 마감 준수는 처 취합본의 최초 상신 시각 기준입니다.</p>
    </section>}
  </main>;
}
