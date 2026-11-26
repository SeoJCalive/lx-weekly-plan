/** Indent continuation lines to the text after the marker, including literal spaces. */
export const hangingPrefix = (text:string):string => /^[ \t\u3000]*(?:○|\*+|-)[ \t\u3000]+/u.exec(text)?.[0] ?? "";
