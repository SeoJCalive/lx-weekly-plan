import { plainText, type RichText } from "./weekly-plan";

/** Carry template-only typography across an edit on the unchanged prefix and suffix. */
export function formRuns<T>(line:RichText,source:{text:string;style:T}[],fallback:T) {
  const before=source.map(s=>s.text).join(""),after=plainText(line),n=Math.min(before.length,after.length);
  let left=0,right=0;
  while(left<n && before[left]===after[left])left++;
  while(right<n-left && before.at(-1-right)===after.at(-1-right))right++;
  const intervals:{end:number;style:T}[]=[];
  function append(length:number,style:T) {
    if(length<=0)return;
    const last=intervals.at(-1),end=(last?.end??0)+length;
    if(last?.style===style)last.end=end;else intervals.push({end,style});
  }
  function retained(start:number,end:number) {
    let pos=0;
    for(const run of source) {
      append(Math.min(pos+run.text.length,end)-Math.max(pos,start),run.style);
      pos+=run.text.length;
    }
  }
  retained(0,left);append(after.length-left-right,fallback);retained(before.length-right,before.length);
  let index=0,pos=0;
  return line.flatMap(span=>{
    const result=[];
    for(let offset=0;offset<span.text.length;){
      const segment=intervals[index],length=Math.min(span.text.length-offset,segment.end-pos);
      result.push({span:{...span,text:span.text.slice(offset,offset+length)},style:segment.style});
      offset+=length;pos+=length;if(pos===segment.end)index++;
    }
    return result;
  });
}
