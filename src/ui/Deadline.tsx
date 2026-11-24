import { useRef, useState } from "react";
import type { DeadlineView } from "../shared/api";
import { api } from "./api";

const koreaTime=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"});

export function Deadline({value,manage,update}:{value:DeadlineView;manage:boolean;update:(v:DeadlineView)=>void}) {
  const [draft,setDraft]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const trigger=useRef<HTMLButtonElement>(null);
  function close(){setDraft(null);setError("");requestAnimationFrame(()=>trigger.current?.focus());}
  return <div className="deadline">
    <p><span>마감 <time dateTime={new Date(value.deadlineAt).toISOString()}>{koreaTime.format(value.deadlineAt)}</time></span>
      <strong role={value.passed?"alert":undefined}>{value.passed?"마감 경과":"마감 전"}</strong></p>
    {value.canChange && manage && (draft===null?<button ref={trigger} className="text-link" onClick={()=>setDraft(new Date(value.deadlineAt+9*3600000).toISOString().slice(0,16))}>마감 변경</button>:
      <form className="actions" onSubmit={async e=>{
        e.preventDefault();setBusy(true);setError("");
        try{update(await api<DeadlineView>(`deadline?weekId=${value.weekId}`,"PUT",{deadlineAt:Date.parse(draft+":00+09:00")}));close();}
        catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }} onKeyDown={e=>{if(e.key==="Escape"&&!busy)close();}}>
        <label>마감 일시 (한국시간)<input autoFocus type="datetime-local" required disabled={busy} value={draft} onChange={e=>setDraft(e.target.value)}/></label>
        <button className="primary" disabled={busy}>마감 저장</button><button type="button" disabled={busy} onClick={close}>취소</button>
        {error && <span role="alert">{error}</span>}
      </form>)}
  </div>;
}
