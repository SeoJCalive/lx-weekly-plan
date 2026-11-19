import { plainText, type RichText, type TextColor } from "../shared/weekly-plan";

export type Emphasis = "bold" | TextColor | "clear";
export function emphasize(lines: RichText[], start: number, end: number, mark: Emphasis): RichText[] {
  let offset=0;
  return lines.map(line=>{
    const result=line.flatMap(span=>{
      const {text}=span, a=Math.max(0,start-offset), b=Math.min(text.length,end-offset);
      offset+=text.length;
      if (a>=b) return [span];
      const part=text.slice(a,b);
      return [...(a ? [{...span,text:text.slice(0,a)}] : []),
        mark==="clear" ? {text:part,bold:false} : {...span,text:part,...(mark==="bold" ? {bold:true} : {color:mark})},
        ...(b<text.length ? [{...span,text:text.slice(b)}] : [])];
    });
    offset++; // A textarea represents the paragraph boundary with one newline.
    return result;
  });
}

/** Keep the original spans outside the changed range, including on either side of a paste. */
export function editText(old: RichText, next: string, bold = false): RichText {
  const prev = plainText(old);
  if (prev === next) return old;
  let left = 0, right = 0;
  while (left < Math.min(prev.length,next.length) && prev[left] === next[left]) left++;
  while (right < Math.min(prev.length,next.length)-left && prev.at(-1-right) === next.at(-1-right)) right++;
  function slice(start: number, end: number) {
    let pos = 0;
    return old.flatMap(span => {
      const from = Math.max(start-pos,0), to = Math.min(end-pos,span.text.length);
      pos += span.text.length;
      return to > from ? [{...span,text:span.text.slice(from,to)}] : [];
    });
  }
  const insert = next.slice(left,next.length-right);
  const before = slice(0,left), after = slice(prev.length-right,prev.length);
  const style = before.at(-1) ?? after[0] ?? {bold};
  return [...before,...(insert ? [{...style,text:insert}] : []),...after];
}

export const linesText = (lines: RichText[]) => lines.map(plainText).join("\n");
export function editLines(old: RichText[], value: string): RichText[] {
  if (value === linesText(old)) return old;
  if (!value) return [];
  const lines = value.split("\n");
  let start=0,end=0;
  while (start<Math.min(lines.length,old.length) && lines[start]===plainText(old[start])) start++;
  while (end<Math.min(lines.length,old.length)-start && lines.at(-1-end)===plainText(old.at(-1-end)!)) end++;
  return lines.map((line,i) => i<start ? old[i] : i>=lines.length-end ? old[old.length-(lines.length-i)] :
    editText(i<old.length-end ? old[i] : [],line));
}
export function marked(lines: RichText[], original: RichText[], note: boolean) {
  return lines.map((line,i) => {
    const text = plainText(line);
    if (!text.trim() || /^\s*(?:○|\*)/.test(text) || original.some(x=>plainText(x)===text)) return line;
    return [{text:note ? (i===0 ? " * " : " ** ") : " ○ "},...line];
  });
}
