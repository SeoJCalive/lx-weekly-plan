import type { ReviewStage } from "../shared/api";

export function ReviewCard({kind,message,at,sender,reviewUnit,context,open=false}:{
  kind:"request"|"note";message:string;at:number;sender?:string;
  reviewUnit?:ReviewStage["reviewUnit"];context?:string;open?:boolean;
}) {
  return <details className="review-card" data-kind={kind} open={open}>
    <summary>{({request:"수정 요청",note:"수정 사유"} as const)[kind]}</summary>
    <div className="review-card-body">
      {context && <b>{context}</b>}
      <div className="review-card-meta">{sender && <span>{sender}</span>}
        <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>
        {reviewUnit && <span>{reviewUnit==="section"?"처 전체 검토":"항목 검토"}</span>}
      </div>
      <p>{message}</p>
    </div>
  </details>;
}
