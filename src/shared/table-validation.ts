import type { WorkTable } from "./weekly-plan";
import { tableRows, tableRowWidth, type TableStyles } from "./table-style";

export const tableWidthError = "앞 표와 합친 폭이 본문보다 넓어 옆에 붙일 수 없습니다.";

export function validateTableLayout(tables: WorkTable[], width: number, styles: TableStyles): void {
  for (const row of tableRows(tables, styles))
    if (row.length > 1 && tableRowWidth(row, styles) > width-styles.inline.trailing)
      throw Error(tableWidthError);
}

/** Structural contract shared by the save endpoint and the Hancom exporter. */
export function validateTable(table:WorkTable):void {
  if (table.beside !== undefined && typeof table.beside !== "boolean")
    throw Error("표의 옆 배치 값이 올바르지 않습니다.");
  if(!Number.isInteger(table.rows) || !Number.isInteger(table.columns) ||
    table.rows<1 || table.columns<1 || table.columnWidths.length!==table.columns || table.rowHeights.length!==table.rows ||
    table.columnWidths.some(w=>!Number.isFinite(w) || w<=0) || table.rowHeights.some(h=>!Number.isFinite(h) || h<0))
    throw Error("Invalid table dimensions: 행·열 개수와 크기를 확인하세요.");
  const occupied=new Set<string>();
  for(const c of table.cells) {
    if(c.background !== undefined && c.background !== "header" && c.background !== "gray")
      throw Error("셀 색은 머리 색과 회색만 사용할 수 있습니다.");
    if(![c.row,c.column,c.rowSpan,c.colSpan].every(Number.isInteger) || c.row<0 || c.column<0 ||
      c.rowSpan<1 || c.colSpan<1 || c.row+c.rowSpan>table.rows || c.column+c.colSpan>table.columns)
      throw Error("Table cell outside table bounds: 셀이 표 밖으로 나갑니다.");
    for(let r=c.row;r<c.row+c.rowSpan;r++)for(let col=c.column;col<c.column+c.colSpan;col++){
      const key=`${r}/${col}`;
      if(occupied.has(key))throw Error("Overlapping table cells: 셀 범위가 겹칩니다.");
      occupied.add(key);
    }
    if(c.formula) {
      const {from,to}=c.formula;
      if(![from.row,from.column,to.row,to.column].every(Number.isInteger) || from.row<0 || from.column<0 ||
        to.row>=table.rows || to.column>=table.columns || from.row>to.row || from.column>to.column ||
        table.cells.some(other=>other.formula && other.row<=to.row && other.row+other.rowSpan>from.row &&
          other.column<=to.column && other.column+other.colSpan>from.column))
        throw Error("Invalid SUM range: 표 안에서 합계 셀을 제외한 범위를 지정하세요.");
    }
  }
  if(occupied.size!==table.rows*table.columns)throw Error("Table has uncovered cells: 표에 누락된 셀이 있습니다.");
}
