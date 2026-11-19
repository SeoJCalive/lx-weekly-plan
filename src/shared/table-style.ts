import type { CellAddress, TableCell, WorkTable } from "./weekly-plan";

export interface TableCellStyle {
  background: string;
  fontSize: number;
  bold: boolean;
  charPrId: string;
  borderFillId: string;
}
export interface TableStyles {
  header: TableCellStyle;
  body: TableCellStyle;
  tables: Record<string, { rows: number; columns: number; cells: Record<string, TableCellStyle> }>;
}
/** Cell origins survive insertions, deletions and merges without exposing a style control. */
export const cellOrigin = (cell: TableCell): CellAddress => cell.styleFrom ?? { row: cell.row, column: cell.column };

export function tableCellStyle(table: WorkTable, cell: TableCell, styles: TableStyles): TableCellStyle {
  const origin = cellOrigin(cell), source = styles.tables[table.id];
  if (source) return source.cells[`${Math.min(origin.row, source.rows - 1)}/${Math.min(origin.column, source.columns - 1)}`];
  return origin.row === 0 ? styles.header : styles.body;
}
