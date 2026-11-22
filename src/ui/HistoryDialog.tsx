import { useEffect, useRef } from "react";
import { History } from "./History";

export function HistoryDialog({itemId,weekId,close,openRecord}:{
  itemId:string;weekId:number;close:()=>void;openRecord:(itemId:string,stepId:number)=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const opener=document.activeElement;
    const old=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialog.current?.showModal();
    return ()=>{
      document.body.style.overflow=old;
      if(opener instanceof HTMLElement && opener.isConnected)opener.focus();
    };
  },[]);
  return <dialog ref={dialog} className="history-dialog" aria-labelledby="history-dialog-title" onClose={close} onKeyDown={e=>{
    if(e.key!=="Tab")return;
    const controls=e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),summary,a[href],[tabindex='0']");
    const first=controls[0],last=controls[controls.length-1];
    if((e.shiftKey && document.activeElement===first) || (!e.shiftKey && document.activeElement===last)){
      e.preventDefault();(e.shiftKey?last:first)?.focus();
    }
  }}>
    <div className="dialog-heading"><h2 id="history-dialog-title">처리 이력</h2><button autoFocus onClick={()=>dialog.current?.close()}>닫기</button></div>
    <History target={{kind:"item",id:itemId}} weekId={weekId} narrow openRecord={(id,stepId)=>{
      close();openRecord(id,stepId);
    }}/>
  </dialog>;
}
