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
  margin: { left: number; right: number };
  inline: { leading: number; gap: number };
  tables: Record<string, { rows: number; columns: number; cells: Record<string, TableCellStyle>;
    beside: boolean; margin: { left: number; right: number } }>;
}
/** Cell origins survive insertions, deletions and merges without exposing a style control. */
export const cellOrigin = (cell: TableCell): CellAddress => cell.styleFrom ?? { row: cell.row, column: cell.column };

export function tableCellStyle(table: WorkTable, cell: TableCell, styles: TableStyles): TableCellStyle {
  const origin = cellOrigin(cell), source = styles.tables[table.id];
  const style = source ? source.cells[`${Math.min(origin.row, source.rows - 1)}/${Math.min(origin.column, source.columns - 1)}`] :
    origin.row === 0 ? styles.header : styles.body;
  return cell.background ? {...style, background: cell.background === "header" ? styles.header.background : "#F2F2F2"} : style;
}

export const besidePrevious = (table: WorkTable, styles: TableStyles): boolean =>
  table.beside ?? styles.tables[table.id]?.beside ?? false;
export const tableMargins = (table: WorkTable, styles: TableStyles) => styles.tables[table.id]?.margin ?? styles.margin;

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
  }, tables.length > 1 ? styles.inline.leading + styles.inline.gap * (tables.length - 1) : 0);
}
