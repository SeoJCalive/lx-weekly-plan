import { hangingPrefix } from "../shared/paragraph";
import { plainText, type RichText } from "../shared/weekly-plan";
import type { Caret } from "./undo";

/** Paragraph boundaries count once; the BR keeping an empty line editable counts zero. */
export function readParagraphs(root:HTMLElement):{text:string;caret?:Caret} {
  let text="";
  const positions=new Map<Node,number|number[]>();
  const block=(node:Node)=>node.nodeName==="DIV" || node.nodeName==="P";
  function visit(node:Node) {
    if(node.nodeType===Node.TEXT_NODE) {
      positions.set(node,text.length);text+=node.textContent??"";return;
    }
    const offsets:number[]=[text.length],children=Array.from(node.childNodes);
    positions.set(node,offsets);
    children.forEach((child,i)=>{
      if(i && (block(child) || block(children[i-1])))text+="\n";
      offsets[i]=text.length;
      if(child.nodeName==="BR") {
        positions.set(child,[text.length]);
        if(i<children.length-1)text+="\n";
      } else visit(child);
      offsets[i+1]=text.length;
    });
  }
  visit(root);
  const selection=root.ownerDocument.getSelection();
  function offset(node:Node|null,at:number) {
    const position=node && positions.get(node);
    return typeof position==="number" ? position+at : position?.[at];
  }
  const anchor=selection && offset(selection.anchorNode,selection.anchorOffset);
  const focus=selection && offset(selection.focusNode,selection.focusOffset);
  return {text,...(anchor!=null && focus!=null ? {caret:{
    start:Math.min(anchor,focus),end:Math.max(anchor,focus),direction:anchor>focus?"backward":"forward",
  } as Caret} : {})};
}

export function measureParagraphs(root:HTMLElement) {
  const probe=root.ownerDocument.createElement("span");
  probe.style.cssText="position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
  root.append(probe);
  for(const line of Array.from(root.children)) {
    if(!(line instanceof HTMLElement) || line===probe)continue;
    probe.textContent=hangingPrefix(line.textContent??"");
    line.style.setProperty("--hang",`${probe.getBoundingClientRect().width}px`);
  }
  probe.remove();
}

export function renderParagraphs(root:HTMLElement,lines:RichText[]) {
  const document=root.ownerDocument;
  root.replaceChildren(...(lines.length?lines:[[]]).map(line=>{
    const paragraph=document.createElement("div");
    paragraph.className="emphasis-line";
    for(const run of line) {
      if(!run.text)continue;
      const span=document.createElement("span");
      span.textContent=run.text;
      if(run.color)span.dataset.color=run.color;
      if(run.bold)span.dataset.bold="true";
      paragraph.append(span);
    }
    if(!plainText(line))paragraph.append(document.createElement("br"));
    return paragraph;
  }));
  measureParagraphs(root);
}

export function selectParagraphs(root:HTMLElement,caret:Caret,reveal=false) {
  function point(at:number):[Node,number] {
    const lines=Array.from(root.children);
    for(let i=0;i<lines.length;i++) {
      const line=lines[i],length=line.textContent?.length??0;
      if(at<=length || i===lines.length-1) {
        at=Math.min(at,length);
        const walker=root.ownerDocument.createTreeWalker(line,NodeFilter.SHOW_TEXT);
        let node:Node|null;
        while((node=walker.nextNode())) {
          const size=node.textContent?.length??0;
          if(at<=size)return [node,at];
          at-=size;
        }
        return [line,0];
      }
      at-=length+1;
    }
    return [root,0];
  }
  const start=point(Math.max(0,caret.start)),end=point(Math.max(0,caret.end));
  const backward=caret.direction==="backward",anchor=backward?end:start,focus=backward?start:end;
  root.ownerDocument.getSelection()?.setBaseAndExtent(...anchor,...focus);
  if(!reveal)return;
  const range=root.ownerDocument.createRange();
  range.setStart(...focus);range.collapse(true);
  const rect=range.getClientRects()[0] ?? (focus[0] instanceof HTMLElement?focus[0]:focus[0].parentElement)?.getBoundingClientRect();
  if(!rect)return;
  const bounds=root.getBoundingClientRect(),top=bounds.top+root.clientTop,bottom=top+root.clientHeight;
  if(rect.top<top)root.scrollTop+=rect.top-top;
  else if(rect.bottom>bottom)root.scrollTop+=rect.bottom-bottom;
}
