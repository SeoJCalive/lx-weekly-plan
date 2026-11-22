import type { CellAddress, TableCell, WorkTable } from "./weekly-plan";

export interface TableCellStyle {
  background: string;
  fontSize: number;
  bold: boolean;
  charPrId: string;
  borderFillId: string;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: number;
  padding: { left: number; right: number; top: number; bottom: number };
  borders: { left: string; right: string; top: string; bottom: string };
}
export interface TableStyles {
  header: TableCellStyle;
  body: TableCellStyle;
  margin: { left: number; right: number };
  inline: { leading: number; gap: number; trailing: number; beforeSpacing: number; rowSpacing:number; groupSpacing:number; slack: number;
    bodyMargin: { left: number; right: number; top: number; bottom: number } };
  tables: Record<string, { rows: number; columns: number; cells: Record<string, TableCellStyle>;
    beside: boolean; inline:boolean; margin: { left: number; right: number } }>;
}
/** Cell origins survive insertions, deletions and merges without exposing a style control. */
export const cellOrigin = (cell: TableCell): CellAddress => cell.styleFrom ?? { row: cell.row, column: cell.column };

export function tableCellStyle(table: WorkTable, cell: TableCell, styles: TableStyles): TableCellStyle {
  const origin = cellOrigin(cell), source = styles.tables[table.id];
  let style = source ? source.cells[`${Math.min(origin.row, source.rows - 1)}/${Math.min(origin.column, source.columns - 1)}`] :
    origin.row === 0 ? styles.header : styles.body;
  if(!source)style={...style,borders:{
    left:cell.column===0?styles.body.borders.left.replace("solid","none"):styles.body.borders.left,
    right:cell.column+cell.colSpan===table.columns?styles.body.borders.right.replace("solid","none"):styles.body.borders.right,
    top:cell.row===0?styles.header.borders.top:styles.body.borders.top,
    bottom:styles.body.borders.bottom}};
  return cell.background ? {...style, background: cell.background === "header" ? "#D9D9D9" : "#F2F2F2"} : style;
}

export const besidePrevious = (table: WorkTable, styles: TableStyles): boolean =>
  table.beside ?? styles.tables[table.id]?.beside ?? false;
export const tableMargins = (table: WorkTable, styles: TableStyles) => styles.tables[table.id]?.margin ?? styles.margin;
export const tableRowLeading = (tables: WorkTable[], styles: TableStyles) =>
  tables.length>1 || !styles.tables[tables[0].id] || styles.tables[tables[0].id].inline ? styles.inline.leading : 0;

export function removeTable(tables:WorkTable[],id:string,styles:TableStyles):WorkTable[] {
  return tableRows(tables,styles).flatMap(row=>{
    const remaining=row.filter(table=>table.id!==id);
    return row[0].id===id && remaining.length ? [{...remaining[0],beside:false},...remaining.slice(1)] : remaining;
  });
}

export function tablePartWidth(parts:number,width:number,styles:TableStyles,margin=styles.margin,part=0):number {
  const available=width-styles.inline.trailing-parts*(margin.left+margin.right)-
    styles.inline.leading-styles.inline.gap*(parts-1);
  return Math.floor(available/parts)+(part===parts-1?available%parts:0);
}

export function arrangeTables(tables:WorkTable[],width:number,styles:TableStyles):WorkTable[] {
  return tableRows(tables,styles).flatMap(row=>row.map((table,index)=>{
    const parts=tableWidthParts(table,width,styles);
    if(!parts)return table;
    const total=table.columnWidths.reduce((a,b)=>a+b,0);
    const next=tablePartWidth(parts,width,styles,tableMargins(table,styles),index%parts);
    if(next===total)return table;
    let used=0;
    return {...table,columnWidths:table.columnWidths.map(w=>{
      const start=Math.floor(used*next/total);used+=w;return Math.floor(used*next/total)-start;
    })};
  }));
}

export function tableWidthParts(table:WorkTable,width:number,styles:TableStyles):number|undefined {
  const total=table.columnWidths.reduce((a,b)=>a+b,0),margin=tableMargins(table,styles);
  return [1,2,3].find(parts=>[0,parts-1].some(part=>tablePartWidth(parts,width,styles,margin,part)===total));
}

/** Both preview and export use the same explicit rows, including legacy form defaults. */
export function tableRows(tables: WorkTable[], styles: TableStyles): WorkTable[][] {
  const rows: WorkTable[][] = [];
  for (const table of tables) {
    if (rows.length && besidePrevious(table, styles)) rows[rows.length - 1].push(table);
    else rows.push([table]);
  }
  return rows;
}

export function tableRowWidth(tables: WorkTable[], styles: TableStyles): number {
  return tables.reduce((width, table) => {
    const margin = tableMargins(table, styles);
    return width + table.columnWidths.reduce((a,b)=>a+b,0) + margin.left + margin.right;
  }, tableRowLeading(tables,styles) + styles.inline.gap * (tables.length - 1));
}
